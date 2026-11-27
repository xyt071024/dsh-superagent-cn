/**
 * v0.3.18 专项回归测试：
 * - 问题 I：GitHub Issue/PR 标题与正文 @ 提及判定
 * - 问题 G1/G2：个人 QQ 引用消息 ID 保留 + 权限受控回查原文 + 图片附件可读引用与不可用处理
 * - 问题 H：飞书 post 富文本段落、文本、链接、提及与内嵌图片解析
 * - 优先项 1：普通聊天真实工具路径触发主动分工、空闲成员收到通知自主补位认领、无人应答超时回退不无限等待
 * - 优先项 2：真实双文件修改、真实合并并运行 node --test；冲突/测试失败清晰可见且阻断下游依赖解锁
 * - 优先项 3：canReviewWorkItem 接入真实审查提交入口（作者自审被拒，非作者/独立复查通过）
 * - §4.2 投机执行闭环：未发布草稿 → 确认交付一次 / 撤销零外发 / 无价值静默丢弃
 * - 问题 K：Git 包装器前置配置隔离与可读性预检
 */
import { startRuntime, type Host } from './fixtures/host.ts'
import { createServer } from 'node:http'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsSchema } from '../src/policy.ts'
import { issueTrigger, pullTrigger } from '../src/sources/github-trigger.ts'
import { feishuTrigger, historyEvent, parseFeishuContent, topicEvent } from '../src/sources/feishu-trigger.ts'
import { feishuView } from '../src/sources/feishu-read.ts'
import { admissionImageKeys } from '../src/sources/feishu-image.ts'
import { imageRefsOf, oneBotKind, plainText, QqConfigSchema, qqImageKeys, readQqImage, replyIdOf, triggerOf } from '../src/sources/qq.ts'
import { ROUTER_PRESET } from '../src/app/sessions.ts'
import { gitEnv, probeGitConfigIsolation } from './fixtures/git.ts'

// 1x1 合法 PNG 像素字节
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2m0AAAAASUVORK5CYII=',
  'base64',
)

const deliveredTexts = (h: Host, sessionId: string): string[] =>
  h.deliveries.mock.calls.map(([call]) => call).filter(call => call.sessionId === sessionId).map(call => call.text)

describe('问题 I：GitHub 标题与正文 @ 提及识别', () => {
  const baseIssue = {
    number: 108,
    user: { login: 'alice', type: 'User' },
    created_at: '2026-11-27T01:00:00.000Z',
    html_url: 'https://github.com/acme/widgets/issues/108',
  }

  it('只在标题提及 @agent 时标记 addressed=mention，完全未提及时不标记', () => {
    const titleOnly = issueTrigger({
      ...baseIssue,
      title: '@agent-bot 请核查构建脚本',
      body: '正文没有提及任何人，仅描述背景。',
    }, 'agent-bot')
    expect(titleOnly.addressed).toBe('mention')

    const bodyOnly = issueTrigger({
      ...baseIssue,
      title: '构建脚本问题',
      body: '请 @agent-bot 帮忙核查。',
    }, 'agent-bot')
    expect(bodyOnly.addressed).toBe('mention')

    const none = issueTrigger({
      ...baseIssue,
      title: '普通讨论标题',
      body: '正文也没有提及，仅提及 @other-user。',
    }, 'agent-bot')
    expect(none.addressed).toBeUndefined()
  })

  it('PR 仅在标题提及 @agent 时同样标记 addressed=mention，未提及时不标记', () => {
    const prTitleOnly = pullTrigger({
      ...baseIssue,
      number: 109,
      title: 'fix: resolve lint error @Agent-Bot',
      body: 'No mention in body.',
    }, 'agent-bot')
    expect(prTitleOnly.addressed).toBe('mention')
    expect(prTitleOnly.meta.isPr).toBe(true)

    const prNone = pullTrigger({
      ...baseIssue,
      number: 110,
      title: 'chore: update readme',
      body: 'No mention here either.',
    }, 'agent-bot')
    expect(prNone.addressed).toBeUndefined()
  })
})

describe('问题 G1/G2：个人 QQ 引用消息权限回查与图片附件可读引用', () => {
  afterEach(() => vi.unstubAllGlobals())

  const cfg = QqConfigSchema.parse({
    endpoint: 'http://127.0.0.1:3000',
    token: 'tok',
    groups: '7',
    privateMessages: true,
  })
  const kind = oneBotKind('qq', { zh: 'QQ', en: 'QQ' }, { zh: 'QQ', en: 'QQ' }, { key: 'DSH_SUPERAGENT_QQ_THREAD', description: { zh: '', en: '' } })

  it('G1：保留引用消息 ID，按同群/同私聊权限回查原文，越权引用与不可用消息安全拒绝', async () => {
    const groupReply = {
      message_id: 2002,
      group_id: 7,
      user_id: 9,
      time: 1732670000,
      sender: { nickname: '阿甲' },
      message: [
        { type: 'reply', data: { id: '1001' } },
        { type: 'at', data: { qq: '1' } },
        { type: 'text', data: { text: '按这条旧消息改' } },
      ],
    }
    expect(replyIdOf(groupReply)).toBe('1001')
    const trigger = triggerOf(groupReply, cfg, '1')!
    expect(trigger.meta.replyToId).toBe('1001')
    expect(kind.repliesTo?.(trigger)).toBe('qq:1001')

    // 1) 同群旧消息 -> 权限通过，返回原文
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'ok',
      retcode: 0,
      data: {
        message_id: 1001,
        group_id: 7,
        user_id: 8,
        time: 1732669000,
        sender: { nickname: '阿乙' },
        message: [{ type: 'text', data: { text: '旧消息原文：请把端口改成 3090' } }],
      },
    }))))
    const allowedParent = await kind.threadContext!.read({} as never, trigger, 'parent', undefined, cfg)
    expect(allowedParent.status).toBe('available')
    expect(allowedParent.messages).toHaveLength(1)
    expect(allowedParent.messages[0]!.text).toContain('旧消息原文：请把端口改成 3090')

    // 2) 越权跨群引用（返回的是 999 群的消息）-> 明确拒绝且不泄露内容
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'ok',
      retcode: 0,
      data: {
        message_id: 1001,
        group_id: 999,
        user_id: 8,
        time: 1732669000,
        sender: { nickname: '外部人' },
        message: [{ type: 'text', data: { text: '机密跨群消息' } }],
      },
    }))))
    const crossGroup = await kind.threadContext!.read({} as never, trigger, 'parent', undefined, cfg)
    expect(crossGroup.status).toBe('forbidden')
    expect(crossGroup.messages).toEqual([])
    expect(JSON.stringify(crossGroup)).not.toContain('机密跨群消息')

    // 3) 私聊引用同一联系人的旧消息 vs 越权他人私聊 vs 网关查不到
    const privateTrigger = triggerOf({
      message_id: 3002,
      user_id: 9,
      time: 1732670100,
      raw_message: '[CQ:reply,id=3001]再核对一下刚才那条',
    }, cfg, '1')!
    expect(privateTrigger.meta.replyToId).toBe('3001')

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'ok', retcode: 0,
      data: { message_id: 3001, user_id: 9, time: 1732670050, message: [{ type: 'text', data: { text: '私聊旧消息内容' } }] },
    }))))
    const privOk = await kind.threadContext!.read({} as never, privateTrigger, 'parent', undefined, cfg)
    expect(privOk.status).toBe('available')
    expect(privOk.messages[0]!.text).toBe('私聊旧消息内容')

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'ok', retcode: 0,
      data: { message_id: 3001, user_id: 888, time: 1732670050, message: [{ type: 'text', data: { text: '他人私聊机密' } }] },
    }))))
    const privForbidden = await kind.threadContext!.read({} as never, privateTrigger, 'parent', undefined, cfg)
    expect(privForbidden.status).toBe('forbidden')
    expect(privForbidden.messages).toEqual([])

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'failed', retcode: 100 }))))
    const unavailable = await kind.threadContext!.read({} as never, privateTrigger, 'parent', undefined, cfg)
    expect(unavailable.status).toBe('unavailable')
    expect(unavailable.messages).toEqual([])
  })

  it('G2：单图生成可读附件引用并实际下载入库；图片不可用或非图片时明确报错', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/ok.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' })
        res.end(TINY_PNG)
      } else if (req.url === '/not-image') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html>expired</html>')
      } else {
        res.writeHead(404)
        res.end('Not Found')
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as { port: number }
    const baseUrl = `http://127.0.0.1:${addr.port}`

    const savedImages: Array<{ mediaType: string; name: string; bytes: number }> = []
    const fakeAgent = {
      options: { provider: 'p', model: 'vision-m' },
      session: { requestHeader: () => ({ config: { provider: 'p', model: 'vision-m' } }) },
      ctx: {
        get: (name: string) => {
          if (name === 'attachments') {
            return {
              imageLimits: { maxImageBytes: 5 * 1024 * 1024, maxMessageImageBytes: 5 * 1024 * 1024 },
              saveImage: async (input: { data: Buffer; mediaType: string; name: string }) => {
                savedImages.push({ mediaType: input.mediaType, name: input.name, bytes: input.data.length })
                return { id: `att-${savedImages.length}`, mediaType: input.mediaType, name: input.name }
              },
            }
          }
          if (name === 'llm') {
            return { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) }
          }
          return undefined
        },
      },
    } as never

    try {
      // 1) 单图正常读取
      const imgMsg = {
        message_id: 4001,
        user_id: 9,
        time: 1732670200,
        message: [
          { type: 'text', data: { text: '看这张报错截图' } },
          { type: 'image', data: { url: `${baseUrl}/ok.png`, file: 'err.png' } },
        ],
      }
      const refs = imageRefsOf(imgMsg)
      expect(refs).toHaveLength(1)
      expect(plainText(imgMsg)).toContain(`[图片: ${refs[0]!.key}]`)
      const imgTrigger = triggerOf(imgMsg, cfg, '1')!
      const keys = qqImageKeys(imgTrigger.text)
      expect(keys).toEqual([refs[0]!.key])

      const loaded = await readQqImage(
        fakeAgent,
        imgTrigger,
        { id: '4001', text: imgTrigger.text },
        keys[0]!,
        new AbortController().signal,
        cfg,
      )
      expect(loaded.image_key).toBe(keys[0])
      expect(savedImages).toHaveLength(1)
      expect(savedImages[0]).toMatchObject({ mediaType: 'image/png', bytes: TINY_PNG.length })

      // 2) 图片 404 不可用 -> 明确报错
      const missingTrigger = triggerOf({
        message_id: 4002,
        user_id: 9,
        time: 1732670205,
        message: [{ type: 'image', data: { url: `${baseUrl}/missing.png` } }],
      }, cfg, '1')!
      const missingKey = qqImageKeys(missingTrigger.text)[0]!
      await expect(readQqImage(
        fakeAgent,
        missingTrigger,
        { id: '4002', text: missingTrigger.text },
        missingKey,
        new AbortController().signal,
        cfg,
      )).rejects.toThrow(/QQ image .* is unavailable: HTTP 404/)

      // 3) 图片链接返回非图片 HTML -> 明确报错
      const htmlTrigger = triggerOf({
        message_id: 4003,
        user_id: 9,
        time: 1732670210,
        message: [{ type: 'image', data: { url: `${baseUrl}/not-image` } }],
      }, cfg, '1')!
      const htmlKey = qqImageKeys(htmlTrigger.text)[0]!
      await expect(readQqImage(
        fakeAgent,
        htmlTrigger,
        { id: '4003', text: htmlTrigger.text },
        htmlKey,
        new AbortController().signal,
        cfg,
      )).rejects.toThrow(/not a supported PNG\/JPEG\/WebP\/GIF image/)
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})

describe('问题 H：飞书 post 混合富文本解析', () => {
  it('正确解析含标题、多段落、纯文本、链接、@提及与内嵌图片的 post 事件（实时/历史/话题一致）', () => {
    const richPost = JSON.stringify({
      zh_cn: {
        title: '发布前核对清单',
        content: [
          [
            { tag: 'at', user_id: 'ou_bot', user_name: 'SuperAgent' },
            { tag: 'text', text: '请核对 ' },
            { tag: 'a', text: '安装说明', href: 'https://example.com/install' },
          ],
          [
            { tag: 'text', text: '第二段：详见截图 ' },
            { tag: 'img', image_key: 'img_v3_demo123' },
            { tag: 'text', text: ' 并确认日志。' },
          ],
        ],
      },
    })

    const parsed = parseFeishuContent(richPost)
    expect(parsed).toContain('发布前核对清单')
    expect(parsed).toContain('@SuperAgent 请核对 安装说明 (https://example.com/install)')
    expect(parsed).toContain('第二段：详见截图 [图片: img_v3_demo123] 并确认日志。')
    expect(parsed).not.toContain('"tag"')
    expect(admissionImageKeys(parsed)).toEqual(['img_v3_demo123'])

    const live = feishuTrigger({
      message_id: 'om_post_1',
      chat_id: 'oc_1',
      chat_type: 'group',
      sender_id: 'ou_alice',
      sender_type: 'user',
      content: richPost,
      create_time: '1764200000000',
      mentions: [{ id: 'ou_bot', key: '@_user_1', name: 'SuperAgent' }],
    }, 'ou_bot', 'cli_bot')!
    expect(live.addressed).toBe('mention')
    expect(live.text).toBe(parsed)

    const hist = feishuTrigger(historyEvent({
      message_id: 'om_post_2',
      chat_id: 'oc_1',
      create_time: '1764200005000',
      sender: { id: 'ou_alice', sender_type: 'user' },
      body: { content: richPost },
      mentions: [{ id: 'ou_bot', key: '@_user_1', name: 'SuperAgent' }],
    }, 'oc_1', false), 'ou_bot', 'cli_bot')!
    expect(hist.text).toBe(parsed)

    const directPostJson = JSON.stringify({
      title: 'Direct Post',
      content: [[{ tag: 'text', text: 'Hello ' }, { tag: 'a', text: 'Docs', href: 'https://docs.example.com' }]],
    })
    const view = feishuView({
      message_id: 'om_post_3',
      chat_id: 'oc_1',
      msg_type: 'post',
      content: directPostJson,
      sender: { id: 'ou_alice', name: 'Alice', sender_type: 'user' },
      create_time: '1764200010000',
    })
    expect(view.text).toBe('Direct Post\nHello Docs (https://docs.example.com)')
    expect(feishuTrigger(topicEvent({
      message_id: 'om_post_3',
      chat_id: 'oc_1',
      msg_type: 'post',
      content: directPostJson,
      sender: { id: 'ou_alice', sender_type: 'user' },
      create_time: '1764200010000',
    }, 'oc_1', false, 'om_root'), 'ou_bot', 'cli_bot')!.text).toBe('Direct Post\nHello Docs (https://docs.example.com)')
  })
})

describe('优先项 1/2/3 与 §4.2：普通聊天主动补位、真实双文件合并门禁、真实审查入口与投机草稿', () => {
  it('优先项 1：普通聊天经真实工具主动分工，等待/空闲成员收到主动通知后自行调用认领工具，无人应答时超时回退不卡死', async () => {
    const h = await startRuntime(store => {
      const cur = store.settings()
      store.saveSettings(SettingsSchema.parse({
        ...cur,
        routing: { ...cur.routing, multiSession: 'auto', maxSessions: 5 },
      }))
    })
    try {
      await h.controller.create({ sessionId: 'chat-origin-1' } as never)
      ;(h.ctx as unknown as { emit: (event: string, sessionId: string, presetId: string) => void }).emit(
        'agent-preset/selected',
        'chat-origin-1',
        ROUTER_PRESET,
      )
      await vi.waitFor(() => expect(h.tools.get('chat-origin-1')?.has('orchestrator_dispatch')).toBe(true))

      // 1) 普通聊天会话自身调用注册的 orchestrator_dispatch 工具触发首次派工
      const dispatchResult = await h.runTool('chat-origin-1', 'orchestrator_dispatch', {
        task_id: 'chat-auto-offer-1',
        title: '双模块协同改造',
        brief: '开发模块拆成两个独立工作项，空闲/等待依赖的预审查成员可主动响应补位',
        difficulty: 90,
        plan_key: 'offer-p1',
        divisions: [
          {
            division_id: 'dev',
            title: '开发',
            brief: '实现模块 A 与模块 B',
            work_items: [
              { item_id: 'wi-a', title: '模块 A', brief: '实现核心 A' },
              { item_id: 'wi-b', title: '模块 B', brief: '实现独立工具 B' },
            ],
          },
          {
            division_id: 'helper',
            title: '协作成员',
            brief: '等待 dev 完成后整合',
            depends_on: ['dev'],
          },
        ],
      }) as { task_id: string; extra_sessions: number }

      expect(dispatchResult.extra_sessions).toBe(2)
      const planAfterDispatch = h.runtime.divisions.get('chat-auto-offer-1')!
      expect(planAfterDispatch.triggeredBy).toBe('chat-origin-1')
      expect(planAfterDispatch.handoffAudit?.some(e => e.kind === 'dispatch' && e.actor === 'chat-origin-1')).toBe(true)

      // 2) 验证处于 waiting_deps 的 helper 自动收到了 [work_item_available] 主动补位通知
      const helperDiv = planAfterDispatch.divisions.find(d => d.divisionId === 'helper')!
      expect(h.agents.get(helperDiv.sessionId)).toBeDefined()
      expect(deliveredTexts(h, helperDiv.sessionId).some(t => t.includes('[work_item_available]') && t.includes('wi-b'))).toBe(true)
      expect(planAfterDispatch.handoffAudit?.some(e => e.kind === 'offer' && e.itemId === 'wi-b')).toBe(true)

      // 3) helper 在自己会话中调用真实注册的 orchestrator_division_claim_item 自主认领 wi-b
      const claimOut = await h.runTool(helperDiv.sessionId, 'orchestrator_division_claim_item', {
        item_id: 'wi-b',
        event_id: 'helper-claim-b-1',
      }) as { claimed: boolean; item: { assigneeDivisionId: string } }
      expect(claimOut.claimed).toBe(true)
      expect(claimOut.item.assigneeDivisionId).toBe('helper')

      const afterClaim = h.runtime.divisions.get('chat-auto-offer-1')!
      expect(afterClaim.handoffAudit?.some(e => e.kind === 'claim' && e.actor === 'helper' && e.itemId === 'wi-b')).toBe(true)

      // 4) 无人应答场景：wi-a 曾被主动推送但无人认领 -> 超时后 reclaimExpiredOffers 自动回退给原负责人 dev 与主会话，避免无限等待
      const futureMs = Date.now() + 5 * 60_000
      const reclaimed = await h.runtime.divisions.reclaimExpiredOffers('chat-auto-offer-1', futureMs)
      expect(reclaimed.timedOutItems).toContain('wi-a')
      const afterTimeout = h.runtime.divisions.get('chat-auto-offer-1')!
      const wiA = afterTimeout.workItems!.find(w => w.itemId === 'wi-a')!
      expect(wiA.offerTimedOutAt).toBeTruthy()
      expect(afterTimeout.handoffAudit?.some(e => e.kind === 'offer_timeout' && e.itemId === 'wi-a')).toBe(true)
      const devSessionId = afterTimeout.divisions.find(d => d.divisionId === 'dev')!.sessionId
      expect(deliveredTexts(h, devSessionId).some(t => t.includes('[work_item_offer_timeout]') && t.includes('wi-a'))).toBe(true)
      expect(deliveredTexts(h, 'chat-origin-1').some(t => t.includes('[work_item_offer_timeout]') && t.includes('wi-a'))).toBe(true)
    } finally { await h.stop() }
  })

  it('优先项 2 & 3：真实修改两个文件并运行 node --test 门禁（失败/冲突可见并阻断下游解锁，修复后解锁），真实审查入口拒绝作者自审、允许非作者通过', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'sa-real-merge-'))
    const h = await startRuntime(store => {
      const cur = store.settings()
      store.saveSettings(SettingsSchema.parse({
        ...cur,
        executor: { ...cur.executor, reviewEnabled: true },
        routing: { ...cur.routing, multiSession: 'auto', maxSessions: 5 },
      }))
    })
    try {
      // 在真实工作目录写入两份源码文件与一份真实可执行的 node:test 套件
      writeFileSync(join(workDir, 'math.mjs'), 'export const add = (a, b) => a + b\n')
      writeFileSync(join(workDir, 'format.mjs'), 'export const formatSum = (a, b, sum) => `${a}+${b}=${sum}`\n')
      writeFileSync(join(workDir, 'suite.test.mjs'), [
        'import test from "node:test"',
        'import assert from "node:assert/strict"',
        'import { add } from "./math.mjs"',
        'import { formatSum } from "./format.mjs"',
        'test("merged math + format works", () => {',
        '  assert.equal(formatSum(2, 3, add(2, 3)), "2 + 3 = 5")',
        '})',
      ].join('\n'))

      const dispatched = await h.runtime.divisions.dispatch({
        taskId: 'real-merge-task',
        title: '双文件真实合并与独立审查',
        brief: '修改 math.mjs 和 format.mjs，合并并跑项目单测，独立审查确认',
        directory: workDir,
        difficulty: 95,
        originSessionId: h.runtime.masterId,
        planKey: 'merge-p1',
        divisions: [
          {
            divisionId: 'dev',
            title: '主开发',
            brief: '维护 math.mjs 与合并 format.mjs',
            workItems: [
              { itemId: 'item-math', title: '更新 math.mjs', brief: '确保 add 正确' },
              { itemId: 'item-format', title: '更新 format.mjs', brief: '格式化为 a + b = sum' },
            ],
          },
          {
            divisionId: 'helper',
            title: '协助开发',
            brief: '认领 format.mjs 改造',
          },
          {
            divisionId: 'qa',
            title: '独立测试员',
            brief: '在 item-format 合并后执行集成回归与独立复核',
            workItems: [
              { itemId: 'item-e2e', title: '下游集成验证', brief: '依赖 item-format 合并通过', dependsOn: ['item-format'] },
            ],
          },
        ],
      })

      const devSessionId = dispatched.plan.divisions.find(d => d.divisionId === 'dev')!.sessionId
      const helperSessionId = dispatched.plan.divisions.find(d => d.divisionId === 'helper')!.sessionId
      const qaSessionId = dispatched.plan.divisions.find(d => d.divisionId === 'qa')!.sessionId

      // 1) helper 认领 item-format，故意写入未通过单测的代码并提交
      await h.runTool(helperSessionId, 'orchestrator_division_claim_item', { item_id: 'item-format', event_id: 'c-fmt-1' })
      writeFileSync(join(workDir, 'format.mjs'), 'export const formatSum = (a, b, sum) => `${a}+${b}=${sum}`\n')
      await h.runTool(helperSessionId, 'orchestrator_division_submit_item', {
        item_id: 'item-format',
        summary: '初次修改 format.mjs',
        deliverable: 'format.mjs updated (v1)',
        event_id: 's-fmt-1',
      })

      // 2) dev 尝试合并并实际运行 node --test suite.test.mjs -> 失败！状态应变为 merge_failed 且下游 item-e2e 严格保持锁定
      const failedMerge = await h.runTool(devSessionId, 'orchestrator_division_merge_item', {
        item_id: 'item-format',
        run_check: true,
        verification_command: process.execPath,
        verification_args: ['--test', 'suite.test.mjs'],
        merge_note: '尝试合并并运行单测',
        event_id: 'm-fmt-fail',
      }) as { merged: boolean; blockedDependents: string[]; item: { status: string; verificationOutput?: string } }
      expect(failedMerge.merged).toBe(false)
      expect(failedMerge.item.status).toBe('merge_failed')
      expect(failedMerge.item.verificationOutput).toMatch(/2\+3=5|2 \+ 3 = 5|not ok/i)
      expect(failedMerge.blockedDependents).toEqual(['item-e2e'])
      expect(h.runtime.divisions.listClaimableItems(h.runtime.divisions.get('real-merge-task')!).map(x => x.itemId)).not.toContain('item-e2e')

      // 3) 显式合并冲突测试 -> 状态应为 conflict、冲突文件可见且下游仍被阻断
      const conflictMerge = await h.runTool(devSessionId, 'orchestrator_division_merge_item', {
        item_id: 'item-format',
        verification_status: 'conflict',
        conflict_files: ['format.mjs'],
        merge_note: '发现合并冲突',
        event_id: 'm-fmt-conflict',
      }) as { merged: boolean; item: { status: string; conflictFiles?: string[] } }
      expect(conflictMerge.merged).toBe(false)
      expect(conflictMerge.item.status).toBe('conflict')
      expect(conflictMerge.item.conflictFiles).toEqual(['format.mjs'])
      expect(h.runtime.divisions.listClaimableItems(h.runtime.divisions.get('real-merge-task')!).map(x => x.itemId)).not.toContain('item-e2e')

      // 4) helper 修复 format.mjs 与 dev 的 math.mjs 合并，重新提交 -> 真跑 node --test 通过并解锁 item-e2e
      writeFileSync(join(workDir, 'math.mjs'), 'export const add = (a, b) => Number(a) + Number(b)\n')
      writeFileSync(join(workDir, 'format.mjs'), 'export const formatSum = (a, b, sum) => `${a} + ${b} = ${sum}`\n')
      await h.runTool(helperSessionId, 'orchestrator_division_submit_item', {
        item_id: 'item-format',
        summary: '修复格式空格并消除冲突',
        deliverable: 'format.mjs updated (v2)',
        event_id: 's-fmt-2',
      })
      const passedMerge = await h.runTool(devSessionId, 'orchestrator_division_merge_item', {
        item_id: 'item-format',
        run_check: true,
        verification_command: process.execPath,
        verification_args: ['--test', 'suite.test.mjs'],
        merge_note: '单测全部通过，确认合并',
        event_id: 'm-fmt-pass',
      }) as { merged: boolean; unblockedItems: string[]; item: { status: string; verificationStatus?: string } }
      expect(passedMerge.merged).toBe(true)
      expect(passedMerge.item.status).toBe('merged')
      expect(passedMerge.item.verificationStatus).toBe('passed')
      expect(passedMerge.unblockedItems).toContain('item-e2e')

      // 5) 优先项 3：真实工具入口强制执行 canReviewWorkItem
      // 5a) 编写者 helper 试图通过真实工具批准自己参与编写的 item-format -> 明确拒绝！
      await expect(h.runTool(helperSessionId, 'orchestrator_division_review_item', {
        item_id: 'item-format',
        approved: true,
        summary: '自己审自己通过',
        event_id: 'rev-self-1',
      })).rejects.toThrow(/contributed to work item "item-format"/)

      // 5b) 未参与编写 item-format 的 qa 通过真实工具执行独立复核 -> 成功通过！
      const qaReview = await h.runTool(qaSessionId, 'orchestrator_division_review_item', {
        item_id: 'item-format',
        approved: true,
        summary: '独立核查 format.mjs 改动与单测输出均符合要求',
        event_id: 'rev-qa-1',
      }) as { reviewed: boolean; item: { reviewedBy: string; reviewState: string } }
      expect(qaReview.reviewed).toBe(true)
      expect(qaReview.item.reviewedBy).toBe('qa')
      expect(qaReview.item.reviewState).toBe('passed')

      // 5c) 全部分工完成后启动专属独立复查会话，验证作者会话调用 submitReview 被拒，专属复查会话通过
      await h.runtime.divisions.reportDivision({ taskId: 'real-merge-task', divisionId: 'dev', state: 'completed', summary: 'math+merge done', eventId: 'd-done' })
      await h.runtime.divisions.reportDivision({ taskId: 'real-merge-task', divisionId: 'helper', state: 'completed', summary: 'format done', eventId: 'h-done' })
      const finalRep = await h.runtime.divisions.reportDivision({ taskId: 'real-merge-task', divisionId: 'qa', state: 'completed', summary: 'e2e done', eventId: 'q-done' })
      expect(finalRep.reviewSessionId).toBeTruthy()

      // 作者会话 helperSessionId 尝试在最终复查入口批准 -> 被真实入口拦截拒绝
      await expect(h.runtime.divisions.submitReview({
        taskId: 'real-merge-task',
        approved: true,
        summary: 'author trying to self-approve task',
        sessionId: helperSessionId,
      })).rejects.toThrow(/contributed to work item|Self-review rejected/)

      // 专属独立复查会话调用真实注册工具 orchestrator_division_review_submit -> 通过！
      const reviewOut = await h.runTool(finalRep.reviewSessionId!, 'orchestrator_division_review_submit', {
        approved: true,
        summary: '独立复查验证两份改动文件与测试结果全部通过',
      }) as { recorded: boolean; review: { state: string } }
      expect(reviewOut.recorded).toBe(true)
      expect(reviewOut.review.state).toBe('passed')
    } finally {
      await h.stop()
      rmSync(workDir, { recursive: true, force: true })
    }
  })

  it('§4.2 投机执行闭环：未发布草稿确认后交付一次、撤销后零外发、无价值候选静默丢弃', async () => {
    const h = await startRuntime()
    try {
      const deliveries: Array<{ draftId: string; content: string }> = []
      const deliver = async (draft: { draftId: string; content: string }) => {
        deliveries.push({ draftId: draft.draftId, content: draft.content })
        return `outbox:${draft.draftId}`
      }

      // 1) 批准路径：先形成未发布草稿（0 外发） -> 确认后外发一次（重复确认幂等不再发）
      const d1 = h.runtime.divisions.createSpeculativeDraft({
        draftId: 'spec-approve',
        triggerId: 'trig-1',
        title: '会议邀约日程草稿',
        content: '建议周三 14:00 评审',
      })
      expect(d1.status).toBe('draft')
      expect(deliveries).toHaveLength(0)

      const c1 = await h.runtime.divisions.confirmSpeculativeDraft('spec-approve', deliver)
      expect(c1.delivered).toBe(true)
      expect(c1.deduplicated).toBe(false)
      expect(c1.draft.status).toBe('delivered')
      expect(deliveries).toHaveLength(1)

      const c1Dup = await h.runtime.divisions.confirmSpeculativeDraft('spec-approve', deliver)
      expect(c1Dup.deduplicated).toBe(true)
      expect(deliveries).toHaveLength(1)

      // 2) 撤销路径：未确认前撤销 -> 零外发且不可再确认
      h.runtime.divisions.createSpeculativeDraft({
        draftId: 'spec-revoke',
        triggerId: 'trig-2',
        title: '待确认通知草稿',
        content: '计划变更通知',
      })
      const revoked = h.runtime.divisions.revokeSpeculativeDraft('spec-revoke', '用户取消了变更')
      expect(revoked.status).toBe('revoked')
      await expect(h.runtime.divisions.confirmSpeculativeDraft('spec-revoke', deliver)).rejects.toThrow(/already revoked/)
      expect(deliveries).toHaveLength(1)

      // 3) 无价值静默丢弃路径：不打扰、零外发
      const masterPromptsBefore = deliveredTexts(h, h.runtime.masterId).length
      h.runtime.divisions.createSpeculativeDraft({
        draftId: 'spec-discard',
        triggerId: 'trig-3',
        title: '闲聊噪声候选',
        content: '无需动作',
      })
      const discarded = h.runtime.divisions.discardSpeculativeDraft('spec-discard', 'no actionable value')
      expect(discarded.status).toBe('discarded')
      expect(deliveries).toHaveLength(1)
      expect(deliveredTexts(h, h.runtime.masterId).length).toBe(masterPromptsBefore)
    } finally { await h.stop() }
  })
})

describe('问题 K：Git 包装器前置配置隔离与可读性校验', () => {
  it('gitEnv 清除宿主遗留的 GIT_CONFIG_COUNT/PARAMETERS，probeGitConfigIsolation 可识别覆写 GIT_CONFIG_GLOBAL 的异常包装器', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sa-git-wrap-'))
    try {
      const prevCount = process.env.GIT_CONFIG_COUNT
      process.env.GIT_CONFIG_COUNT = '1'
      try {
        const cleaned = gitEnv()
        expect(cleaned.GIT_CONFIG_COUNT).toBeUndefined()
        expect(cleaned.GIT_CONFIG_PARAMETERS).toBeUndefined()
      } finally {
        if (prevCount === undefined) delete process.env.GIT_CONFIG_COUNT
        else process.env.GIT_CONFIG_COUNT = prevCount
      }

      const cfgFile = join(dir, 'worker-gitconfig')
      writeFileSync(cfgFile, '[user]\n\tuseConfigOnly = true\n')

      // 正常宿主 git 应能读取 GIT_CONFIG_GLOBAL
      const normalEnv = gitEnv({ GIT_CONFIG_GLOBAL: cfgFile, GIT_CONFIG_NOSYSTEM: '1' }) as NodeJS.ProcessEnv
      expect(probeGitConfigIsolation(cfgFile, normalEnv).ok).toBe(true)

      // 模拟一个忽略 GIT_CONFIG_GLOBAL 的异常 git 包装器 -> precheck 必须明确报失败
      const badBin = join(dir, 'bad-bin')
      mkdirSync(badBin, { recursive: true })
      const script = join(badBin, 'fake-git.mjs')
      writeFileSync(script, 'process.stdout.write("file:/etc/forced-gitconfig\\0true\\0")\n')
      let wrapperPath: string
      if (process.platform === 'win32') {
        wrapperPath = join(badBin, 'git.cmd')
        writeFileSync(wrapperPath, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`)
      } else {
        wrapperPath = join(badBin, 'git')
        writeFileSync(wrapperPath, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`)
        chmodSync(wrapperPath, 0o755)
      }
      const wrappedEnv = {
        ...normalEnv,
        PATH: `${badBin}${delimiter}${normalEnv.PATH ?? ''}`,
      }
      const badCheck = probeGitConfigIsolation(cfgFile, wrappedEnv, wrapperPath)
      expect(badCheck.ok).toBe(false)
      expect(badCheck.detail).toContain('ignored GIT_CONFIG_GLOBAL')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
