import { expect, it, vi } from 'vitest'
import { startRuntime } from './fixtures/host.ts'

it('runs archiving from the configured Runtime using the managed session and its scoped services', async () => {
  const host = await startRuntime()
  try {
    const managed = host.runtime.sessions.managed()
    expect(managed.length).toBeGreaterThan(0)
    const agent = managed[0]!.agent
    let pressure = 80
    const services = { tokenMeter: { contextPressure: () => ({ pressureTokens: pressure, contextWindow: 100 }) },
      compaction: { compactNow: vi.fn(async () => { pressure = 40; return {} }) } }
    const originalGet = agent.ctx.get.bind(agent.ctx)
    vi.spyOn(agent.ctx, 'get').mockImplementation(((name: string) =>
      name in services ? services[name as keyof typeof services] : originalGet(name as never)) as never)
    Object.assign(agent, { runMaintenance: () => {} })
    await host.runtime.archiver.tick()
    expect(services.compaction.compactNow).toHaveBeenCalledTimes(1)
    expect(host.deliveries.mock.calls.some(([call]) => call.text.includes('was archived'))).toBe(true)
  } finally { await host.stop(); vi.restoreAllMocks() }
})
