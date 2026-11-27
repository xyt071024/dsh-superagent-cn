/**
 * OneBot Source: polls group history through a compatible HTTP bridge and sends replies through the same endpoint.
 * Optional forward WebSocket events provide private and live group messages. Group history support varies by bridge.
 * A group message reaches the agent only when it @s it, unless observeAll is enabled.
 */
import { z } from 'zod'
import WebSocket from 'ws'
import { key } from '../core/index.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-llm'
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
  eventEndpoint: z.string().trim().refine(value => !value || /^wss?:\/\/[^\s?#@]+(?:\/[^\s?#]*)?$/.test(value), 'ws://host:port/path').default(''),
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
  if (!response.ok) throw new Error(`${action} returned HTTP ${response.status}`)
  const text = await response.text()
  const body = ((): { status?: string; retcode?: number; wording?: string; data?: unknown } => {
    try { return JSON.parse(text) as { status?: string; retcode?: number; wording?: string; data?: unknown } }
    catch { throw new Error(`${action} did not answer with JSON`) }
  })()
  if ((body.status !== undefined && body.status !== 'ok') || (body.retcode !== undefined && body.retcode !== 0) ||
      (body.status === undefined && body.retcode === undefined)) throw new Error(`${action} was rejected${typeof body.retcode === 'number' ? ` (${body.retcode})` : ''}`)
  return body.data
}

/** Metadata describing one readable image attachment referenced in a OneBot message. */
export interface QqImageRef {
  key: string
  url?: string
  file?: string
  name?: string
}

/** Extracts the replied-to message ID from a OneBot `reply` segment or `[CQ:reply,id=...]` raw code. */
export function replyIdOf(message: OneBotMessage): string | undefined {
  const segments = Array.isArray(message.message) ? message.message : []
  for (const segment of segments) {
    if (!segment || typeof segment !== 'object') continue
    const { type, data } = segment as { type?: string; data?: Record<string, unknown> }
    if (type === 'reply') {
      const value = id(data?.id).trim()
      if (value) return value
    }
  }
  const raw = typeof message.raw_message === 'string' ? message.raw_message : ''
  const cq = /\[CQ:reply,[^\]]*\bid=([^,\]]+)/i.exec(raw)
  return cq?.[1]?.trim() || undefined
}

const HTTP_URL = /^https?:\/\/\S+$/i

function parseCqParams(paramText: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of paramText.split(',')) {
    const eq = entry.indexOf('=')
    if (eq <= 0) continue
    const k = entry.slice(0, eq).trim()
    const v = entry.slice(eq + 1).trim()
      .replaceAll('&amp;', '&').replaceAll('&#91;', '[').replaceAll('&#93;', ']').replaceAll('&#44;', ',')
    if (k && v) out[k] = v
  }
  return out
}

/** Extracts readable image attachment references from OneBot `image` segments or `[CQ:image,...]` codes. */
export function imageRefsOf(message: OneBotMessage): QqImageRef[] {
  const refs: QqImageRef[] = []
  const seen = new Set<string>()
  const pushRef = (urlRaw: unknown, fileRaw: unknown, nameRaw: unknown, index: number) => {
    const url = typeof urlRaw === 'string' && HTTP_URL.test(urlRaw.trim()) ? urlRaw.trim() : undefined
    const file = typeof fileRaw === 'string' && fileRaw.trim() ? fileRaw.trim() : undefined
    const name = typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : undefined
    if (!url && !file) return
    const seed = url || file || String(index)
    const imgKey = `qqimg_${key('qq-image', seed, String(index)).slice(0, 12)}`
    if (seen.has(imgKey)) return
    seen.add(imgKey)
    refs.push({ key: imgKey, ...(url ? { url } : {}), ...(file ? { file } : {}), ...(name ? { name } : {}) })
  }
  const segments = Array.isArray(message.message) ? message.message : []
  if (segments.length > 0) {
    segments.forEach((segment, index) => {
      if (!segment || typeof segment !== 'object') return
      const { type, data } = segment as { type?: string; data?: Record<string, unknown> }
      if (type !== 'image') return
      const urlCandidate = data?.url ?? (typeof data?.file === 'string' && HTTP_URL.test(data.file.trim()) ? data.file : undefined)
      pushRef(urlCandidate, data?.file, data?.summary ?? data?.name ?? data?.file_name, index)
    })
    return refs
  }
  const raw = typeof message.raw_message === 'string' ? message.raw_message : ''
  let match: RegExpExecArray | null
  const pattern = /\[CQ:image,([^\]]+)\]/gi
  let index = 0
  while ((match = pattern.exec(raw)) !== null) {
    const params = parseCqParams(match[1]!)
    const urlCandidate = params.url ?? (params.file && HTTP_URL.test(params.file) ? params.file : undefined)
    pushRef(urlCandidate, params.file, params.summary ?? params.name, index++)
  }
  return refs
}

/** Extracts QQ image reference keys from message text so keys remain scoped to the originating message. */
export function qqImageKeys(text: string): string[] {
  return [...new Set(text.match(/\bqqimg_[a-zA-Z0-9_-]+\b/g) ?? [])]
}

/** Flattens OneBot's message segments to plain text, keeping @ targets and readable image attachment references. */
export function plainText(message: OneBotMessage): string {
  const segments = Array.isArray(message.message) ? message.message : []
  const imageRefs = imageRefsOf(message)
  let imageCursor = 0
  const parts = segments.map(segment => {
    if (!segment || typeof segment !== 'object') return ''
    const { type, data } = segment as { type?: string; data?: Record<string, unknown> }
    if (type === 'text') return String(data?.text ?? '')
    if (type === 'at') return `@${id(data?.qq)} `
    if (type === 'face') return '[表情]'
    if (type === 'image') {
      const hasLocator = (typeof data?.url === 'string' && HTTP_URL.test(data.url.trim()))
        || (typeof data?.file === 'string' && data.file.trim().length > 0)
      if (hasLocator) {
        const ref = imageRefs[imageCursor++]
        if (ref) return `[图片: ${ref.key}]`
      }
      return '[图片]'
    }
    // Every other segment used to return nothing, so a voice note, a video, a file or a shared card reached the agent
    // as an empty message — indistinguishable from a person who said nothing. Each one now says what it is; a card
    // adds its title, because that is the only part of it a policy can reason about.
    if (type === 'record') return '[语音]'
    if (type === 'video') return '[视频]'
    if (type === 'file') return `[文件: ${String(data?.file ?? data?.name ?? data?.file_name ?? '未命名')}]`
    if (type === 'json' || type === 'xml' || type === 'card') return `[卡片: ${cardTitle(data)}]`
    if (type === 'location') return '[位置]'
    if (type === 'contact') return '[名片]'
    if (type === 'shake') return '[窗口抖动]'
    // `reply` and `forward` name another message; `reply` ID is preserved in `trigger.meta.replyToId`.
    return ''
  })
  const joined = parts.join('').trim()
  if (joined) return joined
  const raw = (message.raw_message ?? '').trim()
  if (raw && imageRefs.length > 0 && /\[CQ:image,/i.test(raw)) {
    let idx = 0
    return raw.replace(/\[CQ:image,[^\]]+\]/gi, () => {
      const ref = imageRefs[idx++]
      return ref ? `[图片: ${ref.key}]` : '[图片]'
    }).replace(/\[CQ:reply,[^\]]+\]/gi, '').trim()
  }
  return raw
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
  if (!user || (self && user === self)) return undefined
  if (group) {
    const listed = list(config.groups)
    if (listed.length && !listed.includes(group)) return undefined
  } else if (!config.privateMessages || !user) return undefined
  // A private message is addressed to the agent by definition: the conversation has no one else in it.
  const addressed = group ? mentions(message, self) : true
  if (!addressed && !config.observeAll) return undefined
  const text = plainText(message)
  const at = atIso(message)
  const messageId = id(message.message_id)
  const replyToId = replyIdOf(message)
  const images = imageRefsOf(message)
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
    meta: {
      messageId,
      group,
      user,
      scope: group ? 'group' : 'private',
      ...(replyToId ? { replyToId } : {}),
      ...(images.length > 0 ? { images } : {}),
    },
  }
}

/** Reads the newest messages of every watched group; OneBot has no push cursor, so the highest seen id is the cursor. */
export async function recent(config: QqConfig, signal: AbortSignal): Promise<OneBotMessage[]> {
  const listed = list(config.groups)
  // No group listed: read the account's own groups, so an install with nothing configured still receives something.
  const targets = listed.length ? listed : await call(config, 'get_group_list', {}, signal)
    .then(data => {
      if (!Array.isArray(data)) throw new Error('get_group_list did not return a group list')
      return data.map(entry => id((entry as { group_id?: unknown }).group_id))
    })
  const out: OneBotMessage[] = []
  const errors: unknown[] = []
  let succeeded = 0
  for (const group of targets.filter(Boolean)) {
    // A group the account left answers with an error; the remaining groups must still be read.
    let messages: unknown
    try {
      const history = await call(config, 'get_group_msg_history', { group_id: Number(group), count: 20 }, signal)
      messages = (history as { messages?: unknown } | undefined)?.messages
      if (!Array.isArray(messages)) throw new Error('get_group_msg_history did not return messages')
      succeeded++
    } catch (error) {
      if (signal.aborted) throw error
      errors.push(error)
      continue
    }
    for (const entry of messages) { const parsed = MessageSchema.safeParse(entry); if (parsed.success) out.push(parsed.data) }
  }
  if (errors.length && !succeeded) throw errors[0]
  return out
}

/** Returns an error health once `failures` consecutive polls fail, so one network interruption stays quiet. */
export function pollFailure(failures: number, threshold: number, error: unknown): Health | undefined {
  void error
  // Network errors may contain authorization headers, URLs or upstream response text.
  return failures >= threshold ? health('error', 'pollFailures', { count: String(failures), error: 'OneBot request failed; check bridge connection and credentials' }) : undefined
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
      void poll(ctx, source, instance.id, controller.signal).catch(() => {
        ctx.report(instance.id, { state: 'error', detail: 'OneBot source stopped unexpectedly; check the bridge and restart the source' })
      }).finally(() => {
        signal.removeEventListener('abort', stop)
        if (ids.get(instance.id) === controller) ids.delete(instance.id)
      })
    }
    // An instance removed from settings stops on its own next tick, when its id no longer appears above.
    await pause(5_000, signal)
  }
  for (const controller of ids.values()) controller.abort()
}

/** Polls one instance until its controller aborts. */
export async function poll(ctx: SourceContext, source: string, instanceId: string, signal: AbortSignal): Promise<void> {
  let failures = 0
  let self = ''
  let socket: WebSocket | undefined
  let socketKey = ''
  let drainFailed = false
  let overflow = false
  let pending = Promise.resolve()
  const identity = (config: QqConfig) => JSON.stringify([config.endpoint, config.eventEndpoint, config.token])
  const drain = (expectedKey: string, expectedSelf: string) => {
    pending = pending.then(async () => {
      while (!signal.aborted) {
        const config = ctx.config<QqConfig>(instanceId)
        if (!config || identity(config) !== expectedKey || self !== expectedSelf) return
        const queue = ctx.state.get(KV.qq.pending(instanceId)) ?? []
        const index = queue.findIndex(entry => entry.account === expectedSelf)
        if (index < 0) { drainFailed = false; return }
        const item = queue[index]!
        const message = MessageSchema.parse(item.message)
        const stamp = id(message.message_id), scoped = `${expectedSelf}:${stamp}`
        const seen = new Set<string>(ctx.state.get(KV.qq.seen(instanceId)) ?? [])
        if (!seen.has(stamp) && !seen.has(scoped)) {
          const trigger = triggerOf(message, config, expectedSelf, source)
          if (trigger) await ctx.receive(trigger)
          seen.add(scoped)
          ctx.state.set(KV.qq.seen(instanceId), [...seen].slice(-2000))
        }
        // Re-read: other events may have arrived while receive was awaiting.
        const current = ctx.state.get(KV.qq.pending(instanceId)) ?? []
        const position = current.findIndex(entry => entry.account === expectedSelf && id(entry.message.message_id) === stamp)
        if (position >= 0) { current.splice(position, 1); ctx.state.set(KV.qq.pending(instanceId), current) }
      }
    }).catch(() => { drainFailed = true; if (!signal.aborted) ctx.report(instanceId, { state: 'error', detail: 'OneBot message processing failed; queued messages will be retried' }) })
    return pending
  }
  const accept = (message: OneBotMessage, expectedKey: string, expectedSelf: string) => {
    const config = ctx.config<QqConfig>(instanceId)
    if (signal.aborted || !config || identity(config) !== expectedKey || self !== expectedSelf) return pending
    const stamp = id(message.message_id)
    if (!stamp) return pending
    const seen = new Set<string>(ctx.state.get(KV.qq.seen(instanceId)) ?? [])
    if (seen.has(stamp) || seen.has(`${expectedSelf}:${stamp}`)) return pending
    const queue = ctx.state.get(KV.qq.pending(instanceId)) ?? []
    if (queue.some(entry => entry.account === expectedSelf && id(entry.message.message_id) === stamp)) return pending
    if (queue.length >= 500) {
      overflow = true
      socket?.terminate(); socket = undefined
      ctx.report(instanceId, { state: 'error', detail: 'OneBot message queue is full; disconnecting events. Events may be missed until the queue drains.' })
      return pending
    }
    try {
      ctx.state.set(KV.qq.pending(instanceId), [...queue, { account: expectedSelf, message }])
    } catch {
      overflow = true
      socket?.terminate(); socket = undefined
      ctx.report(instanceId, { state: 'error', detail: 'Could not persist OneBot event; disconnecting events. Messages may be missed.' })
      return pending
    }
    return drain(expectedKey, expectedSelf)
  }
  // The account's own id decides which group messages address it, so it is read once per endpoint and remembered.
  let selfFor = ''
  let tokenFor = ''
  while (!signal.aborted) {
    // Read the configuration each tick: the operator may disable this instance or change its endpoint while it runs.
    const config = ctx.config<QqConfig>(instanceId)
    if (!config) {
      socket?.terminate(); socket = undefined; socketKey = ''
      ctx.report(instanceId, health('paused', 'sourceOff'))
      await pause(5_000, signal)
      continue
    }
    const nextKey = identity(config)
    // Close an old connection before any potentially failing authentication against the new endpoint.
    if (socket && socketKey !== nextKey) { socket.terminate(); socket = undefined; socketKey = '' }
    try {
      if (!self || selfFor !== config.endpoint || tokenFor !== config.token) {
        self = await call(config, 'get_login_info', {}, signal)
          .then(data => id((data as { user_id?: unknown } | undefined)?.user_id))
        if (!self) throw new Error('get_login_info did not return the account ID')
        selfFor = config.endpoint
        tokenFor = config.token
      }
      await drain(nextKey, self)
      if ((ctx.state.get(KV.qq.pending(instanceId)) ?? []).length >= 500) {
        socket?.terminate(); socket = undefined
        ctx.report(instanceId, { state: 'error', detail: 'OneBot message queue is full; event connection paused. Messages may be missed.' })
        await pause(config.pollSeconds * 1000, signal)
        continue
      }
      overflow = false
      if (socket && (socketKey !== nextKey || socket.readyState >= WebSocket.CLOSING)) { socket.terminate(); socket = undefined }
      if (config.eventEndpoint && !socket) {
        socketKey = nextKey
        const current = new WebSocket(config.eventEndpoint, { headers: config.token ? { Authorization: `Bearer ${config.token}` } : {}, maxPayload: 64 * 1024, handshakeTimeout: 20_000 })
        socket = current
        const connectedSelf = self
        current.on('error', () => { if (!signal.aborted && socket === current) ctx.report(instanceId, { state: 'error', detail: 'OneBot event connection failed; events may be missed while disconnected' }) })
        current.on('message', bytes => {
          try {
            const raw: unknown = JSON.parse(bytes.toString())
            const parsed = MessageSchema.safeParse(raw)
            if (!parsed.success || parsed.data.post_type !== 'message' || !['group', 'private'].includes(parsed.data.message_type ?? '')) return
            const latest = ctx.config<QqConfig>(instanceId)
            if (latest && socket === current && identity(latest) === nextKey) void accept(parsed.data, nextKey, connectedSelf)
          } catch { /* Ignore non-JSON and unsupported event frames. */ }
        })
      }
      // The cursor is per instance as well: two bridges reaching the same endpoint must not share one.
      const messages = await recent(config, signal)
      let received = 0
      // Oldest first: history arrives newest first, and the Engine should see a burst in the order it was typed.
      for (const message of [...messages].reverse()) {
        await accept(message, nextKey, self)
        received += 1
      }
      failures = 0
      ctx.report(instanceId, overflow
        ? { state: 'error', detail: 'OneBot event intake was interrupted; messages may have been missed' }
        : drainFailed
        ? { state: 'error', detail: 'OneBot message processing failed; queued messages will be retried' }
        : config.eventEndpoint && socket?.readyState !== WebSocket.OPEN
        ? { state: 'starting', detail: 'OneBot group polling is running; event connection is not ready' }
        : { state: 'ready', detail: `${received} group message(s) checked; next poll ≥ ${config.pollSeconds}s`, at: new Date().toISOString() })
    } catch (error) {
      failures += 1
      const failed = pollFailure(failures, config.failuresBeforeError, error)
      if (!signal.aborted && failed) ctx.report(instanceId, failed)
    }
    await pause(config.pollSeconds * 1000, signal)
  }
  socket?.terminate()
  await pending
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

/** Bounded cache of image refs discovered when reading thread history or quoted parent messages. */
const discoveredImages = new Map<string, QqImageRef>()
function rememberImages(triggerId: string, refs: QqImageRef[]): void {
  if (!refs.length) return
  if (discoveredImages.size > 500) {
    for (const k of [...discoveredImages.keys()].slice(0, 200)) discoveredImages.delete(k)
  }
  for (const ref of refs) discoveredImages.set(`${triggerId}:${ref.key}`, ref)
}

function detectImageMediaType(bytes: Uint8Array, contentType?: string | null): ImageMediaType | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  const mime = (contentType ?? '').split(';')[0]?.trim().toLowerCase()
  if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/gif' || mime === 'image/webp') return mime
  return undefined
}

function extForMediaType(mediaType: ImageMediaType): string {
  return mediaType === 'image/jpeg' ? '.jpg' : mediaType === 'image/gif' ? '.gif' : mediaType === 'image/webp' ? '.webp' : '.png'
}

function quotedMessageAllowed(trigger: Trigger, config: QqConfig, quoted: OneBotMessage): boolean {
  const triggerGroup = String(trigger.meta.group ?? '')
  const triggerUser = String(trigger.meta.user ?? trigger.actor.id ?? '')
  const quotedGroup = groupOf(quoted)
  if (triggerGroup) {
    const listed = list(config.groups)
    if (listed.length && !listed.includes(triggerGroup)) return false
    return quotedGroup === triggerGroup
  }
  if (!config.privateMessages) return false
  if (quotedGroup) return false
  const quotedUser = userOf(quoted)
  const quotedRecord = quoted as Record<string, unknown>
  const quotedTarget = id(quotedRecord.target_id)
  const quotedSelf = id(quotedRecord.self_id)
  if (!quotedUser && !quotedTarget) return true
  return quotedUser === triggerUser || quotedTarget === triggerUser || (!!quotedSelf && quotedUser === quotedSelf)
}

/** Downloads a QQ message image referenced by `imageKey` and commits it as an agent-visible attachment. */
export async function readQqImage(
  agent: Agent,
  trigger: Trigger,
  message: { id: string; text: string },
  imageKey: string,
  signal: AbortSignal,
  config?: QqConfig,
): Promise<{ source_message_id: string; image_key: string; image: ImageAttachmentRef }> {
  if (!qqImageKeys(message.text).includes(imageKey)) throw new Error('Choose an image key from this source message')
  const triggerImages = Array.isArray(trigger.meta.images) ? trigger.meta.images as QqImageRef[] : []
  const ref = triggerImages.find(item => item.key === imageKey) ?? discoveredImages.get(`${trigger.id}:${imageKey}`)
  if (!ref) throw new Error(`QQ image ${imageKey} is unavailable: no attachment metadata found on this message`)
  const attachments = agent.ctx.get('attachments')
  if (!attachments) throw new Error('Image reading is unavailable: no attachment service is mounted')
  const route = agent.session.requestHeader()?.config
  const provider = route?.provider ?? agent.options.provider
  const model = route?.model ?? agent.options.model
  const llm = agent.ctx.get('llm')
  if (!llm || !provider || !model) throw new Error('Image reading is unavailable: the current model route is unresolved')
  const info = await llm.resolveModelInfo(provider, model, signal)
  if (!info.inputModalities?.includes('image')) throw new Error(`Model ${model} does not support image input; the image has not been inspected`)
  signal.throwIfAborted()

  let url = ref.url && HTTP_URL.test(ref.url) ? ref.url : undefined
  if (!url && ref.file && config?.endpoint) {
    const resolved = await call(config, 'get_image', { file: ref.file }, signal).catch(() => undefined) as { url?: unknown } | undefined
    if (typeof resolved?.url === 'string' && HTTP_URL.test(resolved.url.trim())) url = resolved.url.trim()
  }
  if (!url) throw new Error(`QQ image ${imageKey} is unavailable: image URL could not be resolved`)

  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) })
  } catch (error) {
    throw new Error(`QQ image ${imageKey} is unavailable: download failed (${error instanceof Error ? error.message : String(error)})`)
  }
  if (!response.ok) throw new Error(`QQ image ${imageKey} is unavailable: HTTP ${response.status}`)
  const maxBytes = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
  const declaredLen = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
    throw new Error(`QQ image ${imageKey} is unavailable: image exceeds the deployment byte limit`)
  }
  const data = Buffer.from(await response.arrayBuffer())
  if (data.length === 0) throw new Error(`QQ image ${imageKey} is unavailable: empty image payload`)
  if (data.length > maxBytes) throw new Error(`QQ image ${imageKey} is unavailable: image exceeds the deployment byte limit`)
  const mediaType = detectImageMediaType(data, response.headers.get('content-type'))
  if (!mediaType) throw new Error(`QQ image ${imageKey} is unavailable: response is not a supported PNG/JPEG/WebP/GIF image`)
  signal.throwIfAborted()
  const image = await attachments.saveImage({ data, mediaType, name: `${imageKey}${extForMediaType(mediaType)}` })
  signal.throwIfAborted()
  return { source_message_id: message.id, image_key: imageKey, image }
}

const threadContext: ThreadContext<QqConfig> = {
  messageId: trigger => String(trigger.meta.messageId ?? trigger.id),
  async read(commands, trigger, part, cursor, config) {
    void commands
    void cursor
    const group = String(trigger.meta.group ?? '')
    const replyToId = typeof trigger.meta.replyToId === 'string' ? trigger.meta.replyToId : ''
    if (part === 'parent') {
      if (!replyToId) return { messages: [], body: { status: 'no_parent' }, status: 'no_parent' }
      const raw = await call(config, 'get_msg', { message_id: /^\d+$/.test(replyToId) ? Number(replyToId) : replyToId }).catch(() => undefined)
      const parsed = MessageSchema.safeParse(raw)
      if (!parsed.success) {
        return { messages: [], body: { status: 'unavailable', reply_to_id: replyToId }, status: 'unavailable' }
      }
      if (!quotedMessageAllowed(trigger, config, parsed.data)) {
        return {
          messages: [],
          body: { status: 'forbidden', reply_to_id: replyToId, reason: 'Quoted message is outside the authorized chat scope' },
          status: 'forbidden',
        }
      }
      const origImages = imageRefsOf(parsed.data)
      rememberImages(trigger.id, origImages)
      const origReply = replyIdOf(parsed.data)
      const msg: ContextMessage = {
        id: id(parsed.data.message_id) || replyToId,
        from: nameOf(parsed.data),
        at: atIso(parsed.data),
        text: plainText(parsed.data),
        ...(origReply ? { reply_to: origReply } : {}),
      }
      return {
        messages: [msg],
        body: { status: 'available', reply_to_id: replyToId, message: msg },
        status: 'available',
      }
    }
    if (part !== 'thread') return { messages: [], body: {} }
    if (!group) {
      // A private Thread holds the trigger itself; if it quotes an earlier message, also attempt authorized parent lookup.
      const selfMsg: ContextMessage = {
        id: String(trigger.meta.messageId ?? trigger.id),
        from: trigger.actor.name ?? trigger.actor.id,
        at: trigger.at,
        text: trigger.text,
        ...(replyToId ? { reply_to: replyToId } : {}),
      }
      const messages: ContextMessage[] = []
      if (replyToId) {
        const parent = await threadContext.read(commands, trigger, 'parent', undefined, config)
        if (parent.messages.length > 0) messages.push(...parent.messages)
      }
      messages.push(selfMsg)
      return { messages, body: { ...(replyToId ? { reply_to_id: replyToId } : {}) } }
    }
    const history = await call(config, 'get_group_msg_history', { group_id: Number(group), count: 20 }).catch(() => undefined)
    const messages = (history as { messages?: unknown } | undefined)?.messages
    if (!Array.isArray(messages)) return { messages: [], body: {} }
    const out: ContextMessage[] = []
    for (const entry of messages) {
      const parsed = MessageSchema.safeParse(entry)
      if (!parsed.success) continue
      rememberImages(trigger.id, imageRefsOf(parsed.data))
      const entryReply = replyIdOf(parsed.data)
      out.push({
        id: id(parsed.data.message_id),
        from: nameOf(parsed.data),
        at: atIso(parsed.data),
        text: plainText(parsed.data),
        ...(entryReply ? { reply_to: entryReply } : {}),
      })
    }
    return { messages: out, body: { ...(replyToId ? { reply_to_id: replyToId } : {}) } }
  },
  images: qqImageKeys,
  image: (agent, _commands, trigger, message, imageKey, _stateDir, signal, config) =>
    readQqImage(agent, trigger, message, imageKey, signal, config),
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
  schema: QqConfigSchema,
  fields: [
    { key: 'endpoint', type: 'text', pattern: 'https?://\\S+', label: { zh: 'OneBot 端点', en: 'OneBot endpoint' },
      hint: { zh: 'OneBot v11 的 HTTP 地址，通常是 http://127.0.0.1:3000。', en: 'The OneBot v11 HTTP address, usually http://127.0.0.1:3000.' } },
    { key: 'token', type: 'text', label: { zh: '访问令牌', en: 'Access token' },
      hint: { zh: '端点要求的令牌，留空表示没设。作为 Bearer 头发送，不写进日志。',
        en: 'The token the endpoint requires; empty when it has none. Sent as a bearer header and never logged.' } },
    { key: 'eventEndpoint', type: 'text', label: { zh: '事件 WebSocket 地址', en: 'Event WebSocket endpoint' },
      hint: { zh: '可选。配置网关的正向 WebSocket 地址以接收私聊和实时群消息；需在网关中启用。令牌与 HTTP 共用。', en: 'Optional forward WebSocket endpoint for private and live group events; enable it in your bridge. Uses the HTTP token.' } },
    { key: 'privateMessages', type: 'switch', label: { zh: '接收私聊事件', en: 'Receive private events' },
      hint: { zh: '需要配置事件 WebSocket 地址。', en: 'Requires an event WebSocket endpoint.' } },
    { key: 'groups', type: 'text', label: { zh: '接收的群号', en: 'Group numbers' },
      hint: { zh: '空格或逗号分隔。留空表示账号所在的全部群。', en: 'Spaces or commas. Empty reads every group the account is in.' } },
    { key: 'observeAll', type: 'switch', label: { zh: '接收群里没 @ 的消息', en: 'Receive group messages that do not @ the agent' },
      hint: { zh: '打开后普通群消息也会收到，由策略的接收表决定是否成为候选。群热闹时消息很多，通常配合策略白名单收窄。',
        en: 'Ordinary group messages are received too, and the Policy\'s admission table decides. A busy group is noisy; narrow it with the Policy list.' } },
    { key: 'pollSeconds', type: 'number', advanced: true, min: 2, max: 3600, label: { zh: '轮询间隔 / 秒', en: 'Polling interval / seconds' },
      hint: { zh: '定期读取最近群消息；事件 WebSocket 配置后可实时接收消息。', en: 'Periodically reads recent group messages; the optional event WebSocket receives live events.' } },
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
  repliesTo: trigger => typeof trigger.meta.replyToId === 'string' && trigger.meta.replyToId ? `qq:${trigger.meta.replyToId}` : undefined,
  find: query => {
    const group = /^(?:group:)?(\d{5,})$/.exec(query.trim())?.[1]
    return { threads: group ? [`${kind}:group:${group}`] : [], terms: [] }
  },
  policy: {
    schema: z.object({ allowed: z.array(z.object({ id: z.string().regex(/^\d+$/) }).strict()).default([]) }).strict(),
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '能发起工作的 QQ 号', en: 'QQ numbers that may originate work' },
      hint: { zh: '名单里的人私聊或在群里 @ 智能体才算明确请求；私聊需要事件 WebSocket。名单外的人不会直接成为工单。',
        en: 'A listed person can request work by private message or a group mention. Private events require WebSocket.' },
      columns: [{ key: 'id', type: 'text', label: { zh: 'QQ 号', en: 'QQ number' }, pattern: '\\d+' }] }],
    explicit: { zh: '名单里的人私聊或在群里 @ 智能体。', en: 'A listed person messages privately or mentions the agent in a group.' },
    rows: () => [
      { id: 'group', label: { zh: '群消息', en: 'Group messages' }, note: { zh: '@ 才算', en: '@ only' },
        cells: { listedUnaddressed: false, unlistedAddressed: true, unlistedUnaddressed: false } },
      { id: 'private', label: { zh: '私聊', en: 'Private messages' }, note: { zh: '需要事件 WebSocket', en: 'Requires event WebSocket' },
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
    description: { zh: '通过兼容 OneBot 网关读取 QQ 群消息；配置事件 WebSocket 后可接收私聊。需实测网关兼容性。',
      en: 'Reads QQ group messages through a compatible OneBot bridge; an event WebSocket enables private messages. Verify bridge compatibility.' },
    variable: { key: 'DSH_SUPERAGENT_QQ_THREAD', description: { zh: '接下工单的 QQ 会话：群号或私聊的对象', en: 'The QQ conversation that started the ticket: a group number, or the person in a private chat' } } },
  { kind: 'wechat',
    title: { zh: '微信', en: 'WeChat' },
    description: { zh: '通过兼容 OneBot 桥读取微信群消息；私聊需要事件 WebSocket。微信桥及接口兼容性须实际验证。',
      en: 'Reads WeChat group messages through a compatible OneBot bridge; private reception requires an event WebSocket. Verify compatibility.' },
    variable: { key: 'DSH_SUPERAGENT_WECHAT_THREAD', description: { zh: '接下工单的微信会话：群号或私聊的对象', en: 'The WeChat conversation that started the ticket: a group number, or the person in a private chat' } } },
  { kind: 'wecom',
    title: { zh: '企业微信', en: 'WeCom' },
    description: { zh: '通过兼容 OneBot 桥读取企业微信群消息；私聊需要事件 WebSocket。企业微信桥及接口兼容性须实际验证。',
      en: 'Reads WeCom group messages through a compatible OneBot bridge; private reception requires an event WebSocket. Verify compatibility.' },
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

/** 卡片的标题：JSON/XML 卡片把它埋在嵌套字段里，取不到就退回一个中性的名字。 */
function cardTitle(data: Record<string, unknown> | undefined): string {
  const candidates = [data?.prompt, data?.title, data?.desc, data?.name, data?.summary]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 60)
  }
  const nested = JSON.stringify(data ?? {})
  const match = /"(?:title|prompt|desc)"\s*:\s*"([^"]{1,60})"/.exec(nested)
  return match?.[1] ?? '未命名'
}
