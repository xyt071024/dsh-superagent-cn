import { describe, expect, it } from 'vitest'
import { checkForUpdate, currentVersion } from '../src/app/update-check.ts'

const response = (value: unknown, ok = true) => (async () => ({ ok, json: async () => value })) as unknown as typeof fetch
describe('read-only update check', () => {
  it('reads the actual installed package version', async () => {
    expect(await currentVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })
  it('compares stable versions without confusing numeric components', async () => {
    expect((await checkForUpdate('0.3.9', response({ tag_name: 'v0.3.10', draft: false, prerelease: false }))).status).toBe('available')
    expect((await checkForUpdate('0.3.10', response({ tag_name: 'v0.3.10' }))).status).toBe('up-to-date')
    expect((await checkForUpdate('0.4.0', response({ tag_name: 'v0.3.10' }))).status).toBe('newer-local')
  })
  it('does not claim success for errors, prereleases, invalid tags or missing local version', async () => {
    for (const [local, get] of [
      ['0.3.5', response({}, false)], ['0.3.5', response({ tag_name: 'v0.4.0-rc.1' })],
      ['0.3.5', response({ tag_name: 'v0.4.0', prerelease: true })], [null, response({ tag_name: 'v0.4.0' })],
      ['0.3.5', (async () => { throw new Error('network unavailable') }) as typeof fetch],
    ] as const) expect((await checkForUpdate(local, get)).status).toBe('unknown')
  })
})
