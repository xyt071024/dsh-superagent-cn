/**
 * QQ Source: receives group and private messages through a OneBot v11 HTTP endpoint (SnowLuma / NapCat) and replies
 * through the same endpoint.
 *
 * A group message reaches the agent only when it @s it, because a busy group would otherwise drown the Orchestrator.
 * A private message always belongs to the agent: there is nobody else in that conversation to address.
 */
import { z } from 'zod'
import { key } from '../core/index.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { OutboundMessage, ScopeResult, Trigger } from '../core/index.ts'
import type { ContextMessage, FieldSpec, SourceChannel, SourceKind, ThreadContext, TriggerContext } from './kind.ts'
import { health, sourceContext, type Health, type SourceContext } from './host.ts'
import { pause } from './poll.ts'
import { KV } from '../kv.ts'

export const SOURCE = 'qq'

const SenderSchema = z.looseObject({
  user_id: z.union([z.number(), z.string()]).optional(),
  nickname: z.string().optional(),
  card: z.string().optional(),
})
/** OneBot v11 message, kept loose so a different implementation may add fields without breaking the read. */
const MessageSchema = z.looseObject({
  message_id: z.union([z.number(), z.string()]).optional(),
  message_type: z.string().optional(),
  group_id: z.union([z.number(), z.string()]).optional(),
  user_id: z.union([z.number(), z.string()]).optional(),
  raw_message: z.string().optional(),
  message: z.unknown().optional(),
  time: z.union([z.number(), z.string()]).optional(),
  sender: SenderSchema.optional(),
  post_type: z.string().optional(),
})
type OneBotMessage = z.infer<typeof MessageSchema>

/**
 * `endpoint` and `token` are installation facts rather than hidden secrets: an operator has to read the value back to
 * correct it, so the token is an ordinary field that is simply never logged.
 */
export const QqConfigSchema = z.object({
  endpoint: z.string().trim().regex(/^https?:\/\/\S+$/, 'http://host:port').default('http://127.0.0.1:3000'),
  token: z.string().trim().default(''),
  /** Group numbers to receive from; empty reads every group the account is already in. */
  groups: z.string().trim().default(''),
  privateMessages: z.boolean().default(true),
  /** Receive group messages that do not @ the agent; the Policy's admission table then decides. */
  observeAll: z.boolean().default(false),
  pollSeconds: z.number().int().min(2).max(3600).default(5),
  failuresBeforeError: z.number().int().min(1).max(20).default(3),
})
export type QqConfig = z.infer<typeof QqConfigSchema>

const id = (value: unknown): string => value === undefined || value === null ? '' : String(value)
const list = (text: string): string[] => text.split(/[\s,]+/).map(entry => entry.trim()).filter(Boolean)

/** Calls one OneBot action, turning a refused action into an error even though it arrives with HTTP 200. */
export async function call(config: Pick<QqConfig, 'endpoint' | 'token'>, action: string, params: Record<string, unknown> = {},
  signal?: AbortSignal): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.token) headers.Authorization = `Bearer ${config.token}`
  const response = await fetch(`${config.endpoint.replace(/\/+$/, '')}/${action}`, { method: 'POST', headers,
    body: JSON.stringify(params), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) })
  const text = await response.text()
  const body = ((): { status?: string; retcode?: number; wording?: string; data?: unknown } => {
    try { return JSON.parse(text) as { status?: string; retcode?: number; wording?: string; data?: unknown } }
    catch { throw new Error(`${action} did not answer with JSON: ${text.slice(0, 200)}`) }
  })()
  if (body.status !== 'ok' && body.retcode !== 0) throw new Error(`${body.wording ?? action}${body.retcode ? ` (${body.retcode})` : ''}`)
  return body.data
}

/** Flattens OneBot's message segments to plain text, keeping @ targets so an address stays detectable. */
export function plainText(message: OneBotMessage): string {
  const segments = Array.isArray(message.message) ? message.message : []
  const parts = segments.map(segment => {
    if (!segment || typeof segment !== 'object') return ''
    const { type, data } = segment as { type?: string; data?: Record<string, unknown> }
    if (type === 'text') return String(data?.text ?? '')
    if (type === 'at') return `@${id(data?.qq)} `
    if (type === 'face') return '[表情]'
    if (type === 'image') return '[图片]'
    // `reply` and `forward` name another message; they carry no words of their own.
    return ''
  })
  return (parts.join('').trim() || (message.raw_message ?? '').trim())
}

/** Whether a group message @s the agent's own account. `all` is @everyone: it reaches the agent but does not name it. */
export function mentions(message: OneBotMessage, self: string): boolean {
  if (!self) return false
  const segments = Array.isArray(message.message) ? message.message : []
  return segments.some(segment => {
    if (!segment || typeof segment !== 'object') return false
    const { type, data } = segment as { type?: string; data?: Record<string, unknown> }
    return type === 'at' && id(data?.qq) === self
  })
}

const groupOf = (message: OneBotMessage): string => id(message.group_id)
const userOf = (message: OneBotMessage): string => id(message.user_id) || id(message.sender?.user_id)
const nameOf = (message: OneBotMessage): string => message.sender?.card?.trim() || message.sender?.nickname?.trim() || userOf(message)
function atIso(message: OneBotMessage): string {
  const seconds = Number(message.time)
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : new Date().toISOString()
}
export const threadOf = (message: OneBotMessage): string => {
  const group = groupOf(message)
  return group ? `group:${group}` : `private:${userOf(message)}`
}
const addressOf = (message: OneBotMessage): Record<string, string> => {
  const group = groupOf(message)
  return group ? { group } : { user: userOf(message) }
}

/**
 * Turns one OneBot message into a Trigger, or undefined when it is not for the agent.
 *
 * `source` is the kind that received it: the same OneBot protocol serves QQ, a WeChat bridge and a WeCom bridge, and each
 * must be recorded under its own name so a reply goes back out through the bridge it arrived on.
 */
export function triggerOf(message: OneBotMessage, config: QqConfig, self: string, source: string = SOURCE): Trigger | undefined {
  const group = groupOf(message)
  const user = userOf(message)
  if (!user) return undefined
  if (group) {
    const listed = list(config.groups)
    if (listed.length && !listed.includes(group)) return undefined
    // The account's own messages are echoes of what it sent; receiving them would let it answer itself.
    if (self && user === self) return undefined
  } else if (!config.privateMessages || !user) return undefined
  // A private message is addressed to the agent by definition: the conversation has no one else in it.
  const addressed = group ? mentions(message, self) : true
  if (!addressed && !config.observeAll) return undefined
  const text = plainText(message)
  const at = atIso(message)
  const messageId = id(message.message_id)
  return {
    id: `qq:${messageId || `${threadOf(message)}:${at}`}`,
    source,
    threads: [{ source, id: threadOf(message) }],
    // `source` is what a Policy list is looked up by, so an actor without it matches no list and every sender reads as a stranger.
    actor: { source, id: user, name: nameOf(message) },
    human: true,
    ...addressed ? { addressed: group ? 'mention' as const : 'direct' as const } : {},
    at,
    text,
    channel: { source, thread: threadOf(message), address: addressOf(message) },
    meta: { messageId, group, user, scope: group ? 'group' : 'private' },
  }
}

/** Reads the newest messages of every watched group; OneBot has no push cursor, so the highest seen id is the cursor. */
async function recent(ctx: SourceContext, config: QqConfig, signal: AbortSignal): Promise<OneBotMessage[]> {
  const listed = list(config.groups)
  // No group listed: read the account's own groups, so an install with nothing configured still receives something.
  const targets = listed.length ? listed : await call(config, 'get_group_list', {}, signal)
    .then(data => (Array.isArray(data) ? data.map(entry => id((entry as { group_id?: unknown }).group_id)) : []))
    .catch(() => [] as string[])
  const out: OneBotMessage[] = []
  for (const group of targets.filter(Boolean)) {
    // A group the account left answers with an error; the remaining groups must still be read.
    const history = await call(config, 'get_group_msg_history', { group_id: Number(group), count: 20 }, signal).catch(() => undefined)
    const messages = (history as { messages?: unknown } | undefined)?.messages
    if (!Array.isArray(messages)) continue
    for (const entry of messages) { const parsed = MessageSchema.safeParse(entry); if (parsed.success) out.push(parsed.data) }
  }
  return out
}

/** Returns an error health once `failures` consecutive polls fail, so one network interruption stays quiet. */
export function pollFailure(failures: number, threshold: number, error: unknown): Health | undefined {
  return failures >= threshold ? health('error', 'pollFailures', { count: String(failures), error: String(error) }) : undefined
}

/**
 * Polls every configured instance of this kind, one loop per instance.
 *
 * A kind can carry several accounts — two QQ numbers, a QQ bridge and a WeChat bridge — and each has its own endpoint,
 * its own cursor and its own health entry. Running them as separate loops keeps a dead endpoint from delaying a live one,
 * which a single loop reading both would do.
 */
async function watch(ctx: SourceContext, source: string, signal: AbortSignal): Promise<void> {
  await ctx.ready
  // Setup restarts dsh-superagent once it resolves the accounts; until then nothing is polled.
  if (!ctx.configured()) { ctx.report(source, health('paused', 'setupPending')); return }
  const ids = new Map<string, AbortController>()
  while (!signal.aborted) {
    const instances = ctx.instances<QqConfig>(source)
    for (const instance of instances) {
      if (ids.has(instance.id)) continue
      const controller = new AbortController()
      ids.set(instance.id, controller)
      const stop = () => { controller.abort(); ids.delete(instance.id) }
      signal.addEventListener('abort', stop, { once: true })
      // Unhandled rejections terminate the DSH process, so an escape becomes that instance's health instead.
      void poll(ctx, source, instance.id, controller.signal).catch((error: unknown) => {
        ctx.report(instance.id, { state: 'error', detail: String(error) })
      })
    }
    // An instance removed from settings stops on its own next tick, when its id no longer appears above.
    await pause(5_000, signal)
  }
  for (const controller of ids.values()) controller.abort()
}

/** Polls one instance until its controller aborts. */
async function poll(ctx: SourceContext, source: string, instanceId: string, signal: AbortSignal): Promise<void> {
  let failures = 0
  let self = ''
  // The account's own id decides which group messages address it, so it is read once per endpoint and remembered.
  let selfFor = ''
  while (!signal.aborted) {
    // Read the configuration each tick: the operator may disable this instance or change its endpoint while it runs.
    const config = ctx.config<QqConfig>(instanceId)
    if (!config) {
      ctx.report(instanceId, health('paused', 'sourceOff'))
      await pause(5_000, signal)
      continue
    }
    try {
      if (selfFor !== config.endpoint) {
        self = await call(config, 'get_login_info', {}, signal)
          .then(data => id((data as { user_id?: unknown } | undefined)?.user_id)).catch(() => '')
        selfFor = config.endpoint
      }
      // The cursor is per instance as well: two bridges reaching the same endpoint must not share one.
      const seen = new Set<string>(ctx.state.get(KV.qq.seen(instanceId)) ?? [])
      const messages = await recent(ctx, config, signal)
      let received = 0
      // Oldest first: history arrives newest first, and the Engine should see a burst in the order it was typed.
      for (const message of [...messages].reverse()) {
        const stamp = id(message.message_id) || `${threadOf(message)}:${atIso(message)}`
        if (seen.has(stamp)) continue
        seen.add(stamp)
        const trigger = triggerOf(message, config, self, source)
        if (trigger) { await ctx.receive(trigger); received += 1 }
      }
      // Keep the cursor bounded: the newest 2000 ids dedupe a burst, and an unbounded set would grow forever.
      ctx.state.set(KV.qq.seen(instanceId), seen.size > 2000 ? [...seen].slice(-2000) : [...seen])
      failures = 0
      ctx.report(instanceId, { state: 'ready', detail: `${received} new message(s); next poll ≥ ${config.pollSeconds}s`, at: new Date().toISOString() })
    } catch (error) {
      failures += 1
      const failed = pollFailure(failures, config.failuresBeforeError, error)
      if (!signal.aborted && failed) ctx.report(instanceId, failed)
    }
    await pause(config.pollSeconds * 1000, signal)
  }
}

const channel: SourceChannel<QqConfig> = {
  // OneBot reports a refused send in the body, so the error is thrown and the Outbox keeps the receipt for a retry.
  async send(host, message: OutboundMessage): Promise<'sent'> {
    const config = host.config
    if (!config.endpoint) throw new Error('The QQ Source has no endpoint yet')
    const group = message.channel.address.group
    // `auto_escape` stays off: the text is sent as one text segment, which needs no escaping.
    await call(config, group ? 'send_group_msg' : 'send_private_msg',
      { ...group ? { group_id: Number(group) } : { user_id: Number(message.channel.address.user) }, message: [{ type: 'text', data: { text: message.text } }] })
    return 'sent'
  },
  link(address, links) {
    void links
    const group = address.group
    return group
      ? { url: `https://qun.qq.com/#${group}`, label: { zh: `QQ 群 ${group}`, en: `QQ group ${group}` } }
      : { url: '', label: { zh: 'QQ 私聊', en: 'QQ private chat' } }
  },
}

const threadContext: ThreadContext<QqConfig> = {
  messageId: trigger => String(trigger.meta.messageId ?? trigger.id),
  async read(commands, trigger, part, cursor, config) {
    void commands
    void cursor
    const group = String(trigger.meta.group ?? '')
    // Only the Thread itself is readable: OneBot exposes per-group history and no private history at all.
    if (part !== 'thread') return { messages: [], body: {} }
    if (!group) {
      // A private Thread holds one message, which the Trigger already carries.
      return { messages: [{ id: String(trigger.meta.messageId ?? trigger.id), from: trigger.actor.name ?? trigger.actor.id, at: trigger.at,
        text: trigger.text }], body: {} }
    }
    const history = await call(config, 'get_group_msg_history', { group_id: Number(group), count: 20 }).catch(() => undefined)
    const messages = (history as { messages?: unknown } | undefined)?.messages
    if (!Array.isArray(messages)) return { messages: [], body: {} }
    const out: ContextMessage[] = []
    for (const entry of messages) {
      const parsed = MessageSchema.safeParse(entry)
      if (!parsed.success) continue
      out.push({ id: id(parsed.data.message_id), from: nameOf(parsed.data), at: atIso(parsed.data), text: plainText(parsed.data) })
    }
    return { messages: out, body: {} }
  },
}

/**
 * Builds the kind for one OneBot implementation.
 *
 * QQ, a WeChat bridge and a WeCom bridge all speak OneBot v11, so they share this code and differ only in the name they
 * record and the labels the operator reads. One kind per platform — rather than one kind with a platform field — is what
 * lets each carry its own Policy list, its own instances and its own health.
 */
export function oneBotKind(kind: string, title: { zh: string; en: string }, description: { zh: string; en: string },
  threadVariable: { key: string; description: { zh: string; en: string } }): SourceKind<QqConfig> {
  return {
  kind,
  title,
  description,
  description: {
    zh: '通过 OneBot 端点接收 QQ 群和私聊消息。群里只有 @ 智能体的消息才算发给它，私聊则都是。',
    en: 'Receives QQ group and private messages through a OneBot endpoint. In a group only a message that @s the agent is for it; a private message always is.',
  },
  schema: QqConfigSchema,
  fields: [
    { key: 'endpoint', type: 'text', pattern: 'https?://\\S+', label: { zh: 'OneBot 端点', en: 'OneBot endpoint' },
      hint: { zh: 'OneBot v11 的 HTTP 地址，通常是 http://127.0.0.1:3000。', en: 'The OneBot v11 HTTP address, usually http://127.0.0.1:3000.' } },
    { key: 'token', type: 'text', label: { zh: '访问令牌', en: 'Access token' },
      hint: { zh: '端点要求的令牌，留空表示没设。作为 Bearer 头发送，不写进日志。',
        en: 'The token the endpoint requires; empty when it has none. Sent as a bearer header and never logged.' } },
    { key: 'groups', type: 'text', label: { zh: '接收的群号', en: 'Group numbers' },
      hint: { zh: '空格或逗号分隔。留空表示账号所在的全部群。', en: 'Spaces or commas. Empty reads every group the account is in.' } },
    { key: 'privateMessages', type: 'switch', label: { zh: '接收私聊', en: 'Receive private messages' },
      hint: { zh: '私聊的消息都算直接发给智能体。', en: 'Every private message counts as sent to the agent directly.' } },
    { key: 'observeAll', type: 'switch', label: { zh: '接收群里没 @ 的消息', en: 'Receive group messages that do not @ the agent' },
      hint: { zh: '打开后普通群消息也会收到，由策略的接收表决定是否成为候选。群热闹时消息很多，通常配合策略白名单收窄。',
        en: 'Ordinary group messages are received too, and the Policy\'s admission table decides. A busy group is noisy; narrow it with the Policy list.' } },
    { key: 'pollSeconds', type: 'number', advanced: true, min: 2, max: 3600, label: { zh: '轮询间隔 / 秒', en: 'Polling interval / seconds' },
      hint: { zh: 'OneBot 没有推送游标，只能定期读取最近消息。', en: 'OneBot offers no push cursor, so recent messages are read on an interval.' } },
    { key: 'failuresBeforeError', type: 'number', advanced: true, min: 1, max: 20, label: { zh: '连续失败几次后报告异常', en: 'Failed polls before reporting an error' },
      hint: { zh: '单次网络中断会在下一次轮询时自动重试。', en: 'A single network interruption is retried on the next poll.' } },
  ],
  health: [kind],
  scope: ({ meta }, config): ScopeResult => {
    const group = meta.scope === 'group'
    return { listened: true, observed: group && config.observeAll, ...group ? { row: 'group' } : { row: 'private' } }
  },
  channel,
  threadContext,
  find: query => {
    const group = /^(?:group:)?(\d{5,})$/.exec(query.trim())?.[1]
    return { threads: group ? [`${kind}:group:${group}`] : [], terms: [] }
  },
  policy: {
    schema: z.object({ allowed: z.array(z.object({ id: z.string().regex(/^\d+$/) }).strict()).default([]) }).strict(),
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '能发起工作的 QQ 号', en: 'QQ numbers that may originate work' },
      hint: { zh: '名单里的人 @ 智能体或私聊它，才算明确的请求。名单外的人仍会被评估，但不会直接成为工单。',
        en: 'A listed person @ing the agent or messaging it privately makes an explicit request. Someone off the list is still assessed, but never becomes a ticket on their own.' },
      columns: [{ key: 'id', type: 'text', label: { zh: 'QQ 号', en: 'QQ number' }, pattern: '\\d+' }] }],
    explicit: { zh: '名单里的人 @ 智能体，或私聊它。', en: 'A listed person @s the agent, or messages it privately.' },
    rows: () => [
      { id: 'group', label: { zh: '群消息', en: 'Group messages' }, note: { zh: '@ 才算', en: '@ only' },
        cells: { listedUnaddressed: false, unlistedAddressed: true, unlistedUnaddressed: false } },
      { id: 'private', label: { zh: '私聊', en: 'Private messages' }, note: { zh: '都算直接发给它', en: 'All addressed' },
        cells: { listedUnaddressed: true, unlistedAddressed: true, unlistedUnaddressed: true } },
    ],
  },
  environment: {
    variables: [threadVariable],
    values: ({ trigger }) => {
      const group = String(trigger?.meta.group ?? '')
      const user = String(trigger?.meta.user ?? '')
      return { [threadVariable.key]: group || user }
    },
  },
  }
}

/** The three platforms this OneBot implementation reaches, each with the name and wording the operator sees. */
export const ONE_BOT_KINDS = [
  { kind: 'qq',
    title: { zh: 'QQ', en: 'QQ' },
    description: { zh: '通过 OneBot 端点接收 QQ 群和私聊消息。群里只有 @ 智能体的消息才算发给它，私聊则都是。',
      en: 'Receives QQ group and private messages through a OneBot endpoint. In a group only a message that @s the agent is for it; a private message always is.' },
    variable: { key: 'DSH_SUPERAGENT_QQ_THREAD', description: { zh: '接下工单的 QQ 会话：群号或私聊的对象', en: 'The QQ conversation that started the ticket: a group number, or the person in a private chat' } } },
  { kind: 'wechat',
    title: { zh: '微信', en: 'WeChat' },
    description: { zh: '通过微信端的 OneBot 桥接收群聊和私聊。群里只有 @ 智能体的消息才算发给它，私聊则都是。桥接要先在微信端启动。',
      en: 'Receives WeChat group and private messages through its OneBot bridge. In a group only a message that @s the agent is for it; a private message always is. The bridge has to be started in the WeChat agent first.' },
    variable: { key: 'DSH_SUPERAGENT_WECHAT_THREAD', description: { zh: '接下工单的微信会话：群号或私聊的对象', en: 'The WeChat conversation that started the ticket: a group number, or the person in a private chat' } } },
  { kind: 'wecom',
    title: { zh: '企业微信', en: 'WeCom' },
    description: { zh: '通过企业微信端的 OneBot 桥接收消息。群里只有 @ 智能体的消息才算发给它，私聊则都是。',
      en: 'Receives WeCom messages through its OneBot bridge. In a group only a message that @s the agent is for it; a private message always is.' },
    variable: { key: 'DSH_SUPERAGENT_WECOM_THREAD', description: { zh: '接下工单的企业微信会话', en: 'The WeCom conversation that started the ticket' } } },
] as const

export const name = 'dsh-superagent-qq'
export const inject = ['orchestrator']
export function apply(ctx: Context): void {
  for (const spec of ONE_BOT_KINDS) {
    const built = oneBotKind(spec.kind, spec.title, spec.description, spec.variable)
    ctx.effect(() => ctx.orchestrator.sources.register(built), `${spec.kind}: source kind`)
    ctx.effect(() => {
      const source = sourceContext(ctx.orchestrator, built)
      const controller = new AbortController()
      const running = watch(source, spec.kind, controller.signal)
        .catch((error: unknown) => { source.report(spec.kind, { state: 'error', detail: String(error) }) })
      return async () => { controller.abort(); await running }
    })
  }
}
