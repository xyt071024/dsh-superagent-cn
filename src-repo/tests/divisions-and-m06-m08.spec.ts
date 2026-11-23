/**
 * 覆盖 M06（继任主会话实际派工与子会话 60% 接力）、M07（多会话规划、独立可打开对话、模型槽位、依赖与复查）、
 * M08（运行时加载版本与配置识别）以及 routing/budget 设置保存接口的完整验收测试。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { KV } from '../src/kv.ts'
import { assessComplexity } from '../src/app/routing.ts'
import { inspect } from '../src/app/self-inspect.ts'
import { VersionTracker } from '../src/app/version-info.ts'
import { SettingsSchema } from '../src/policy.ts'
import { startRuntime, feishu } from './fixtures/host.ts'

describe('M06: 继任主会话权限与子会话 60% 接力', () => {
  it('继任主会话接班后可真实派工并收进度，且 /orchestrator/api/state 返回最新 masterId', async () => {
    const h = await startRuntime()
    try {
      const firstMaster = h.runtime.masterId
      h.agents.get(firstMaster)!.status = 'idle'
      h.controller.inspect.mockResolvedValue({ events: [{ type: 'user/message', data: { content: '准备派工' } }] } as never)
      const moved = await h.runtime.relay.moveCoordinator(firstMaster, 0.8)
      expect(moved).toHaveProperty('moved')
      const secondMaster = h.runtime.masterId
      expect(secondMaster).not.toBe(firstMaster)

      // 继任主会话可以直接调用 orchestrator_dispatch 派工并收到分工回报。
      const dispatched = await h.runTool(secondMaster, 'orchestrator_dispatch', {
        title: '继任后简单任务',
        brief: '把端口号从 3000 改成 3001',
        plan_key: 'post-handover-simple',
      }) as { origin_session_id: string; extra_sessions: number }
      expect(dispatched.origin_session_id).toBe(secondMaster)
      expect(dispatched.extra_sessions).toBe(0)

      // HTTP /orchestrator/api/state 应返回最新 masterId，而非启动时旧值。
      const stateRes = await h.api('GET', 'state')
      expect(stateRes.status).toBe(200)
      expect((stateRes.body as { masterId: string }).masterId).toBe(secondMaster)
    } finally { await h.stop() }
  })

  it('子会话超过 60% 阈值时自动接力到新子会话，保留父子关系、模型槽位与共享状态', async () => {
    const h = await startRuntime(store => {
      const cur = store.settings()
      store.saveSettings(SettingsSchema.parse({
        ...cur,
        routing: { ...cur.routing, multiSession: 'auto', maxSessions: 5, sessionModels: [{ provider: 'p1', model: 'm1' }, { provider: 'p2', model: 'm2' }] },
        budget: { ...cur.budget, archiveEnabled: true, archivePercent: 60 },
      }))
    })
    try {
      const { ticket, sessionId: workerId } = await h.acceptedTicket(feishu('1', '请实现模块 A 与模块 B 并补测试'))
      // 创建真实子会话（由 worker 派生）并绑定模型槽位与父子关系。
      const childId = 'subagent-child-1'
      await h.runtime.sessions.ensureSubagent(childId, h.directory, 'Subagent 1', {
        parentId: workerId, ticketId: ticket.id, slot: 1, model: { provider: 'p2', model: 'm2' }, autoHard: true,
      })
      const childAgent = h.agents.get(childId)!
      expect(childAgent).toBeDefined()
      childAgent.status = 'idle'
      // 模拟上下文达到 65%（超过默认 60% 阈值）与可读历史、未认领共享任务。
      const services = {
        tokenMeter: { contextPressure: () => ({ pressureTokens: 65, contextWindow: 100 }) },
        compaction: { compactNow: vi.fn(async () => ({})) },
      }
      const origGet = (childAgent as unknown as { ctx: { get: (n: string) => unknown } }).ctx.get.bind((childAgent as unknown as { ctx: unknown }).ctx)
      vi.spyOn((childAgent as unknown as { ctx: { get: (n: string) => unknown } }).ctx, 'get').mockImplementation(((n: string) =>
        n in services ? services[n as keyof typeof services] : origGet(n)) as never)
      Object.assign(childAgent as object, { runMaintenance: () => {} })
      h.controller.inspect.mockResolvedValue({
        events: [{ type: 'assistant/message', data: { message: { content: 'SUBAGENT_HALFWAY_CHECKPOINT' } } }],
      } as never)
      h.ctx.reflect.provide('agentTeams' as never, {
        listMembers: () => [{ id: childId, role: 'lead', status: 'inactive' }],
        listTasks: () => [{ id: 't-sub', subject: 'subagent-pending-task', status: 'pending' }],
      } as never)

      await h.runtime.archiver.tick()
      expect(services.compaction.compactNow).not.toHaveBeenCalled()
      const nextId = h.runtime.relay.route(childId)
      expect(nextId).not.toBe(childId)
      expect(h.agents.has(nextId)).toBe(true)
      // 保留父子关系与模型槽位（slot 1 复用，未消耗额外槽位）。
      expect(h.runtime.store.get(KV.sessions.subagentParent(nextId))).toBe(workerId)
      expect(h.runtime.store.get(KV.sessions.subagentTicket(nextId))).toBe(ticket.id)
      const teamModels = h.runtime.store.get(KV.sessions.teamModels(ticket.id))
      expect(teamModels?.slots[nextId]).toBe(1)
      expect(Object.keys(teamModels?.slots ?? {}).filter(id => id === nextId || id === childId)).toContain(nextId)
      // 摘要保留历史进度与未认领共享任务。
      const injected = JSON.stringify(h.agents.get(nextId)!.inject.mock.calls)
      expect(injected).toContain('SUBAGENT_HALFWAY_CHECKPOINT')
      expect(injected).toContain('subagent-pending-task')
      // 重建路由后仍能把旧子会话指向新子会话。
      h.runtime.relay.restoreRoutes()
      expect(h.runtime.relay.route(childId)).toBe(nextId)
    } finally { await h.stop() }
  })
})

describe('M07: 复杂度判定与多独立可打开分工对话', () => {
  it('区分“简短难题”和“冗长简单题”', () => {
    const shortHard = assessComplexity({
      threshold: 60,
      brief: '重构认证模块、同步更新前端登录页、调整后端接口与数据库迁移并补全测试',
    })
    expect(shortHard.hard).toBe(true)
    expect(shortHard.score).toBeGreaterThanOrEqual(60)

    const longLog = Array.from({ length: 18 }, (_, i) => `[2026-11-23 12:00:${String(i).padStart(2, '0')}] INFO server log line ${'x'.repeat(45)}`).join('\n')
    const longSimple = assessComplexity({
      threshold: 60,
      brief: `请把下面配置里的端口 3000 改成 3001：\n\`\`\`\n${longLog}\n\`\`\``,
    })
    expect(longSimple.hard).toBe(false)
    expect(longSimple.score).toBeLessThan(60)
  })

  it('简单任务开 0 个额外会话；复杂任务按上限 5 分配混合模型槽位、依赖唤醒、去重回报、60% 接班与独立复查', async () => {
    const h = await startRuntime(store => {
      const cur = store.settings()
      store.saveSettings(SettingsSchema.parse({
        ...cur,
        executor: { ...cur.executor, reviewEnabled: true },
        routing: {
          ...cur.routing,
          multiSession: 'auto',
          maxSessions: 5,
          sessionModels: [
            { provider: 'prov-a', model: 'model-a' },
            { provider: 'prov-b', model: 'model-b' },
            null,
            null,
            null,
          ],
          thinking: 'high',
        },
        budget: { ...cur.budget, archiveEnabled: true, archivePercent: 60 },
      }))
    })
    try {
      const master = h.runtime.masterId
      // 给主会话挂上发起时的实时模型（供留空槽位继承）。
      vi.spyOn(h.agents.get(master)!.session, 'snapshotEvents').mockReturnValue([
        { type: 'model/selection', data: { provider: 'origin-prov', model: 'origin-model' } },
      ] as never)

      // 1. 简单任务 -> 额外会话数为 0
      const simple = await h.runTool(master, 'orchestrator_dispatch', {
        title: '简单文案修改',
        brief: '把 README 里的错别字改一下',
        difficulty: 20,
        plan_key: 'simple-1',
      }) as { extra_sessions: number; complexity: { skipReason?: string } }
      expect(simple.extra_sessions).toBe(0)
      expect(simple.complexity.skipReason).toBe('below-difficulty-threshold')

      // 2. 复杂任务（3 个分工，div-3 依赖 div-1 与 div-2）
      const planArgs = {
        task_id: 'complex-task-1',
        title: '全栈功能拆分',
        brief: '拆分为接口开发、前端页面与集成联调三个独立模块',
        difficulty: 85,
        plan_key: 'complex-plan-v1',
        divisions: [
          { division_id: 'api', title: '后端接口', brief: '实现后端 REST 接口' },
          { division_id: 'ui', title: '前端界面', brief: '实现前端组件' },
          { division_id: 'e2e', title: '联调测试', brief: '基于接口与前端完成端到端测试', depends_on: ['api', 'ui'] },
        ],
      }
      const created = await h.runTool(master, 'orchestrator_dispatch', planArgs) as {
        task_id: string
        extra_sessions: number
        reused: boolean
        divisions: { division_id: string; session_id: string; slot: number; model: { provider: string; model: string; reasoningEffort?: string }; status: string }[]
      }
      expect(created.reused).toBe(false)
      expect(created.extra_sessions).toBe(3)

      const apiDiv = created.divisions.find(d => d.division_id === 'api')!
      const uiDiv = created.divisions.find(d => d.division_id === 'ui')!
      const e2eDiv = created.divisions.find(d => d.division_id === 'e2e')!
      // 前两个槽位使用显式模型 + thinking=high，第三个留空槽位继承发起会话模型。
      expect(apiDiv.model).toEqual({ provider: 'prov-a', model: 'model-a', reasoningEffort: 'high' })
      expect(uiDiv.model).toEqual({ provider: 'prov-b', model: 'model-b', reasoningEffort: 'high' })
      expect(e2eDiv.model).toEqual({ provider: 'origin-prov', model: 'origin-model', reasoningEffort: 'high' })
      expect(apiDiv.status).toBe('running')
      expect(uiDiv.status).toBe('running')
      expect(e2eDiv.status).toBe('waiting_deps')
      expect(h.agents.has(apiDiv.session_id)).toBe(true)
      expect(h.agents.has(uiDiv.session_id)).toBe(true)
      expect(h.agents.has(e2eDiv.session_id)).toBe(false)

      // 3. 重放同一 plan_key 不重复开会话
      const replay = await h.runTool(master, 'orchestrator_dispatch', planArgs) as { reused: boolean; extra_sessions: number }
      expect(replay.reused).toBe(true)
      expect(replay.extra_sessions).toBe(3)

      // 4. 在请求边界记录实际模型调用轨迹
      h.ctx.emit('session/event', h.agents.get(apiDiv.session_id)!.session as never, {
        type: 'request/header',
        data: { provider: 'prov-a', model: 'model-a', reasoningEffort: 'high' },
      } as never)

      // 5. 分工汇报（带 event_id 去重）并触发依赖唤醒
      const rep1 = await h.runTool(apiDiv.session_id, 'orchestrator_division_report', {
        state: 'completed',
        summary: 'API 完成',
        result: 'API_OUTPUT_READY',
        event_id: 'evt-api-done',
      }) as { deduplicated: boolean; unblocked: string[] }
      expect(rep1.deduplicated).toBe(false)
      expect(rep1.unblocked).toEqual([])
      // 重复事件 ID 幂等去重
      const rep1Dup = await h.runTool(apiDiv.session_id, 'orchestrator_division_report', {
        state: 'completed',
        summary: 'API 完成',
        result: 'API_OUTPUT_READY',
        event_id: 'evt-api-done',
      }) as { deduplicated: boolean }
      expect(rep1Dup.deduplicated).toBe(true)

      // ui 完成后，e2e 自动解锁并收到上游成果
      const rep2 = await h.runTool(uiDiv.session_id, 'orchestrator_division_report', {
        state: 'completed',
        summary: 'UI 完成',
        result: 'UI_OUTPUT_READY',
        event_id: 'evt-ui-done',
      }) as { unblocked: string[] }
      expect(rep2.unblocked).toEqual(['e2e'])
      expect(h.agents.has(e2eDiv.session_id)).toBe(true)
      const e2ePrompt = h.deliveries.mock.calls.filter(([c]) => c.sessionId === e2eDiv.session_id).map(([c]) => c.text).join('\n')
      expect(e2ePrompt).toContain('API_OUTPUT_READY')
      expect(e2ePrompt).toContain('UI_OUTPUT_READY')

      // 6. 让 e2e 分工会话到达 60% 接班，保留同一槽位，并用 orchestrator_division_send 给旧会话追问应送达新代次
      const e2eAgent = h.agents.get(e2eDiv.session_id)!
      e2eAgent.status = 'idle'
      const services = {
        tokenMeter: { contextPressure: () => ({ pressureTokens: 70, contextWindow: 100 }) },
        compaction: { compactNow: vi.fn(async () => ({})) },
      }
      const origGet = (e2eAgent as unknown as { ctx: { get: (n: string) => unknown } }).ctx.get.bind((e2eAgent as unknown as { ctx: unknown }).ctx)
      vi.spyOn((e2eAgent as unknown as { ctx: { get: (n: string) => unknown } }).ctx, 'get').mockImplementation(((n: string) =>
        n in services ? services[n as keyof typeof services] : origGet(n)) as never)
      Object.assign(e2eAgent as object, { runMaintenance: () => {} })
      h.controller.inspect.mockResolvedValue({
        events: [{ type: 'assistant/message', data: { message: { content: 'E2E_IN_PROGRESS' } } }],
      } as never)
      await h.runtime.archiver.tick()
      const newE2eSession = h.runtime.relay.route(e2eDiv.session_id)
      expect(newE2eSession).not.toBe(e2eDiv.session_id)
      expect(h.runtime.divisions.get('complex-task-1')?.divisions.find(d => d.divisionId === 'e2e')?.slot).toBe(2)

      const follow = await h.runTool(master, 'orchestrator_division_send', {
        task_id: 'complex-task-1',
        division_id: 'e2e',
        message: '请补测错误分支',
        request_id: 'follow-e2e-1',
      }) as { sessionId: string; sent: boolean }
      expect(follow.sent).toBe(true)
      expect(follow.sessionId).toBe(newE2eSession)

      // 7. e2e 完成 -> 自动创建并绑定独立可打开复查对话
      const rep3 = await h.runTool(newE2eSession, 'orchestrator_division_report', {
        state: 'completed',
        summary: 'E2E 全部通过',
        result: 'E2E_PASSED',
        event_id: 'evt-e2e-done',
      }) as { reviewSessionId?: string }
      expect(rep3.reviewSessionId).toBeDefined()
      expect(h.agents.has(rep3.reviewSessionId!)).toBe(true)
      await h.runTool(rep3.reviewSessionId!, 'orchestrator_division_review_submit', {
        approved: true,
        summary: '三项分工与联调全部达标',
      })
      const finalPlan = h.runtime.divisions.get('complex-task-1')!
      expect(finalPlan.review?.state).toBe('passed')
      expect(finalPlan.divisions.find(d => d.divisionId === 'api')?.modelCalls.length).toBeGreaterThan(0)

      // 8. 超过上限 5 应明确拒绝
      await expect(h.runTool(master, 'orchestrator_dispatch', {
        title: '超限拆分',
        brief: '拆 6 个会话',
        difficulty: 90,
        plan_key: 'too-many',
        divisions: Array.from({ length: 6 }, (_, i) => ({ division_id: `d${i}`, title: `D${i}`, brief: `Work ${i}` })),
      })).rejects.toThrow(/maxSessions limit is 5/)
    } finally { await h.stop() }
  })
})

describe('M08 & 设置保存接口: 版本/配置识别与 routing/budget 保存', () => {
  it('PUT /orchestrator/api/settings/routing 与 budget 正常保存并校验', async () => {
    const h = await startRuntime()
    try {
      const getSettings = await h.api('GET', 'settings')
      const body = getSettings.body as { blocks: { routing: { revision: number; value: Record<string, unknown> }; budget: { revision: number; value: Record<string, unknown> } } }
      const saveRouting = await h.api('PUT', 'settings/routing', {
        revision: body.blocks.routing.revision,
        value: { ...body.blocks.routing.value, multiSession: 'auto', maxSessions: 5 },
      })
      expect(saveRouting.status).toBe(200)
      expect(h.runtime.store.settings().routing.maxSessions).toBe(5)

      const saveBudget = await h.api('PUT', 'settings/budget', {
        revision: body.blocks.budget.revision,
        value: { ...body.blocks.budget.value, archivePercent: 60, dailyTokens: 50000 },
      })
      expect(saveBudget.status).toBe(200)
      expect(h.runtime.store.settings().budget.dailyTokens).toBe(50000)
    } finally { await h.stop() }
  })

  it('loaded 与 disk installed 不一致时报告 reloadRequired 并提示重载', async () => {
    const h = await startRuntime()
    try {
      const tracker = new VersionTracker(h.directory)
      const snap = tracker.snapshot()
      expect(snap.loaded).toBeTruthy()
      expect(snap.installed).toBe(snap.loaded)
      expect(snap.reloadRequired).toBe(false)

      const dir = mkdtempSync(join(tmpdir(), 'ver-mismatch-'))
      try {
        const fakeState = { ...snap, loaded: '0.3.10', installed: '0.3.12', profileName: 'superagent', reloadRequired: true }
        const result = inspect(h.runtime.store.settings(), h.runtime.sources, h.runtime.health, h.runtime.store, 7, fakeState)
        expect(result.gaps.some(g => g.code === 'reloadRequired' && g.detail.includes('0.3.10') && g.detail.includes('0.3.12'))).toBe(true)
      } finally { rmSync(dir, { recursive: true, force: true }) }
    } finally { await h.stop() }
  })
})
