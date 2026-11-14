/**
 * Checks that one Source kind can carry several accounts.
 *
 * This is what lets a person connect two QQ numbers, a QQ bridge and a WeChat bridge, each with its own endpoint and its
 * own Policy list — the configuration shape the whole multi-connection design rests on.
 */
import { describe, expect, it } from 'vitest'
import { SourceRegistry } from '../src/sources/registry.ts'
import { QqConfigSchema, oneBotKind } from '../src/sources/qq.ts'

/** A QQ kind built the way the plugin builds it. */
const qqKind = oneBotKind('qq', { zh: 'QQ', en: 'QQ' }, { zh: '', en: '' }, { key: 'X', description: { zh: '', en: '' } })
import { SettingsSchema } from '../src/policy.ts'

/** A registry with the QQ kind installed and the given stored instances. */
function registry(sources: Record<string, { enabled?: boolean; config?: Record<string, unknown> }>) {
  const settings = SettingsSchema.parse({ sources })
  const board = { claim: () => ({ get: () => undefined, set: () => undefined, release: () => undefined }) }
  const list = new SourceRegistry(() => settings, board as never)
  list.register(qqKind)
  return list
}

describe('instance identity', () => {
  it('treats a bare kind id as that kind', () => {
    const list = registry({ qq: { config: { endpoint: 'http://a:1' } } })
    expect(list.kind('qq')?.kind).toBe('qq')
  })

  it('treats a suffixed id as the same kind', () => {
    const list = registry({})
    // `qq-work` is a second QQ account, not an unknown Source.
    expect(list.kind('qq-work')?.kind).toBe('qq')
    expect(list.kind('qq-work-wx')?.kind).toBe('qq')
  })

  it('does not invent a kind from an unknown prefix', () => {
    const list = registry({})
    expect(list.kind('ghost-work')).toBeUndefined()
    expect(list.kind('missingsuffix')).toBeUndefined()
  })
})

describe('instances', () => {
  it('lists the bare instance when no suffix is stored', () => {
    const list = registry({ qq: { config: { endpoint: 'http://a:1' } } })
    const ids = list.instances().map(instance => instance.id)
    // One account must not appear twice just because the kind could hold several.
    expect(ids).toEqual(['qq'])
  })

  it('lists one instance per stored suffix, and drops the bare one', () => {
    const list = registry({
      'qq-work': { config: { endpoint: 'http://work:3000' } },
      'qq-wx': { config: { endpoint: 'http://wx:11229' } },
    })
    const instances = list.instances()
    // Alphabetical by id, so the list is stable however the store returns its keys.
    expect(instances.map(instance => instance.id)).toEqual(['qq-work', 'qq-wx'])
    expect(instances.every(instance => instance.kind === 'qq')).toBe(true)
    expect(instances.every(instance => instance.installed)).toBe(true)
  })

  it('keeps each instance own configuration', () => {
    const list = registry({
      'qq-work': { config: { endpoint: 'http://work:3000', pollSeconds: 5 } },
      'qq-wx': { config: { endpoint: 'http://wx:11229', pollSeconds: 9 } },
    })
    const byId = new Map(list.instances().map(instance => [instance.id, instance.config]))
    expect(byId.get('qq-work')).toMatchObject({ endpoint: 'http://work:3000', pollSeconds: 5 })
    expect(byId.get('qq-wx')).toMatchObject({ endpoint: 'http://wx:11229', pollSeconds: 9 })
  })

  it('reports a disabled instance as disabled without hiding its sibling', () => {
    const list = registry({
      'qq-work': { enabled: false, config: { endpoint: 'http://work:3000' } },
      'qq-wx': { enabled: true, config: { endpoint: 'http://wx:11229' } },
    })
    const byId = new Map(list.instances().map(instance => [instance.id, instance.enabled]))
    expect(byId.get('qq-work')).toBe(false)
    expect(byId.get('qq-wx')).toBe(true)
  })

  it('lists a stored instance of an uninstalled kind as not installed', () => {
    // A profile that removed the plugin must still show what was configured, not silently forget it.
    const list = registry({ 'ghost-xx': { config: {} } })
    const orphan = list.instances().find(instance => instance.id === 'ghost-xx')
    expect(orphan?.installed).toBe(false)
  })
})

describe('validation', () => {
  it('validates a suffixed instance against its kind schema', () => {
    const list = registry({})
    const value = list.validate('qq-work', { enabled: true, config: { endpoint: 'http://work:3000' } })
    // A suffixed id must not be rejected as an unknown Source.
    expect(QqConfigSchema.parse(value.config).endpoint).toBe('http://work:3000')
  })

  it('rejects a configuration the kind cannot parse', () => {
    const list = registry({})
    expect(() => list.validate('qq-work', { enabled: true, config: { endpoint: 'not-a-url' } })).toThrow()
  })
})
