/** Plugin configuration and startup verification for repository access and agent CLI identities. */
import { LIMITS } from './limits.ts'
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, extname, isAbsolute, join } from 'node:path'
import type { Volatile } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { z } from 'zod'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { runAsWorker, sameDirectory, withoutDirectory, workerBin } from './infra/environment.ts'
import { SetupError } from './setup.ts'
import { probeSource } from './app/source-probe.ts'

const reason = (error: unknown): string => error instanceof Error ? error.message : String(error)
/**
 * A path that must be absolute, on whichever platform is running.
 *
 * This was `/^\//`, which is only absolute on POSIX: a Windows path starts with a drive letter (`D:/state`, `D:\state`) or a
 * UNC share (`\\server\share`), so every Windows install failed its own configuration check with
 * `expect string to match regexp /^\//`. The plugin then reported "did not activate" and the panel never appeared — the same
 * POSIX-only assumption that was fixed in `policy.ts` for the ticket directory, and missed here.
 */
const absolute = (description: string) => s.string()
  .pattern(/^(\/|[A-Za-z]:[\\/]|\\\\)/).description(`${description} Absolute path.`)
/** Plugin configuration of the dsh-superagent entry. Volatile fields apply without a restart because dsh-superagent reads them on each use; changing `stateDir` remounts the plugin. */
export const Config = s.object({
  stateDir: absolute('Directory for the database, locks, worker shims, the agent\'s git configuration and, by default, the ticket directories.').required(),
  promptMaxChars: s.number().min(LIMITS.promptMaxChars.min).max(LIMITS.promptMaxChars.max).step(1).default(100000)
    .description('Largest saved prompt configuration, in characters.').volatile(),
  admissionContextMaxPages: s.number().min(LIMITS.admissionContextMaxPages.min).max(LIMITS.admissionContextMaxPages.max).step(1).default(10)
    .description('Pages of thread context one assessment may read.').volatile(),
  admissionContextTimeoutMs: s.number().min(LIMITS.admissionContextTimeoutMs.min).max(LIMITS.admissionContextTimeoutMs.max).step(1)
    .default(15000).description('Time limit of one context read during an assessment, in milliseconds.').volatile(),
  isolateEnvironment: s.boolean().default(false).volatile()
    .description('Give worker processes their own PATH and git configuration instead of changing the ones this process runs with.'),
})
export type DeploymentConfig = ReturnType<typeof Config>
export interface Machine {
  stateDir: string
  promptMaxChars: Volatile<number>
  admissionContextMaxPages: Volatile<number>
  admissionContextTimeoutMs: Volatile<number>
  /**
   * Whether workers get their own environment rather than sharing this process's.
   *
   * Without it the plugin edits the process-wide `PATH` and git configuration, which on a machine already running other
   * plugins silently replaces their `gh` and `lark-cli` with the worker shims. With it the overrides are passed to each
   * spawn instead, so nothing outside a worker is touched.
   */
  isolateEnvironment: Volatile<boolean>
}
const MOVED: Record<string, string> = {
  repository: 'on the GitHub Source', branchPrefix: 'in the prepare command of the Execution settings', github: 'on the GitHub Source',
  feishu: 'on the Feishu Source', author: 'prompt text', repositoryPath: 'in the prepare command of the Execution settings',
  worktreeRoot: 'the ticket directory of the Execution settings', blockedCommands: 'in the Execution settings',
}

/** Read machine settings and reject unknown configuration keys (naming where deprecated keys moved). */
export function machineOf(config: DeploymentConfig): Machine {
  const unknown = Object.keys(config).filter(key => !(key in (Config.dict ?? {})))
  if (unknown.length) throw new Error(`dsh-superagent configuration has keys it does not use: ${unknown.map(key => MOVED[key] ? `${key} (now ${MOVED[key]})` : key).join(', ')}; docs/006-deployment.md lists the keys`)
  const { stateDir, promptMaxChars, admissionContextMaxPages, admissionContextTimeoutMs, isolateEnvironment } = config
  return { stateDir, promptMaxChars, admissionContextMaxPages, admissionContextTimeoutMs, isolateEnvironment }
}

export const GithubAccountsSchema = z.object({
  repository: z.string().trim().regex(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?$/, 'owner/name').default(''),
  cli: z.string().trim().default(''),
})
export const FeishuBotSchema = z.object({ cli: z.string().trim().default('') })
/** Source configuration keys that affect deployment setup and trigger a restart when changed. */
export const SETUP_FIELDS: Readonly<Record<string, readonly string[]>> = { github: Object.keys(GithubAccountsSchema.shape), feishu: Object.keys(FeishuBotSchema.shape) }

export interface Deployment extends Machine {
  repository: string
  github: { cli: string; login: string; noreply: string }
  feishu?: FeishuBot
}
export interface FeishuBot { cli: string; appId: string; brand: 'feishu' | 'lark'; botId: string; name: string }

/** Resolve a command name or absolute path to an executable file, ignoring the worker shim directory. */
export function executable(name: string, path: string, exclude?: string): string {
  if ((name.includes('/') || name.includes('\\')) && !isAbsolute(name)) throw new Error(`${name} must be a command name or an absolute path`)
  const names = process.platform === 'win32' && !extname(name) ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name] : [name]
  const candidates = isAbsolute(name) ? names : path.split(delimiter).filter(dir => isAbsolute(dir) && !(exclude && sameDirectory(dir, exclude))).flatMap(dir => names.map(candidate => join(dir, candidate)))
  for (const candidate of candidates) {
    try { if (statSync(candidate).isFile()) { accessSync(candidate, constants.X_OK); return candidate } }
    catch { /* Not an executable file here; try the next PATH directory. */ }
  }
  throw new Error(`${name} is not an executable file${isAbsolute(name) ? '' : ' on PATH'}`)
}

export type Probe = (argv: string[], env?: Record<string, string>) => Promise<string>
/** Run startup checks through DSH's worker subprocess service with worker shims removed from PATH so a `gh` wrapper script reaches the real binary. */
export function workerProbe(subprocess: SubprocessRuntime, stateDir: string, cwd: string, signal: AbortSignal): Probe {
  const path = withoutDirectory(process.env.PATH ?? '', workerBin(stateDir))
  return (argv, env) => runAsWorker(subprocess, argv, cwd, AbortSignal.any([signal, AbortSignal.timeout(60_000)]), { ...env, PATH: path })
}

const GithubUser = z.object({ login: z.string().regex(/^[A-Za-z0-9-]+$/), id: z.number().int().positive() })
const RepositoryAccess = z.object({ name: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/), push: z.boolean().nullable() })
function parsed<T>(schema: z.ZodType<T>, text: string): T | undefined {
  let value: unknown
  try { value = JSON.parse(text) } catch { return undefined /* Non-JSON output; the caller surfaces the setup failure. */ }
  const result = schema.safeParse(value)
  return result.success ? result.data : undefined
}
/** Verify the agent's GitHub CLI identity and push access to the configured repository. */
export async function resolveDeployment(machine: Machine, github: unknown, probe: Probe, path = process.env.PATH ?? ''): Promise<Deployment> {
  const { stateDir } = machine
  const accounts = GithubAccountsSchema.parse(github ?? {})
  const remote = accounts.repository
  if (!remote) throw new SetupError('repositoryUnset')
  if (!accounts.cli) throw new SetupError('agentCliUnset')
  let cli: string
  try { cli = executable(accounts.cli, path, workerBin(stateDir)) } catch (error) { throw new SetupError('agentCliMissing', { output: reason(error) }) }
  const text = await probe([cli, 'api', 'user']).catch((error: unknown) => { throw new SetupError('agentCliSignedOut', { output: reason(error) }) })
  const agent = parsed(GithubUser, text)
  if (!agent) throw new SetupError('agentCliNoAccount')
  // Use the canonical repository name returned by GitHub so renamed repositories match incoming notifications.
  const access = parsed(RepositoryAccess, await probe([cli, 'api', `repos/${remote}`, '--jq', '{name: .full_name, push: .permissions.push}']).catch((error: unknown) => {
    throw new SetupError('repositoryUnreadable', { account: agent.login, repository: remote, output: reason(error) })
  }))
  if (!access) throw new SetupError('repositoryUnreported', { repository: remote })
  const repository = access.name
  if (access.push !== true) throw new SetupError('repositoryReadOnly', { account: agent.login, repository })
  return { ...machine, repository, github: { cli, login: agent.login, noreply: `${agent.id}+${agent.login}@users.noreply.github.com` } }
}

const AuthStatus = z.object({ appId: z.string().regex(/^cli_[A-Za-z0-9]+$/), brand: z.enum(['feishu', 'lark']).default('feishu'), identities: z.object({ bot: z.object({ status: z.string() }) }) })
const BotInfo = z.object({ bot: z.object({ open_id: z.string().regex(/^ou_[A-Za-z0-9]+$/), app_name: z.string().default('') }) })
/**
 * Verify that the configured Feishu CLI is authenticated as a bot and restricted to strict mode `bot`.
 * Workers invoke this CLI as `lark-cli`, so a CLI that also permits a user identity would let workers act as that user.
 */
export async function resolveFeishuBot(machine: Machine, feishu: unknown, probe: Probe, path = process.env.PATH ?? ''): Promise<FeishuBot | undefined> {
  const { cli: name } = FeishuBotSchema.parse(feishu ?? {})
  if (!name) return undefined
  const fail = (error: unknown): never => { throw error instanceof SetupError ? error : new SetupError('feishuCliFailed', { output: reason(error) }) }
  let cli = ''
  try { cli = executable(name, path, workerBin(machine.stateDir)) } catch (error) { fail(error) }
  const run = (...args: string[]): Promise<string> => probe([cli, ...args], {
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
  }).catch(fail)
  const text = await run('auth', 'status')
  const status = parsed(AuthStatus, text.slice(text.indexOf('{')))
  if (!status) return fail(new SetupError('feishuNoApp'))
  if (status.identities.bot.status !== 'ready') fail(new SetupError('feishuBotNotReady', { app: status.appId, status: status.identities.bot.status }))
  const mode = /strict-mode:\s*(\w+)/.exec(await run('config', 'strict-mode'))?.[1]
  if (mode !== 'bot') fail(new SetupError('feishuUserIdentity', { mode: mode ?? 'unknown' }))
  // `--format json` unwraps only `data`, whereas this endpoint returns the payload under `bot`.
  const info = parsed(BotInfo, (await run('api', 'GET', '/open-apis/bot/v3/info', '--as', 'bot', '--format', 'ndjson')).split('\n')[0] ?? '')
  if (!info) return fail(new SetupError('feishuNoBot'))
  return { cli, appId: status.appId, brand: status.brand, botId: info.bot.open_id, name: info.bot.app_name }
}

/**
 * Verify one OneBot gateway (QQ, WeChat or WeCom) names an endpoint and answers the identity check.
 *
 * Why this exists: until these checks, a gateway that was simply not running produced only "waiting" or "error" in the
 * panel, with nothing said about what to fix. That silence is the complaint this project kept receiving ("他这也没有提示，
 * 让我怎么弄"). The check reuses `probeSource`, so it sends no message, reads no history and returns no token.
 *
 * The platform name is in the message because one factory serves all three; without it a person running QQ and WeCom
 * cannot tell which gateway the problem is about.
 */
/** Whether a value parses as an http(s) URL with no embedded credentials, query or fragment. */
function isHttpEndpoint(value: string): boolean {
  // `new URL` accepts a bare string as a relative path only with a base; without one it throws for "not-a-url", but a
  // value such as "localhost:3000" parses as a custom scheme. Both are wrong for a gateway, so the scheme is checked.
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.host) && !url.username && !url.password
      && !url.search && !url.hash
  } catch { return false }
}

/**
 * The part of an endpoint that is safe to show: scheme and host only.
 *
 * A gateway address can carry a query string with a token, or userinfo with a password. Neither belongs in a message
 * that the panel renders and the problem record keeps, but the host does: without it a person cannot tell which of two
 * gateways is failing.
 */
function shownEndpoint(value: string): string {
  try {
    const url = new URL(value)
    return url.host ? `${url.protocol}//${url.host}` : 'the configured address'
  } catch { return 'the configured address' }
}

export async function resolveOneBot(instance: { kind: string; config: Record<string, unknown> }): Promise<void> {
  const platform = instance.kind === 'wechat' ? 'WeChat' : instance.kind === 'wecom' ? 'WeCom' : 'QQ'
  const endpoint = instance.config.endpoint
  if (typeof endpoint !== 'string' || !endpoint.trim()) throw new SetupError('onebotEndpointUnset', { platform })
  const usable = isHttpEndpoint(endpoint)
  const result = await probeSource(instance as Parameters<typeof probeSource>[0])
  const state = result.checks.find(check => check.name === 'onebot')?.state
  if (state === 'ok' || state === 'unsupported') return
  if (state === 'missing') throw new SetupError('onebotEndpointUnset', { platform })
  // A filled-in but unusable address is reported as one, before any verdict about the gateway: nothing was reached, so
  // nothing can be said about it. The value itself is never echoed — an endpoint can carry a query string or userinfo,
  // and this message is shown in the panel and kept in the problem record.
  if (!usable) throw new SetupError('onebotUnreachable', { platform, endpoint: shownEndpoint(endpoint) })
  if (state === 'auth_failed') throw new SetupError('onebotAuthFailed', { platform })
  if (state === 'unreachable') throw new SetupError('onebotUnreachable', { platform, endpoint: shownEndpoint(endpoint) })
  throw new SetupError('onebotFailed', { platform })
}

/**
 * Verify a mailbox names an address and an app password, and that both servers answer.
 *
 * Reading and sending are checked separately because they fail separately: a mailbox whose SMTP is blocked can still be
 * read, and saying "the mailbox is unavailable" would be wrong. The address is quoted, never the password.
 */
export async function resolveMail(instance: { kind: string; config: Record<string, unknown> }): Promise<void> {
  const address = instance.config.address
  const password = instance.config.password
  if (typeof address !== 'string' || !address.trim()) throw new SetupError('mailAddressUnset')
  if (typeof password !== 'string' || !password) throw new SetupError('mailPasswordUnset')
  const server = ((): string => { const at = address.lastIndexOf('@'); return at > 0 ? address.slice(at + 1) : address })()
  const result = await probeSource(instance as Parameters<typeof probeSource>[0])
  for (const check of result.checks) {
    if (check.state === 'ok' || check.state === 'unsupported' || check.state === 'missing') continue
    if (check.name === 'imap') {
      if (check.state === 'unreachable') throw new SetupError('mailImapUnreachable', { server })
      if (check.state === 'auth_failed') throw new SetupError('mailImapAuthFailed', { server })
      throw new SetupError('mailImapUnreachable', { server })
    }
    if (check.name === 'smtp') {
      if (check.state === 'unreachable') throw new SetupError('mailSmtpUnreachable', { server })
      if (check.state === 'auth_failed') throw new SetupError('mailSmtpAuthFailed', { server })
      throw new SetupError('mailSmtpUnreachable', { server })
    }
  }
}
