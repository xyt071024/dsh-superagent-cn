/** Checks the routing decisions: which approved model a Session gets, and never one the operator did not approve. */
import { describe, expect, it } from 'vitest'
import { effortFor, modelFor, multiSession, narrated, parseRoute, placementFor, routes } from '../src/app/routing.ts'
import { RoutingConfigSchema } from '../src/policy.ts'

const defaults = RoutingConfigSchema.parse({})
const two = RoutingConfigSchema.parse({ multiSession: 'auto', allow: ['cheap/fast', 'strong/deep'] })

describe('parseRoute', () => {
  it('splits the provider from the model', () => {
    expect(parseRoute('deepseek-official/deepseek-flash')).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash' })
  })

  it('keeps a model id that itself contains a slash', () => {
    expect(parseRoute('vendor/org/model')).toEqual({ provider: 'vendor', model: 'org/model' })
  })

  it('drops a malformed id rather than inventing a model', () => {
    expect(parseRoute('noslash')).toBeUndefined()
    expect(parseRoute('/model')).toBeUndefined()
    expect(parseRoute('provider/')).toBeUndefined()
  })
})

describe('routes', () => {
  it('keeps the operator order and skips what cannot be parsed', () => {
    expect(routes({ allow: ['a/1', 'broken', 'b/2'] })).toEqual([{ provider: 'a', model: '1' }, { provider: 'b', model: '2' }])
  })
})

describe('effortFor', () => {
  it('uses a fixed level as given', () => {
    expect(effortFor({ thinking: 'high' })).toBe('high')
    expect(effortFor({ thinking: 'low' })).toBe('low')
  })

  it('leaves auto to the model own default instead of guessing one', () => {
    expect(effortFor({ thinking: 'auto' })).toBeUndefined()
  })
})

describe('modelFor', () => {
  it('falls back to the Execution model when nothing is approved', () => {
    const executor = { provider: 'p', model: 'm' }
    expect(modelFor(defaults, executor, true)).toEqual(executor)
    // No Routing configuration at all is the upstream install, which must behave exactly as before.
    expect(modelFor(undefined, executor, false)).toEqual(executor)
  })

  it('picks the first approved route for ordinary work and the last for hard work', () => {
    expect(modelFor(two, null, false)).toEqual({ provider: 'cheap', model: 'fast' })
    expect(modelFor(two, null, true)).toEqual({ provider: 'strong', model: 'deep' })
  })

  it('carries the fixed thinking level into the selection', () => {
    const config = { ...two, thinking: 'high' as const }
    expect(modelFor(config, null, true)).toEqual({ provider: 'strong', model: 'deep', reasoningEffort: 'high' })
  })

  it('never selects a model outside the allowance, whatever the estimate says', () => {
    const selected = modelFor(two, null, true)!
    expect(routes(two).map(route => `${route.provider}/${route.model}`)).toContain(`${selected.provider}/${selected.model}`)
  })
})

describe('multiSession', () => {
  it('opens several Sessions only when the operator chose auto', () => {
    expect(multiSession(defaults)).toBe(false)
    expect(multiSession(two)).toBe(true)
    expect(multiSession(undefined)).toBe(false)
  })
})

describe('placementFor', () => {
  it('follows the operator when the setting names a side', () => {
    expect(placementFor({ ...defaults, placement: 'foreground' }, 'background')).toBe('foreground')
    expect(placementFor({ ...defaults, placement: 'background' }, 'foreground')).toBe('background')
  })

  it('defers to the request when the setting says so, and defaults to background', () => {
    const ask = { ...defaults, placement: 'ask' as const }
    expect(placementFor(ask, 'foreground')).toBe('foreground')
    expect(placementFor(ask, undefined)).toBe('background')
    expect(placementFor(undefined, undefined)).toBe('background')
  })
})

describe('narrated', () => {
  it('reports progress only for a run the operator chose to watch', () => {
    // DSH cannot bring a Session to the front, so foreground means telling the person as it happens.
    expect(narrated('foreground')).toBe(true)
    expect(narrated('background')).toBe(false)
  })
})
