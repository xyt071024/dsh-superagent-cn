/**
 * Handing a ticket's work from a filled-up Session to a fresh one.
 *
 * Why this is its own module: the move spans several asynchronous steps (read the old transcript, persist a summary,
 * create the new Session, deliver the summary, switch the pointer), and any of them can fail or be interrupted by a
 * process crash or by a person typing into the old Session. A move that only assigns a new name and hopes is worse than
 * no move at all: every routing decision in this plugin follows the pointer, so a pointer switched too early sends
 * prompts, reviews and stops to a Session that may not exist or may hold no history.
 *
 * The rules this module keeps:
 *
 * 1. `current` is the only field anything routes to, and it changes once per move, at commit, after the new Session
 *    verifiably holds the summary. While a move is in flight `current` is still the old Session, so a crash mid-move
 *    leaves a working ticket rather than a phantom one.
 * 2. The summary is built from what the store and the old Session's persisted events actually say, and is persisted
 *    before the new Session exists. A fixed sentence claiming "history is attached" is not a summary.
 * 3. Every step is recorded, so a restart resumes a half-finished move instead of repeating it; delivery uses one
 *    request id per move, so a resumed delivery cannot put the summary in twice.
 * 4. A move is refused — leaving the ticket where it is, with the reason reported — while the ticket has undelivered
 *    input, while the old Session has a live Team or running subagents, or while a person has typed into the old Session
 *    and the message has not been taken up.
 * 5. Input a person puts into the old Session after the switch is forwarded to the new one rather than dropped.
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import { KV, type Relay } from '../kv.ts'
import { key, type Ticket } from '../core/index.ts'
import type { Store } from './store.ts'

/** How much of the old Session's transcript the summary carries, and how much of its assignment text. */
const TRANSCRIPT_CHARS = 12_000, ASSIGNMENT_CHARS = 4_000
/** Stages of a move that is still under way: one of these resumes as it stands instead of starting a generation. */
const IN_FLIGHT = ['prepared', 'created', 'summarised'] as const
/** How many of the most recent messages the summary quotes. */
const TRANSCRIPT_MESSAGES = 24
/** What this module needs from `Sessions`; a narrow slice keeps the dependency one-way. */
export interface RelaySessions {
  ensure(id: string, cwd: string, title: string, role: 'orchestrator' | 'worker', hard?: boolean, ticketId?: string): Promise<Agent>
  prompt(sessionId: string, requestId: string, text: string, mode: 'queue' | 'steer'): Promise<void>
  holds(sessionId: string, requestId: string): Promise<boolean>
}
/** What this module needs from the runtime around it. */
export interface RelayHost {
  readonly context: Context
  readonly store: Pick<Store, 'get' | 'set' | 'keys' | 'atomic' | 'tickets'>
  readonly sessions: RelaySessions
  /** Writes the outcome where the operator can see it. */
  report(detail: string, state?: 'ready' | 'error'): void
}
/** The outcome of one move attempt. */
export type MoveResult = { moved: string } | { refused: string }

/**
 * Moves one ticket between Sessions, once at a time per ticket.
 *
 * `move` is safe to call repeatedly: a record already committed answers at once, and a record a crash left at a middle
 * stage is carried forward from that stage rather than restarted.
 */
export class SessionRelay {
  /** Per-ticket serialization: a switch, a delivery, a stop and the startup scan never interleave on one ticket. */
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(private readonly host: RelayHost) {}

  /** Runs `work` after every earlier call for `ticketId` settled, whether it resolved or threw. */
  private serialize<T>(ticketId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(ticketId) ?? Promise.resolve()
    const next = previous.then(work, work)
    this.queues.set(ticketId, next.catch(() => undefined))
    return next
  }

  /**
   * Hand `ticketId`'s work from `fromSession` to a fresh Session.
   *
   * Returns the Session the ticket is committed to afterwards, or the reason it stayed put. A refusal is not an error:
   * the caller keeps working on the old Session and says why, which is what the operator sees.
   */
  move(ticketId: string, fromSession: string, percent: number): Promise<MoveResult> {
    return this.serialize(ticketId, async () => {
      const { store } = this.host
      const ticket = store.tickets.get(ticketId)
      if (!ticket) return { refused: `ticket ${ticketId} no longer exists` }
      if (ticket.ended) return { refused: `ticket ${ticketId} has ended` }
      // A ticket only moves from the Session it is committed to. A caller measuring some other Session is holding a
      // stale reading, so its answer is "this ticket is already elsewhere", not "your move succeeded": saying `moved`
      // here would report a handover the archiver did not perform.
      const record = store.get(KV.sessions.relay(ticketId))
      const current = record?.current ?? fromSession
      if (current !== fromSession) return { refused: `the ticket already runs on ${current}, not ${fromSession}` }
      if (ticket.undelivered.length > 0) {
        return { refused: `${ticket.undelivered.length} message(s) are still waiting for the old Session` }
      }
      const lead = this.host.context.agents.get(fromSession as SessionId)
      if (!lead) return { refused: `the old Session ${fromSession} is not loaded` }
      if (lead.status !== 'idle') return { refused: `the old Session is still ${lead.status}` }
      const bound = this.bound(lead)
      if (bound !== undefined) return { refused: bound }
      const typed = this.typed(lead)
      if (typed !== undefined) return { refused: `a message typed into the old Session has not been taken up: ${typed}` }

      // A move already under way is resumed as it stands; only a finished one starts a new generation. Reusing a
      // committed move's target would make the ticket hand itself to the Session it is already on.
      const resuming = record !== undefined && (IN_FLIGHT as readonly string[]).includes(record.stage) && record.target !== undefined
      const generation = resuming ? record.generation ?? 0 : (record?.generation ?? 0) + 1
      const target = resuming ? record.target! : this.targetId(ticketId, generation)
      const requestId = resuming && record?.requestId ? record.requestId : `relay:${ticketId}:g${generation}`
      let working: Relay = resuming
        ? { ...record!, target, requestId }
        : { current: fromSession, previous: record?.previous ?? [], target, stage: 'idle', at: new Date().toISOString(), requestId, generation,
          ...record?.error ? {} : {} }
      if (working.stage === 'idle' || working.stage === 'failed') {
        const summary = await this.digest(ticket, fromSession, percent)
        if (summary === undefined) {
          const why = 'the old Session\'s transcript could not be read, so there is no summary to hand over'
          this.host.report(`${fromSession}: handover refused — ${why}`, 'error')
          return { refused: why }
        }
        working = { ...working, summary, stage: 'prepared', at: new Date().toISOString() }
        this.save(ticketId, working)
      }
      return this.advance(ticketId, working)
    })
  }

  /**
   * Resume every move a previous process left unfinished.
   *
   * Called once at startup, before workers and passes begin, so no routing decision runs against a half-moved ticket.
   * A record left at a middle stage is carried forward; a committed or failed one is left as it is.
   */
  async resume(): Promise<void> {
    const { store } = this.host
    for (const name of store.keys(KV.sessions.relay)) {
      const ticketId = name.slice(KV.sessions.relay.prefix.length)
      const record = store.get(KV.sessions.relay(ticketId))
      if (!record || record.stage === 'committed' || record.stage === 'failed' || record.stage === 'idle') continue
      await this.serialize(ticketId, async () => {
        const result = await this.advance(ticketId, record)
        const settled = store.get(KV.sessions.relay(ticketId))
        if ('moved' in result) this.host.report(`relay for ${ticketId} resumed onto ${settled?.current ?? result.moved}`)
        return result
      }).catch(error => {
        this.host.report(`relay for ${ticketId} could not be resumed: ${error instanceof Error ? error.message : String(error)}`, 'error')
      })
    }
  }

  /**
   * Carry one record forward from the step it reached: create the target, deliver the summary, commit the pointer.
   *
   * Each step persists before the next starts, so a failure at any point leaves a record that says what is done and the
   * ticket still committed to the old Session.
   */
  private async advance(ticketId: string, start: Relay): Promise<MoveResult> {
    const { store, sessions } = this.host
    let record = start
    const fail = (why: string): MoveResult => {
      this.save(ticketId, { ...record, stage: 'failed', error: why, at: new Date().toISOString() })
      this.host.report(`handover for ${ticketId} stopped: ${why}; the ticket stays on ${record.current}`, 'error')
      return { refused: why }
    }
    // Both are fixed for the whole move; narrowing them once here keeps every step below from re-checking.
    const target = record.target, summary = record.summary
    if (!target || !summary) return fail('the record names no target Session or no summary')
    if (target === record.current) return fail(`the record names the Session the ticket is already on (${target})`)
    const ticket = store.tickets.get(ticketId)
    if (!ticket) return fail(`ticket ${ticketId} no longer exists`)
    try {
      // Every stage re-establishes what it depends on instead of trusting the stage word: a target deleted, an owner
      // record lost or a summary never persisted before a crash is repaired here rather than committed over.
      if (record.stage === 'prepared' || record.stage === 'created' || record.stage === 'summarised') {
        await sessions.ensure(target, ticket.execution?.directory ?? process.cwd(), ticket.title, 'worker', false, ticketId)
        if (record.stage === 'prepared') {
          record = { ...record, stage: 'created', at: new Date().toISOString() }
          this.save(ticketId, record)
        }
      }
      if (record.stage === 'created' || record.stage === 'summarised') {
        // A resumed delivery must not put the summary in twice, so the request id is the one recorded with the move.
        const requestId = record.requestId ?? ''
        if (!await sessions.holds(target, requestId)) await sessions.prompt(target, requestId, summary, 'queue')
        if (!await sessions.holds(target, requestId)) return fail(`the summary did not reach ${target}`)
        if (record.stage === 'created') {
          record = { ...record, stage: 'summarised', at: new Date().toISOString() }
          this.save(ticketId, record)
        }
      }
      if (record.stage === 'summarised') {
        // The last look before the switch, re-read now rather than at the top of the move: input that arrived while the
        // summary was being delivered, a stop, or someone typing into the old Session keeps the ticket where it is.
        const latest = store.tickets.get(ticketId)
        if (!latest || latest.ended) return this.abandon(ticketId, record, 'the ticket changed while the handover was being prepared')
        if (latest.undelivered.length > 0) {
          return this.abandon(ticketId, record, `${latest.undelivered.length} message(s) arrived while the handover was in flight`)
        }
        const old = this.host.context.agents.get(record.current as SessionId)
        if (record.current !== target && old !== undefined) {
          const typed = this.typed(old)
          if (typed !== undefined) return this.abandon(ticketId, record, `a message typed into the old Session has not been taken up: ${typed}`)
        }
        const previous = [...record.previous.filter(id => id !== target && id !== record.current), record.current]
        // The commit is the one write that moves the ticket: `current` becomes the target in the same record that
        // records the move, so no reader ever sees a committed record still pointing at the old Session. The summary is
        // dropped here because it now lives in the new Session's own history.
        const committed: Relay = { ...record, current: target, previous, stage: 'committed', at: new Date().toISOString(),
          target: undefined, summary: undefined, requestId: undefined, held: false }
        // The pointer changes in one transaction, so no reader sees a record naming a Session it cannot use.
        store.atomic(() => this.save(ticketId, committed))
        this.host.report(`${record.current}: relayed to ${target} with ${Math.round(summary.length / 1024)} KB of handover`
          + ` (generation ${record.generation ?? 1})`)
        this.forward(record.current, target)
        return { moved: target }
      }
      return { moved: record.current }
    } catch (error) {
      return this.abandon(ticketId, record, describe(error))
    }
  }

  /**
   * Stop a move that will not commit, and make sure the prepared target does not keep working.
   *
   * The summary is delivered before the commit so the new Session has something to act on the moment it is woken; if
   * the commit is then refused, that Session is already awake and would run the same task beside the old one. It is
   * cancelled and reported, and the ticket stays on the old Session with the reason recorded.
   */
  private abandon(ticketId: string, record: Relay, why: string): MoveResult {
    this.save(ticketId, { ...record, stage: 'failed', error: why, at: new Date().toISOString(), held: false })
    const target = record.target
    if (target !== undefined && target !== record.current) {
      const agent = this.host.context.agents.get(target as SessionId)
      // Cancelled, not disposed: its transcript records that the handover reached it, which the next attempt reuses.
      agent?.cancel({ kind: 'user' }, { keepInbox: true })
    }
    this.host.report(`handover for ${ticketId} stopped: ${why}; the ticket stays on ${record.current}`, 'error')
    return { refused: why }
  }

  /**
   * A name for the replacement Session: one per generation, and free of anything a durable store or a URL cannot carry.
   *
   * The generation counter rather than a clock: two handovers in the same millisecond must still differ, and a resumed
   * move must land on the same name it committed to writing before the crash.
   */
  private targetId(ticketId: string, generation: number): string {
    return `worker-${ticketId}-r${generation}-${key(ticketId, String(generation)).slice(0, 8)}`
  }

  /** Persists one record. */
  private save(ticketId: string, record: Relay): void { this.host.store.set(KV.sessions.relay(ticketId), record) }

  /**
   * Why the old Session cannot be left behind, or `undefined` when it can.
   *
   * A Team's roster and shared task board live with the Session that spawned them, so a real teammate means the work is
   * not only in the transcript. The roster is read from the host, never assumed — and it always begins with the lead
   * itself (`{ id: root.id, name: 'lead', role: 'lead' }`), so counting the list's length would veto every handover
   * forever, including the common case of a Session with no teammates at all.
   *
   * The status values are the service's own (`running` / `inactive` / `provisioning` / `failed`), not a guess.
   */
  private bound(agent: Agent): string | undefined {
    const teams = this.service<{ listMembers(agent: Agent): readonly TeamMember[] }>('agentTeams', agent.ctx)
    const members = [...teams?.listMembers?.(agent) ?? []]
    const others = members.filter(member => member.role !== 'lead' && member.id !== agent.id)
    if (others.length === 0) return undefined
    // Only a member that is doing something, or about to, is a reason to stay: an inactive teammate's work is finished
    // and recorded in the transcript like everything else.
    const busy = others.filter(member => member.status === 'running' || member.status === 'provisioning')
    if (busy.length === 0) return undefined
    return `${busy.length} Team member(s) are still working in the old Session`
      + ` (${busy.map(member => `${member.name || member.id}:${member.status}`).slice(0, 3).join(', ')})`
  }

  /**
   * Reads an optional host service from a Session's own scope first.
   *
   * `agentTeams` is mounted inside a group declaring `isolate: { agentTeams: true }`, so a lookup from this plugin's
   * root context cannot see it; the Agent's context can. The root stays as a fallback for a deployment that does not
   * isolate it.
   */
  private service<T>(name: string, scope?: Context): T | undefined {
    for (const ctx of [scope, this.host.context]) {
      if (!ctx) continue
      try {
        const found = ctx.get(name as never) as T | undefined
        if (found) return found
      } catch { /* A service absent from this scope throws rather than returning undefined. */ }
    }
    return undefined
  }

  /** A message a person typed into the old Session that no turn has taken up yet, by its first words. */
  private typed(agent: Agent): string | undefined {
    const inbox = (agent as unknown as { inbox?: Inbox }).inbox
    const human = [...inbox?.nextTurn ?? [], ...inbox?.nextStep ?? []].find(message => message.source?.kind === 'user')
    if (!human) return undefined
    return human.content?.map(block => block.text ?? '').join('').trim().slice(0, 80) || '(empty message)'
  }

  /**
   * Moves what a person typed into the old Session to the new one, and stops the old one from acting on the rest.
   *
   * The ticket's own input never arrives this way — it is addressed to `sessionOf(store, ticket)`, which is the new
   * Session — but a message typed straight into the old Session's window does. Dropping it would lose a person's words,
   * and leaving it to run would start a second turn on work that has moved, so it is re-delivered under its own id and
   * then taken out of the old inbox: a repeated forward re-delivers nothing.
   */
  private forward(fromSession: string, toSession: string): void {
    const agent = this.host.context.agents.get(fromSession as SessionId)
    if (!agent) return
    const inbox = (agent as unknown as { inbox?: Inbox }).inbox
    const typed = [...inbox?.nextTurn ?? [], ...inbox?.nextStep ?? []]
      .filter(message => message.source?.kind === 'user' && message.id !== undefined)
    // The Session object is kept, not disposed: its transcript is the record of the work that moved.
    agent.cancel({ kind: 'user' }, { keepInbox: true })
    let moved = 0
    for (const message of typed) {
      const text = message.content?.map(block => block.text ?? '').join('').trim()
      if (!text || message.id === undefined) continue
      inbox?.remove?.(message.id)
      moved++
      void this.host.sessions.prompt(toSession, `forward:${message.id}`, text, 'queue')
        .catch(error => this.host.report(`could not forward a message from ${fromSession} to ${toSession}: ${describe(error)}`, 'error'))
    }
    if (moved > 0) this.host.report(`${moved} message(s) typed into ${fromSession} were forwarded to ${toSession}`)
  }

  /**
   * The handover text: what the ticket asked for, what has been done, what is left, and what the old Session last said.
   *
   * Everything here is read from the durable ticket or from the old Session's persisted events. When the transcript
   * cannot be read the move is refused instead of handing over a summary that omits the history it claims to carry.
   */
  private async digest(ticket: Ticket, fromSession: string, percent: number): Promise<string | undefined> {
    let events: readonly { type: string; data: unknown }[]
    try {
      events = (await this.host.context.sessionController.inspect(fromSession as SessionId)).events
    } catch { return undefined }
    const recent: string[] = []
    for (const event of events) {
      if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
      // Both events carry a message, but not at the same depth: user/message data is the message itself, while
      // assistant/message data wraps one. Reading the wrong depth yields a message rather than its blocks, which is how
      // an earlier attempt produced a summary that silently dropped every line of history.
      const data = event.data as { message?: { content?: unknown }; content?: unknown }
      const body = textOf(event.type === 'user/message' ? data : data.message)
      if (!body) continue
      recent.push(`${event.type === 'user/message' ? 'worker was told' : 'worker said'}: ${body}`)
    }
    const latest = ticket.assignments.at(-1)
    const report = latest?.report
    // Each part gets its own budget and is trimmed from its own old end. Slicing the assembled text instead is what
    // dropped the newest progress: the tail is written last, so a plain truncation removes exactly the part that says
    // where the work actually stopped.
    const head = [
      `This Session continues ticket ${ticket.id} ("${ticket.title}") in the same working directory, because its`
      + ` earlier Session filled ${Math.round(percent * 100)}% of its context window. This is a handover, not a restart:`
      + ' the work below already happened, so do not redo it.',
      '',
      '## What the ticket asked for',
      fit((ticket.execution?.assignment ?? '').trim() || '(the ticket records no assignment text)', ASSIGNMENT_CHARS, 'the start'),
      '',
      '## Where it stands',
      `- assignments so far: ${ticket.assignments.length}`
      + (latest ? `; the latest is ${latest.state}${report ? `, last reporting "${report.state}: ${report.summary}"` : ''}` : ''),
      `- working directory: ${ticket.execution?.directory ?? '(not chosen yet)'}`,
      `- mandate strength: ${ticket.mandate.strength}`,
      ...ticket.attention ? [`- waiting on a person: ${ticket.attention.question}`] : [],
      ...ticket.undelivered.length ? [`- messages not yet delivered: ${ticket.undelivered.length}`] : [],
      '',
      '## The earlier Session\'s recent history',
    ]
    const foot = ['', 'Continue from here. Report to the main Session with orchestrator_report as usual.']
    // The history keeps its newest lines: the most recent message is where the work stopped.
    const budget = TRANSCRIPT_CHARS - head.join('\n').length - foot.join('\n').length
    const tail = fit(recent.slice(-TRANSCRIPT_MESSAGES).join('\n\n')
      || '(the earlier Session recorded no messages before the handover)', Math.max(1_000, budget), 'the end')
    return [...head, tail, ...foot].join('\n')
  }
}

/** One entry of the Agent Teams roster, as the bundled service returns it. */
interface TeamMember { id: string; name?: string; role?: string; status?: string }
/** The part of a Session's inbox this module reads: what is queued, and whether the agent could act on it. */
interface Inbox {
  nextTurn: readonly InboxMessage[]
  nextStep: readonly InboxMessage[]
  remove?(id: string): boolean
}
interface InboxMessage { id?: string; source?: { kind?: string }; content?: readonly { type: string; text?: string }[] }

/**
 * Cuts `text` to `limit` characters from the side that matters, and says so.
 *
 * A silent cut is what loses the newest progress: the reader cannot tell a complete handover from a trimmed one, so
 * the note that something was dropped is part of the value, not decoration.
 */
function fit(text: string, limit: number, keep: 'the start' | 'the end'): string {
  if (text.length <= limit) return text
  const notice = `\n…(${text.length - limit} characters omitted; this is an excerpt, ${keep} kept)`
  const room = Math.max(0, limit - notice.length)
  return (keep === 'the start' ? text.slice(0, room) + notice : notice + '\n…' + text.slice(text.length - room))
}

/** The text of a message, whichever shape a persisted event gives it: a block list, a message, or a bare string. */
function textOf(message: unknown): string {
  const content = (message as { content?: unknown } | undefined)?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return (content as { type?: string; text?: string }[]).filter(block => block?.type === 'text').map(block => block.text ?? '').join('\n').trim()
}

/**
 * A readable reason for anything thrown.
 *
 * Host failures are not always `Error`s: a Session-domain failure arrives as a plain `{ code, message }` object, and
 * `String()` renders that as "[object Object]" — an unreadable reason in the one place the operator needs to read it.
 */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  const shaped = error as { message?: unknown; code?: unknown }
  if (typeof shaped?.message === 'string' && shaped.message) return String(shaped.code ? `${shaped.code}: ${shaped.message}` : shaped.message)
  if (typeof shaped?.code === 'string') return shaped.code
  try { return JSON.stringify(error) } catch { return String(error) }
}
