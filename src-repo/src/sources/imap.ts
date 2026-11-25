/**
 * Minimal IMAP client, enough for this Source: sign in, list the mailbox, and read the newest few messages.
 *
 * A full IMAP implementation is a library, and this project keeps its dependency list to the DSH packages; the subset
 * below is what reading an inbox needs. Every call is tagged and awaited, so two commands never interleave their replies,
 * and an unexpected reply to an unknown tag is dropped rather than mistaken for the answer to the current one.
 */
import { connect, type Socket } from 'node:net'
import { connect as tlsConnect, type TLSSocket } from 'node:tls'

export interface ImapOptions {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  /** Milliseconds to wait for the greeting and for each command. */
  timeoutMs?: number
}
/** One message as fetched; `body` holds whatever the caller asked `FETCH` for. */
export interface ImapMessage { seq: number; body: string; raw: Buffer }

const CRLF = '\r\n'

/** Quotes a string for IMAP, escaping the quote and backslash characters the protocol reserves. */
const quoted = (text: string): string => `"${text.replace(/[\\"]/g, char => `\\${char}`)}"`

/**
 * One IMAP connection: greeting, `LOGIN`, one mailbox `SELECT`, and the `FETCH`es the caller asks for.
 * Every command is tagged and awaited in turn, so replies never interleave; a reply to a tag nobody is waiting for is
 * dropped rather than mistaken for the current answer.
 */
export class ImapClient {
  private socket?: Socket | TLSSocket
  private buffer: Buffer = Buffer.alloc(0)
  private literal?: { line: string; size: number }
  private tag = 0
  private greeting = false
  private readonly waiting = new Map<string, { resolve: (lines: string[]) => void; reject: (error: Error) => void }>()
  /** Untagged lines collected for the command in flight, which carry the data an answer refers to. */
  private collected: string[] = []
  constructor(private readonly options: ImapOptions) {}

  private get timeout(): number { return this.options.timeoutMs ?? 20_000 }

  /** Connects and signs in; resolves once the mailbox is authenticated. */
  async open(): Promise<void> {
    const { host, port, secure } = this.options
    this.socket = await new Promise<Socket | TLSSocket>((resolve, reject) => {
      const socket = secure ? tlsConnect({ host, port, servername: host }) : connect({ host, port })
      const timer = setTimeout(() => { socket.destroy(); reject(new Error(`IMAP ${host}:${port} did not answer in ${this.timeout} ms`)) }, this.timeout)
      const ready = () => { clearTimeout(timer); socket.off('error', fail); resolve(socket) }
      const fail = (error: Error) => { clearTimeout(timer); reject(error) }
      socket.once('error', fail)
      if (secure) (socket as TLSSocket).once('secureConnect', ready)
      else socket.once('connect', ready)
    })
    this.socket.on('data', chunk => { this.consume(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) })
    this.socket.on('error', (error: Error) => { for (const entry of this.waiting.values()) entry.reject(error); this.waiting.clear() })
    await this.awaitGreeting()
    await this.run(`LOGIN ${quoted(this.options.user)} ${quoted(this.options.password)}`)
  }

  /** Number of messages in the selected mailbox, or 0 when the server reports none. */
  async select(mailbox = 'INBOX'): Promise<number> {
    const lines = await this.run(`SELECT ${quoted(mailbox)}`)
    for (const line of lines) { const exists = /^\*\s+(\d+)\s+EXISTS/i.exec(line); if (exists) return Number(exists[1]) }
    return 0
  }

  /**
   * Reads the newest `limit` messages with the given `FETCH` items, in mailbox order.
   * An empty mailbox asks nothing: `FETCH 0:*` would name the last message of a mailbox that has none.
   */
  async newest(count: number, items: string, limit = 5): Promise<ImapMessage[]> {
    if (count <= 0) return []
    const from = Math.max(1, count - limit + 1)
    const lines = await this.run(`FETCH ${from}:${count} (${items})`)
    return parseFetch(lines)
  }

  /** Signs out and closes the socket; safe to call twice. */
  async close(): Promise<void> {
    const socket = this.socket
    if (!socket) return
    try { await this.run('LOGOUT') } catch { /* A closed connection needs no goodbye. */ }
    this.socket = undefined
    socket.destroy()
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (true) {
      if (this.literal) {
        if (this.buffer.length < this.literal.size) return
        // Latin-1 maps each byte to one character, preserving arbitrary MIME bytes until parseFetch.
        const body = this.buffer.subarray(0, this.literal.size).toString('latin1')
        this.buffer = this.buffer.subarray(this.literal.size)
        this.deliver(`${this.literal.line}${CRLF}${body}`)
        this.literal = undefined
        continue
      }
      const index = this.buffer.indexOf(CRLF)
      if (index < 0) return
      const line = this.buffer.subarray(0, index).toString('utf8')
      this.buffer = this.buffer.subarray(index + CRLF.length)
      const literal = /\{(\d+)\}$/.exec(line)
      if (literal) this.literal = { line, size: Number(literal[1]) }
      else this.deliver(line)
    }
  }
  private deliver(line: string): void {
    if (!this.greeting && /^\*\s+(OK|PREAUTH)/i.test(line)) { this.greeting = true; return }
    const tagged = /^(A\d+)\s+(OK|NO|BAD)\b/i.exec(line)
    if (tagged) {
      const entry = this.waiting.get(tagged[1]!)
      if (!entry) return
      this.waiting.delete(tagged[1]!)
      const collected = this.collected
      this.collected = []
      if (tagged[2]!.toUpperCase() === 'OK') entry.resolve(collected)
      else entry.reject(new Error(line.slice(tagged[1]!.length).trim() || 'IMAP command failed'))
      return
    }
    this.collected.push(line)
  }
  private awaitGreeting(): Promise<void> {
    if (this.greeting) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const started = Date.now()
      const poll = () => {
        if (this.greeting) { resolve(); return }
        if (Date.now() - started > this.timeout) { reject(new Error('IMAP sent no greeting')); return }
        setTimeout(poll, 50)
      }
      poll()
    })
  }
  private run(command: string): Promise<string[]> {
    const socket = this.socket
    if (!socket) return Promise.reject(new Error('IMAP is not connected'))
    const id = `A${++this.tag}`
    return new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`IMAP ${command.split(' ')[0]} timed out`)) }, this.timeout)
      this.waiting.set(id, { resolve: lines => { clearTimeout(timer); resolve(lines) }, reject: error => { clearTimeout(timer); reject(error) } })
      socket.write(`${id} ${command}${CRLF}`)
    })
  }
}

/**
 * Extracts messages from `FETCH` replies. A reply looks like `* 3 FETCH (UID 12 BODY[TEXT] {5}\r\nhello)`, and the body
 * may itself contain parentheses or complete lines, so literal byte lengths must be skipped while finding the outer pair.
 */
export function parseFetch(lines: string[]): ImapMessage[] {
  const out: ImapMessage[] = []
  const joined = lines.join('\r\n')
  const pattern = /^\*\s+(\d+)\s+FETCH\s+\(/gim
  let match: RegExpExecArray | null
  while ((match = pattern.exec(joined)) !== null) {
    const start = pattern.lastIndex
    let depth = 1
    let i = start
    let body: Buffer | undefined
    while (i < joined.length && depth > 0) {
      const literal = /^\{(\d+)\}\r\n/.exec(joined.slice(i))
      if (literal) {
        i += literal[0].length
        const size = Number(literal[1])
        if (i + size > joined.length) break
        // The transport represents literal bytes one-to-one as Latin-1 characters.
        if (!body) body = Buffer.from(joined.slice(i, i + size), 'latin1')
        i += size
        continue
      }
      if (joined[i] === '(') depth++
      else if (joined[i] === ')') depth--
      i++
    }
    if (depth === 0 && body) {
      out.push({ seq: Number(match[1]), body: body.toString('utf8'), raw: body })
      pattern.lastIndex = i
    }
  }
  return out
}
