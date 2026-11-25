import { describe, expect, it } from 'vitest'
import { UsageMeter } from '../src/app/usage.ts'
import { DshExecutor, type ExecutorHost } from '../src/executor/dsh.ts'

const event = (tokens: number) => ({ type: 'assistant/message' as const, data: { usage: { outputTokens: tokens } } }) as Parameters<UsageMeter['observe']>[0]

describe('daily token budget', () => {
  it('keeps recorded usage after restart and resets at Shanghai midnight', () => {
    let saved: { day: string; tokens: number } | undefined
    let now = new Date('2026-11-14T15:59:59Z')
    const storage = { load: () => saved, save: (value: { day: string; tokens: number }) => { saved = value } }
    const first = new UsageMeter(storage, () => now)
    first.observe(event(80))
    const restarted = new UsageMeter(storage, () => now)
    expect(restarted.today()).toEqual({ day: '2026-11-14', tokens: 80 })
    expect(restarted.exceeded(80)).toBe(true)
    now = new Date('2026-11-14T16:00:00Z')
    expect(restarted.exceeded(80)).toBe(false)
    restarted.observe(event(10))
    expect(new UsageMeter(storage, () => now).today()).toEqual({ day: '2026-11-15', tokens: 10 })
  })

  it('holds queued launches at the limit and releases them when budget permits', () => {
    let exceeded = false
    const limits: Record<string, () => number> = {}
    const host = {
      store: { tickets: { open: () => [] }, settings: () => ({ executor: { maxWorkers: 2 } }) },
      effects: { handle: (kind: string, _handler: unknown, options: { limit: () => number }) => { limits[kind] = options.limit } },
      paused: () => false, budgetExceeded: () => exceeded,
    } as unknown as ExecutorHost
    new DshExecutor(host)
    expect(limits.launch!()).toBe(2)
    exceeded = true
    expect(limits.launch!()).toBe(0)
    expect(limits.delivery!()).toBe(4)
    exceeded = false
    expect(limits.launch!()).toBe(2)
  })
})
