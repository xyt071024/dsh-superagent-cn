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

  it('M07-a/e: 高难度 Ticket 自动落入持久化分工计划，且单子项委托允许开 1 个独立会话', async () => {
    const h = await startRuntime(store => {
      const s = store.settings()
      store.saveSettings(SettingsSchema.parse({
        ...s,
        routing: { ...s.routing, multiSession: 'auto', maxSessions: 5, difficultyThreshold: 40 },
      }))
    })
    try {
      const { ticket, sessionId } = await h.acceptedTicket(feishu(
        'gh-hard-1',
        'Refactor auth architecture, database migration, and security audit across services\n' +
        'Critical security and schema migration across 12 modules with rollback verification and breaking API changes.\n'.repeat(12),
      ))
      const plans = h.runtime.divisions.list()
      expect(plans.length).toBeGreaterThanOrEqual(1)
      const ticketPlan = plans.find(p => p.taskId === ticket.id || p.originSessionId === sessionId)
      expect(ticketPlan).toBeDefined()
      expect(ticketPlan!.divisions.length).toBeGreaterThanOrEqual(1)
      for (const div of ticketPlan!.divisions) {
        expect(h.agents.has(div.sessionId)).toBe(true)
      }

      // 单子项高难度委托开 1 个独立分工会话
      const master = h.runtime.masterId
      const single = await h.runTool(master, 'orchestrator_dispatch', {
        task_id: 'single-div-task',
        title: '独立长耗时日志审计与安全扫描',
        brief: '单独委托给 1 个独立分工对话处理并汇报',
        difficulty: 85,
        plan_key: 'single-div-key',
        divisions: [{ division_id: 'audit', title: '安全审计', brief: '执行全量扫描' }],
      }) as { extra_sessions: number; divisions: Array<{ session_id: string }> }
      expect(single.extra_sessions).toBe(1)
      expect(h.agents.has(single.divisions[0]!.session_id)).toBe(true)
    } finally { await h.stop() }
  })

  it('M07-b/c/d/f & M06-a: 启动失败重放恢复、汇报通知重试、并发追问不丢完成态、多轮打回重做及多代分工接班恢复', async () => {
    const h = await startRuntime(store => {
      const s = store.settings()
      store.saveSettings(SettingsSchema.parse({
        ...s,
        executor: { ...s.executor, reviewEnabled: true },
        routing: { ...s.routing, multiSession: 'auto', maxSessions: 5 },
      }))
    })
    try {
      const master = h.runtime.masterId

      // M07-b: 某个分工首次启动失败，重放同 plan_key 时仅补建失败分工并恢复至 running
      let failOnce = true
      const origPrompt = h.runtime.sessions.prompt.bind(h.runtime.sessions)
      const promptSpy = vi.spyOn(h.runtime.sessions, 'prompt').mockImplementation(async (...args) => {
        if (failOnce && args[1] === 'division-start:recover-task:b') {
          failOnce = false
          throw new Error('simulated transient launch error')
        }
        return origPrompt(...args)
      })

      const first = await h.runTool(master, 'orchestrator_dispatch', {
        task_id: 'recover-task',
        title: '启动失败恢复验证',
        brief: 'A 与 B 并行',
        difficulty: 80,
        plan_key: 'recover-key',
        divisions: [
          { division_id: 'a', title: 'A', brief: 'Task A' },
          { division_id: 'b', title: 'B', brief: 'Task B', depends_on: ['a'] },
        ],
      }) as { divisions: Array<{ division_id: string; session_id: string; status: string }> }
      const divA = first.divisions.find(d => d.division_id === 'a')!

      // M07-c: A 汇报时若通知主窗口瞬时失败，不应提前写入已投递回执，重复汇报应补发通知并推进 B
      let failNotifyOnce = true
      promptSpy.mockImplementation(async (...args) => {
        if (failNotifyOnce && args[1]?.startsWith('div-notify:recover-task:a:')) {
          failNotifyOnce = false
          throw new Error('simulated notify transient failure')
        }
        if (failOnce && args[1] === 'division-start:recover-task:b') {
          failOnce = false
          throw new Error('simulated transient launch error')
        }
        return origPrompt(...args)
      })

      await h.runTool(divA.session_id, 'orchestrator_division_report', {
        state: 'completed',
        summary: 'A done',
        result: 'A_RES',
        event_id: 'evt-a-1',
      })
      // 通知主窗口失败时，未写入 deliveredNotificationIds，保留在 pendingDeliveries；且 B 首次启动失败标为 failed
      expect(h.runtime.divisions.get('recover-task')?.deliveredNotificationIds ?? []).not.toContain('notify:recover-task:a:evt-a-1')
      expect((h.runtime.divisions.get('recover-task')?.pendingDeliveries ?? []).length).toBeGreaterThan(0)
      expect(h.runtime.divisions.get('recover-task')?.divisions.find(d => d.divisionId === 'b')?.status).toBe('failed')

      // 重复调用同 event_id：通知补发成功并写入 deliveredNotificationIds
      const dupRep = await h.runTool(divA.session_id, 'orchestrator_division_report', {
        state: 'completed',
        summary: 'A done',
        result: 'A_RES',
        event_id: 'evt-a-1',
      }) as { deduplicated: boolean }
      expect(dupRep.deduplicated).toBe(true)
      expect(h.runtime.divisions.get('recover-task')?.deliveredNotificationIds ?? []).toContain('notify:recover-task:a:evt-a-1')
      expect(h.runtime.divisions.get('recover-task')?.pendingDeliveries ?? []).toHaveLength(0)
      expect(h.runtime.divisions.get('recover-task')?.divisions.find(d => d.divisionId === 'b')?.status).toBe('failed')

      const replayed = await h.runTool(master, 'orchestrator_dispatch', {
        task_id: 'recover-task',
        title: '启动失败恢复验证',
        brief: 'A 与 B 并行',
        difficulty: 80,
        plan_key: 'recover-key',
        divisions: [
          { division_id: 'a', title: 'A', brief: 'Task A' },
          { division_id: 'b', title: 'B', brief: 'Task B', depends_on: ['a'] },
        ],
      }) as { reused: boolean; divisions: Array<{ division_id: string; session_id: string; status: string }> }
      expect(replayed.reused).toBe(true)
      const divB = replayed.divisions.find(d => d.division_id === 'b')!
      expect(divB.status).toBe('running')

      // M07-d: sendToDivision 慢投递期间 B 并发汇报 completed，不得回滚 completed 状态
      let releaseSend!: () => void
      const sendGate = new Promise<void>(r => { releaseSend = r })
      promptSpy.mockImplementation(async (...args) => {
        if (args[1] === 'div-send:recover-task:b:concurrent-msg-1') await sendGate
        return origPrompt(...args)
      })

      const pendingSend = h.runtime.divisions.sendToDivision({
        taskId: 'recover-task',
        divisionId: 'b',
        message: '补充说明',
        requestId: 'concurrent-msg-1',
      })
      await new Promise(r => setTimeout(r, 15))
      await h.runTool(divB.session_id, 'orchestrator_division_report', {
        state: 'completed',
        summary: 'B done concurrently',
        result: 'B_RES',
        event_id: 'evt-b-1',
      })
      releaseSend()
      await pendingSend

      const afterConcurrent = h.runtime.divisions.get('recover-task')!
      const bRow = afterConcurrent.divisions.find(d => d.divisionId === 'b')!
      expect(bRow.status).toBe('completed')
      expect(bRow.result).toBe('B_RES')
      expect(bRow.deliveredEventIds).toContain('concurrent-msg-1')
      expect(bRow.deliveredEventIds).toContain('evt-b-1')

      // M07-f: 复查打回 -> 分工返工重提 -> 自动进入第 2 轮复查并通过
      const reviewSession1 = afterConcurrent.review!.sessionId
      await h.runTool(reviewSession1, 'orchestrator_division_review_submit', {
        approved: false,
        summary: 'Fix B edge case',
        findings: ['B needs retry logic'],
        rework_division_ids: ['b'],
        acceptance_criteria: 'Must cover retry logic',
      })
      expect(h.runtime.divisions.get('recover-task')?.divisions.find(d => d.divisionId === 'b')?.status).toBe('running')

      await h.runTool(divB.session_id, 'orchestrator_division_report', {
        state: 'completed',
        summary: 'B fixed retry logic',
        result: 'B_RES_V2',
        event_id: 'evt-b-2',
      })
      const round2Review = h.runtime.divisions.get('recover-task')!.review!
      expect(round2Review.round).toBe(2)
      expect(round2Review.state).toBe('pending')

      await h.runTool(round2Review.sessionId, 'orchestrator_division_review_submit', {
        approved: true,
        summary: 'Round 2 passed',
      })
      expect(h.runtime.divisions.get('recover-task')!.review!.state).toBe('passed')

      // M06-a: 分工会话连续两次接班 (gen0 -> gen1 -> gen2) 且唤醒瞬时失败后由 relay.resume() 恢复
      let failWakeOnce = true
      promptSpy.mockImplementation(async (...args) => {
        if (failWakeOnce && args[1]?.startsWith('activate:division:recover-task:a:')) {
          failWakeOnce = false
          throw new Error('simulated division wake failure')
        }
        return origPrompt(...args)
      })

      h.agents.get(divA.session_id)!.status = 'idle'
      h.controller.inspect.mockResolvedValue({ events: [{ type: 'assistant/message', data: { message: { content: 'gen1 summary' } } }] } as never)
      const gen1Move = await h.runtime.relay.moveDivision('recover-task', 'a', divA.session_id, 0.7)
      expect(gen1Move).toHaveProperty('moved')
      const gen1 = (gen1Move as { moved: string }).moved
      expect(h.runtime.divisions.get('recover-task')?.divisions.find(d => d.divisionId === 'a')?.pendingActivation).toBeDefined()

      await h.runtime.relay.resume()
      expect(h.runtime.divisions.get('recover-task')?.divisions.find(d => d.divisionId === 'a')?.pendingActivation).toBeUndefined()

      h.agents.get(gen1)!.status = 'idle'
      const gen2Move = await h.runtime.relay.moveDivision('recover-task', 'a', gen1, 0.7)
      expect(gen2Move).toHaveProperty('moved')
      const gen2 = (gen2Move as { moved: string }).moved
      expect(h.runtime.relay.route(divA.session_id)).toBe(gen2)
      expect(h.runtime.relay.route(gen1)).toBe(gen2)
    } finally { await h.stop() }
  })

  it('M07-g/h/i & M06-b: 复杂工单自动拆分多分工、拒绝旧轮复查迟到改写、修订计划保留已完成成果、接班后恢复不重投首次任务', async () => {
    const h = await startRuntime(store => {
      const s = store.settings()
      store.saveSettings(SettingsSchema.parse({
        ...s,
        executor: { ...s.executor, reviewEnabled: true },
        routing: { ...s.routing, multiSession: 'auto', maxSessions: 5, difficultyThreshold: 50 },
      }))
    })
    try {
      // 1. M07-g: 普通复杂工单明确包含多项独立交付物（接口、前端、测试）时，自动拆分为多个独立分工会话
      const req = '@bot 分成三个相互独立、可并行的对话：一人做 API，一人做前端 UI，一人做测试；分别提交成果。' + ' independent complex deliverables'.repeat(25)
      const accepted = await h.acceptedTicket(feishu('multi-deliverables-1', req))
      const autoPlan = h.runtime.divisions.get(accepted.ticket.id)!
      expect(autoPlan).toBeDefined()
      expect(autoPlan.divisions.length).toBeGreaterThanOrEqual(3)
      for (const d of autoPlan.divisions) {
        expect(h.agents.has(d.sessionId)).toBe(true)
      }

      // 2. M07-i: 修订计划新增/修改分工时，保留未变更分工的 completed 状态与成果
      await h.runtime.divisions.dispatch({
        originSessionId: h.runtime.masterId,
        taskId: 'revise-task',
        planKey: 'p1',
        title: 'Parallel Delivery',
        brief: 'API and UI',
        difficulty: 90,
        divisions: [
          { divisionId: 'api', title: 'API', brief: 'Implement API' },
          { divisionId: 'ui', title: 'UI', brief: 'Implement UI' },
        ],
      })
      await h.runtime.divisions.reportDivision({
        taskId: 'revise-task',
        divisionId: 'api',
        state: 'completed',
        summary: 'API finished',
        result: 'API_V1_DONE',
        eventId: 'evt-api-v1',
      })
      await h.runtime.divisions.dispatch({
        originSessionId: h.runtime.masterId,
        taskId: 'revise-task',
        planKey: 'p2',
        title: 'Parallel Delivery',
        brief: 'API, UI, and QA',
        difficulty: 90,
        divisions: [
          { divisionId: 'api', title: 'API', brief: 'Implement API' },
          { divisionId: 'ui', title: 'UI', brief: 'Implement UI' },
          { divisionId: 'qa', title: 'QA', brief: 'Regression testing' },
        ],
      })
      const revised = h.runtime.divisions.get('revise-task')!
      expect(revised.divisions.find(d => d.divisionId === 'api')?.status).toBe('completed')
      expect(revised.divisions.find(d => d.divisionId === 'api')?.result).toBe('API_V1_DONE')
      expect(revised.divisions.find(d => d.divisionId === 'qa')?.status).toBe('running')

      // 3. M07-h: 第二轮复查处于 pending 时，第一轮旧复查会话迟到提交 approved=true 必须被拒绝且记入 history，不得改写第二轮状态
      await h.runtime.divisions.reportDivision({
        taskId: 'revise-task',
        divisionId: 'ui',
        state: 'completed',
        summary: 'UI finished',
        result: 'UI_V1_DONE',
        eventId: 'evt-ui-v1',
      })
      await h.runtime.divisions.reportDivision({
        taskId: 'revise-task',
        divisionId: 'qa',
        state: 'completed',
        summary: 'QA finished',
        result: 'QA_V1_DONE',
        eventId: 'evt-qa-v1',
      })
      const r1Review = h.runtime.divisions.get('revise-task')!.review!
      expect(r1Review.round).toBe(1)
      expect(r1Review.state).toBe('pending')

      await h.runTool(r1Review.sessionId, 'orchestrator_division_review_submit', {
        approved: false,
        summary: 'Fix QA edge case',
        findings: ['QA missing negative test'],
        rework_division_ids: ['qa'],
      })
      await h.runtime.divisions.reportDivision({
        taskId: 'revise-task',
        divisionId: 'qa',
        state: 'completed',
        summary: 'QA negative test added',
        result: 'QA_V2_DONE',
        eventId: 'evt-qa-v2',
      })
      const r2Review = h.runtime.divisions.get('revise-task')!.review!
      expect(r2Review.round).toBe(2)
      expect(r2Review.state).toBe('pending')

      // 第一轮旧审查会话迟到提交通过 -> 拒绝并保持第 2 轮 pending
      await expect(h.runTool(r1Review.sessionId, 'orchestrator_division_review_submit', {
        approved: true,
        summary: 'Late approval from round 1 reviewer',
      })).rejects.toThrow(/stale reviewer/)
      const stillPending = h.runtime.divisions.get('revise-task')!.review!
      expect(stillPending.round).toBe(2)
      expect(stillPending.state).toBe('pending')
      expect(stillPending.history?.some(e => e.state === 'superseded_late' && e.round === 1)).toBe(true)

      // 第二轮审查会话正常提交通过，且重复提交被拒绝
      await h.runTool(r2Review.sessionId, 'orchestrator_division_review_submit', {
        approved: true,
        summary: 'Round 2 verified and approved',
      })
      expect(h.runtime.divisions.get('revise-task')!.review!.state).toBe('passed')
      await expect(h.runTool(r2Review.sessionId, 'orchestrator_division_review_submit', {
        approved: true,
        summary: 'Duplicate round 2 submission',
      })).rejects.toThrow(/already passed/)

      // 4. M06-b: 分工接班成功后执行 divisions.resume()，绝不向接班会话重投首次 division-start
      const handoverPlan = (await h.runtime.divisions.dispatch({
        originSessionId: h.runtime.masterId,
        taskId: 'handover-no-repost',
        planKey: 'hp1',
        title: 'Handover Resume Check',
        brief: 'Long running division',
        difficulty: 85,
        divisions: [{ divisionId: 'worker', title: 'Worker', brief: 'Step 1 and Step 2' }],
      })).plan
      const gen1Session = handoverPlan.divisions[0]!.sessionId
      h.agents.get(gen1Session)!.status = 'idle'
      h.controller.inspect.mockResolvedValue({
        events: [{ type: 'assistant/message', data: { message: { content: 'Step 1 done; Step 2 remaining' } } }],
      } as never)
      const moved = await h.runtime.relay.moveDivision('handover-no-repost', 'worker', gen1Session, 0.75)
      expect(moved).toHaveProperty('moved')
      const gen2Session = h.runtime.divisions.get('handover-no-repost')!.divisions[0]!.sessionId
      expect(gen2Session).not.toBe(gen1Session)

      const promptSpy = vi.spyOn(h.runtime.sessions, 'prompt')
      await h.runtime.divisions.resume()
      expect(promptSpy.mock.calls.filter(c => c[0] === gen2Session && c[1] === 'division-start:handover-no-repost:worker')).toHaveLength(0)
    } finally { await h.stop() }
  })

  it('M07-j/k/l: 复查期间新增分工自动换新复查、修改分工返工更新正式成果、移除运行中分工自动停止会话并拒绝失控移除', async () => {
    const h = await startRuntime(store => {
      const s = store.settings()
      store.saveSettings(SettingsSchema.parse({
        ...s,
        executor: { ...s.executor, reviewEnabled: true },
        routing: { ...s.routing, multiSession: 'auto', maxSessions: 5, difficultyThreshold: 50 },
      }))
    })
    try {
      // 1. M07-j: api 与 ui 完成后进入第 1 轮待审，此时修订计划新增 qa；旧审查会话被取代且不能批准新成果，qa 完成后新审查会话可正常批准
      await h.runtime.divisions.dispatch({
        originSessionId: h.runtime.masterId,
        taskId: 'jkl-task',
        planKey: 'p1',
        title: 'JKL Verification',
        brief: 'API and UI',
        difficulty: 90,
        divisions: [
          { divisionId: 'api', title: 'API', brief: 'Implement API v1' },
          { divisionId: 'ui', title: 'UI', brief: 'Implement UI v1' },
        ],
      })
      await h.runtime.divisions.reportDivision({ taskId: 'jkl-task', divisionId: 'api', state: 'completed', summary: 'Result v1', eventId: 'a1' })
      await h.runtime.divisions.reportDivision({ taskId: 'jkl-task', divisionId: 'ui', state: 'completed', summary: 'Result u1', eventId: 'u1' })
      const oldReview = h.runtime.divisions.get('jkl-task')!.review!
      expect(oldReview.state).toBe('pending')

      // 修订计划：同时修改 api 的要求（M07-k），移除 ui 并新增 qa（M07-l + M07-j）
      const uiSession = h.runtime.divisions.get('jkl-task')!.divisions.find(d => d.divisionId === 'ui')!.sessionId
      // 再开一个 running 的 temp 分工验证移除时自动停止
      await h.runtime.divisions.dispatch({
        originSessionId: h.runtime.masterId,
        taskId: 'jkl-task',
        planKey: 'p2',
        title: 'JKL Verification',
        brief: 'API, UI, and Temp',
        difficulty: 90,
        divisions: [
          { divisionId: 'api', title: 'API', brief: 'Implement API v1' },
          { divisionId: 'ui', title: 'UI', brief: 'Implement UI v1' },
          { divisionId: 'temp', title: 'Temp', brief: 'Running work to be removed' },
        ],
      })
      const tempSession = h.runtime.divisions.get('jkl-task')!.divisions.find(d => d.divisionId === 'temp')!.sessionId
      expect(h.agents.get(tempSession)?.status).toBe('running')

      // p3: 修改 api 的 brief（M07-k）、移除 running 的 temp（M07-l）、新增 qa（依赖 api）
      await h.runtime.divisions.dispatch({
        originSessionId: h.runtime.masterId,
        taskId: 'jkl-task',
        planKey: 'p3',
        title: 'JKL Verification',
        brief: 'Revised API, UI, and QA',
        difficulty: 90,
        divisions: [
          { divisionId: 'api', title: 'API', brief: 'Implement revised API v2' },
          { divisionId: 'ui', title: 'UI', brief: 'Implement UI v1' },
          { divisionId: 'qa', title: 'QA', brief: 'Verify API v2 and UI', dependsOn: ['api'] },
        ],
      })
      // M07-l: 被移除的 temp 已不再处于 running，且迟到汇报被拒绝
      expect(h.runtime.divisions.get('jkl-task')!.divisions.some(d => d.divisionId === 'temp')).toBe(false)
      expect(h.agents.get(tempSession)?.status).not.toBe('running')
      await expect(h.runtime.divisions.reportDivision({
        taskId: 'jkl-task',
        divisionId: 'temp',
        state: 'completed',
        summary: 'Late temp report',
        eventId: 'temp-late',
      })).rejects.toThrow(/not found or stopped/)

      // M07-k: api 仅填写 summary 完成 v2，其正式 result 必须更新为 Result v2（且保留 v1 在 resultHistory），下游 qa 拿到 Result v2
      expect(h.runtime.divisions.get('jkl-task')!.divisions.find(d => d.divisionId === 'ui')?.sessionId).toBe(uiSession)
      await h.runtime.divisions.reportDivision({ taskId: 'jkl-task', divisionId: 'api', state: 'completed', summary: 'Result v2', eventId: 'a2' })
      const apiDiv = h.runtime.divisions.get('jkl-task')!.divisions.find(d => d.divisionId === 'api')!
      expect(apiDiv.latestProgress).toBe('Result v2')
      expect(apiDiv.result).toBe('Result v2')
      expect(apiDiv.resultHistory?.[0]?.result).toBe('Result v1')

      // 旧消息 a1 重放不回退 Result v2
      await h.runtime.divisions.reportDivision({ taskId: 'jkl-task', divisionId: 'api', state: 'completed', summary: 'Result v1', eventId: 'a1' })
      expect(h.runtime.divisions.get('jkl-task')!.divisions.find(d => d.divisionId === 'api')!.result).toBe('Result v2')

      // qa 完成 -> 触发绑定新成果范围的复查
      await h.runtime.divisions.reportDivision({ taskId: 'jkl-task', divisionId: 'qa', state: 'completed', summary: 'Result qa1', eventId: 'q1' })
      await h.runtime.divisions.resume()
      const renewedReview = h.runtime.divisions.get('jkl-task')!.review!
      expect(renewedReview.state).toBe('pending')
      expect(renewedReview.sessionId).not.toBe(oldReview.sessionId)

      // 旧审查员不能批准新成果版本
      await expect(h.runTool(oldReview.sessionId, 'orchestrator_division_review_submit', {
        approved: true,
        summary: 'Old reviewer trying to approve new scope',
      })).rejects.toThrow(/stale reviewer/)
      expect(h.runtime.divisions.get('jkl-task')!.review!.state).toBe('pending')

      // 当前新审查员正常批准通过
      await h.runTool(renewedReview.sessionId, 'orchestrator_division_review_submit', {
        approved: true,
        summary: 'Reviewed current deliverables',
      })
      expect(h.runtime.divisions.get('jkl-task')!.review!.state).toBe('passed')
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
