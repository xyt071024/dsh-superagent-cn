import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SettingsSchema } from '../src/policy.ts'
import { feishu, startRuntime } from './fixtures/host.ts'
import { DraftBoundaryError, type VerificationExecutionInput } from '../src/app/divisions.ts'

describe('v0.3.19 高优 1：mergeWorkItem 原子前置校验、受控执行入口与计数替身验证', () => {
  it('无权调用、非法状态、重复重放、同/异 eventId 并发重试与过时交付版本均严格控制执行次数', async () => {
    const h = await startRuntime(store => {
      const cur = store.settings()
      store.saveSettings(SettingsSchema.parse({
        ...cur,
        routing: { ...cur.routing, multiSession: 'auto', maxSessions: 5 },
      }))
    })
    try {
      const calls: VerificationExecutionInput[] = []
      let gate: PromiseWithResolvers<{ exitCode: number; output: string }> | undefined
      h.runtime.divisions.setVerificationRunner(async input => {
        calls.push(input)
        if (gate) {
          const currentGate = gate
          gate = undefined
          return currentGate.promise
        }
        return { exitCode: 0, output: `ok:${input.deliverableVersion}` }
      })

      const dispatched = await h.runtime.divisions.dispatch({
        taskId: 'gate-count-task',
        title: '前置门禁与计数替身任务',
        brief: '验证无权、重复、并发重试与过时版本下的验证执行次数',
        difficulty: 95,
        originSessionId: h.runtime.masterId,
        planKey: 'gc-1',
        divisions: [
          {
            divisionId: 'dev',
            title: '开发',
            brief: '负责模块 A',
            workItems: [
              { itemId: 'wi-code', title: '核心代码 A', brief: '实现代码 A' },
              { itemId: 'wi-stale', title: '并发改版代码 B', brief: '实现代码 B' },
            ],
          },
          {
            divisionId: 'helper',
            title: '协助开发',
            brief: '协助修改模块',
          },
          {
            divisionId: 'qa',
            title: '下游测试',
            brief: '依赖合并后解锁',
            workItems: [
              { itemId: 'wi-down-a', title: '下游 A', brief: '依赖 wi-code', dependsOn: ['wi-code'] },
              { itemId: 'wi-down-b', title: '下游 B', brief: '依赖 wi-stale', dependsOn: ['wi-stale'] },
            ],
          },
        ],
      })
      const devSession = dispatched.plan.divisions.find(d => d.divisionId === 'dev')!.sessionId
      const helperSession = dispatched.plan.divisions.find(d => d.divisionId === 'helper')!.sessionId

      // 1) 非法状态（open，尚未 submit）-> 前置拒绝，执行次数必须为 0
      await expect(h.runTool(devSession, 'orchestrator_division_merge_item', {
        item_id: 'wi-code',
        verification_command: 'node',
        verification_args: ['--test'],
        event_id: 'merge-open-reject',
      })).rejects.toThrow(/must be submitted before merging/)
      expect(calls).toHaveLength(0)

      // helper 认领并提交 wi-code
      await h.runTool(helperSession, 'orchestrator_division_claim_item', { item_id: 'wi-code', event_id: 'c-1' })
      await h.runTool(helperSession, 'orchestrator_division_submit_item', {
        item_id: 'wi-code',
        summary: '完成 v1',
        deliverable: 'code v1',
        event_id: 's-1',
      })

      // 2) 无权调用者（helper 不是 wi-code 的 owner）-> 前置拒绝，执行次数必须仍为 0
      await expect(h.runTool(helperSession, 'orchestrator_division_merge_item', {
        item_id: 'wi-code',
        verification_command: 'node',
        verification_args: ['--test'],
        event_id: 'merge-unauth',
      })).rejects.toThrow(/Only owner "dev"/)
      expect(calls).toHaveLength(0)

      // 3) 阻塞验证运行器：同时测“同 eventId 并发重试”和“不同 eventId 并发竞争” -> 进程只能拉起 1 次
      const gate1 = Promise.withResolvers<{ exitCode: number; output: string }>()
      gate = gate1
      const p1 = h.runtime.divisions.mergeWorkItem({
        taskId: 'gate-count-task',
        itemId: 'wi-code',
        mergerDivisionId: 'dev',
        verificationCommand: 'node',
        verificationArgs: ['--test'],
        eventId: 'merge-concurrent-1',
      })
      // 同一 eventId 并发重试 -> 合流到同一在途 promise，不重跑
      const p2 = h.runtime.divisions.mergeWorkItem({
        taskId: 'gate-count-task',
        itemId: 'wi-code',
        mergerDivisionId: 'dev',
        verificationCommand: 'node',
        verificationArgs: ['--test'],
        eventId: 'merge-concurrent-1',
      })
      // 不同 eventId 并发竞争 -> 直接拒绝，不重跑
      await expect(h.runtime.divisions.mergeWorkItem({
        taskId: 'gate-count-task',
        itemId: 'wi-code',
        mergerDivisionId: 'dev',
        verificationCommand: 'node',
        verificationArgs: ['--test'],
        eventId: 'merge-concurrent-other',
      })).rejects.toThrow(/Verification already in progress/)
      expect(calls).toHaveLength(1)

      gate1.resolve({ exitCode: 0, output: 'all tests passed' })
      const [r1, r2] = await Promise.all([p1, p2])
      expect(r1.merged).toBe(true)
      expect(r1.deduplicated).toBe(false)
      expect(r2.merged).toBe(true)
      expect(r2.deduplicated).toBe(true)
      expect(r1.unblockedItems).toContain('wi-down-a')
      expect(calls).toHaveLength(1)

      // 4) 完成后重复重放同一 eventId -> 幂等返回，执行次数仍保持 1
      const replay = await h.runtime.divisions.mergeWorkItem({
        taskId: 'gate-count-task',
        itemId: 'wi-code',
        mergerDivisionId: 'dev',
        verificationCommand: 'node',
        verificationArgs: ['--test'],
        eventId: 'merge-concurrent-1',
      })
      expect(replay.deduplicated).toBe(true)
      expect(replay.merged).toBe(true)
      expect(calls).toHaveLength(1)

      // 5) 过时交付版本：在验证阻塞期间重新提交新版本 v2 -> v1 即使返回 exit 0 也不得合并或解锁下游 wi-down-b
      await h.runTool(helperSession, 'orchestrator_division_claim_item', { item_id: 'wi-stale', event_id: 'c-b1' })
      await h.runTool(helperSession, 'orchestrator_division_submit_item', {
        item_id: 'wi-stale',
        summary: 'B v1',
        deliverable: 'stale-v1',
        event_id: 's-b1',
      })
      const gate2 = Promise.withResolvers<{ exitCode: number; output: string }>()
      gate = gate2
      const staleMergePromise = h.runtime.divisions.mergeWorkItem({
        taskId: 'gate-count-task',
        itemId: 'wi-stale',
        mergerDivisionId: 'dev',
        verificationCommand: 'node',
        verificationArgs: ['--test'],
        eventId: 'merge-stale-v1',
      })
      expect(calls).toHaveLength(2)

      // 验证运行中，协作者提交新版本 v2
      await h.runTool(helperSession, 'orchestrator_division_submit_item', {
        item_id: 'wi-stale',
        summary: 'B v2 revised',
        deliverable: 'stale-v2',
        event_id: 's-b2',
      })
      gate2.resolve({ exitCode: 0, output: 'v1 passed too late' })
      const staleResult = await staleMergePromise
      expect(staleResult.merged).toBe(false)
      expect(staleResult.failureReason).toBe('stale_verification')
      expect(staleResult.unblockedItems).toEqual([])
      expect(staleResult.blockedDependents).toEqual(['wi-down-b'])
      expect(h.runtime.divisions.listClaimableItems(h.runtime.divisions.get('gate-count-task')!).map(x => x.itemId)).not.toContain('wi-down-b')
    } finally { await h.stop() }
  })
})

describe('v0.3.19 高优 2：强制验证凭据五态（缺结果 / 伪报通过 / 测试失败 / 结果过期 / 成功）与文档人工验收', () => {
  it('代码工作项严格验证全部五种状态，文档工作项记录人工验收方式后放行', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'sa-five-states-'))
    const h = await startRuntime(store => {
      const cur = store.settings()
      store.saveSettings(SettingsSchema.parse({
        ...cur,
        routing: { ...cur.routing, multiSession: 'auto', maxSessions: 5 },
      }))
    })
    try {
      writeFileSync(join(workDir, 'calc.mjs'), 'export const mul = (a, b) => a + b\n')
      writeFileSync(join(workDir, 'calc.test.mjs'), [
        'import test from "node:test"',
        'import assert from "node:assert/strict"',
        'import { mul } from "./calc.mjs"',
        'test("mul multiplies", () => assert.equal(mul(3, 4), 12))',
      ].join('\n'))

      const dispatched = await h.runtime.divisions.dispatch({
        taskId: 'five-states-task',
        title: '五态验证与文档验收任务',
        brief: '代码项强校验五态，文档项允许人工验收并记录方式',
        directory: workDir,
        difficulty: 95,
        originSessionId: h.runtime.masterId,
        planKey: 'fs-1',
        divisions: [
          {
            divisionId: 'dev',
            title: '开发',
            brief: '代码与文档工作项',
            workItems: [
              { itemId: 'wi-code', title: '乘法函数实现', brief: '实现 mul', kind: 'code' },
              { itemId: 'wi-docs', title: '使用说明文档', brief: '补充文档章节', kind: 'docs' },
            ],
          },
          {
            divisionId: 'qa',
            title: '下游验证',
            brief: '分别依赖代码项与文档项',
            workItems: [
              { itemId: 'wi-after-code', title: '代码下游集成', brief: '依赖 wi-code', dependsOn: ['wi-code'] },
              { itemId: 'wi-after-docs', title: '文档发布检查', brief: '依赖 wi-docs', dependsOn: ['wi-docs'] },
            ],
          },
        ],
      })
      const devSession = dispatched.plan.divisions.find(d => d.divisionId === 'dev')!.sessionId

      await h.runTool(devSession, 'orchestrator_division_submit_item', {
        item_id: 'wi-code', summary: '初次实现 mul', deliverable: 'calc.mjs v1', event_id: 'sub-c1',
      })

      // 状态 1：缺结果（无命令也无可信凭据）-> 明确拒绝 missing_verification，下游保持锁定
      const missing = await h.runTool(devSession, 'orchestrator_division_merge_item', {
        item_id: 'wi-code', merge_note: '口头认为没问题', event_id: 'm-missing',
      }) as { merged: boolean; failureReason: string; blockedDependents: string[] }
      expect(missing.merged).toBe(false)
      expect(missing.failureReason).toBe('missing_verification')
      expect(missing.blockedDependents).toEqual(['wi-after-code'])

      // 状态 2：伪报通过（传入 verification_status='passed' 但未跑受控验证）-> 明确拒绝 untrusted_claim，下游保持锁定
      const forged = await h.runTool(devSession, 'orchestrator_division_merge_item', {
        item_id: 'wi-code',
        verification_status: 'passed',
        verification_output: 'fake ok',
        run_check: false,
        merge_note: '伪报测试通过',
        event_id: 'm-forged',
      }) as { merged: boolean; failureReason: string; blockedDependents: string[] }
      expect(forged.merged).toBe(false)
      expect(forged.failureReason).toBe('untrusted_claim')
      expect(forged.blockedDependents).toEqual(['wi-after-code'])

      // 状态 3：测试失败（真实经 Commands.runChecked 运行 node --test 失败）-> merge_failed + test_failed，下游保持锁定
      const failed = await h.runTool(devSession, 'orchestrator_division_merge_item', {
        item_id: 'wi-code',
        verification_command: process.execPath,
        verification_args: ['--test', 'calc.test.mjs'],
        merge_note: '首次实测',
        event_id: 'm-fail',
      }) as { merged: boolean; failureReason: string; item: { status: string; verificationCredential?: { exitCode: number; passed: boolean; source: string } } }
      expect(failed.merged).toBe(false)
      expect(failed.failureReason).toBe('test_failed')
      expect(failed.item.status).toBe('merge_failed')
      expect(failed.item.verificationCredential?.passed).toBe(false)
      expect(failed.item.verificationCredential?.source).toBe('controlled_runner')

      // 状态 4：结果过期（先对 v1 预验证通过签发 v1 可信凭据 -> 随后提交新版本 v2 -> 不重跑直接合并必须报 stale_verification）
      writeFileSync(join(workDir, 'calc.mjs'), 'export const mul = (a, b) => a * b\n')
      const preVerified = await h.runtime.divisions.verifyWorkItem({
        taskId: 'five-states-task',
        itemId: 'wi-code',
        verifierDivisionId: 'dev',
        verificationCommand: process.execPath,
        verificationArgs: ['--test', 'calc.test.mjs'],
        eventId: 'verify-v1',
      })
      expect(preVerified.verified).toBe(true)
      expect(preVerified.credential?.source).toBe('controlled_runner')

      // 再次修改提交为 v2（使 v1 凭据过期）
      await h.runTool(devSession, 'orchestrator_division_submit_item', {
        item_id: 'wi-code', summary: '微调注释 v2', deliverable: 'calc.mjs v2', event_id: 'sub-c2',
      })
      const stale = await h.runTool(devSession, 'orchestrator_division_merge_item', {
        item_id: 'wi-code', merge_note: '复用旧版测试结果直接合并', event_id: 'm-stale',
      }) as { merged: boolean; failureReason: string; blockedDependents: string[] }
      expect(stale.merged).toBe(false)
      expect(stale.failureReason).toBe('stale_verification')
      expect(stale.blockedDependents).toEqual(['wi-after-code'])
      expect(h.runtime.divisions.listClaimableItems(h.runtime.divisions.get('five-states-task')!).map(x => x.itemId)).not.toContain('wi-after-code')

      // 状态 5：成功（对最新 v2 真跑受控测试通过 -> 签发当前版本可信凭据、记录 automated_test 并解锁下游）
      const passed = await h.runTool(devSession, 'orchestrator_division_merge_item', {
        item_id: 'wi-code',
        verification_command: process.execPath,
        verification_args: ['--test', 'calc.test.mjs'],
        merge_note: 'v2 实测通过合并',
        event_id: 'm-pass',
      }) as { merged: boolean; unblockedItems: string[]; item: { status: string; acceptanceMethod?: string; deliverableVersion?: string; verificationCredential?: { deliverableVersion: string; passed: boolean; source: string } } }
      expect(passed.merged).toBe(true)
      expect(passed.item.status).toBe('merged')
      expect(passed.item.acceptanceMethod).toBe('automated_test')
      expect(passed.item.verificationCredential?.passed).toBe(true)
      expect(passed.item.verificationCredential?.source).toBe('controlled_runner')
      expect(passed.item.verificationCredential?.deliverableVersion).toBe(passed.item.deliverableVersion)
      expect(passed.unblockedItems).toContain('wi-after-code')

      // 文档类工作项（kind='docs' -> manual_acceptance）：缺验收说明被拒，填写人工验收说明后记录方式并解锁下游
      await h.runTool(devSession, 'orchestrator_division_submit_item', {
        item_id: 'wi-docs', summary: '补充 README 安装章节', deliverable: 'README.md', event_id: 'sub-d1',
      })
      const docsNoNote = await h.runTool(devSession, 'orchestrator_division_merge_item', {
        item_id: 'wi-docs', event_id: 'm-docs-nonote',
      }) as { merged: boolean; failureReason: string }
      expect(docsNoNote.merged).toBe(false)
      expect(docsNoNote.failureReason).toBe('missing_verification')

      const docsMerged = await h.runTool(devSession, 'orchestrator_division_merge_item', {
        item_id: 'wi-docs',
        acceptance_note: '人工逐段审阅文档、核对命令与链接一致',
        event_id: 'm-docs-ok',
      }) as { merged: boolean; unblockedItems: string[]; item: { acceptanceMethod?: string; acceptanceNote?: string } }
      expect(docsMerged.merged).toBe(true)
      expect(docsMerged.item.acceptanceMethod).toBe('manual_acceptance')
      expect(docsMerged.item.acceptanceNote).toContain('人工逐段审阅')
      expect(docsMerged.unblockedItems).toContain('wi-after-docs')
    } finally {
      await h.stop()
      rmSync(workDir, { recursive: true, force: true })
    }
  })
})

describe('v0.3.19 高优 3：confirmSpeculativeDraft 并发双确认、确认/撤销边界与已发未写回崩溃重启恢复', () => {
  it('阻塞投递下双确认只发一次、确认与撤销互斥无矛盾状态、外部发完未写回崩溃后重启零重发收口', async () => {
    const h = await startRuntime()
    const stateDir = h.directory
    const externalSink = new Map<string, { draftId: string; count: number; content: string }>()
    let invokeCount = 0

    try {
      // 场景 A：阻塞模拟投递 + 并发双确认 -> 仅调用投递回调 1 次
      h.runtime.divisions.createSpeculativeDraft({
        draftId: 'race-double',
        triggerId: 'trig-race-1',
        title: '并发双确认测试草稿',
        content: '周三 14:00 评审会议',
      })
      const gateA = Promise.withResolvers<string>()
      const blockingDeliverA = async (draft: { draftId: string; content: string }, deliveryKey: string) => {
        invokeCount++
        const id = await gateA.promise
        const prev = externalSink.get(deliveryKey)
        externalSink.set(deliveryKey, { draftId: draft.draftId, count: (prev?.count ?? 0) + 1, content: draft.content })
        return id
      }
      const c1 = h.runtime.divisions.confirmSpeculativeDraft('race-double', blockingDeliverA)
      const c2 = h.runtime.divisions.confirmSpeculativeDraft('race-double', blockingDeliverA)
      expect(invokeCount).toBe(1)
      expect(h.runtime.divisions.getSpeculativeDraft('race-double')?.status).toBe('delivering')

      // 场景 B：在途 delivering 期间并发调用 revoke -> 必须抛 DraftBoundaryError，严禁形成“既撤销又已发”的矛盾状态
      expect(() => h.runtime.divisions.revokeSpeculativeDraft('race-double', 'too late')).toThrow(DraftBoundaryError)
      expect(h.runtime.divisions.getSpeculativeDraft('race-double')?.status).toBe('delivering')

      gateA.resolve('ext-msg-1')
      const [res1, res2] = await Promise.all([c1, c2])
      expect(res1.delivered).toBe(true)
      expect(res1.deduplicated).toBe(false)
      expect(res2.delivered).toBe(true)
      expect(res2.deduplicated).toBe(true)
      expect(invokeCount).toBe(1)
      expect(externalSink.get('spec-draft:race-double')?.count).toBe(1)
      expect(h.runtime.divisions.getSpeculativeDraft('race-double')?.status).toBe('delivered')

      // 场景 C：撤销先胜出 -> 后续确认被 DraftBoundaryError 拒绝且 0 外发
      h.runtime.divisions.createSpeculativeDraft({
        draftId: 'race-revoke-first',
        triggerId: 'trig-race-2',
        title: '先撤销草稿',
        content: '不应外发',
      })
      h.runtime.divisions.revokeSpeculativeDraft('race-revoke-first', 'user cancelled first')
      await expect(h.runtime.divisions.confirmSpeculativeDraft('race-revoke-first', blockingDeliverA)).rejects.toThrow(DraftBoundaryError)
      expect(invokeCount).toBe(1)

      // 场景 D：外部已发送但写回 KV 前进程崩溃 -> 重启同一 SQLite 存储，恢复后零重发收口为 delivered
      h.runtime.divisions.createSpeculativeDraft({
        draftId: 'crash-after-send',
        triggerId: 'trig-crash-1',
        title: '发完崩溃待恢复草稿',
        content: '已送达外部但尚未落库',
      })
      const deliverCrash = async (draft: { draftId: string; content: string }, deliveryKey: string) => {
        invokeCount++
        const prev = externalSink.get(deliveryKey)
        externalSink.set(deliveryKey, { draftId: draft.draftId, count: (prev?.count ?? 0) + 1, content: draft.content })
        return `ext:${deliveryKey}`
      }
      await expect(h.runtime.divisions.confirmSpeculativeDraft('crash-after-send', deliverCrash, {
        beforeCommit: () => { throw new Error('SimulatedCrashBeforeKvCommit') },
      })).rejects.toThrow('SimulatedCrashBeforeKvCommit')
      expect(invokeCount).toBe(2)
      expect(externalSink.get('spec-draft:crash-after-send')?.count).toBe(1)
      expect(h.runtime.divisions.getSpeculativeDraft('crash-after-send')?.status).toBe('delivering')

      // 停掉旧 Runtime（保留 SQLite 文件），拉起全新重启的 Runtime
      await h.runtime.stop()
      vi.restoreAllMocks()

      const restarted = await startRuntime(undefined, stateDir)
      try {
        // 1) 重启后直接对崩溃草稿再次确认并传入外部发件探针 -> 探测到已发出，直接收口为 delivered，0 次重复发送！
        const recovered = await restarted.runtime.divisions.confirmSpeculativeDraft('crash-after-send', deliverCrash, {
          probeDelivered: key => externalSink.has(key) ? `ext:${key}` : undefined,
        })
        expect(recovered.delivered).toBe(true)
        expect(recovered.deduplicated).toBe(true)
        expect(recovered.draft.status).toBe('delivered')
        expect(invokeCount).toBe(2)
        expect(externalSink.get('spec-draft:crash-after-send')?.count).toBe(1)
      } finally {
        await restarted.stop()
      }
      return
    } catch (error) {
      await h.stop().catch(() => {})
      throw error
    }
  })
})

describe('v0.3.19 §4.2 真实入口闭环：入站事件 → 主会话工具创建草稿 → HTTP/面板交互确认、撤销与静默丢弃 → 真实 Outbox 外发', () => {
  it('从真实入站飞书事件端到端验证生成草稿、HTTP 确认后经 Outbox 唯一外发、撤销零外发与无价值静默丢弃', async () => {
    const h = await startRuntime()
    try {
      const sentMessages: Array<{ id: string; source: string; thread: string; address: Record<string, string>; text: string }> = []
      vi.spyOn(h.runtime.sources, 'send').mockImplementation(async receipt => {
        sentMessages.push({
          id: receipt.id,
          source: receipt.channel.source,
          thread: receipt.channel.thread,
          address: receipt.channel.address,
          text: receipt.text,
        })
        return 'sent'
      })

      // 1) 真实入站事件 1（会议邀约，最终确认发送）
      const trigConfirm = feishu('901', '周三下午 2 点产品评审，帮我查下冲突并草拟回复')
      h.runtime.receive(trigConfirm)
      await h.runtime.idle()

      const createdConfirm = await h.runTool(h.runtime.masterId, 'orchestrator_draft', {
        op: 'create',
        draft_id: 'meeting-confirm',
        trigger_id: trigConfirm.id,
        title: '周三评审回复草稿',
        content: '已查日历无冲突，确认周三 14:00 参会。',
      }) as { draft: { draftId: string; status: string; deliveryKey: string; target?: { kind: string; channel?: { source: string; address: Record<string, string> } } } }
      expect(createdConfirm.draft.status).toBe('draft')
      expect(createdConfirm.draft.target).toMatchObject({ kind: 'outbox', channel: { source: 'feishu' } })
      expect(sentMessages).toHaveLength(0)

      // 真实管理 HTTP 入口列表可见
      const listRes = await h.api('GET', 'drafts?status=draft')
      expect(listRes.status).toBe(200)
      expect((listRes.body.drafts as Array<{ draftId: string }>).map(d => d.draftId)).toContain('meeting-confirm')

      // 用户通过管理 HTTP 入口确认发送 -> 真实 Outbox 外发恰好 1 次，携带稳定 deliveryKey
      const confirmRes = await h.api('POST', 'drafts/meeting-confirm/confirm')
      expect(confirmRes.status).toBe(200)
      expect(confirmRes.body.delivered).toBe(true)
      expect((confirmRes.body.draft as { status: string }).status).toBe('delivered')
      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0]).toMatchObject({
        id: 'spec-draft:meeting-confirm',
        source: 'feishu',
        text: '已查日历无冲突，确认周三 14:00 参会。',
      })
      expect(sentMessages[0]!.address.chat_id ?? sentMessages[0]!.thread).toContain('oc_team')

      // 重复确认幂等，Outbox 仍仅 1 次外发；已发送后撤销返回 HTTP 409
      const confirmDup = await h.api('POST', 'drafts/meeting-confirm/confirm')
      expect(confirmDup.status).toBe(200)
      expect(confirmDup.body.deduplicated).toBe(true)
      expect(sentMessages).toHaveLength(1)
      const revokeAfterSend = await h.api('POST', 'drafts/meeting-confirm/revoke', { reason: 'too late' })
      expect(revokeAfterSend.status).toBe(409)

      // 2) 真实入站事件 2（撤销路径，零外发）
      const trigRevoke = feishu('902', '先草拟一个上线公告，别发出去')
      h.runtime.receive(trigRevoke)
      await h.runtime.idle()
      await h.runTool(h.runtime.masterId, 'orchestrator_draft', {
        op: 'create',
        draft_id: 'meeting-revoke',
        trigger_id: trigRevoke.id,
        title: '上线公告草稿',
        content: '今晚 22:00 发布新版本。',
      })
      const revokeRes = await h.api('POST', 'drafts/meeting-revoke/revoke', { reason: '计划推迟' })
      expect(revokeRes.status).toBe(200)
      expect((revokeRes.body.draft as { status: string }).status).toBe('revoked')
      const confirmAfterRevoke = await h.api('POST', 'drafts/meeting-revoke/confirm')
      expect(confirmAfterRevoke.status).toBe(409)
      expect(sentMessages).toHaveLength(1)

      // 3) 真实入站事件 3（低价值候安静默丢弃，零外发零打扰）
      const trigNoise = feishu('903', '哈哈收到')
      h.runtime.receive(trigNoise)
      await h.runtime.idle()
      const masterMsgsBefore = h.deliveries.mock.calls.filter(([c]) => c.sessionId === h.runtime.masterId).length
      const discarded = await h.runTool(h.runtime.masterId, 'orchestrator_draft', {
        op: 'create',
        draft_id: 'noise-discard',
        trigger_id: trigNoise.id,
        title: '闲聊无需回复',
        content: '无操作',
        low_value: true,
        reason: 'acknowledgement chatter, no user value',
      }) as { draft: { status: string } }
      expect(discarded.draft.status).toBe('discarded')
      expect(sentMessages).toHaveLength(1)
      expect(h.deliveries.mock.calls.filter(([c]) => c.sessionId === h.runtime.masterId).length).toBe(masterMsgsBefore)
    } finally { await h.stop() }
  })
})
