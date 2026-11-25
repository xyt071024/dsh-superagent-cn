/**
 * v0.3.17 综合验收测试：覆盖 M07-m1/m2（大数量全可达与稀疏存储）、项 1–7（预设修复、同工作区独立会话、
 * 自然复杂任务主动拆分、成员双向互通/动态补位/原负责人合并/复核回避、严格原窗口模型跟随与下架报错、吞吐口径验证）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { startRuntime } from './fixtures/host.ts'
import { assessComplexity, configuredSlotModel } from '../src/app/routing.ts'
import { extractDeliverablesFromText } from '../src/app/divisions.ts'
import { ROUTER_PRESET } from '../src/app/sessions.ts'
import { KV } from '../src/kv.ts'
import { RoutingConfigSchema, SettingsSchema } from '../src/policy.ts'
import { computeRunMetrics, runThroughputBenchmark, startMockSseServer, summarizeRound } from '../scripts/benchmark-throughput.mjs'

describe('v0.3.17 M07-m2 稀疏高编号模型配置与旧数组兼容', () => {
  it('仅配置第 5000 与第 100000 位模型时体积随实际选择数增长，重启可读且其余槽位正常继承', async () => {
    const parsed = RoutingConfigSchema.parse({
      multiSession: 'auto',
      maxSessions: 100_000,
      sessionModels: [],
      sessionModelOverrides: {
        '4999': { provider: 'prov-5k', model: 'model-5k' },
        '99999': { provider: 'prov-100k', model: 'model-100k' },
      },
    })
    expect(Buffer.byteLength(JSON.stringify(parsed))).toBeLessThan(350)
    expect(configuredSlotModel(parsed, 0)).toBeNull()
    expect(configuredSlotModel(parsed, 4999)).toEqual({ provider: 'prov-5k', model: 'model-5k' })
    expect(configuredSlotModel(parsed, 99999)).toEqual({ provider: 'prov-100k', model: 'model-100k' })

    const h = await startRuntime()
    try {
      const get0 = (await h.api('GET', 'settings')).body as { blocks: { routing: { revision: number; value: Record<string, unknown> } } }
      const put = await h.api('PUT', 'settings/routing', {
        revision: get0.blocks.routing.revision,
        value: {
          ...get0.blocks.routing.value,
          multiSession: 'auto',
          maxSessions: 100_000,
          sessionModels: [],
          sessionModelOverrides: {
            '4999': { provider: 'prov-5k', model: 'model-5k' },
            '99999': { provider: 'prov-100k', model: 'model-100k' },
          },
        },
      })
      expect(put.status).toBe(200)
      const saved = h.runtime.store.settings().routing
      expect(saved.maxSessions).toBe(100_000)
      expect(saved.sessionModels).toEqual([])
      expect(saved.sessionModelOverrides?.['99999']).toEqual({ provider: 'prov-100k', model: 'model-100k' })
      expect(Buffer.byteLength(JSON.stringify(saved))).toBeLessThan(350)
      expect(configuredSlotModel(saved, 500)).toBeNull()
    } finally { await h.stop() }
  })
})

describe('v0.3.17 项 2/3/4：预设乱码修复、工作区独立对话归属与自然复杂任务主动拆分', () => {
  it('cordis.patch.yml 预设名称与说明无乱码，清晰区分自动分工协调与内部执行器', () => {
    const patch = readFileSync(join(process.cwd(), 'cordis.patch.yml'), 'utf8')
    expect(patch).not.toMatch(/鎵ц|涓撶敤|绉掕浆/)
    expect(patch).toContain('Super Agent · 自动分工协调')
    expect(patch).toContain('Super Agent · 内部执行器（自动使用）')
  })

  it('工作区 A 普通聊天启用自动分工后，自然复杂任务在工作区 A 创建独立顶层对话，简单任务留在原聊天，且支持取消与重启恢复', async () => {
    const h = await startRuntime()
    try {
      const wsA = { id: 'ws-workspace-a', path: join(h.directory, 'workspace-a'), sessionIds: ['chat-in-ws-a'] as string[] }
      const wsB = { id: 'ws-workspace-b', path: join(h.directory, 'workspace-b'), sessionIds: [h.runtime.masterId] as string[] }
      const createdInWorkspace: Array<{ sessionId: string; workspaceId?: string; parentSession?: string }> = []
      const workspaces = new Map([[wsA.id, wsA], [wsB.id, wsB]])
      Object.assign(h.ctx.workspaceRegistry as object, {
        list: () => [...workspaces.values()],
        get: (id: string) => workspaces.get(id),
        resolveByPath: async (p: string) => [...workspaces.values()].find(w => w.path === p),
        create: async (p: string) => {
          const found = [...workspaces.values()].find(w => w.path === p)
          if (found) return found
          const next = { id: `ws-${workspaces.size + 1}`, path: p, sessionIds: [] as string[] }
          workspaces.set(next.id, next)
          return next
        },
      })
      const origCreate = h.controller.create.getMockImplementation()!
      h.controller.create.mockImplementation(async (req: { sessionId: string; workspaceId?: string; parentSession?: string }) => {
        createdInWorkspace.push({ sessionId: req.sessionId, workspaceId: req.workspaceId, parentSession: req.parentSession })
        if (req.workspaceId && workspaces.has(req.workspaceId)) {
          workspaces.get(req.workspaceId)!.sessionIds.push(req.sessionId)
        }
        return origCreate(req as never)
      })

      // 在工作区 A 创建普通聊天会话，并选择「Super Agent · 自动分工协调」预设
      await h.controller.create({ sessionId: 'chat-in-ws-a' } as never)
      const chatAgent = h.agents.get('chat-in-ws-a')!
      chatAgent.session.header.agentPreset = ROUTER_PRESET
      h.ctx.reflect.provide('agentPresets' as never, {
        select: vi.fn(async () => ROUTER_PRESET),
        presetForSession: (s: { header?: { agentPreset?: string } }) => s.header?.agentPreset ?? null,
      })
      h.ctx.emit('agent-preset/selected', 'chat-in-ws-a', ROUTER_PRESET)
      await vi.waitFor(() => expect(h.tools.get('chat-in-ws-a')?.has('orchestrator_dispatch')).toBe(true))

      // 给工作区 A 的聊天设置实时模型 B，同时协调器 masterId 设置不同模型 A
      vi.spyOn(h.agents.get(h.runtime.masterId)!.session, 'snapshotEvents').mockReturnValue([
        { type: 'model/selection', data: { provider: 'coord-prov', model: 'model-A' } },
      ] as never)
      vi.spyOn(chatAgent.session, 'snapshotEvents').mockReturnValue([
        { type: 'model/selection', data: { provider: 'chat-prov', model: 'model-B' } },
      ] as never)

      // 1. 不带“开会话”字眼的自然复杂任务 -> 自动识别并拆分 3 个独立顶层对话，全部归属工作区 A
      const naturalPrompt = '请分别核对这份项目的安装说明、设置项说明和更新日志，各自给出文件依据，最后汇总'
      expect(assessComplexity({ threshold: 60, brief: naturalPrompt }).hard).toBe(true)
      expect(extractDeliverablesFromText('项目文档核对', naturalPrompt)).toHaveLength(3)

      const dispatched = await h.runTool('chat-in-ws-a', 'orchestrator_dispatch', {
        task_id: 'natural-audit',
        title: '项目文档核对',
        brief: naturalPrompt,
        plan_key: 'nat-1',
      }) as {
        workspace_id: string
        directory: string
        extra_sessions: number
        divisions: Array<{ division_id: string; session_id: string; model: { provider: string; model: string } }>
      }
      expect(dispatched.workspace_id).toBe(wsA.id)
      expect(dispatched.directory).toBe(wsA.path)
      expect(dispatched.extra_sessions).toBe(3)
      for (const div of dispatched.divisions) {
        const rec = createdInWorkspace.find(c => c.sessionId === div.session_id)
        expect(rec?.workspaceId).toBe(wsA.id)
        expect(rec?.parentSession).toBeUndefined()
        // 严格继承发起聊天模型 B，绝不使用协调器模型 A
        expect(div.model).toEqual({ provider: 'chat-prov', model: 'model-B' })
      }

      // 重放同一计划幂等复用，不产生重复侧栏行
      const countBefore = createdInWorkspace.length
      const replay = await h.runTool('chat-in-ws-a', 'orchestrator_dispatch', {
        task_id: 'natural-audit',
        title: '项目文档核对',
        brief: naturalPrompt,
        plan_key: 'nat-1',
      }) as { reused: boolean; extra_sessions: number }
      expect(replay.reused).toBe(true)
      expect(createdInWorkspace.length).toBe(countBefore)

      // 2. 单步简单任务留在原聊天，不开额外会话
      const simple = await h.runTool('chat-in-ws-a', 'orchestrator_dispatch', {
        task_id: 'simple-typo',
        title: '改端口',
        brief: '把端口号 3000 改成 3001',
        plan_key: 'simple-p1',
      }) as { extra_sessions: number }
      expect(simple.extra_sessions).toBe(0)

      // 3. 重启恢复场景：保持持久标记，重新触发 agent/created 时应自动恢复协调工具权限
      const recoveredId = 'chat-restart-recovered'
      h.runtime.store.set(KV.sessions.chatCoordinator(recoveredId), true)
      await h.controller.create({ sessionId: recoveredId } as never)
      const recoveredAgent = h.agents.get(recoveredId)!
      recoveredAgent.session.header.agentPreset = ROUTER_PRESET
      await h.ctx.serial('agent/created', { agent: recoveredAgent, source: 'resume' } as never)
      await vi.waitFor(() => expect(h.tools.get(recoveredId)?.has('orchestrator_dispatch')).toBe(true))

      // 4. 切回普通预设（取消自动分工）-> 立刻释放 orchestrator_* 工具权限
      chatAgent.session.header.agentPreset = 'standard'
      h.ctx.emit('agent-preset/selected', 'chat-in-ws-a', 'standard')
      expect(h.tools.get('chat-in-ws-a')?.has('orchestrator_dispatch')).toBe(false)
    } finally { await h.stop() }
  })
})

describe('v0.3.17 项 6：模型目录、同名模型区分、严格跟随原窗口与下架报错', () => {
  it('验证全留空用 B、第 2 位指定 C 得 B/C/B、原窗口改 D 得 D/C/D、未手选继承宿主默认、同名模型区分、下架明确报错不静默替换', async () => {
    const h = await startRuntime(store => {
      const cur = store.settings()
      store.saveSettings(SettingsSchema.parse({
        ...cur,
        routing: { ...cur.routing, multiSession: 'auto', maxSessions: 5 },
      }))
    })
    try {
      let catalog = {
        default: { provider: 'host-def', model: 'default-M' },
        routableProviders: ['coord-prov', 'prov-1', 'prov-2', 'host-def'],
        failures: [],
        groups: [
          { id: 'coord-prov', name: 'Coordinator Provider', models: [{ id: 'model-A', name: 'Model A' }] },
          { id: 'prov-1', name: 'Provider One', models: [{ id: 'shared-name', name: 'Shared (P1)' }, { id: 'model-B', name: 'Model B' }, { id: 'model-D', name: 'Model D' }] },
          { id: 'prov-2', name: 'Provider Two', models: [{ id: 'shared-name', name: 'Shared (P2)' }, { id: 'model-C', name: 'Model C' }] },
          { id: 'host-def', name: 'Host Default', models: [{ id: 'default-M', name: 'Default M' }] },
        ],
      }
      ;(h.controller as unknown as { modelCatalog?: () => Promise<typeof catalog> }).modelCatalog = async () => catalog

      // 协调器设为 A
      vi.spyOn(h.agents.get(h.runtime.masterId)!.session, 'snapshotEvents').mockReturnValue([
        { type: 'model/selection', data: { provider: 'coord-prov', model: 'model-A' } },
      ] as never)

      // 发起聊天窗口：首次选 B
      await h.controller.create({ sessionId: 'user-chat-1' } as never)
      const chat1 = h.agents.get('user-chat-1')!
      let chat1Selection: { provider: string; model: string } | null = { provider: 'prov-1', model: 'model-B' }
      vi.spyOn(chat1.session, 'snapshotEvents').mockImplementation(() =>
        chat1Selection ? [{ type: 'model/selection', data: chat1Selection }] as never : [])

      const threeSpecs = [
        { divisionId: 'd1', title: 'D1', brief: 'Part 1' },
        { divisionId: 'd2', title: 'D2', brief: 'Part 2' },
        { divisionId: 'd3', title: 'D3', brief: 'Part 3' },
      ]

      // 场景 1：全部位置留空 -> 全部使用 B（绝不回退到协调器的 A）
      const r1 = await h.runtime.divisions.dispatch({
        taskId: 'model-all-blank', title: 'All Blank', brief: 'Three parts', difficulty: 90,
        originSessionId: 'user-chat-1', planKey: 'k1', divisions: threeSpecs,
      })
      expect(r1.plan.divisions.map(d => `${d.model?.provider}/${d.model?.model}`)).toEqual([
        'prov-1/model-B', 'prov-1/model-B', 'prov-1/model-B',
      ])

      // 场景 2：仅给第 2 位（slot 1）指定 C -> B, C, B
      const s1 = h.runtime.store.settings()
      h.runtime.store.saveSettings(SettingsSchema.parse({
        ...s1,
        routing: { ...s1.routing, sessionModelOverrides: { '1': { provider: 'prov-2', model: 'model-C' } } },
      }))
      const r2 = await h.runtime.divisions.dispatch({
        taskId: 'model-b-c-b', title: 'BCB', brief: 'Three parts', difficulty: 90,
        originSessionId: 'user-chat-1', planKey: 'k2', divisions: threeSpecs,
      })
      expect(r2.plan.divisions.map(d => `${d.model?.provider}/${d.model?.model}`)).toEqual([
        'prov-1/model-B', 'prov-2/model-C', 'prov-1/model-B',
      ])

      // 场景 3：原窗口改为 D，新任务 -> D, C, D
      chat1Selection = { provider: 'prov-1', model: 'model-D' }
      const r3 = await h.runtime.divisions.dispatch({
        taskId: 'model-d-c-d', title: 'DCD', brief: 'Three parts', difficulty: 90,
        originSessionId: 'user-chat-1', planKey: 'k3', divisions: threeSpecs,
      })
      expect(r3.plan.divisions.map(d => `${d.model?.provider}/${d.model?.model}`)).toEqual([
        'prov-1/model-D', 'prov-2/model-C', 'prov-1/model-D',
      ])

      // 场景 4：原窗口从未手动选过模型但宿主有有效默认值 -> 继承 host-def/default-M，而非协调器 model-A
      chat1Selection = null
      const r4 = await h.runtime.divisions.dispatch({
        taskId: 'model-host-default', title: 'Host Default', brief: 'Two parts', difficulty: 90,
        originSessionId: 'user-chat-1', planKey: 'k4', divisions: [threeSpecs[0]!, threeSpecs[2]!],
      })
      expect(r4.plan.originModelSource).toBe('host-default')
      expect(r4.plan.divisions[0]!.model).toEqual({ provider: 'host-def', model: 'default-M' })

      // 场景 5：两家供应商同名模型精确区分（prov-1/shared-name vs prov-2/shared-name）
      const s2 = h.runtime.store.settings()
      h.runtime.store.saveSettings(SettingsSchema.parse({
        ...s2,
        routing: {
          ...s2.routing,
          sessionModelOverrides: {
            '0': { provider: 'prov-1', model: 'shared-name' },
            '1': { provider: 'prov-2', model: 'shared-name' },
          },
        },
      }))
      const r5 = await h.runtime.divisions.dispatch({
        taskId: 'model-same-name', title: 'Same Name', brief: 'Two parts', difficulty: 90,
        originSessionId: 'user-chat-1', planKey: 'k5', divisions: [threeSpecs[0]!, threeSpecs[1]!],
      })
      expect(r5.plan.divisions[0]!.model).toEqual({ provider: 'prov-1', model: 'shared-name' })
      expect(r5.plan.divisions[1]!.model).toEqual({ provider: 'prov-2', model: 'shared-name' })

      // 场景 6：移除已指定的模型（下架）-> 明确报错，取消静默回退
      catalog = {
        ...catalog,
        groups: catalog.groups.filter(g => g.id !== 'prov-2'),
      }
      await expect(h.runtime.divisions.dispatch({
        taskId: 'model-removed', title: 'Removed Model', brief: 'Two parts', difficulty: 90,
        originSessionId: 'user-chat-1', planKey: 'k6', divisions: [threeSpecs[0]!, threeSpecs[1]!],
      })).rejects.toThrow(/prov-2.*no longer available/)
    } finally { await h.stop() }
  })
})

describe('v0.3.17 项 5：动态补位、工作项原子领取/提交/合并、防循环与复核回避', () => {
  it('开发/测试/调试/审查四分工完成动态补位领取、幂等去重、原负责人合并、接力保留、防循环与独立复核回避', async () => {
    const h = await startRuntime(store => {
      const cur = store.settings()
      store.saveSettings(SettingsSchema.parse({
        ...cur,
        executor: { ...cur.executor, reviewEnabled: true },
        routing: { ...cur.routing, multiSession: 'auto', maxSessions: 5 },
      }))
    })
    try {
      const dispatched = await h.runtime.divisions.dispatch({
        taskId: 'collab-4',
        title: '四分工动态补位任务',
        brief: '开发含两个可独立合并项，审查等待依赖时先领取其中一项协助完成并合并，空闲后再领测试项',
        difficulty: 95,
        originSessionId: h.runtime.masterId,
        planKey: 'collab-p1',
        divisions: [
          {
            divisionId: 'dev',
            title: '开发',
            brief: '负责模块核心与工具函数两项工作',
            workItems: [
              { itemId: 'dev-part-a', title: '核心逻辑 A', brief: '实现核心逻辑 A' },
              { itemId: 'dev-part-b', title: '工具模块 B', brief: '实现独立工具模块 B' },
            ],
          },
          {
            divisionId: 'test',
            title: '测试',
            brief: '负责集成测试',
            workItems: [
              { itemId: 'test-case-1', title: '边界单测 1', brief: '编写边界单测', dependsOn: ['dev-part-a', 'dev-part-b'] },
            ],
          },
          { divisionId: 'debug', title: '调试', brief: '负责日志与性能诊断' },
          { divisionId: 'review_prep', title: '预审查成员', brief: '等待开发完成后开展审查', dependsOn: ['dev'] },
        ],
      })

      const devSession = dispatched.plan.divisions.find(d => d.divisionId === 'dev')!.sessionId
      const testSession = dispatched.plan.divisions.find(d => d.divisionId === 'test')!.sessionId
      const debugSession = dispatched.plan.divisions.find(d => d.divisionId === 'debug')!.sessionId

      // 1. 等待依赖的 review_prep 主动原子领取 dev-part-b（模拟提前接手补位）
      const claim1 = await h.runtime.divisions.claimWorkItem({
        taskId: 'collab-4', itemId: 'dev-part-b', claimantDivisionId: 'review_prep', eventId: 'claim-b-1',
      })
      expect(claim1.claimed).toBe(true)
      expect(claim1.deduplicated).toBe(false)
      expect(claim1.item.assigneeDivisionId).toBe('review_prep')

      // 相同领取消息投递两次 -> 幂等只生效一次
      const claimDup = await h.runtime.divisions.claimWorkItem({
        taskId: 'collab-4', itemId: 'dev-part-b', claimantDivisionId: 'review_prep', eventId: 'claim-b-1',
      })
      expect(claimDup.deduplicated).toBe(true)
      expect(claimDup.item.claimRevision).toBe(1)

      // 并发另一成员 debug 试图争抢同一工作项 -> 明确拒绝防并发覆盖
      const claimRace = await h.runtime.divisions.claimWorkItem({
        taskId: 'collab-4', itemId: 'dev-part-b', claimantDivisionId: 'debug', eventId: 'claim-b-race',
      })
      expect(claimRace.claimed).toBe(false)
      expect(claimRace.reason).toContain('already_claimed_by_review_prep')

      // 验证原负责人 dev 收到了接手通知
      const devDeliveries = h.deliveries.mock.calls.filter(([c]) => c.sessionId === devSession).map(([c]) => c.text).join('\n')
      expect(devDeliveries).toContain('work_item_claimed')
      expect(devDeliveries).toContain('dev-part-b')

      // 2. 双方分别提交成果（重复提交幂等只生效一次），原负责人 dev 确认合并
      await h.runTool(devSession, 'orchestrator_division_submit_item', {
        item_id: 'dev-part-a', summary: '核心逻辑 A 已完成', deliverable: 'src/core-a.ts', event_id: 'sub-a-1',
      })
      await h.runtime.divisions.submitWorkItem({
        taskId: 'collab-4', itemId: 'dev-part-b', submitterDivisionId: 'review_prep',
        summary: '工具模块 B 已完成并通过单测', deliverable: 'src/util-b.ts', eventId: 'sub-b-1',
      })
      const subDup = await h.runtime.divisions.submitWorkItem({
        taskId: 'collab-4', itemId: 'dev-part-b', submitterDivisionId: 'review_prep',
        summary: '工具模块 B 已完成并通过单测', deliverable: 'src/util-b.ts', eventId: 'sub-b-1',
      })
      expect(subDup.deduplicated).toBe(true)

      await h.runTool(devSession, 'orchestrator_division_merge_item', {
        item_id: 'dev-part-a', merge_note: 'A 合并通过', event_id: 'merge-a-1',
      })
      const mergedB = await h.runTool(devSession, 'orchestrator_division_merge_item', {
        item_id: 'dev-part-b', merge_note: 'B 已验收并与 A 合并测试通过', event_id: 'merge-b-1',
      }) as { merged: boolean; unblockedItems: string[] }
      expect(mergedB.merged).toBe(true)
      // 合并后自动解锁依赖二者的 test-case-1
      expect(mergedB.unblockedItems).toContain('test-case-1')

      // 3. 已空闲成员 debug 领取刚解锁的测试项 test-case-1，并在中途经历 60% 接力仍保留认领与回报目标
      const claimTest = await h.runTool(debugSession, 'orchestrator_division_claim_item', {
        item_id: 'test-case-1', event_id: 'claim-t1',
      }) as { claimed: boolean }
      expect(claimTest.claimed).toBe(true)

      const debugAgent = h.agents.get(debugSession)!
      debugAgent.status = 'idle'
      h.controller.inspect.mockResolvedValue({ events: [{ type: 'assistant/message', data: { message: { content: 'DEBUG_HALFWAY' } } }] } as never)
      const moved = await h.runtime.relay.moveDivision('collab-4', 'debug', debugSession, 0.65)
      expect(moved).toHaveProperty('moved')
      const debugGen2 = (moved as { moved: string }).moved
      const injectedSummary = JSON.stringify(h.agents.get(debugGen2)!.inject.mock.calls)
      expect(injectedSummary).toContain('test-case-1')
      expect(injectedSummary).toContain('owner=test')

      // 接班后的 debugGen2 提交 test-case-1，原负责人 test 确认合并
      await h.runTool(debugGen2, 'orchestrator_division_submit_item', {
        item_id: 'test-case-1', summary: '边界单测已补充', deliverable: 'tests/edge.spec.ts', event_id: 'sub-t1',
      })
      await h.runTool(testSession, 'orchestrator_division_merge_item', {
        item_id: 'test-case-1', merge_note: '已合入测试套', event_id: 'merge-t1',
      })

      // 4. 独立复核回避验证：review_prep 参与编写了 dev-part-b，可审查 dev-part-a，但不得独自作为 dev-part-b 最终复核者
      const planNow = h.runtime.divisions.get('collab-4')!
      expect(h.runtime.divisions.canReviewWorkItem(planNow, 'review_prep', 'dev-part-a').allowed).toBe(true)
      expect(h.runtime.divisions.canReviewWorkItem(planNow, 'review_prep', 'dev-part-b').allowed).toBe(false)
      expect(h.runtime.divisions.canReviewWorkItem(planNow, '__review_r1', 'dev-part-b').allowed).toBe(true)

      // 5. 成员定向消息防循环护栏：同一对成员连续互发超过上限被拦截
      for (let i = 1; i <= 6; i++) {
        const res = await h.runTool(i % 2 ? devSession : testSession, 'orchestrator_division_peer_message', {
          to_division_id: i % 2 ? 'test' : 'dev',
          kind: 'clarification',
          content: `round ${i}`,
          event_id: `peer-${i}`,
        }) as { sent: boolean }
        expect(res.sent).toBe(true)
      }
      const blocked = await h.runTool(devSession, 'orchestrator_division_peer_message', {
        to_division_id: 'test',
        kind: 'clarification',
        content: 'round 7 should trip loop guard',
        event_id: 'peer-7',
      }) as { sent: boolean; loopGuardTriggered?: boolean }
      expect(blocked.sent).toBe(false)
      expect(blocked.loopGuardTriggered).toBe(true)

      // 6. 全部分工完成后，独立复查会话 __review_r1（未参与编写）完成最终批准
      await h.runtime.divisions.reportDivision({ taskId: 'collab-4', divisionId: 'dev', state: 'completed', summary: 'dev ok', eventId: 'rep-dev' })
      await h.runtime.divisions.reportDivision({ taskId: 'collab-4', divisionId: 'test', state: 'completed', summary: 'test ok', eventId: 'rep-test' })
      await h.runtime.divisions.reportDivision({ taskId: 'collab-4', divisionId: 'debug', state: 'completed', summary: 'debug ok', eventId: 'rep-debug' })
      await h.runtime.divisions.reportDivision({ taskId: 'collab-4', divisionId: 'review_prep', state: 'completed', summary: 'prep ok', eventId: 'rep-prep' })
      const finalReview = h.runtime.divisions.get('collab-4')!.review!
      expect(finalReview.state).toBe('pending')
      await h.runTool(finalReview.sessionId, 'orchestrator_division_review_submit', {
        approved: true,
        summary: 'Independent reviewer verified all merged deliverables',
      })
      expect(h.runtime.divisions.get('collab-4')!.review!.state).toBe('passed')
    } finally { await h.stop() }
  })
})

describe('v0.3.17 项 7：单会话与三会话并行吞吐测速口径验证', () => {
  it('严格按“三条输出 token 总数 ÷ (最晚末段 - 最早首段)”计算合计吞吐并确认并行重叠输出', async () => {
    // 1. 数学口径单元测试（避免错误地把三条峰值相加）
    const r1 = computeRunMetrics({ lane: 1, dispatchAtMs: 0, firstTokenAtMs: 100, lastTokenAtMs: 1100, completedAtMs: 1120, outputTokens: 200 })
    const r2 = computeRunMetrics({ lane: 2, dispatchAtMs: 0, firstTokenAtMs: 200, lastTokenAtMs: 1200, completedAtMs: 1220, outputTokens: 200 })
    const r3 = computeRunMetrics({ lane: 3, dispatchAtMs: 0, firstTokenAtMs: 300, lastTokenAtMs: 1300, completedAtMs: 1320, outputTokens: 200 })
    const round = summarizeRound(1, 'parallel', [r1, r2, r3])
    // 窗口 = (1300 - 100) / 1000 = 1.2s，合计 = 600 / 1.2 = 500 tok/s（绝非 200+200+200=600）
    expect(round.totalOutputTokens).toBe(600)
    expect(round.aggregateWindowSeconds).toBeCloseTo(1.2, 5)
    expect(round.aggregateTokensPerSecond).toBeCloseTo(500, 5)
    expect(round.overlappingLanesConfirmed).toBe(true)
    expect(round.overlapSeconds).toBeCloseTo(0.8, 5)

    // 2. 本地可控流式 SSE 端到端实跑 3 轮（单会话 vs 3 路并发）
    const mock = await startMockSseServer({ tokensPerResponse: 40, chunkTokens: 5, chunkIntervalMs: 12, ttftMs: 15 })
    try {
      const bench = await runThroughputBenchmark({ endpoint: mock.url, model: 'mock-stream', rounds: 3, concurrency: 3 })
      expect(bench.singleRounds).toHaveLength(3)
      expect(bench.parallelRounds).toHaveLength(3)
      expect(bench.summary.allParallelRoundsOverlapped).toBe(true)
      expect(bench.summary.totalRateLimited).toBe(0)
      expect(Number(bench.summary.parallelAvgAggregateTokPerSec)).toBeGreaterThan(Number(bench.summary.singleAvgTokPerSec) * 1.5)
    } finally {
      await mock.close()
    }
  })
})
