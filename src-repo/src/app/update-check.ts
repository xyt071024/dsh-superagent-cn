/** User-requested, read-only check of the configured distribution repository's latest stable release. */
import { readFile } from 'node:fs/promises'

const RELEASES = 'https://github.com/xyt071024/dsh-superagent-cn/releases'
const API = 'https://api.github.com/repos/xyt071024/dsh-superagent-cn/releases/latest'
export type UpdateCheck = { current: string | null; latest: string | null; status: 'available' | 'up-to-date' | 'newer-local' | 'unknown'; releases: string }

/** Find the package beside the built entry, or beside the project root when running from source. */
export async function currentVersion(): Promise<string | null> {
  for (const location of ['../package.json', '../../package.json']) {
    try {
      const pkg = JSON.parse(await readFile(new URL(location, import.meta.url), 'utf8')) as { name?: unknown; version?: unknown }
      if (pkg.name === 'dsh-superagent' && typeof pkg.version === 'string') return pkg.version
    } catch { /* Try the other expected package location. */ }
  }
  return null
}

/** Only compare stable numeric versions; prereleases are deliberately reported as unknown. */
function parts(version: string | null): number[] | undefined {
  if (!version) return undefined
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version)
  if (!match) return undefined
  const values = match.slice(1).map(Number)
  return values.every(Number.isSafeInteger) ? values : undefined
}

export async function checkForUpdate(current: string | null, get: typeof fetch = fetch): Promise<UpdateCheck> {
  const result: UpdateCheck = { current, latest: null, status: 'unknown', releases: RELEASES }
  try {
    const response = await get(API, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000), redirect: 'error' })
    if (!response.ok) return result
    const data: unknown = await response.json()
    if (!data || typeof data !== 'object' || !('tag_name' in data) || typeof data.tag_name !== 'string' || data.tag_name.length > 64
      || ('draft' in data && data.draft !== false) || ('prerelease' in data && data.prerelease !== false)) return result
    const local = parts(current), remote = parts(data.tag_name)
    if (!local || !remote) return result
    result.latest = data.tag_name.replace(/^v/, '')
    const difference = remote[0]! - local[0]! || remote[1]! - local[1]! || remote[2]! - local[2]!
    result.status = difference > 0 ? 'available' : difference < 0 ? 'newer-local' : 'up-to-date'
    return result
  } catch { return result }
}
