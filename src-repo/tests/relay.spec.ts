/**
 * The Session handover, exercised through the real Runtime, its store and its Session controller rather than a mock of
 * the relay: the earlier tests proved only that the archiver calls whatever it is given. What has to hold is that a
 * ticket's work really reaches a new Session, that the summary is built from the old Session's own transcript, that the
 * pointer moves only once the new Session holds it, and that a refused or interrupted move leaves a working ticket.
 */
import { describe, expect, it, vi } from 'vitest'
import { KV } from '../src/kv.ts'
import { sessionOf, ticketOfSession, validSessionId } from '../src/executor/dsh.ts'
import { startRuntime, feishu, type Host } from './fixtures/host.ts'

/**
 * The handover summaries a Session holds, newest last.
 *
 * A summary is delivered as a notice: it is written into the new Session's history without starting a turn, which is
 * what keeps the target from running before the ticket's pointer has switched. So it is read from the inject calls,
 * not from the queued deliveries (whose one entry is the wake-up that carries no history).
 */
const summariesOf = (host: Host, sessionId: string): string[] => (host.agents.get(sessionId)?.inject.mock.calls ?? [])
  .map(call => JSON.stringify(call[0]))

/** Gives a Session the two services the archiver measures and compacts with, and a context pressure to measure. */
function measure(host: Host, sessionId: string, pressure: number, onCompact = () => {}) {
  const agent = host.agents.get(sessionId)
  if (!agent) throw new Error(`no agent ${sessionId}`)
  const services = {
    tokenMeter: { contextPressure: () => ({ pressureTokens: pressure, contextWindow: 100 }) },
    compaction: { compactNow: vi.fn(async () => { onCompact(); return {} }) },
  }
  const original = (agent as unknown as { ctx: { get: (name: string) => unknown } }).ctx.get.bind((agent as unknown as { ctx: unknown }).ctx)
  vi.spyOn((agent as unknown as { ctx: { get: (name: string) => unknown } }).ctx, 'get').mockImplementation(((name: string) =>
    name in services ? services[name as keyof typeof services] : original(name)) as never)
  Object.assign(agent as object, { runMaintenance: () => {} })
  return services
}

/**
 * Every text the archiver reports from now on.
 *
 * Health keeps only its latest entry, so a refusal followed by the compaction's own outcome would hide the reason the
 * handover was declined; recording the stream keeps what the operator saw as it happened.
 */
function collect(host: Host): string[] {
  const reports: string[] = []
  const archiver = host.runtime.archiver as unknown as { host: { report: (detail: string, state?: string) => void } }
  const original = archiver.host.report
  archiver.host.report = (detail, state) => { reports.push(detail); original(detail, state) }
  return reports
}

/**
 * An accepted ticket with a worker sitting idle, which is where a handover can start: the archiver only measures a
 * Session with no turn in flight, exactly as a filled-up context is measured between turns in a real deployment.
 */
async function working(host: Host, text = 'Please fix the regression in widgets') {
  const { ticket, sessionId } = await host.acceptedTicket(feishu('1', text))
  const agent = host.agents.get(sessionId)
  if (!agent) throw new Error(`no worker ${sessionId}`)
  agent.status = 'idle'
  return { ticket, sessionId }
}

describe('session identity', () => {
  it('recognises a handed-over Session from its owner record, not from its name', async () => {
    const host = await startRuntime()
    try {
      const { ticket } = await working(host)
      const relayed = `worker-${ticket.id}-r${Date.now().toString(36)}abcdef`
      // Before the owner record exists a generation suffix cannot be resolved, which is exactly why names are unusable.
      expect(ticketOfSession(host.runtime.store, relayed)).toBeUndefined()
      host.runtime.store.set(KV.sessions.owner(relayed), ticket.id)
      expect(ticketOfSession(host.runtime.store, relayed)).toBe(ticket.id)
      expect(ticketOfSession(host.runtime.store, `worker-${ticket.id}`)).toBe(ticket.id)
    } finally { await host.stop() }
  })

  it('refuses to create a Session whose name a durable store cannot carry', async () => {
    const host = await startRuntime()
    try {
      const { ticket } = await working(host)
      // The shape a multi-line template literal produced: the value begins and ends with a newline.
      const broken = `\nworker-${ticket.id}-r1\n`
      expect(validSessionId(broken)).toBe(false)
      await expect(host.runtime.sessions.ensure(broken, host.directory, ticket.title, 'worker', false, ticket.id))
        .rejects.toThrow(/not a usable name/)
      await expect(host.runtime.sessions.ensure(`worker-${ticket.id}-ok`, host.directory, ticket.title, 'worker', false, undefined))
        .rejects.toThrow(/without its ticket/)
    } finally { await host.stop() }
  })

  it('records a worker Session owner so the ticket survives a name that carries a generation', async () => {
    const host = await startRuntime()
    try {
      const { ticket, sessionId } = await working(host)
      expect(host.runtime.store.get(KV.sessions.owner(sessionId))).toBe(ticket.id)
      expect(ticketOfSession(host.runtime.store, sessionId)).toBe(ticket.id)
    } finally { await host.stop() }
  })
})

describe('handing a ticket over', () => {
  it('moves the work to a new Session and builds the handover from the old transcript', async () => {
    const host = await startRuntime()
    try {
      const { ticket, sessionId } = await working(host)
      // What the old Session knew, which nothing else in the store records.
      const inspected = (host.controller.inspect as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue
      inspected({ events: [
        { type: 'user/message', data: { content: [{ type: 'text', text: 'Assignment: fix the widgets regression' }] } },
        { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'I traced it to the retry guard in widgets.ts and have not committed yet.' }] } } },
      ] })
      const services = measure(host, sessionId, 90)
      await host.runtime.archiver.tick()
      const record = host.runtime.store.get(KV.sessions.relay(ticket.id))
      expect(record?.stage).toBe('committed')
      const moved = record!.current
      expect(moved).not.toBe(sessionId)
      // The name a durable store gets is one it can carry back.
      expect(validSessionId(moved)).toBe(true)
      expect(sessionOf(host.runtime.store, ticket.id)).toBe(moved)
      expect(ticketOfSession(host.runtime.store, moved)).toBe(ticket.id)
      // The ticket moved, so the old Session must not also have been compacted.
      expect(services.compaction.compactNow).not.toHaveBeenCalled()
      // The summary the new Session holds is the old one's own history, not a fixed sentence. It is written into the
      // new Session's history as a notice (so it starts no turn), which is why it is read from the inject calls.
      const delivered = summariesOf(host, moved)
      expect(delivered).toHaveLength(1)
      expect(delivered[0]!).toContain('widgets.ts')
      expect(delivered[0]!).toContain('not committed yet')
      expect(delivered[0]!).toContain(ticket.id)
      expect(delivered[0]!).toMatch(/handover, not a restart/)
      // And the target is woken only after the ticket already points at it.
      expect(host.deliveries.mock.calls.map(([call]) => call).filter(call => call.sessionId === moved)
        .some(call => call.text.includes('The handover summary above is the state of this ticket'))).toBe(true)
    } finally { await host.stop() }
  })

  it('keeps the ticket on the old Session when it holds undelivered input', async () => {
    const host = await startRuntime()
    try {
      const { ticket, sessionId } = await working(host)
      const current = host.runtime.store.tickets.get(ticket.id)!
      host.runtime.store.tickets.save({ ...current, undelivered: ['input-still-waiting'] })
      const services = measure(host, sessionId, 90)
      const reports = collect(host)
      await host.runtime.archiver.tick()
      // No record at all: a move that was refused must not leave a pointer a later reader could follow.
      expect(host.runtime.store.get(KV.sessions.relay(ticket.id))).toBeUndefined()
      expect(sessionOf(host.runtime.store, ticket.id)).toBe(sessionId)
      // Refused is not failed: the work continues by shrinking in place.
      expect(services.compaction.compactNow).toHaveBeenCalledTimes(1)
      expect(reports.join(' | ')).toMatch(/still waiting for the old Session/)
    } finally { await host.stop() }
  })

  it('refuses the move when the old Session cannot be read, rather than claiming history', async () => {
    const host = await startRuntime()
    try {
      const { ticket, sessionId } = await working(host)
      ;(host.controller.inspect as unknown as { mockRejectedValue: (value: unknown) => void }).mockRejectedValue(new Error('session store unreadable'))
      const services = measure(host, sessionId, 90)
      const reports = collect(host)
      await host.runtime.archiver.tick()
      expect(host.runtime.store.get(KV.sessions.relay(ticket.id))).toBeUndefined()
      expect(sessionOf(host.runtime.store, ticket.id)).toBe(sessionId)
      expect(services.compaction.compactNow).toHaveBeenCalledTimes(1)
      expect(reports.join(' | ')).toMatch(/no summary to hand over/)
    } finally { await host.stop() }
  })
})

describe('a move interrupted by a crash', () => {
  /** A record left at `stage` by a process that stopped, as the store would hold it after that process died. */
  const seeded = (stage: 'prepared' | 'created' | 'summarised', ticketId: string, target: string, requestId: string) =>
    ({ current: `worker-${ticketId}`, previous: [], target, stage, at: new Date().toISOString(), requestId,
      summary: 'HANDOVER: monthly report is half finished, do not resend the invoice email.' })

  it('closes a record whose ticket is gone as failed instead of leaving it mid-move', async () => {
    const host = await startRuntime(store => {
      store.set(KV.sessions.relay('planted-ticket'), seeded('prepared', 'planted-ticket', 'worker-planted-ticket-r1abc', 'relay:planted-ticket:1'))
    })
    try {
      // A record naming a ticket the store does not hold must be closed with its reason kept, never left mid-move where
      // a later reader could route to a Session that does not exist.
      await host.runtime.relay.resume()
      const record = host.runtime.store.get(KV.sessions.relay('planted-ticket'))!
      expect(record.stage).toBe('failed')
      expect(record.error).toMatch(/no longer exists/)
    } finally { await host.stop() }
  })

  it('resumes a move that had already reached the created stage, delivering the summary once', async () => {
    const host = await startRuntime()
    try {
      const { ticket, sessionId } = await working(host)
      const target = `worker-${ticket.id}-rresume`
      const requestId = `relay:${ticket.id}:resume`
      // The state a crash between creating the target and delivering the summary leaves behind.
      host.runtime.store.set(KV.sessions.owner(target), ticket.id)
      host.runtime.store.set(KV.sessions.relay(ticket.id), seeded('created', ticket.id, target, requestId) as never)
      await host.runtime.relay.resume()
      const record = host.runtime.store.get(KV.sessions.relay(ticket.id))!
      expect(record.stage).toBe('committed')
      expect(record.current).toBe(target)
      expect(sessionOf(host.runtime.store, ticket.id)).toBe(target)
      const delivered = summariesOf(host, target)
      expect(delivered).toHaveLength(1)
      expect(delivered[0]!).toContain('do not resend the invoice email')
      // Running the resume again must not deliver a second copy.
      await host.runtime.relay.resume()
      expect(summariesOf(host, target)).toHaveLength(1)
      expect(sessionId).not.toBe(target)
    } finally { await host.stop() }
  })

  it('never routes to the target while the summary is still being delivered', async () => {
    const host = await startRuntime()
    try {
      const { ticket } = await working(host)
      const target = `worker-${ticket.id}-rpending`
      const requestId = `relay:${ticket.id}:pending`
      host.runtime.store.set(KV.sessions.owner(target), ticket.id)
      host.runtime.store.set(KV.sessions.relay(ticket.id), seeded('prepared', ticket.id, target, requestId) as never)
      // A prepared record has a target but no Session yet: every routing decision must still answer the old Session.
      const before = sessionOf(host.runtime.store, ticket.id)
      expect(before).not.toBe(target)
      expect(before).toBe(`worker-${ticket.id}`)
    } finally { await host.stop() }
  })
})

describe('a stale measurement', () => {
  it('reports the ticket as already elsewhere instead of claiming a move it did not make', async () => {
    const host = await startRuntime()
    try {
      const { ticket, sessionId } = await working(host)
      // The ticket is committed to a Session this caller did not measure.
      host.runtime.store.set(KV.sessions.relay(ticket.id), { current: 'worker-somewhere-else', previous: [], stage: 'idle', at: '' })
      const answer = await (host.runtime.relay as unknown as { move: (t: string, f: string, p: number) => Promise<unknown> })
        .move(ticket.id, sessionId, 0.9)
      expect(answer).toEqual({ refused: `the ticket already runs on worker-somewhere-else, not ${sessionId}` })
    } finally { await host.stop() }
  })
})


describe('generations', () => {
  it('gives each handover a new Session instead of reusing the last target', async () => {
    const host = await startRuntime()
    try {
      const { ticket, sessionId } = await working(host)
      const first = await (host.runtime.relay as unknown as { move: (t: string, f: string, p: number) => Promise<unknown> })
        .move(ticket.id, sessionId, 0.9)
      expect(first).toHaveProperty('moved')
      const second = sessionOf(host.runtime.store, ticket.id)
      expect(second).not.toBe(sessionId)
      const agent = host.agents.get(second)
      if (agent) agent.status = 'idle'
      const again = await (host.runtime.relay as unknown as { move: (t: string, f: string, p: number) => Promise<unknown> })
        .move(ticket.id, second, 0.9)
      expect(again).toHaveProperty('moved')
      // A committed move's target must never become the next move's target: that would hand the ticket to itself.
      expect(sessionOf(host.runtime.store, ticket.id)).not.toBe(second)
      expect(host.runtime.store.get(KV.sessions.relay(ticket.id))?.generation).toBeGreaterThanOrEqual(2)
    } finally { await host.stop() }
  })
})

describe('a Team roster', () => {
  it('does not veto a handover because the lead is listed among its own members', async () => {
    const host = await startRuntime()
    try {
      const { ticket, sessionId } = await working(host)
      // The bundled service always lists the lead first, even with no teammate at all.
      host.ctx.reflect.provide('agentTeams' as never, {
        listMembers: () => [{ id: sessionId, name: 'lead', role: 'lead', status: 'inactive' }],
      } as never)
      const answer = await (host.runtime.relay as unknown as { move: (t: string, f: string, p: number) => Promise<unknown> })
        .move(ticket.id, sessionId, 0.9)
      expect(answer).toHaveProperty('moved')
    } finally { await host.stop() }
  })

  it('still refuses while a real teammate is working', async () => {
    const host = await startRuntime()
    try {
      const { ticket, sessionId } = await working(host)
      host.ctx.reflect.provide('agentTeams' as never, {
        listMembers: () => [{ id: sessionId, name: 'lead', role: 'lead', status: 'running' },
          { id: 'member-1', name: 'reviewer', role: 'teammate', status: 'running' }],
      } as never)
      const answer = await (host.runtime.relay as unknown as { move: (t: string, f: string, p: number) => Promise<unknown> })
        .move(ticket.id, sessionId, 0.9)
      expect(answer).toHaveProperty('refused')
      expect(JSON.stringify(answer)).toMatch(/still working in the old Session/)
    } finally { await host.stop() }
  })
})

describe('the handover budget', () => {
  it('keeps the newest line of history when the transcript is far over budget', async () => {
    const host = await startRuntime()
    try {
      const { ticket, sessionId } = await working(host)
      const filler = 'x'.repeat(1100)
      ;(host.controller.inspect as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
        events: Array.from({ length: 24 }, (_, index) => ({ type: 'assistant/message', data: { message: { content: [
          { type: 'text', text: `message ${index}: ${filler}${index === 23 ? ' NEWEST_PROGRESS_MARKER' : ''}` }] } } })) } as never)
      const answer = await (host.runtime.relay as unknown as { move: (t: string, f: string, p: number) => Promise<unknown> })
        .move(ticket.id, sessionId, 0.9)
      expect(answer).toHaveProperty('moved')
      const target = sessionOf(host.runtime.store, ticket.id)
      const text = summariesOf(host, target)[0]!
      // The last thing the old Session said is where the work stopped, so a trimmed handover must keep it.
      expect(text).toContain('NEWEST_PROGRESS_MARKER')
      expect(text).toMatch(/omitted/)
    } finally { await host.stop() }
  })
})

describe('a refused commit', () => {
  it('stops the prepared target so two workers never run one ticket', async () => {
    const host = await startRuntime()
    try {
      const { ticket, sessionId } = await working(host)
      const prompt = host.runtime.sessions.prompt.bind(host.runtime.sessions)
      let armed = true
      vi.spyOn(host.runtime.sessions, 'prompt').mockImplementation(async (...args: Parameters<typeof prompt>) => {
        await prompt(...args)
        if (armed && args[0] !== sessionId) {
          armed = false
          // Input lands after the summary was delivered but before the pointer commits.
          const current = host.runtime.store.tickets.get(ticket.id)!
          host.runtime.store.tickets.save({ ...current, undelivered: ['arrived-during-delivery'] })
        }
      })
      const answer = await (host.runtime.relay as unknown as { move: (t: string, f: string, p: number) => Promise<unknown> })
        .move(ticket.id, sessionId, 0.9)
      expect(answer).toHaveProperty('refused')
      const record = host.runtime.store.get(KV.sessions.relay(ticket.id))!
      const target = record.target!
      expect(sessionOf(host.runtime.store, ticket.id)).toBe(sessionId)
      // The target received the summary, so it was awake; the refusal must put it back to sleep.
      expect(host.agents.get(target)?.status).not.toBe('running')
    } finally { await host.stop() }
  })
})
