/** User-requested, non-delivery connectivity checks for saved source settings. */
import nodemailer from 'nodemailer'
import { ImapClient } from '../sources/imap.ts'
import { MailConfigSchema } from '../sources/mail.ts'
import type { SourceInstance } from '../sources/kind.ts'

export type ProbeState = 'ok' | 'missing' | 'failed' | 'unsupported' | 'unsafe' | 'auth_failed' | 'unreachable' | 'tls_failed'
export interface SourceProbeResult { checks: Array<{ name: 'onebot' | 'imap' | 'smtp'; state: ProbeState }> }

/** Classify errors without copying server text, URLs, usernames or credentials into the response. */
function failure(error: unknown): ProbeState {
  const value = error as { code?: unknown; cause?: { code?: unknown }; message?: unknown }
  const code = String(value?.code ?? value?.cause?.code ?? '')
  if (code === 'EAUTH') return 'auth_failed'
  if (/^(ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|ESOCKET)$/.test(code)) return 'unreachable'
  if (/TLS|CERT|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) return 'tls_failed'
  if (typeof value?.message === 'string' && /^NO\b/i.test(value.message)) return 'auth_failed'
  return 'failed'
}

/** Does not send messages, return endpoint responses or expose credentials. */
export async function probeSource(instance: SourceInstance): Promise<SourceProbeResult> {
  if (['qq', 'wechat', 'wecom'].includes(instance.kind)) {
    const endpoint = instance.config.endpoint
    if (typeof endpoint !== 'string' || !endpoint.trim()) return { checks: [{ name: 'onebot', state: 'missing' }] }
    try {
      const base = new URL(endpoint)
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Invalid endpoint')
      const token = instance.config.token
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (typeof token === 'string' && token) headers.authorization = `Bearer ${token}`
      const response = await fetch(`${base.toString().replace(/\/+$/, '')}/get_login_info`, {
        method: 'POST', headers, body: '{}', redirect: 'error', signal: AbortSignal.timeout(5000),
      })
      if (response.status === 401 || response.status === 403) return { checks: [{ name: 'onebot', state: 'auth_failed' }] }
      if (!response.ok) throw new Error('Request failed')
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No gateway response')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const part = await reader.read()
          if (part.done) break
          size += part.value.byteLength
          if (size > 65536) { await reader.cancel(); throw new Error('Gateway response too large') }
          chunks.push(part.value)
        }
      } finally { reader.releaseLock() }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { status?: unknown; retcode?: unknown; data?: { user_id?: unknown } }
      if (body.status !== 'ok' || body.retcode !== 0 || !body.data?.user_id) throw new Error('Unexpected gateway response')
      return { checks: [{ name: 'onebot', state: 'ok' }] }
    } catch (error) { return { checks: [{ name: 'onebot', state: failure(error) }] } }
  }
  if (instance.kind !== 'mail') return { checks: [] }
  const parsed = MailConfigSchema.safeParse(instance.config)
  if (!parsed.success) return { checks: [{ name: 'imap', state: 'missing' }, { name: 'smtp', state: 'missing' }] }
  const config = parsed.data
  const common = !!config.address && !!config.secret
  const imap = async (): Promise<ProbeState> => {
    if (!common || !config.imapHost) return 'missing'
    // The existing IMAP client has no STARTTLS support: never transmit a password on a plain connection.
    if (!config.imapSecure) return 'unsafe'
    const client = new ImapClient({ host: config.imapHost, port: config.imapPort, secure: true,
      user: config.address, password: config.secret, timeoutMs: 5000 })
    try { await client.open(); await client.select('INBOX'); return 'ok' }
    catch (error) { return failure(error) }
    finally { await client.close() }
  }
  const smtp = async (): Promise<ProbeState> => {
    if (!common || !config.smtpHost) return 'missing'
    const transport = nodemailer.createTransport({ host: config.smtpHost, port: config.smtpPort,
      secure: config.smtpSecure, requireTLS: !config.smtpSecure, auth: { user: config.address, pass: config.secret },
      connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000 })
    try { await transport.verify(); return 'ok' }
    catch (error) { return failure(error) }
    finally { transport.close() }
  }
  const [inbound, outbound] = await Promise.all([imap(), smtp()])
  return { checks: [{ name: 'imap', state: inbound }, { name: 'smtp', state: outbound }] }
}
