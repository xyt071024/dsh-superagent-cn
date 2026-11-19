import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { ContextArchiver } from '../src/app/archive.ts'

function fixture(compactNow: (agent: unknown, signal: AbortSignal) => Promise<unknown>) {
  const scoped = { tokenMeter: { contextPressure: () => ({ pressureTokens: 80, contextWindow: 100 }) }, compaction: { compactNow } }
  const agent = { status: 'idle', session: {}, runMaintenance: () => {}, ctx: { get: (name: string) => scoped[name as keyof typeof scoped] } } as unknown as Agent
  const steer = vi.fn(async () => {})
  const report = vi.fn()
  const host = { context: { get: () => undefined } as unknown as Context, managed: () => [{ id: 'worker', agent }],
    budget: () => ({ enabled: true, percent: 65 }), steer, report,
    // No relay in this fixture: the archiver must fall through to compaction for a bare session id.
    ticketOf: (session: string) => session.startsWith('worker-') ? session.slice('worker-'.length) : undefined }
  return { archiver: new ContextArchiver(host), steer, report }
}

describe('context archiver lifecycle', () => {
  it('aborts the active compaction, waits for its cleanup and does not hand off after stopping', async () => {
    let signal!: AbortSignal
    let finish!: () => void
    const cleanup = new Promise<void>(resolve => { finish = resolve })
    const compact = vi.fn(async (_agent: unknown, next: AbortSignal) => { signal = next; await cleanup; return {} })
    const { archiver, steer } = fixture(compact)
    const tick = archiver.tick()
    await archiver.tick()
    expect(compact).toHaveBeenCalledTimes(1)
    let stopped = false
    const stop = archiver.stop().then(() => { stopped = true })
    expect(signal.aborted).toBe(true)
    await Promise.resolve()
    expect(stopped).toBe(false)
    finish(); await Promise.all([tick, stop])
    expect(steer).not.toHaveBeenCalled()
    await archiver.tick()
    expect(compact).toHaveBeenCalledTimes(1)
  })

  it('bounds shutdown if the host ignores cancellation and never starts another archive', async () => {
    vi.useFakeTimers()
    try {
      let finish!: () => void
      let received!: AbortSignal
      const compact = vi.fn((_agent: unknown, signal: AbortSignal) => {
        received = signal
        return new Promise(resolve => { finish = () => resolve({}) })
      })
      const { archiver, steer, report } = fixture(compact)
      const tick = archiver.tick()
      const stop = archiver.stop()
      expect(received.aborted).toBe(true)
      await vi.advanceTimersByTimeAsync(10_000)
      await stop
      expect(report).toHaveBeenCalledWith(expect.stringContaining('still running'), 'error')
      await archiver.tick()
      expect(compact).toHaveBeenCalledTimes(1)
      finish(); await tick
      expect(steer).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('times out a stuck archive, keeps its session isolated, and continues other sessions', async () => {
    vi.useFakeTimers()
    try {
      let finish!: () => void
      let firstSignal!: AbortSignal
      const compact = vi.fn(async (target: { session: { id: string } }, signal: AbortSignal) => {
        if (target.session.id === 'first') {
          firstSignal = signal
          return await new Promise(resolve => { finish = () => resolve({}) })
        }
        return {}
      })
      const services = { tokenMeter: { contextPressure: () => ({ pressureTokens: 80, contextWindow: 100 }) }, compaction: { compactNow: compact } }
      const agents = ['first', 'second'].map(id => ({ id, agent: { status: 'idle', session: { id }, runMaintenance: () => {},
        ctx: { get: (name: string) => services[name as keyof typeof services] } } as unknown as Agent }))
      const steer = vi.fn(async (_id: string, _requestId: string, _text: string) => {})
      const report = vi.fn()
      const archiver = new ContextArchiver({ context: { get: () => undefined } as unknown as Context,
        managed: () => agents, budget: () => ({ enabled: true, percent: 65 }), steer, report, ticketOf: (session: string) => session.startsWith('worker-') ? session.slice('worker-'.length) : undefined })
      const tick = archiver.tick()
      expect(compact).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(120_000)
      await tick
      expect(firstSignal.aborted).toBe(true)
      expect(compact).toHaveBeenCalledTimes(2)
      expect(steer).not.toHaveBeenCalled()
      await archiver.tick()
      expect(compact).toHaveBeenCalledTimes(2)
      finish(); await Promise.resolve(); await Promise.resolve()
      expect(steer).not.toHaveBeenCalled()
      await archiver.stop()
    } finally { vi.useRealTimers() }
  })

  it('does not repeatedly retry or steer when the host declines to compact', async () => {
    const compact = vi.fn(async () => null)
    const { archiver, steer, report } = fixture(compact)
    await archiver.tick()
    await archiver.tick()
    expect(compact).toHaveBeenCalledTimes(1)
    expect(steer).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalledWith(expect.stringContaining('archive was unavailable'), 'error')
    await archiver.stop()
  })

  it('hands off once after successful compaction and observes the cooldown', async () => {
    let pressure = 80
    const compact = vi.fn(async () => { pressure = 40; return {} })
    const services = { tokenMeter: { contextPressure: () => ({ pressureTokens: pressure, contextWindow: 100 }) }, compaction: { compactNow: compact } }
    const agent = { status: 'idle', session: {}, runMaintenance: () => {}, ctx: { get: (name: string) => services[name as keyof typeof services] } } as unknown as Agent
    const steer = vi.fn(async () => {})
    const archiver = new ContextArchiver({ context: { get: () => undefined } as unknown as Context, managed: () => [{ id: 'worker', agent }],
      budget: () => ({ enabled: true, percent: 65 }), steer, report: () => {}, ticketOf: (session: string) => session.startsWith('worker-') ? session.slice('worker-'.length) : undefined })
    await archiver.tick(); await archiver.tick()
    expect(compact).toHaveBeenCalledTimes(1)
    expect(steer).toHaveBeenCalledTimes(1)
    await archiver.stop()
  })

  it('does not repeatedly wake a worker when compaction fails to reduce context pressure', async () => {
    vi.useFakeTimers()
    try {
      const compact = vi.fn(async () => ({}))
      const { archiver, steer, report } = fixture(compact)
      await archiver.tick()
      await vi.advanceTimersByTimeAsync(180_000)
      await archiver.tick()
      expect(compact).toHaveBeenCalledTimes(1)
      expect(steer).not.toHaveBeenCalled()
      expect(report).toHaveBeenCalledWith(expect.stringContaining('did not reduce context pressure'), 'error')
      await archiver.stop()
    } finally { vi.useRealTimers() }
  })
})

describe('session relay', () => {
  const services = () => ({ tokenMeter: { contextPressure: () => ({ pressureTokens: 90, contextWindow: 100 }) },
    compaction: { compactNow: vi.fn(async () => ({})) } })
  const agentAt = () => {
    const scoped = services()
    return { status: 'idle', session: {}, runMaintenance: () => {},
      ctx: { get: (name: string) => scoped[name as keyof typeof scoped] } } as unknown as Agent
  }

  it('hands a ticket over to a new Session instead of compacting when the host can move it', async () => {
    const agent = agentAt()
    const relay = vi.fn(async () => ({ moved: 'worker-t1-r2' }))
    const compact = vi.fn(async () => ({}))
    const scoped = { tokenMeter: { contextPressure: () => ({ pressureTokens: 90, contextWindow: 100 }) }, compaction: { compactNow: compact } }
    const host = { context: { get: () => undefined } as unknown as Context,
      managed: () => [{ id: 'worker-t1', agent: { ...agent, ctx: { get: (n: string) => scoped[n as keyof typeof scoped] } } as unknown as Agent }],
      budget: () => ({ enabled: true, percent: 65 }), steer: vi.fn(async () => {}), report: vi.fn(),
      ticketOf: (s: string) => s.startsWith('worker-') ? s.slice('worker-'.length) : undefined, relay }
    await new ContextArchiver(host).tick()
    expect(relay).toHaveBeenCalledTimes(1)
    // The ticket moved, so the old Session must not also be compacted.
    expect(compact).not.toHaveBeenCalled()
  })

  it('falls back to compaction when the host refuses to move the ticket', async () => {
    const compact = vi.fn(async () => ({}))
    const scoped = { tokenMeter: { contextPressure: () => ({ pressureTokens: 90, contextWindow: 100 }) }, compaction: { compactNow: compact } }
    const host = { context: { get: () => undefined } as unknown as Context,
      managed: () => [{ id: 'worker-t2', agent: { status: 'idle', session: {}, runMaintenance: () => {},
        ctx: { get: (n: string) => scoped[n as keyof typeof scoped] } } as unknown as Agent }],
      budget: () => ({ enabled: true, percent: 65 }), steer: vi.fn(async () => {}), report: vi.fn(),
      ticketOf: (s: string) => s.startsWith('worker-') ? s.slice('worker-'.length) : undefined,
      relay: vi.fn(async () => ({ refused: 'a Team is attached' })) }
    await new ContextArchiver(host).tick()
    // A refused handover is not a failure: the work continues by shrinking in place.
    expect(compact).toHaveBeenCalledTimes(1)
  })

  it('never relays the main Session', async () => {
    const compact = vi.fn(async () => ({}))
    const scoped = { tokenMeter: { contextPressure: () => ({ pressureTokens: 90, contextWindow: 100 }) }, compaction: { compactNow: compact } }
    const relay = vi.fn(async () => ({ moved: 'x' as string }))
    const host = { context: { get: () => undefined } as unknown as Context,
      managed: () => [{ id: 'master', agent: { status: 'idle', session: {}, runMaintenance: () => {},
        ctx: { get: (n: string) => scoped[n as keyof typeof scoped] } } as unknown as Agent }],
      budget: () => ({ enabled: true, percent: 65 }), steer: vi.fn(async () => {}), report: vi.fn(),
      ticketOf: (s: string) => s.startsWith('worker-') ? s.slice('worker-'.length) : undefined, relay }
    await new ContextArchiver(host).tick()
    expect(relay).not.toHaveBeenCalled()
    expect(compact).toHaveBeenCalledTimes(1)
  })
})