/**
 * Mail Source: reads an IMAP inbox and replies over SMTP.
 *
 * One kind serves QQ Mail, Gmail and any other IMAP host, because they differ only in host name and credentials. The
 * policy list is what keeps an inbox usable: without it every stranger who finds the address becomes a candidate.
 *
 * A mail is addressed to the agent when it arrives, which is the point of an inbox; the Policy decides whether its sender
 * may originate work. Only mail from a listed sender becomes an explicit request.
 */
import { z } from 'zod'
import { key } from '../core/index.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { OutboundMessage, ScopeResult, Trigger } from '../core/index.ts'
import type { ContextMessage, FieldSpec, SourceChannel, SourceKind, ThreadContext } from './kind.ts'
import { health, sourceContext, type Health, type SourceContext } from './host.ts'
import { ImapClient } from './imap.ts'
import { pause } from './poll.ts'
import { KV } from '../kv.ts'

export const SOURCE = 'mail'

/**
 * `secret` is the app password the provider issues, not the account password: QQ Mail and Gmail both refuse a normal
 * password to an IMAP client, and both issue a separate one for it.
 */
export const MailConfigSchema = z.object({
  address: z.string().trim().regex(/^[^\s@]+@[^\s@]+$/, 'name@example.com').default(''),
  imapHost: z.string().trim().default('imap.qq.com'),
  imapPort: z.number().int().min(1).max(65535).default(993),
  imapSecure: z.boolean().default(true),
  smtpHost: z.string().trim().default('smtp.qq.com'),
  smtpPort: z.number().int().min(1).max(65535).default(465),
  smtpSecure: z.boolean().default(true),
  secret: z.string().trim().default(''),
  /** Mailboxes to read, comma separated; empty reads INBOX only. */
  mailboxes: z.string().trim().default('INBOX'),
  /** Most recent messages to read per poll. */
  window: z.number().int().min(1).max(50).default(5),
  pollSeconds: z.number().int().min(30).max(3600).default(120),
  failuresBeforeError: z.number().int().min(1).max(20).default(3),
})
export type MailConfig = z.infer<typeof MailConfigSchema>

/** Returns an error health once `failures` consecutive polls fail, so one network interruption stays quiet. */
export function pollFailure(failures: number, threshold: number, error: unknown): Health | undefined {
  return failures >= threshold ? health('error', 'pollFailures', { count: String(failures), error: String(error) }) : undefined
}

const list = (text: string): string[] => text.split(/[\s,]+/).map(entry => entry.trim()).filter(Boolean)

/** Decodes the RFC 2047 encoded words a mail header uses for a non-ASCII sender or subject. */
export function decodeHeader(text: string): string {
  return text.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset: string, encoding: string, payload: string) => {
    try {
      if (encoding.toUpperCase() === 'B') return Buffer.from(payload, 'base64').toString(charset === 'utf-8' || /^utf-?8$/i.test(charset) ? 'utf8' : 'latin1')
      // Q encoding: an underscore is a space, an `=XX` sequence is one byte.
      const bytes = payload.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      return Buffer.from(bytes, 'latin1').toString('utf8')
    } catch { return whole }
  })
}

/** Reads one header field from a raw message head; a folded continuation line is appended. */
function header(raw: string, name: string): string {
  const match = new RegExp(`^${name}:\\s*((?:[^\\r\\n]|\\r?\\n[ \\t])*)`, 'im').exec(raw)
  return match ? decodeHeader(match[1]!.replace(/\r?\n[ \t]+/g, ' ').trim()) : ''
}

/** A bare address out of `Name <a@b>`, already decoded. */
function addressOf(value: string): string {
  return (/<([^>]+)>/.exec(value)?.[1] ?? value).trim().toLowerCase()
}

/** The text a person wrote: the plain part when the message is multipart, otherwise the body itself. */
export function bodyOf(raw: string): string {
  // The head ends at the first blank line; everything after it is the body as sent.
  const split = /\r?\n\r?\n/.exec(raw)
  if (!split) return ''
  return raw.slice(split.index + split[0].length).slice(0, 8_000).trim()
}

/** Turns a fetched message into a Trigger, or undefined when it carries nothing a person wrote. */
export function triggerOf(raw: string, config: MailConfig, mailbox: string, seq: number): Trigger | undefined {
  const sender = addressOf(header(raw, 'From'))
  if (!sender) return undefined
  const own = config.address.toLowerCase()
  // A copy of what the agent sent comes back through the same inbox; answering it would loop.
  if (sender === own) return undefined
  const messageId = header(raw, 'Message-ID') || `${mailbox}:${seq}`
  const subject = header(raw, 'Subject')
  const date = header(raw, 'Date')
  const at = Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : new Date().toISOString()
  const text = [...subject ? [`主题：${subject}`] : [], bodyOf(raw)].filter(Boolean).join('\n\n')
  if (!text.trim()) return undefined
  return {
    id: `mail:${messageId}`,
    source: SOURCE,
    threads: [{ source: SOURCE, id: `mail:${messageId}` }],
    // An inbox receives mail addressed to it by definition; the Policy decides whether this sender may originate work.
    actor: { source: SOURCE, id: sender, name: decodeHeader(header(raw, 'From')) },
    human: true,
    addressed: 'direct',
    at,
    text,
    channel: { source: SOURCE, thread: `mail:${messageId}`, address: { to: sender, subject: `Re: ${subject}` } },
    meta: { messageId, mailbox, seq, subject },
  }
}

async function poll(ctx: SourceContext, config: MailConfig): Promise<number> {
  const client = new ImapClient({ host: config.imapHost, port: config.imapPort, secure: config.imapSecure,
    user: config.address, password: config.secret })
  let received = 0
  try {
    await client.open()
    for (const mailbox of list(config.mailboxes)) {
      const total = await client.select(mailbox)
      const messages = await client.newest(total, 'BODY.PEEK[]', config.window)
      for (const message of messages) {
        const raw = message.body
        // The dedupe key is the server's identity for the message, which is stable across polls.
        const stamp = header(raw, 'Message-ID') || `${mailbox}:${message.seq}`
        const seen = new Set<string>(ctx.state.get(KV.mail.seen(config.address)) ?? [])
        if (seen.has(stamp)) continue
        const trigger = triggerOf(raw, config, mailbox, message.seq)
        if (trigger) { await ctx.receive(trigger); received += 1 }
        seen.add(stamp)
        ctx.state.set(KV.mail.seen(config.address), seen.size > 2000 ? [...seen].slice(-2000) : [...seen])
      }
    }
  } finally { await client.close().catch(() => undefined) }
  return received
}

async function watch(ctx: SourceContext, signal: AbortSignal): Promise<void> {
  await ctx.ready
  if (!ctx.configured()) { ctx.report(SOURCE, health('paused', 'setupPending')); return }
  let failures = 0
  while (!signal.aborted) {
    const config = ctx.config<MailConfig>(SOURCE)
    if (!config) {
      ctx.report(SOURCE, health('paused', 'sourceOff'))
      await pause(5_000, signal)
      continue
    }
    if (!config.address || !config.secret) {
      // Reported as paused rather than as a failure: nothing is wrong with the connection, it is not set up yet.
      ctx.report(SOURCE, health('paused', 'mailUnconfigured'))
      await pause(10_000, signal)
      continue
    }
    try {
      const received = await poll(ctx, config)
      failures = 0
      ctx.report(SOURCE, { state: 'ready', detail: `${received} new message(s); next poll ≥ ${config.pollSeconds}s`, at: new Date().toISOString() })
    } catch (error) {
      failures += 1
      const failed = pollFailure(failures, config.failuresBeforeError, error)
      if (!signal.aborted && failed) ctx.report(SOURCE, failed)
    }
    await pause(config.pollSeconds * 1000, signal)
  }
}

/**
 * Sends a reply over SMTP using curl, which ships with this host and already speaks the protocol.
 * The body is passed as a file so a long or non-ASCII message never becomes one argument of a shell command.
 */
const channel: SourceChannel<MailConfig> = {
  async send(host, message: OutboundMessage): Promise<'sent'> {
    const config = host.config
    if (!config.address || !config.secret) throw new Error('The Mail Source has no address or app password yet')
    const to = message.channel.address.to
    if (!to) throw new Error('Missing mail recipient')
    const { writeFile, rm, mkdtemp } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const body = join(tmpdir(), `dsh-mail-${message.id.replace(/[^A-Za-z0-9]/g, '')}.eml`)
    // The headers curl does not build are written here, so the message keeps its subject and threading hints.
    const subject = message.channel.address.subject ?? 'Reply'
    await writeFile(body, [
      `To: ${to}`,
      `From: ${config.address}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      message.text,
      '',
    ].join('\r\n'), 'utf8')
    const url = `${config.smtpSecure ? 'smtps' : 'smtp'}://${config.smtpHost}:${config.smtpPort}`
    // The app password must not travel as a command-line argument: `--user address:secret` is visible in the process list
    // to every process running as this user, and gets copied into crash reports, shell history and `ps` snapshots. curl
    // reads `--config <file>` instead, so the credential stays in a file this account can read and that is deleted at once.
    const auth = await mkdtemp(join(tmpdir(), 'dsh-superagent-smtp-'))
    const rc = join(auth, 'curl.rc')
    try {
      // Quoted because a password may contain `"` or `\`, which curl's config parser would otherwise treat as syntax.
      await writeFile(rc, `user = "${`${config.address}:${config.secret}`.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\n`, { mode: 0o600 })
      await host.commands.run('curl', ['--silent', '--show-error', '--fail', '--url', url, '--config', rc,
        '--mail-from', config.address, '--mail-rcpt', to, '--upload-file', body])
    } finally {
      await rm(auth, { recursive: true, force: true })
      await rm(body, { force: true })
    }
    return 'sent'
  },
  link(address, links) {
    void links
    return { url: '', label: { zh: `邮件 ${address.to ?? ''}`.trim(), en: `Mail ${address.to ?? ''}`.trim() } }
  },
}

const threadContext: ThreadContext<MailConfig> = {
  messageId: trigger => String(trigger.meta.messageId ?? trigger.id),
  // A mail Thread is one message; there is no conversation to page through beyond the headers already carried.
  async read(commands, trigger, part) {
    void commands
    if (part !== 'thread') return { messages: [], body: {} }
    const message: ContextMessage = { id: String(trigger.meta.messageId ?? trigger.id), from: trigger.actor.name ?? trigger.actor.id,
      at: trigger.at, text: trigger.text }
    return { messages: [message], body: {} }
  },
}

export const mailKind: SourceKind<MailConfig> = {
  kind: SOURCE,
  title: { zh: '邮箱', en: 'Mail' },
  description: {
    zh: '通过 IMAP 收信、通过 SMTP 回信，QQ 邮箱与 Gmail 等通用。收件箱里的信都算发给智能体；是否成为工单由策略的名单决定。',
    en: 'Reads an IMAP inbox and replies over SMTP, which serves QQ Mail, Gmail and any other host. Every mail in the inbox is addressed to the agent; the Policy list decides which become tickets.',
  },
  schema: MailConfigSchema,
  fields: [
    { key: 'address', type: 'text', pattern: '[^\\s@]+@[^\\s@]+', label: { zh: '邮箱地址', en: 'Mail address' },
      hint: { zh: '完整的邮箱地址，也是 IMAP/SMTP 的登录名。', en: 'The full address, which is also the IMAP and SMTP login.' } },
    { key: 'secret', type: 'password', label: { zh: '授权码', en: 'App password' },
      // A link rather than directions: the page that issues this is not reachable from here and the steps differ per
      // provider, so taking the operator straight there is the whole help worth giving.
      link: { url: 'https://service.mail.qq.com/detail/0/75', label: { zh: 'QQ 邮箱怎么拿授权码', en: 'How to get one (QQ Mail)' } },
      hint: { zh: '不是邮箱密码。QQ 邮箱要先在「设置 → 账户」开启 IMAP/SMTP 服务，再生成授权码；Gmail 用「应用专用密码」。点右边链接按提示走三步即可。',
        en: 'Not the account password. QQ Mail needs IMAP/SMTP switched on under Settings → Account, then an app password generated; Gmail needs an app password. The link walks through it.' } },
    { key: 'imapHost', type: 'text', advanced: true, label: { zh: 'IMAP 服务器', en: 'IMAP host' },
      hint: { zh: 'QQ 邮箱是 imap.qq.com，Gmail 是 imap.gmail.com。', en: 'imap.qq.com for QQ Mail, imap.gmail.com for Gmail.' } },
    { key: 'imapPort', type: 'number', advanced: true, min: 1, max: 65535, label: { zh: 'IMAP 端口', en: 'IMAP port' } },
    { key: 'imapSecure', type: 'switch', advanced: true, label: { zh: 'IMAP 使用 TLS', en: 'IMAP over TLS' } },
    { key: 'smtpHost', type: 'text', advanced: true, label: { zh: 'SMTP 服务器', en: 'SMTP host' },
      hint: { zh: 'QQ 邮箱是 smtp.qq.com，Gmail 是 smtp.gmail.com。', en: 'smtp.qq.com for QQ Mail, smtp.gmail.com for Gmail.' } },
    { key: 'smtpPort', type: 'number', advanced: true, min: 1, max: 65535, label: { zh: 'SMTP 端口', en: 'SMTP port' } },
    { key: 'smtpSecure', type: 'switch', advanced: true, label: { zh: 'SMTP 使用 TLS', en: 'SMTP over TLS' } },
    { key: 'mailboxes', type: 'text', advanced: true, label: { zh: '读取的邮箱文件夹', en: 'Mailboxes to read' },
      hint: { zh: '逗号分隔，留空只读收件箱。', en: 'Comma separated; empty reads the inbox only.' } },
    { key: 'window', type: 'number', advanced: true, min: 1, max: 50, label: { zh: '每次读取最近几封', en: 'Recent messages per poll' } },
    { key: 'pollSeconds', type: 'number', advanced: true, min: 30, max: 3600, label: { zh: '轮询间隔 / 秒', en: 'Polling interval / seconds' } },
    { key: 'failuresBeforeError', type: 'number', advanced: true, min: 1, max: 20, label: { zh: '连续失败几次后报告异常', en: 'Failed polls before reporting an error' } },
  ],
  health: ['mail'],
  scope: (): ScopeResult => ({ listened: true, observed: true, row: 'mail' }),
  channel,
  threadContext,
  policy: {
    schema: z.object({ allowed: z.array(z.object({ id: z.string().regex(/^[^\s@]+@[^\s@]+$/) }).strict()).default([]) }).strict(),
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '能发起工作的邮箱', en: 'Addresses that may originate work' },
      hint: { zh: '只有名单里的发件人写的信会成为明确的请求。名单外的信仍会被评估，但不会直接成为工单——收件箱谁都能写，这一步是必须的。',
        en: 'Only mail from a listed sender becomes an explicit request. Mail from anyone else is still assessed but never becomes a ticket: anyone can write to an inbox, so this list is what makes it safe.' },
      columns: [{ key: 'id', type: 'text', label: { zh: '邮箱', en: 'Address' }, pattern: '[^\\s@]+@[^\\s@]+' }] }],
    explicit: { zh: '名单里的地址发来的信。', en: 'A mail from a listed address.' },
    rows: () => [{ id: 'mail', label: { zh: '来信', en: 'Mail' }, note: { zh: '都算发给它', en: 'All addressed' },
      cells: { listedUnaddressed: true, unlistedAddressed: true, unlistedUnaddressed: true } }],
  },
  environment: {
    variables: [{ key: 'DSH_SUPERAGENT_MAIL_THREAD', description: { zh: '接下工单的那封信的 Message-ID', en: 'Message-ID of the mail that started the ticket' } }],
    values: ({ trigger }) => ({ DSH_SUPERAGENT_MAIL_THREAD: String(trigger?.meta.messageId ?? '') }),
  },
}

export const name = 'dsh-superagent-mail'
export const inject = ['orchestrator']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(mailKind), 'mail: source kind')
  ctx.effect(() => {
    const source = sourceContext(ctx.orchestrator, mailKind)
    const controller = new AbortController()
    const running = watch(source, controller.signal).catch((error: unknown) => { source.report(SOURCE, { state: 'error', detail: String(error) }) })
    return async () => { controller.abort(); await running }
  })
}
