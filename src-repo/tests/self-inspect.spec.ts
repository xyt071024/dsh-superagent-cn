/**
 * Checks self-inspection: every gap must name an action, and an installation that is already working must report none.
 *
 * The value of this module is that a gap is actionable; a report that says "something is wrong" is worse than silence,
 * because it reads like progress. These tests hold that line.
 */
import { describe, expect, it } from 'vitest'
import { hygiene, inspect } from '../src/app/self-inspect.ts'
import { SettingsSchema } from '../src/policy.ts'
import type { Store } from '../src/app/store.ts'
import type { SourceRegistry } from '../src/sources/registry.ts'
import type { Settings } from '../src/policy.ts'

const settings = (patch: Partial<Settings> = {}): Settings => SettingsSchema.parse(patch)

/** A registry that reports the given instances, which is all `inspect` reads from it. */
const registry = (kinds: string[], enabled = true): Pick<SourceRegistry, 'instances'> => ({
  instances: () => kinds.map(kind => ({ id: kind, kind, enabled, config: {}, installed: true })),
}) as unknown as SourceRegistry

/** A store whose ticket lists are the given ones, which is all `inspect` and `hygiene` read. */
const store = (tickets: unknown[] = []): Store => ({
  tickets: { list: () => tickets, open: () => tickets, get: () => undefined, save: () => undefined, active: () => [] },
}) as unknown as Store

const ready = { qq: { state: 'ready', detail: 'ok' } } as never

/** The settings of an installation an operator would call finished. */
const working = settings({
  eval: { mode: 'auto', timeoutSeconds: 120, model: null },
  executor: { model: null, maxWorkers: 3, directory: '', prepare: 'git clone x', blockedCommands: [] },
  routing: { multiSession: 'auto', placement: 'background', thinking: 'auto', allow: ['a/1'], difficultyThreshold: 60 },
  policy: { rules: [], sources: { qq: { allowed: [{ id: '1' }], admission: {} } } },
} as Partial<Settings>)

describe('inspect', () => {
  it('reports nothing missing on a working installation', () => {
    // One Source is ready, a list entry exists, a model is approved, work spreads, eval accepts, mail exists, prepare runs.
    const result = inspect(working, registry(['qq', 'mail']), ready, store())
    expect(result.gaps.map(gap => gap.code)).toEqual([])
    expect(result.sources.map(source => source.id).sort()).toEqual(['mail', 'qq'])
  })

  it('names the one action that closes each gap', () => {
    const result = inspect(settings(), registry([], false), {} as never, store())
    expect(result.gaps.length).toBeGreaterThan(0)
    for (const gap of result.gaps) {
      // A gap without a fix is a complaint; this module exists to avoid exactly that.
      expect(gap.fix.length).toBeGreaterThan(10)
      expect(gap.detail.length).toBeGreaterThan(5)
    }
  })

  it('reports a paused Source with its own detail rather than as a failure', () => {
    const health = { mail: { state: 'paused', detail: 'Waiting for the mail address and app password' } } as never
    const gap = inspect(settings(), registry(['mail']), health, store()).gaps.find(entry => entry.code === 'source_paused')
    expect(gap?.detail).toContain('Waiting for the mail address')
    // A paused Source is not a failed one, so the fix says to fill in fields, not to debug a poll.
    expect(gap?.fix).toContain('supply')
  })

  it('reports an error Source as something to debug', () => {
    const health = { qq: { state: 'error', detail: '3 consecutive failed polls' } } as never
    const gap = inspect(settings(), registry(['qq']), health, store()).gaps.find(entry => entry.code === 'source_error')
    expect(gap?.fix).toContain('last poll failed')
  })

  it('flags an observe-only Eval, because such an installation accepts no work by itself', () => {
    const gaps = inspect(settings({ eval: { mode: 'observe', timeoutSeconds: 120, model: null } } as Partial<Settings>),
      registry(['qq']), ready, store()).gaps.map(gap => gap.code)
    expect(gaps).toContain('observeOnly')
  })

  it('counts open and ended tickets separately', () => {
    const now = new Date().toISOString()
    const tickets = [{ id: 'a', ended: undefined }, { id: 'b', ended: { at: now } }]
    const { activity } = inspect(working, registry(['qq', 'mail']), ready, store(tickets))
    expect(activity.open).toBe(1)
    expect(activity.ended).toBe(1)
    expect(activity.days).toBe(7)
  })
})

describe('hygiene', () => {
  it('names an open ticket whose directory is gone', () => {
    const tickets = [{ id: 't1', execution: { name: 'n', directory: 'D:/definitely/not/here', assignment: '' } }]
    expect(hygiene(store(tickets)).missing).toHaveLength(1)
    expect(hygiene(store(tickets)).missing[0]).toContain('t1')
  })

  it('says nothing about a ticket with no directory yet', () => {
    expect(hygiene(store([{ id: 't2' }])).missing).toEqual([])
  })
})
