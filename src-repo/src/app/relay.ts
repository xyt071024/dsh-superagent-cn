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
import type { RoleModel } from '../policy.ts'
import type { Store } from './store.ts'

/** How much of the old Session's transcript the summary carries, and how much of its assignment text. */
const TRANSCRIPT_CHARS = 12_000, ASSIGNMENT_CHARS = 4_000
/** Stages of a move that is still under way: one of these resumes as it stands instead of starting a generation. */
const IN_FLIGHT = ['prepared', 'created', 'summarised'] as const
/** How many of the most recent messages the summary quotes. */
const TRANSCRIPT_MESSAGES = 24
/** The line separator the handover texts are written with, named so a builder reads as one document. */
const NL = '\n'
/** What this module needs from `Sessions`; a narrow slice keeps the dependency one-way. */
export interface RelaySessions {
  ensure(id: string, cwd: string, title: string, role: 'orchestrator' | 'worker', hard?: boolean, ticketId?: string): Promise<Agent>
  ensureSubagent?(id: string, cwd: string, title: string, options: {
    parentId: string; ticketId?: string | undefined; slot?: number | undefined; model?: RoleModel | null | undefined; autoHard?: boolean | undefined
  }): Promise<Agent>
  ensureDivision?(id: string, cwd: string, title: string, options: {
    taskId: string; divisionId: string; model: RoleModel | null; autoHard?: boolean | undefined
  }): Promise<Agent>
  subagentContext?(agent: Agent): { parentId?: string; ticketId?: string; slot?: number; model: RoleModel | null; autoHard?: boolean }
  prompt(sessionId: string, requestId: string, text: string, mode: 'queue' | 'steer' | { inject: string }): Promise<void>
  holds(sessionId: string, requestId: string): Promise<boolean>
}
/** What this module needs from the runtime around it. */
export interface RelayHost {
  readonly context: Context
  readonly store: Pick<Store, 'get' | 'set' | 'delete' | 'keys' | 'atomic' | 'tickets'>
  readonly sessions: RelaySessions
  /** Writes the outcome where the operator can see it. */
  report(detail: string, state?: 'ready' | 'error'): void
  /**
   * Points every reader at the Session the main coordinator now runs on.
   *
   * The runtime owns both the current ID and its durable record; this module decides only when the move happens and
   * reports the outcome, so the two never disagree about which Session is current.
   */
  setMaster?(to: string): void
  /** Optional hook to resume pending division launches/deliveries whenever relay.resume() runs. */
  resumeDivisions?(): Promise<void>
  /** The directory every coordinator generation runs in (the state directory the runtime was started with). */
  readonly coordinatorCwd: string
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
  /**
   * Sessions this plugin has already moved away from, mapped to the Session a message typed into them belongs to.
   *
   * A moved-away Session's window can stay open, and a person typing there is addressing the ticket, not that history.
   * Without a route the words either run a second turn on finished work or vanish; both were reported. The route is
   * rebuilt from durable records at startup (`restoreRoutes`), so a restart does not reopen the hole.
   */
  private readonly routes = new Map<string, string>()

  constructor(private readonly host: RelayHost) {}

  /**
   * Where input typed into `sessionId` currently belongs, or the session itself when it has not been moved away from.
   *
   * Read by the inbox hook: a message delivered to a superseded Session is re-addressed to its newest generation.
   */
  route(sessionId: string): string { return this.routes.get(sessionId) ?? sessionId }

  /** Whether `sessionId` has been superseded by a handover, so the host may refuse to run it directly. */
  superseded(sessionId: string): boolean { return this.routes.has(sessionId) }

  /** 把历史代次与当前旧会话一律指向最新目标，确保 A→B→C 后输入仍直达 C。 */
  private recordRoutes(previous: readonly string[], fromSession: string, target: string): void {
    const dest = this.route(target)
    const oldTargets = new Set<string>([fromSession, ...previous])
    for (const [k, v] of this.routes) {
      if (oldTargets.has(v)) this.routes.set(k, dest)
    }
    for (const prev of previous) {
      if (prev !== dest) this.routes.set(prev, dest)
    }
    if (fromSession !== dest) this.routes.set(fromSession, dest)
    this.routes.delete(dest)
  }

  /**
   * Watches inbox activity so a message typed into a superseded Session still reaches the ticket's current one.
   *
   * Called once at startup. The commit-time `forward` only covers what was already queued at the instant of the
   * switch; a person's window stays open afterwards, and a message typed a minute later either started a second turn
   * on finished work or was lost. This hook is the durable half of that rule: the message is re-addressed under its own
   * id (so a repeated delivery adds nothing) and the superseded Session is stopped before it acts on work that moved.
   *
   * A host that predates the event leaves the commit-time forward as the only path, which is the previous behaviour.
   */
  install(): () => void {
    const disposers: (() => void)[] = []
    try {
      disposers.push(this.host.context.on('agent/inbox/claimed', ({ agent, message }: {
        agent: Agent; message: InboxMessage
      }) => {
        const mapped = this.routes.get(agent.id)
        if (mapped === undefined || message?.source?.kind !== 'user' || message.id === undefined) return
        const target = this.route(mapped)
        const text = (message.content ?? []).map(block => block.text ?? '').join('').trim()
        if (!text) return
        // The claim means a turn has started on the superseded Session, so it is stopped before it can act; the message
        // itself is not taken from it because a cancelled turn may already own it.
        agent.cancel({ kind: 'user' }, { keepInbox: true })
        const messageId = message.id
        void this.host.sessions.prompt(target, `forward:${messageId}`, text, 'queue')
          .then(() => { (agent as unknown as { inbox?: Inbox }).inbox?.remove?.(messageId) })
          .catch(error => this.host.report(`could not forward a message typed into ${agent.id} to ${target}: ${describe(error)}`, 'error'))
      }))
    } catch { /* No inbox event on this host: the commit-time forward stays the only path. */ }
    return () => { for (const dispose of disposers.splice(0)) dispose() }
  }

  /**
   * Rebuilds the superseded-Session routes from the durable relay records.
   *
   * Called once at startup next to `resume`: the routes are derived data, so a restart must not lose them.
   */
  restoreRoutes(): void {
    this.routes.clear()
    for (const name of this.host.store.keys(KV.sessions.relay)) {
      const record = this.host.store.get(name)
      if (!record || record.stage !== 'committed') continue
      for (const previous of record.previous) {
        if (previous !== record.current) this.routes.set(previous, record.current)
      }
      this.routes.delete(record.current)
    }
    const masterCurrent = this.host.store.get(KV.runtime.masterId)
    const masterPrevious = this.host.store.get(KV.runtime.masterPrevious) ?? []
    if (masterCurrent) {
      for (const prev of masterPrevious) {
        if (prev !== masterCurrent) this.routes.set(prev, masterCurrent)
      }
      this.routes.delete(masterCurrent)
    }
    for (const name of this.host.store.keys(KV.sessions.subagentRelay)) {
      const record = this.host.store.get(name)
      if (!record || record.stage !== 'committed') continue
      for (const previous of record.previous) {
        if (previous !== record.current) this.routes.set(previous, record.current)
      }
      this.routes.delete(record.current)
    }
    for (const name of this.host.store.keys(KV.sessions.divisions)) {
      const plan = this.host.store.get(name)
      if (!plan) continue
      for (const div of plan.divisions) {
        for (const prev of div.previousSessions) {
          if (prev !== div.sessionId) this.routes.set(prev, div.sessionId)
        }
        this.routes.delete(div.sessionId)
      }
    }
  }

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
      if (!record || record.stage === 'failed' || record.stage === 'idle') continue
      if (record.stage === 'committed') {
        if (record.pendingActivation) {
          const { target, generation } = record.pendingActivation
          await this.serialize(ticketId, async () => {
            await this.activate(ticketId, target, generation)
          }).catch(error => {
            this.host.report(`relay activation for ${ticketId} could not be resumed: ${describe(error)}`, 'error')
          })
        }
        continue
      }
      await this.serialize(ticketId, async () => {
        const result = await this.advance(ticketId, record)
        const settled = store.get(KV.sessions.relay(ticketId))
        if ('moved' in result) this.host.report(`relay for ${ticketId} resumed onto ${settled?.current ?? result.moved}`)
        return result
      }).catch(error => {
        this.host.report(`relay for ${ticketId} could not be resumed: ${describe(error)}`, 'error')
      })
    }
    const masterPending = store.get(KV.runtime.masterActivation)
    if (masterPending) {
      await this.serialize('master', async () => {
        await this.activateMaster(masterPending.target, masterPending.generation)
      }).catch(error => {
        this.host.report(`main Session activation could not be resumed: ${describe(error)}`, 'error')
      })
    }
    for (const name of store.keys(KV.sessions.subagentRelay)) {
      const rootKey = name.slice(KV.sessions.subagentRelay.prefix.length)
      const record = store.get(KV.sessions.subagentRelay(rootKey))
      if (!record || record.stage === 'failed' || record.stage === 'idle') continue
      if (record.stage === 'committed' && record.pendingActivation) {
        const { target, generation } = record.pendingActivation
        await this.serialize(`subagent:${rootKey}`, async () => {
          await this.activateSubagent(rootKey, target, generation)
        }).catch(error => {
          this.host.report(`subagent activation for ${rootKey} could not be resumed: ${describe(error)}`, 'error')
        })
      }
    }
    for (const name of store.keys(KV.sessions.divisions)) {
      const plan = store.get(name)
      if (!plan) continue
      for (const div of plan.divisions) {
        if (!div.pendingActivation) continue
        const { target, generation } = div.pendingActivation
        const taskId = plan.taskId
        const divisionId = div.divisionId
        await this.serialize(`division:${taskId}:${divisionId}`, async () => {
          await this.activateDivision(taskId, divisionId, target, generation)
        }).catch(error => {
          this.host.report(`division activation for ${taskId}:${divisionId} could not be resumed: ${describe(error)}`, 'error')
        })
      }
    }
    await this.host.resumeDivisions?.().catch(error => {
      this.host.report(`division plans could not be resumed: ${describe(error)}`, 'error')
    })
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
        //
        // The summary goes in as a NOTICE, not as a queued prompt. A queued prompt wakes an idle Session, which then
        // starts a turn on the ticket while the ticket's pointer still names the old Session: for that window two
        // Sessions run the same work, and the second one cannot be recalled because its turn already began. A notice
        // is written into the new Session's history without waking it, so the summary is durable and verified here and
        // only an explicit activation after the commit can start it (see `activate`).
        const requestId = record.requestId ?? ''
        if (!await sessions.holds(target, requestId)) await sessions.prompt(target, requestId, summary, { inject: 'handover from the earlier Session' })
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
        const generation = record.generation ?? 1
        // The commit is the one write that moves the ticket: `current` becomes the target in the same record that
        // records the move, so no reader ever sees a committed record still pointing at the old Session. The summary is
        // dropped here because it now lives in the new Session's own history.
        const committed: Relay = { ...record, current: target, previous, stage: 'committed', at: new Date().toISOString(),
          target: undefined, summary: undefined, requestId: undefined, held: false, pendingActivation: { target, generation } }
        // The pointer changes in one transaction, so no reader sees a record naming a Session it cannot use.
        store.atomic(() => this.save(ticketId, committed))
        // The superseded Session's route is part of the commit, not an afterthought: every earlier generation is updated
        // directly to the newest target so A→B→C routes A directly to C across restarts too.
        this.recordRoutes(previous, record.current, target)
        this.host.report(`${record.current}: relayed to ${target} with ${Math.round(summary.length / 1024)} KB of handover`
          + ` (generation ${generation})`)
        // Only now, with the pointer already naming the target, may the new Session start working. Activation is
        // idempotent (its request id carries the generation), so a crash or transient failure is repaired by `resume`
        // until `pendingActivation` is cleared.
        await this.activate(ticketId, target, generation)
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
   * Hands the main coordinator's work to a fresh Session when its context window fills.
   *
   * The main coordinator is a Session, so the operator's rule — "every Session continues in a new one at 60%" — has to
   * cover it too; before this it was the one Session that only ever compacted in place. It owns no ticket, so it shares
   * none of the ticket machinery in `move`; what it does share is the ordering rule, which is what actually matters:
   *
   * 1. the summary is written into the new Session as a notice, so it is durable and readable but starts no turn;
   * 2. the current ID is switched and persisted, so every reader now addresses the new Session;
   * 3. only then is the new Session woken, under a request id that names its generation.
   *
   * Refused while the old Session is not idle, while it has a live Team or unfinished shared tasks, or while a person
   * has typed into it and no turn has taken the message up: the same reasons a ticket move is refused, because the
   * same thing would be lost.
   */
  moveCoordinator(fromSession: string, percent: number): Promise<MoveResult> {
    return this.serialize('master', async () => {
      const { store } = this.host
      const current = store.get(KV.runtime.masterId) ?? fromSession
      if (current !== fromSession) return { refused: `the main Session already runs on ${current}, not ${fromSession}` }
      const lead = this.host.context.agents.get(fromSession as SessionId)
      if (!lead) return { refused: `the main Session ${fromSession} is not loaded` }
      if (lead.status !== 'idle') return { refused: `the main Session is still ${lead.status}` }
      const bound = this.bound(lead)
      if (bound !== undefined) return { refused: bound }
      const typed = this.typed(lead)
      if (typed !== undefined) return { refused: `a message typed into the main Session has not been taken up: ${typed}` }
      const previous = store.get(KV.runtime.masterPrevious) ?? []
      const generation = previous.length + 1
      const target = `orchestrator-r${generation}-${key(fromSession, String(generation)).slice(0, 8)}`
      const requestId = `handover:master:g${generation}`
      const summary = await this.digestCoordinator(fromSession, percent, generation)
      if (summary === undefined) {
        const why = "the main Session's transcript could not be read, so there is no summary to hand over"
        this.host.report(`main Session handover refused — ${why}`, 'error')
        return { refused: why }
      }
      try {
        await this.host.sessions.ensure(target, this.workingDirectory(), 'dsh-superagent orchestrator', 'orchestrator')
        if (!await this.host.sessions.holds(target, requestId)) await this.host.sessions.prompt(target, requestId, summary, { inject: 'handover from the earlier main Session' })
        if (!await this.host.sessions.holds(target, requestId)) {
          const why = `the summary did not reach ${target}`
          this.host.report(`main Session handover stopped: ${why}; it stays on ${fromSession}`, 'error')
          return { refused: why }
        }
        // The switch and its record are one write, so no reader sees a current ID whose history is not durable.
        const nextPrevious = [...previous.filter(id => id !== target && id !== fromSession), fromSession]
        store.atomic(() => {
          store.set(KV.runtime.masterPrevious, nextPrevious)
          store.set(KV.runtime.masterId, target)
          store.set(KV.runtime.masterActivation, { target, generation })
        })
        this.host.setMaster?.(target)
        this.recordRoutes(nextPrevious, fromSession, target)
        this.host.report(`main Session handed over to ${target} at ${Math.round(percent * 100)}% of its context window`)
        // Only now may the new Session start: before the switch it would be a second coordinator on the same work.
        await this.activateMaster(target, generation)
        this.forward(fromSession, target)
        return { moved: target }
      } catch (error) {
        const why = describe(error)
        this.host.report(`main Session handover stopped: ${why}; it stays on ${fromSession}`, 'error')
        return { refused: why }
      }
    })
  }

  /** The directory every coordinator generation runs in, taken from the runtime that created the first one. */
  private workingDirectory(): string { return this.host.coordinatorCwd }

  /**
   * The handover text for the main coordinator.
   *
   * Shorter than a ticket's and different in shape: the coordinator's value is the conversation with the person and the
   * orders it has taken, not a task transcript. The live ticket board is included because that is what the next
   * generation has to act on — a handover that omits "what is currently running" makes the fresh Session ask again.
   */
  private async digestCoordinator(fromSession: string, percent: number, generation: number): Promise<string | undefined> {
    let events: readonly { type: string; data: unknown }[]
    try { events = (await this.host.context.sessionController.inspect(fromSession as SessionId)).events } catch { return undefined }
    const recent: string[] = []
    for (const event of events) {
      if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
      const data = event.data as { message?: { content?: unknown }; content?: unknown }
      const body = textOf(event.type === 'user/message' ? data : data.message)
      if (!body) continue
      recent.push(`${event.type === 'user/message' ? 'the person said' : 'the coordinator said'}: ${body}`)
    }
    const tickets = this.host.store.tickets.list().filter(ticket => !ticket.ended)
    const head = [
      `This is coordinator generation ${generation} of the same deployment, continuing because the earlier main`
      + ` Session filled ${Math.round(percent * 100)}% of its context window. This is a handover, not a restart: the`
      + ' conversation below already happened, so do not re-ask what it answers.',
      '',
      '## Work currently open',
      ...tickets.length === 0 ? ['- (no open ticket)']
        : tickets.slice(0, 20).map(ticket => {
          const latest = ticket.assignments.at(-1)
          const waiting = ticket.attention ? `, waiting on: ${ticket.attention.question}` : ''
          return `- ${ticket.id}: ${ticket.title} (last assignment ${latest?.state ?? 'none'}${waiting})`
        }),
      '',
      '## The conversation so far',
    ]
    const foot = ['', 'Carry on from here. Address the person as before; the panel now shows this Session.']
    const budget = TRANSCRIPT_CHARS - head.join(NL).length - foot.join(NL).length
    const tail = fit(recent.slice(-TRANSCRIPT_MESSAGES).join(NL + NL) || '(the earlier main Session recorded no messages)', Math.max(1_000, budget), 'the end')
    return [...head, tail, ...foot].join(NL)
  }

  /**
   * Starts the new Session on the work that has just been committed to it.
   *
   * Called only after the pointer already names the target, so there is no window in which the target runs while the
   * ticket still points at the old Session — the failure this replaced was a target that woke on the queued summary
   * before the switch, leaving two Sessions on one ticket and no way to recall the second.
   *
   * The wake-up carries the generation in its request id, so a resume after a crash mid-activation delivers once: a
   * target that already holds this generation's activation is not woken again.
   */
  private async activate(ticketId: string, target: string, generation: number): Promise<void> {
    const requestId = `activate:${ticketId}:g${generation}`
    try {
      const clearPending = () => {
        const current = this.host.store.get(KV.sessions.relay(ticketId))
        if (current?.pendingActivation?.target === target && current.pendingActivation.generation === generation) {
          this.save(ticketId, { ...current, pendingActivation: undefined })
        }
      }
      if (await this.host.sessions.holds(target, requestId)) { clearPending(); return }
      await this.host.sessions.prompt(target, requestId,
        'The handover summary above is the state of this ticket. Continue from it; do not redo completed steps.', 'queue')
      clearPending()
    } catch (error) {
      // The pointer is already committed, so a failed wake-up must not look like a failed move: the target keeps the
      // summary in its history and the operator is told, rather than the ticket silently staying idle.
      this.host.report(`handover for ${ticketId} committed to ${target}, but it could not be woken: ${describe(error)}`, 'error')
    }
  }

  private async activateMaster(target: string, generation: number): Promise<void> {
    const requestId = `activate:master:g${generation}`
    try {
      if (!await this.host.sessions.holds(target, requestId)) {
        await this.host.sessions.prompt(target, requestId,
          'The handover summary above is the state of this ticket. Continue from it; do not redo completed steps.', 'queue')
      }
      const pending = this.host.store.get(KV.runtime.masterActivation)
      if (pending?.target === target && pending.generation === generation) {
        this.host.store.delete(KV.runtime.masterActivation)
      }
    } catch (error) {
      this.host.report(`handover for master committed to ${target}, but it could not be woken: ${describe(error)}`, 'error')
    }
  }

  private async activateSubagent(rootKey: string, target: string, generation: number): Promise<void> {
    const requestId = `activate:subagent:${rootKey}:g${generation}`
    try {
      const clearPending = () => {
        const current = this.host.store.get(KV.sessions.subagentRelay(rootKey))
        if (current?.pendingActivation?.target === target && current.pendingActivation.generation === generation) {
          this.host.store.set(KV.sessions.subagentRelay(rootKey), { ...current, pendingActivation: undefined })
        }
      }
      if (await this.host.sessions.holds(target, requestId)) { clearPending(); return }
      await this.host.sessions.prompt(target, requestId,
        'The handover summary above is the state of this subagent task. Continue from it; do not redo completed steps.', 'queue')
      clearPending()
    } catch (error) {
      this.host.report(`subagent handover for ${rootKey} committed to ${target}, but it could not be woken: ${describe(error)}`, 'error')
    }
  }

  private async activateDivision(taskId: string, divisionId: string, target: string, generation: number): Promise<void> {
    const requestId = `activate:division:${taskId}:${divisionId}:g${generation}`
    try {
      const clearPending = () => {
        this.host.store.atomic(() => {
          const latest = this.host.store.get(KV.sessions.divisions(taskId))
          const div = latest?.divisions.find(item => item.divisionId === divisionId)
          if (latest && div?.pendingActivation?.target === target && div.pendingActivation.generation === generation) {
            delete div.pendingActivation
            div.updatedAt = new Date().toISOString()
            latest.updatedAt = div.updatedAt
            this.host.store.set(KV.sessions.divisions(taskId), latest)
          }
        })
      }
      if (!this.host.context.agents.get(target as SessionId) && this.host.sessions.ensureDivision) {
        const plan = this.host.store.get(KV.sessions.divisions(taskId))
        const div = plan?.divisions.find(item => item.divisionId === divisionId)
        if (plan && div) {
          await this.host.sessions.ensureDivision(target, plan.directory, `${div.title} (r${generation})`, {
            taskId, divisionId, model: div.model, autoHard: plan.complexity.hard,
          })
        }
      }
      if (await this.host.sessions.holds(target, requestId)) { clearPending(); return }
      await this.host.sessions.prompt(target, requestId,
        'The handover summary above is the state of this division. Continue from it; do not redo completed steps.', 'queue')
      clearPending()
    } catch (error) {
      this.host.report(`division ${divisionId} committed to ${target}, but wake-up failed: ${describe(error)}`, 'error')
    }
  }

  /**
   * 子会话达到 60% 阈值时的接力迁移（M06）：保留父子关系、模型槽位、所属工单与共享状态，并在提交后更新路由。
   */
  moveSubagent(fromSession: string, percent: number): Promise<MoveResult> {
    return this.serialize(`subagent:${fromSession}`, async () => {
      const { store, sessions } = this.host
      if (!sessions.ensureSubagent || !sessions.subagentContext) {
        return { refused: 'subagent relay is unavailable on this host' }
      }
      const agent = this.host.context.agents.get(fromSession as SessionId)
      if (!agent) return { refused: `subagent Session ${fromSession} is not loaded` }
      if (agent.status !== 'idle') return { refused: `subagent Session is still ${agent.status}` }
      const bound = this.bound(agent)
      if (bound !== undefined) return { refused: bound }
      const typed = this.typed(agent)
      if (typed !== undefined) return { refused: `a message typed into the subagent Session has not been taken up: ${typed}` }

      let rootKey = fromSession
      let existing: Relay | undefined
      for (const name of store.keys(KV.sessions.subagentRelay)) {
        const candidate = store.get(name)
        if (candidate?.current === fromSession) {
          rootKey = name.slice(KV.sessions.subagentRelay.prefix.length)
          existing = candidate
          break
        }
      }
      const subCtx = sessions.subagentContext(agent)
      if (!subCtx.parentId) return { refused: `subagent ${fromSession} has no parent session` }
      const previous = existing?.previous ?? []
      const generation = (existing?.generation ?? 0) + 1
      const target = `subagent-${key(rootKey, String(generation)).slice(0, 12)}-r${generation}`
      const requestId = `handover:subagent:${rootKey}:g${generation}`
      const summary = await this.digestSubagent(fromSession, percent, generation, subCtx)
      if (summary === undefined) {
        const why = "the subagent Session's transcript could not be read, so there is no summary to hand over"
        this.host.report(`subagent handover refused — ${why}`, 'error')
        return { refused: why }
      }
      try {
        const cwd = (agent.session.header as { cwd?: string }).cwd ?? this.workingDirectory()
        const rawTitle = (agent.session.header as { title?: string }).title
        const title = rawTitle ? `${rawTitle} (r${generation})` : `Subagent ${rootKey.slice(0, 8)} (r${generation})`
        await sessions.ensureSubagent(target, cwd, title, {
          parentId: subCtx.parentId, ticketId: subCtx.ticketId, slot: subCtx.slot, model: subCtx.model, autoHard: subCtx.autoHard,
        })
        if (!await sessions.holds(target, requestId)) {
          await sessions.prompt(target, requestId, summary, { inject: 'handover from the earlier subagent Session' })
        }
        if (!await sessions.holds(target, requestId)) {
          const why = `the summary did not reach ${target}`
          this.host.report(`subagent handover stopped: ${why}; it stays on ${fromSession}`, 'error')
          return { refused: why }
        }
        const nextPrevious = [...previous.filter(id => id !== target && id !== fromSession), fromSession]
        const committed: Relay = {
          current: target, previous: nextPrevious, stage: 'committed', at: new Date().toISOString(),
          generation, held: false, pendingActivation: { target, generation },
        }
        store.atomic(() => store.set(KV.sessions.subagentRelay(rootKey), committed))
        this.recordRoutes(nextPrevious, fromSession, target)
        this.host.report(`subagent ${fromSession} handed over to ${target} (slot ${subCtx.slot ?? 'none'}, parent ${subCtx.parentId})`)
        await this.activateSubagent(rootKey, target, generation)
        this.forward(fromSession, target)
        return { moved: target }
      } catch (error) {
        const why = describe(error)
        this.host.report(`subagent handover stopped: ${why}; it stays on ${fromSession}`, 'error')
        return { refused: why }
      }
    })
  }

  /**
   * 独立分工会话（M07）达到 60% 阈值时的接力迁移：保留同一槽位、模型、依赖与任务归属。
   */
  moveDivision(taskId: string, divisionId: string, fromSession: string, percent: number): Promise<MoveResult> {
    return this.serialize(`division:${taskId}:${divisionId}`, async () => {
      const { store, sessions } = this.host
      if (!sessions.ensureDivision) return { refused: 'division relay is unavailable on this host' }
      const plan = store.get(KV.sessions.divisions(taskId))
      const div = plan?.divisions.find(item => item.divisionId === divisionId)
      if (!plan || !div) return { refused: `division ${divisionId} no longer exists` }
      if (div.sessionId !== fromSession) return { refused: `division already runs on ${div.sessionId}, not ${fromSession}` }
      const agent = this.host.context.agents.get(fromSession as SessionId)
      if (!agent) return { refused: `division Session ${fromSession} is not loaded` }
      if (agent.status !== 'idle') return { refused: `division Session is still ${agent.status}` }
      const bound = this.bound(agent)
      if (bound !== undefined) return { refused: bound }
      const typed = this.typed(agent)
      if (typed !== undefined) return { refused: `a message typed into the division Session has not been taken up: ${typed}` }

      const generation = div.generation + 1
      const target = `div-${key(`${taskId}:${divisionId}`, String(generation)).slice(0, 12)}-r${generation}`
      const requestId = `handover:division:${taskId}:${divisionId}:g${generation}`
      const summary = await this.digestDivision(plan, div, fromSession, percent, generation)
      if (summary === undefined) {
        const why = "the division Session's transcript could not be read, so there is no summary to hand over"
        this.host.report(`division handover refused — ${why}`, 'error')
        return { refused: why }
      }
      try {
        await sessions.ensureDivision(target, plan.directory, `${div.title} (r${generation})`, {
          taskId, divisionId, model: div.model, autoHard: plan.complexity.hard,
        })
        if (!await sessions.holds(target, requestId)) {
          await sessions.prompt(target, requestId, summary, { inject: 'handover from the earlier division Session' })
        }
        if (!await sessions.holds(target, requestId)) {
          return { refused: `the summary did not reach ${target}` }
        }
        const nextPrevious = [...div.previousSessions.filter(id => id !== target && id !== fromSession), fromSession]
        store.atomic(() => {
          const latest = store.get(KV.sessions.divisions(taskId))
          if (!latest) return
          const targetDiv = latest.divisions.find(item => item.divisionId === divisionId)
          if (!targetDiv) return
          targetDiv.sessionId = target
          targetDiv.previousSessions = nextPrevious
          targetDiv.generation = generation
          targetDiv.pendingActivation = { target, generation }
          targetDiv.updatedAt = new Date().toISOString()
          latest.updatedAt = targetDiv.updatedAt
          store.set(KV.sessions.divisions(taskId), latest)
          store.set(KV.sessions.divisionOwner(target), { taskId, divisionId })
        })
        this.recordRoutes(nextPrevious, fromSession, target)
        this.host.report(`division ${divisionId} (${fromSession}) handed over to ${target} (slot ${div.slot}, gen ${generation})`)
        await this.activateDivision(taskId, divisionId, target, generation)
        this.forward(fromSession, target)
        return { moved: target }
      } catch (error) {
        const why = describe(error)
        this.host.report(`division handover stopped: ${why}; it stays on ${fromSession}`, 'error')
        return { refused: why }
      }
    })
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
    // A host that mounts no Team service has no roster and no board, which is not an error and not a reason to stay.
    let teams: TeamService | undefined
    try { teams = this.service<TeamService>('agentTeams', agent.ctx) } catch { teams = undefined }
    if (teams === undefined) return undefined
    let members: readonly TeamMember[]
    try { members = teams.listMembers?.(agent) ?? [] } catch (error) {
      // A roster that exists but cannot be read is reported rather than read as "no teammates": assuming a Team is
      // absent when it is merely unreadable is exactly how a handover would abandon live work.
      return `the Team roster could not be read (${describe(error)})`
    }
    const others = members.filter(member => member.role !== 'lead' && member.id !== agent.id)
    // Only a member that is doing something, or about to, is a reason to stay: an inactive teammate's work is finished
    // and recorded in the transcript like everything else.
    const busy = others.filter(member => member.status === 'running' || member.status === 'provisioning')
    if (busy.length > 0) {
      return `${busy.length} Team member(s) are still working in the old Session`
        + ` (${busy.map(member => `${member.name || member.id}:${member.status}`).slice(0, 3).join(', ')})`
    }
    // A teammate's status and a shared task's status are two independent facts. An idle member can still own work that
    // is in progress, and that task board lives with the Session that created it — moving the ticket would leave the
    // work behind with nobody reading it. Only a claimed task in an unfinished state is a reason to stay; a finished
    // one is recorded in the transcript like everything else.
    const tasks = this.openTasks(teams, agent)
    if (tasks.error !== undefined) {
      return `the shared task board could not be read (${tasks.error})`
    }
    if (tasks.blocked.length > 0) {
      return `${tasks.blocked.length} shared task(s) are still unfinished in the old Session`
        + ` (${tasks.blocked.slice(0, 3).map(task => `${task.subject || task.id}:${task.status}`).join(', ')})`
    }
    return undefined
  }

  /**
   * Unfinished shared tasks belonging to the Session's Team, read from the host when it exposes them.
   *
   * `listTasks` is a separate service from `listMembers` (a host may supply either), and a task's own status is what
   * says whether work is outstanding. Failing to read the board is not taken as "no tasks": a board that cannot be read
   * while a Team exists is reported, and the handover is refused, because the alternative is silently abandoning work.
   */
  private openTasks(teams: TeamService | undefined, agent: Agent): { blocked: TeamTask[]; unassigned: TeamTask[]; error?: string } {
    if (!teams?.listTasks) return { blocked: [], unassigned: [] }
    let rows: readonly TeamTask[]
    try { rows = teams.listTasks(agent) ?? [] } catch (error) { return { blocked: [], unassigned: [], error: describe(error) } }
    const blocked: TeamTask[] = []
    const unassigned: TeamTask[] = []
    for (const task of rows) {
      if (task.status === undefined || FINISHED_TASK.has(task.status)) continue
      if (task.ownerId !== undefined || task.status === 'in_progress') blocked.push(task)
      else unassigned.push(task)
    }
    return { blocked, unassigned }
  }

  /** 读取旧会话尚未认领的开放共享任务，以便在交接摘要中完整迁移（若读取失败则返回 undefined 阻断交接）。 */
  private readUnassignedTasks(sessionId: string): TeamTask[] | undefined {
    const agent = this.host.context.agents.get(sessionId as SessionId)
    if (!agent) return []
    let teams: TeamService | undefined
    try { teams = this.service<TeamService>('agentTeams', agent.ctx) } catch { teams = undefined }
    if (!teams?.listTasks) return []
    const result = this.openTasks(teams, agent)
    return result.error === undefined ? result.unassigned : undefined
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
      const messageId = message.id
      const dest = this.route(toSession)
      moved++
      void this.host.sessions.prompt(dest, `forward:${messageId}`, text, 'queue')
        .then(() => { inbox?.remove?.(messageId) })
        .catch(error => this.host.report(`could not forward a message from ${fromSession} to ${dest}: ${describe(error)}`, 'error'))
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
    const unassigned = this.readUnassignedTasks(fromSession)
    if (unassigned === undefined) return undefined
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
      ...unassigned.length ? ['', '## Unassigned shared tasks carried over',
        ...unassigned.slice(0, 20).map(task => `- [${task.id}] ${task.subject || task.id} (${task.status ?? 'pending'})`)] : [],
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

  private async digestSubagent(fromSession: string, percent: number, generation: number, subCtx: {
    parentId?: string; ticketId?: string; slot?: number; model: RoleModel | null
  }): Promise<string | undefined> {
    let events: readonly { type: string; data: unknown }[]
    try { events = (await this.host.context.sessionController.inspect(fromSession as SessionId)).events } catch { return undefined }
    const unassigned = this.readUnassignedTasks(fromSession)
    if (unassigned === undefined) return undefined
    const recent: string[] = []
    for (const event of events) {
      if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
      const data = event.data as { message?: { content?: unknown }; content?: unknown }
      const body = textOf(event.type === 'user/message' ? data : data.message)
      if (!body) continue
      recent.push(`${event.type === 'user/message' ? 'parent/user said' : 'subagent said'}: ${body}`)
    }
    const ticket = subCtx.ticketId ? this.host.store.tickets.get(subCtx.ticketId) : undefined
    const head = [
      `This is subagent generation ${generation} continuing from ${fromSession} after it filled ${Math.round(percent * 100)}% of its context window.`,
      `- parent session: ${subCtx.parentId ?? '(unknown)'}`,
      ...subCtx.ticketId ? [`- ticket: ${subCtx.ticketId}${ticket ? ` ("${ticket.title}")` : ''}`] : [],
      ...subCtx.slot !== undefined ? [`- model slot: ${subCtx.slot}${subCtx.model ? ` (${subCtx.model.provider}/${subCtx.model.model})` : ''}`] : [],
      ...unassigned.length ? ['', '## Unassigned shared tasks carried over',
        ...unassigned.slice(0, 20).map(task => `- [${task.id}] ${task.subject || task.id} (${task.status ?? 'pending'})`)] : [],
      '',
      '## The earlier subagent Session\'s recent history',
    ]
    const foot = ['', 'Continue from here and report findings/results to the parent session as instructed.']
    const budget = TRANSCRIPT_CHARS - head.join(NL).length - foot.join(NL).length
    const tail = fit(recent.slice(-TRANSCRIPT_MESSAGES).join(NL + NL) || '(the earlier subagent Session recorded no messages)', Math.max(1_000, budget), 'the end')
    return [...head, tail, ...foot].join(NL)
  }

  private async digestDivision(plan: import('../kv.ts').TaskPlan, div: import('../kv.ts').DivisionRecord, fromSession: string, percent: number, generation: number): Promise<string | undefined> {
    let events: readonly { type: string; data: unknown }[]
    try { events = (await this.host.context.sessionController.inspect(fromSession as SessionId)).events } catch { return undefined }
    const recent: string[] = []
    for (const event of events) {
      if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
      const data = event.data as { message?: { content?: unknown }; content?: unknown }
      const body = textOf(event.type === 'user/message' ? data : data.message)
      if (!body) continue
      recent.push(`${event.type === 'user/message' ? 'user/coordinator said' : 'division said'}: ${body}`)
    }
    const head = [
      `This Session continues division "${div.title}" (${div.divisionId}) of task ${plan.taskId} ("${plan.title}") generation ${generation}, because ${fromSession} filled ${Math.round(percent * 100)}% of its context window.`,
      `- slot: ${div.slot}${div.model ? ` (${div.model.provider}/${div.model.model})` : ''}`,
      `- working directory: ${plan.directory}`,
      `- status before handover: ${div.status}${div.latestProgress ? ` — ${div.latestProgress}` : ''}`,
      '',
      '## Division brief',
      fit(div.brief, ASSIGNMENT_CHARS, 'the start'),
      '',
      '## The earlier division Session\'s recent history',
    ]
    const foot = ['', 'Continue from here. Report progress and results using orchestrator_division_report.']
    const budget = TRANSCRIPT_CHARS - head.join(NL).length - foot.join(NL).length
    const tail = fit(recent.slice(-TRANSCRIPT_MESSAGES).join(NL + NL) || '(no messages recorded before handover)', Math.max(1_000, budget), 'the end')
    return [...head, tail, ...foot].join(NL)
  }
}

/** One entry of the Agent Teams roster, as the bundled service returns it. */
interface TeamMember { id: string; name?: string; role?: string; status?: string }
/**
 * One entry of the Team's shared task board.
 *
 * A host may run one board per Team or one per deployment, so the scope is not assumed: `listTasks` is asked for the
 * Session's own view and whatever it returns is that Session's board. `ownerId` names the member doing the work.
 */
interface TeamTask { id: string; subject?: string; status?: string; ownerId?: string }
/** The parts of the `agentTeams` host service this module reads. Either method may be absent on an older host. */
interface TeamService {
  listMembers?(agent: Agent): readonly TeamMember[]
  listTasks?(agent: Agent): readonly TeamTask[]
}
/** Task states that mean the work is over; anything else is outstanding. */
const FINISHED_TASK = new Set(['completed', 'done', 'failed', 'cancelled', 'canceled', 'archived', 'deleted'])
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
