/** The environment of the git processes the tests start. */
import { execFileSync } from 'node:child_process'
import { GIT_LOCATION } from '../../src/infra/environment.ts'

/** Environment variables that inject operator/wrapper git config overrides and must be stripped for isolated git tests. */
export const GIT_CONFIG_ENV_OVERRIDES: readonly string[] = [
  'GIT_CONFIG',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_NOSYSTEM',
]

/**
 * The process environment with `extra`, and without the variables that tell git which repository to act on (`GIT_LOCATION`)
 * or inject host/wrapper git config overrides (`GIT_CONFIG_ENV_OVERRIDES`).
 */
export const gitEnv = (extra: Record<string, string> = {}): Record<string, string | undefined> => ({
  ...process.env,
  ...Object.fromEntries([...GIT_LOCATION, ...GIT_CONFIG_ENV_OVERRIDES].map(name => [name, undefined])),
  ...extra,
})

/**
 * Verifies before git-isolation tests that the host's `git` binary (even if wrapped) honours `GIT_CONFIG_GLOBAL`
 * and `GIT_CONFIG_NOSYSTEM` instead of silently overriding them.
 */
export function probeGitConfigIsolation(
  configFile: string,
  env: NodeJS.ProcessEnv,
  gitCommand = 'git',
): { ok: boolean; detail?: string } {
  try {
    // `-z` outputs NUL-separated raw paths without Windows backslash escaping or quoting.
    const args = ['config', '-z', '--show-origin', '--get', 'user.useConfigOnly']
    const isWinCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(gitCommand)
    const out = isWinCmd
      ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', gitCommand, ...args], {
          env,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : execFileSync(gitCommand, args, {
          env,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
    const parts = out.split('\0').filter(Boolean)
    const origin = (parts[0] ?? '').replace(/^file:/, '').replace(/^"(.*)"$/, '$1').replaceAll('\\\\', '/').replaceAll('\\', '/').toLowerCase()
    const value = (parts[1] ?? '').trim()
    if (value !== 'true' && !out.includes('true')) {
      return { ok: false, detail: `unexpected user.useConfigOnly output: ${out}` }
    }
    const normCfg = configFile.replaceAll('\\', '/').toLowerCase()
    if (!origin.includes(normCfg)) {
      return { ok: false, detail: `git wrapper ignored GIT_CONFIG_GLOBAL (${configFile}); got: ${parts[0] ?? out}` }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}
