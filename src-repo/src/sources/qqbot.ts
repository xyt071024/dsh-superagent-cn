/** Official QQ Open Platform bot: separate from the personal-account OneBot bridge. */
import { QQBot, type QQBotInboundMessage } from '@tencent-connect/qqbot-nodejs'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import type { Trigger } from '../core/index.ts'
import { health, sourceContext, type SourceContext } from './host.ts'
import type { SourceKind } from './kind.ts'
import { pause } from './poll.ts'

export const SOURCE = 'qqbot'
export const QqBotConfigSchema = z.object({
  appId: z.string().trim().default(''),
  appSecret: z.string().trim().default(''),
  directMessages: z.boolean().default(true),
  groupMessages: z.boolean().default(true),
}).strict()
export type QqBotConfig = z.infer<typeof QqBotConfigSchema>

/** Only supported C2C and group events are converted; guild and channel events are intentionally ignored. */
export function qqBotTrigger(message: QQBotInboundMessage, config: QqBotConfig): Trigger | undefined {
  if ((message.kind !== 'c2c' && message.kind !== 'group') || message.senderIsBot || !message.senderId || !message.messageId) return undefined
  if (message.kind === 'c2c' && !config.directMessages) return undefined
  if (message.kind === 'group' && !config.groupMessages) return undefined
  const target = message.kind === 'group' ? message.groupOpenid : message.senderId
  if (!target || !message.content?.trim()) return undefined
  const group = message.kind === 'group'
  const mentioned = message.rawEventType === 'GROUP_AT_MESSAGE_CREATE'
  const scope = group ? 'group' : 'c2c'
  const thread = `${scope}:${target}`
  const at = Number.isFinite(Date.parse(message.timestamp)) ? new Date(message.timestamp).toISOString() : new Date().toISOString()
  return {
    id: `${SOURCE}:${message.messageId}`, source: SOURCE, threads: [{ source: SOURCE, id: thread }],
    actor: { source: SOURCE, id: message.senderId, name: message.senderName || message.senderId }, human: true,
    ...(!group ? { addressed: 'direct' as const } : mentioned ? { addressed: 'mention' as const } : {}),
    at, text: message.content.trim(),
    channel: { source: SOURCE, thread, address: { scope, target, messageId: message.messageId } },
    meta: { messageId: message.messageId, scope },
  }
}

export const qqBotKind: SourceKind<QqBotConfig> = {
  kind: SOURCE,
  defaultEnabled: false,
  title: { zh: 'QQ 官方机器人', en: 'Official QQ bot' },
  description: { zh: '连接 QQ 开放平台机器人，接收获授权的私聊及群消息；与个人 QQ 网关独立。',
    en: 'Connects a QQ Open Platform bot for authorized direct and group messages; separate from the personal QQ bridge.' },
  schema: QqBotConfigSchema,
  fields: [
    { key: 'appId', type: 'text', label: { zh: '机器人 AppID', en: 'Bot AppID' },
      link: { url: 'https://q.qq.com/', label: { zh: 'QQ 开放平台', en: 'QQ Open Platform' } } },
    { key: 'appSecret', type: 'password', label: { zh: '机器人 AppSecret', en: 'Bot AppSecret' } },
    { key: 'directMessages', type: 'switch', label: { zh: '接收私聊', en: 'Receive direct messages' } },
    { key: 'groupMessages', type: 'switch', label: { zh: '接收群消息', en: 'Receive group messages' },
      hint: { zh: '需要平台授予相应事件权限；默认群 @ 消息会被识别为明确请求。', en: 'Requires the relevant platform event permissions; group mentions are addressed requests.' } },
  ],
  health: [SOURCE],
  scope: ({ meta }, config) => {
    const group = meta.scope === 'group'
    return (group ? config.groupMessages : config.directMessages)
      ? { listened: true, observed: group, row: group ? 'group' : 'direct' }
      : { listened: false, reason: 'source_scope_disabled' }
  },
  channel: {
    async send({ config }, message) {
      const { scope, target, messageId } = message.channel.address
      if (!config.appId || !config.appSecret) throw new Error('Official QQ bot credentials are missing')
      if ((scope !== 'group' && scope !== 'c2c') || !target || !messageId) throw new Error('Official QQ bot reply target is incomplete')
      const bot = new QQBot({ appId: config.appId, appSecret: config.appSecret })
      // Reuse a stable sequence on retries to avoid creating duplicate platform messages.
      const msgSeq = createHash('sha256').update(message.id).digest().readUInt16BE(0)
      try { await bot.send({ target: { scope, targetId: target, msgId: messageId }, content: message.text, extra: { msg_seq: msgSeq } }) }
      finally { bot.stop() }
      return 'sent'
    },
    link: () => ({ url: '', label: { zh: 'QQ 官方机器人会话', en: 'Official QQ bot conversation' } }),
  },
  threadContext: {
    messageId: trigger => String(trigger.meta.messageId ?? trigger.id),
    async read(_commands, trigger, part) {
      return { messages: part === 'thread' ? [{ id: String(trigger.meta.messageId ?? trigger.id), from: trigger.actor.name ?? trigger.actor.id,
        at: trigger.at, text: trigger.text }] : [], body: {} }
    },
  },
  policy: {
    schema: z.object({ allowed: z.array(z.object({ id: z.string().trim().min(1), name: z.string().trim().optional() }).strict()).default([]) }).strict(),
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '允许发起工作的用户 openid', en: 'User openids allowed to originate work' },
      hint: { zh: '使用 QQ 开放平台返回的用户 openid，不是个人 QQ 号。', en: 'Use the platform user openid, not a personal QQ number.' },
      columns: [{ key: 'id', type: 'text', label: { zh: '用户 openid', en: 'User openid' } }] }],
    explicit: { zh: '名单内用户私聊机器人或在群里 @ 机器人。', en: 'A listed user messages the bot directly or mentions it in a group.' },
    rows: () => [
      { id: 'group', label: { zh: '群消息', en: 'Group messages' }, note: { zh: '按平台授权接收', en: 'Subject to platform permissions' },
        cells: { listedUnaddressed: false, unlistedAddressed: true, unlistedUnaddressed: false } },
      { id: 'direct', label: { zh: '私聊', en: 'Direct messages' }, note: { zh: '直接发给机器人', en: 'Addressed to bot' },
        cells: { listedUnaddressed: false, unlistedAddressed: true, unlistedUnaddressed: false } },
    ],
  },
}

/** Single configured account: restart its connection when settings change and stop it on plugin disposal. */
export async function watchQqBot(ctx: SourceContext, signal: AbortSignal): Promise<void> {
  await ctx.ready
  if (!ctx.configured()) { ctx.report(SOURCE, health('paused', 'setupPending')); return }
  let bot: QQBot | undefined
  let active: QqBotConfig | undefined
  let stopped = false
  while (!signal.aborted) {
    const config = ctx.config<QqBotConfig>(SOURCE)
    if (!config || !config.appId || !config.appSecret) {
      bot?.stop(); bot = undefined; active = undefined
      ctx.report(SOURCE, !config ? health('paused', 'sourceOff') : { state: 'paused', detail: '请填写 QQ 官方机器人的 AppID 和 AppSecret' })
    } else if (!bot || !active || JSON.stringify(config) !== JSON.stringify(active)) {
      bot?.stop()
      const current = new QQBot({ appId: config.appId, appSecret: config.appSecret })
      bot = current; active = config; stopped = false
      ctx.report(SOURCE, { state: 'starting', detail: '正在连接 QQ 官方机器人' })
      current.on('ready', () => { if (bot === current && !signal.aborted) ctx.report(SOURCE, { state: 'ready', detail: 'QQ 官方机器人已连接；平台权限和收发需实际验证' }) })
      current.on('resumed', () => { if (bot === current && !signal.aborted) ctx.report(SOURCE, { state: 'ready', detail: 'QQ 官方机器人已重新连接' }) })
      current.on('disconnected', () => { if (bot === current && !signal.aborted) ctx.report(SOURCE, { state: 'starting', detail: 'QQ 官方机器人已断开，正在重连' }) })
      current.on('error', () => { if (bot === current && !signal.aborted) ctx.report(SOURCE, { state: 'error', detail: 'QQ 官方机器人连接异常，请检查凭证和平台权限' }) })
      current.on('message', async (_context, message) => {
        if (bot !== current || signal.aborted) return
        const currentConfig = ctx.config<QqBotConfig>(SOURCE)
        if (!currentConfig) return
        const trigger = qqBotTrigger(message, currentConfig)
        if (trigger) {
          try { await ctx.receive(trigger) }
          catch { if (bot === current && !signal.aborted) ctx.report(SOURCE, { state: 'error', detail: 'QQ 官方机器人消息处理失败' }) }
        }
      })
      void current.start().then(() => { if (bot === current && !signal.aborted) stopped = true })
        .catch(() => { if (bot === current && !signal.aborted) { stopped = true; ctx.report(SOURCE, { state: 'error', detail: 'QQ 官方机器人启动失败，请检查凭证和平台权限' }) } })
    } else if (stopped) { bot.stop(); bot = undefined; active = undefined }
    await pause(10_000, signal)
  }
  bot?.stop()
}

export const name = 'dsh-superagent-qqbot'
export const inject = ['orchestrator']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(qqBotKind), 'qqbot: source kind')
  ctx.effect(() => {
    const controller = new AbortController()
    const running = watchQqBot(sourceContext(ctx.orchestrator, qqBotKind), controller.signal)
    return async () => { controller.abort(); await running }
  })
}
