/** Normalizes Feishu live events, chat history items, and topic replies into domain Triggers. */
import { z } from 'zod'
import { key, type ChannelRef, type Trigger } from '../core/index.ts'
import type { FeishuMessage, FeishuRef } from './feishu-read.ts'

export const SOURCE = 'feishu'
/** Constructs a Feishu reply channel address; records `direct` explicitly because both group and direct chat IDs start with `oc_`. */
export const feishuChannel = (chatId: string, messageId: string, direct = false): ChannelRef =>
  ({ source: SOURCE, thread: `feishu:${chatId}`, address: { chatId, messageId, ...direct ? { direct: 'true' } : {} } })
/** A message as the live event consumer prints it; the history and topic-page paths normalize what they read into this shape. */
const EventSchema = z.object({ message_id: z.string(), chat_id: z.string(), chat_type: z.enum(['p2p', 'group']),
  sender_id: z.string(), sender_type: z.enum(['user', 'bot']), content: z.string(), create_time: z.string(),
  mentions: z.array(z.object({ id: z.string(), key: z.string().optional(), name: z.string().optional() })).default([]),
  root_id: z.string().optional(), parent_id: z.string().optional(), thread_id: z.string().optional(), message_app_link: z.url().optional() })
export type FeishuEvent = z.infer<typeof EventSchema>
export const feishuThreadId = (chatId: string, rootId: string | undefined, messageId: string): string => `${chatId}:${rootId ?? messageId}`
/** Deterministic trigger ID for a Feishu message; every read path for this message produces the same ID. */
export const feishuTriggerId = (messageId: string): string => key('feishu', messageId)
export const withMentionNames = (text: string, mentions: { key?: string | undefined; name?: string | undefined }[]): string =>
  mentions.reduce((result, mention) => mention.key && mention.name ? result.replaceAll(mention.key, `@${mention.name}`) : result, text)

/** Parses a single Feishu `post` rich-text node into readable inline text (preserving `img_` keys for image loading). */
function renderPostNode(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const item = node as Record<string, unknown>
  const tag = typeof item.tag === 'string' ? item.tag : ''
  if (tag === 'text') return typeof item.text === 'string' ? item.text : ''
  if (tag === 'a') {
    const label = typeof item.text === 'string' ? item.text.trim() : ''
    const href = typeof item.href === 'string' ? item.href.trim() : ''
    if (label && href && label !== href) return `${label} (${href})`
    return label || href
  }
  if (tag === 'at') {
    const name = typeof item.user_name === 'string' && item.user_name.trim() ? item.user_name.trim()
      : typeof item.user_id === 'string' && item.user_id.trim() ? item.user_id.trim() : ''
    if (!name) return ''
    return name.startsWith('@') ? name : `@${name}`
  }
  if (tag === 'img') {
    const imageKey = typeof item.image_key === 'string' ? item.image_key.trim() : ''
    return imageKey ? `[图片: ${imageKey}]` : '[图片]'
  }
  if (tag === 'media') {
    const fileKey = typeof item.file_key === 'string' ? item.file_key.trim()
      : typeof item.image_key === 'string' ? item.image_key.trim() : ''
    return fileKey ? `[媒体: ${fileKey}]` : '[媒体]'
  }
  if (tag === 'md' || tag === 'code_block') {
    return typeof item.text === 'string' ? item.text : ''
  }
  if (tag === 'emotion') {
    const emoji = typeof item.emoji_type === 'string' ? item.emoji_type.trim() : ''
    return emoji ? `[表情: ${emoji}]` : '[表情]'
  }
  if (tag === 'hr') return '---'
  return typeof item.text === 'string' ? item.text : ''
}

function renderPostLocale(doc: unknown): string | undefined {
  if (!doc || typeof doc !== 'object') return undefined
  const record = doc as Record<string, unknown>
  if (!Array.isArray(record.content)) return undefined
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const lines: string[] = []
  for (const row of record.content) {
    if (!Array.isArray(row)) continue
    const parts = row.map(renderPostNode).filter(part => part.length > 0)
    if (!parts.length) continue
    // Join inline elements cleanly: insert a space only when an @mention precedes non-whitespace text without spacing.
    let line = ''
    for (const part of parts) {
      if (line && line.endsWith('@') === false && /@[^\s]+$/.test(line) && !/^[\s,，。.:：;；!?！？)]/.test(part)) {
        line += ` ${part}`
      } else {
        line += part
      }
    }
    const trimmed = line.trim()
    if (trimmed) lines.push(trimmed)
  }
  const body = lines.join('\n')
  if (title && body) return `${title}\n${body}`
  return title || body || ''
}

/**
 * Extracts readable text from Feishu message content: supports plain strings, JSON `{ text }`,
 * and Feishu `post` rich-text JSON (direct `{ title, content }` or locale-wrapped `{ zh_cn, en_us, ... }`).
 */
export function parseFeishuContent(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('"'))) return raw
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return raw }
  if (typeof parsed === 'string') return parsed
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return raw
  const obj = parsed as Record<string, unknown>
  if (typeof obj.text === 'string') return obj.text
  const directPost = renderPostLocale(obj)
  if (directPost !== undefined) return directPost
  const container = obj.post && typeof obj.post === 'object' && !Array.isArray(obj.post)
    ? obj.post as Record<string, unknown>
    : obj
  for (const locale of ['zh_cn', 'en_us', 'ja_jp', ...Object.keys(container)]) {
    if (!(locale in container)) continue
    const rendered = renderPostLocale(container[locale])
    if (rendered !== undefined) return rendered
  }
  return JSON.stringify(parsed)
}
/**
 * Parses a Feishu message timestamp into an ISO-8601 string: live events and the history API return epoch milliseconds as a
 * string, whereas topic/thread pages return a local timestamp string such as `2026-09-11 12:00`.
 */
export function feishuTime(value: string): string {
  const time = /^\d+$/.test(value) ? Number(value) : Date.parse(value)
  if (!Number.isFinite(time)) throw new Error(`Unreadable Feishu message time: ${value}`)
  return new Date(time).toISOString()
}
/** Converts a normalized Feishu event into a Trigger, returning undefined for messages sent by the bot itself. */
export function feishuTrigger(input: unknown, botId: string, botAppId: string): Trigger | undefined {
  const event = EventSchema.parse(input)
  if (event.sender_id === botId || event.sender_id === botAppId) return
  const direct = event.chat_type === 'p2p'
  const mentioned = event.mentions.some(mention => mention.id === botId || mention.id === botAppId)
  const thread = feishuThreadId(event.chat_id, event.root_id, event.message_id)
  return { id: feishuTriggerId(event.message_id), source: SOURCE, threads: [{ source: SOURCE, id: thread }],
    actor: { source: SOURCE, id: event.sender_id }, human: event.sender_type === 'user',
    ...(direct ? { addressed: 'direct' as const } : mentioned ? { addressed: 'mention' as const } : {}),
    at: feishuTime(event.create_time), text: withMentionNames(parseFeishuContent(event.content), event.mentions),
    channel: feishuChannel(event.chat_id, event.message_id, direct), ...(event.message_app_link ? { url: event.message_app_link } : {}),
    meta: { chatId: event.chat_id, messageId: event.message_id, direct, mentioned, ...(event.root_id ? { rootId: event.root_id } : {}),
      ...(event.parent_id ? { parentId: event.parent_id } : {}), ...(event.thread_id ? { threadId: event.thread_id } : {}) } }
}
export const feishuParent = (trigger: Trigger): string | undefined =>
  trigger.source === SOURCE && typeof trigger.meta.parentId === 'string' ? feishuTriggerId(trigger.meta.parentId) : undefined
export function feishuRef(trigger: Trigger): FeishuRef | undefined {
  const meta = trigger.meta as { chatId?: string; messageId?: string }
  if (trigger.source !== SOURCE || !meta.chatId || !meta.messageId) return undefined
  return { triggerId: trigger.id, chatId: meta.chatId, messageId: meta.messageId, at: trigger.at }
}

/** A message from the history API; a deleted message may have no body/content. */
export const HistoricalMessageSchema = z.looseObject({
  message_id: z.string(), chat_id: z.string(), create_time: z.string(),
  root_id: z.string().optional(), parent_id: z.string().optional(), thread_id: z.string().optional(),
  deleted: z.boolean().optional(), message_app_link: z.string().optional(),
  sender: z.looseObject({ id: z.string().default(''), sender_type: z.string() }),
  body: z.looseObject({ content: z.string() }).optional(),
  mentions: z.array(z.looseObject({ id: z.string(), key: z.string().optional(), name: z.string().optional() })).optional(),
})
export type HistoricalMessage = z.infer<typeof HistoricalMessageSchema>
/** One page of the history API; items are validated individually so an unreadable item is skipped alone. */
export const HistoryPageSchema = z.looseObject({
  items: z.array(z.unknown()).default([]), has_more: z.boolean().default(false), page_token: z.string().optional(),
})
export function historyText(message: HistoricalMessage): string {
  return parseFeishuContent(message.body?.content ?? '')
}
export function historyEvent(message: HistoricalMessage, chatId: string, direct: boolean): unknown {
  return { message_id: message.message_id, chat_id: chatId, chat_type: direct ? 'p2p' : 'group', create_time: message.create_time,
    sender_id: message.sender.id, sender_type: message.sender.sender_type === 'user' ? 'user' : 'bot', content: historyText(message),
    mentions: message.mentions ?? [], root_id: message.root_id, parent_id: message.parent_id, thread_id: message.thread_id,
    message_app_link: message.message_app_link }
}
/**
 * Adapts a topic-page message into the live-event schema, falling back to `root` when Feishu omits `root_id` on replies;
 * an app's message carries its bot's `open_bot_id`, and a deleted message may have no content.
 */
export function topicEvent(message: FeishuMessage, chatId: string, direct: boolean, root: string): unknown {
  return { message_id: message.message_id, chat_id: chatId, chat_type: direct ? 'p2p' : 'group', create_time: message.create_time,
    sender_id: message.sender.open_bot_id ?? message.sender.id, sender_type: message.sender.sender_type === 'user' ? 'user' : 'bot',
    content: message.content ?? '', mentions: message.mentions ?? [], parent_id: message.parent_id, thread_id: message.thread_id,
    root_id: message.root_id ?? (message.message_id === root ? undefined : root), message_app_link: message.message_app_link }
}
