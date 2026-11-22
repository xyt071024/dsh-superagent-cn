import { expect, it, vi } from 'vitest'
import { startRuntime } from './fixtures/host.ts'

it('the main Session is handed over at the threshold instead of compacted in place', async () => {
  const host = await startRuntime()
  try {
    // The main Session by its id, not by position: the archiver's own set is ordered by load and also covers subagents,
    // so indexing into it would test whichever Session happened to be first.
    const managed = host.runtime.sessions.managed()
    expect(managed.length).toBeGreaterThan(0)
    const agent = managed.find(item => item.id === host.runtime.masterId)!.agent
    const before = host.runtime.masterId
    const services = { tokenMeter: { contextPressure: () => ({ pressureTokens: 80, contextWindow: 100 }) },
      compaction: { compactNow: vi.fn(async () => ({})) } }
    const originalGet = agent.ctx.get.bind(agent.ctx)
    vi.spyOn(agent.ctx, 'get').mockImplementation(((name: string) =>
      name in services ? services[name as keyof typeof services] : originalGet(name as never)) as never)
    Object.assign(agent, { runMaintenance: () => {} })
    host.controller.inspect.mockResolvedValue({ events: [{ type: 'user/message', data: { content: 'carry this over' } }] } as never)
    await host.runtime.archiver.tick()
    // A coordinator with a context window now continues in a new Session, which is what the operator asked for; the
    // in-place compaction path stays for a host that exposes no coordinator relay.
    expect(host.runtime.masterId).not.toBe(before)
    expect(services.compaction.compactNow).not.toHaveBeenCalled()
    const carried = host.agents.get(host.runtime.masterId)!.inject.mock.calls.map(call => JSON.stringify(call[0]))
    expect(carried.some(text => text.includes('carry this over'))).toBe(true)
  } finally { await host.stop(); vi.restoreAllMocks() }
})

it('a Session with no coordinator relay still compacts in place', async () => {
  // The host drives this test through a stand-in archiver whose host object has no coordinator relay, which is the
  // shape an older deployment has: the main Session must keep working by compacting, not fail.
  const { ContextArchiver } = await import('../src/app/archive.ts')
  let pressure = 80
  const compaction = { compactNow: vi.fn(async () => { pressure = 40; return {} }) }
  const services = { tokenMeter: { contextPressure: () => ({ pressureTokens: pressure, contextWindow: 100 }) }, compaction }
  const agent = { id: 'orchestrator-test', status: 'idle',
    ctx: { get: (name: string) => services[name as keyof typeof services] },
    session: {}, runMaintenance: () => {} }
  const reports: string[] = []
  const steers: string[] = []
  const archiver = new ContextArchiver({ context: { get: () => undefined },
    managed: () => [{ id: agent.id, agent }],
    budget: () => ({ enabled: true, percent: 60 }),
    steer: async (_id: string, _requestId: string, text: string) => { steers.push(text) },
    report: (detail: string) => { reports.push(detail) },
    ticketOf: () => undefined } as never)
  await archiver.tick()
  expect(compaction.compactNow).toHaveBeenCalledTimes(1)
  expect(reports.some(line => line.includes('now 40%'))).toBe(true)
  // The handover text only claims the earlier part was archived, which is what actually happened here.
  expect(steers.some(text => text.includes('was archived'))).toBe(true)
})
