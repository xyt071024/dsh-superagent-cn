/**
 * Picks the model a Session runs on from the operator's approved list.
 *
 * The allowance is a list of exact `provider/model` ids, so a model the operator never approved can never be selected,
 * however a difficulty estimate comes out. An empty list means "whatever the profile already offers", which is the
 * upstream behaviour and keeps an install that never opened the Routing page working exactly as before.
 */
import type { RoleModel, RoutingConfig } from '../policy.ts'

/** One approved route, parsed from the `provider/model` form the settings page stores. */
export interface Route { provider: string; model: string }

/** Splits one approved id; a malformed entry is dropped rather than turned into a model that cannot be resolved. */
export function parseRoute(id: string): Route | undefined {
  const at = id.indexOf('/')
  if (at <= 0 || at === id.length - 1) return undefined
  const provider = id.slice(0, at).trim()
  const model = id.slice(at + 1).trim()
  return provider && model ? { provider, model } : undefined
}

/** The approved routes, in the order the operator ticked them. */
export function routes(config: Pick<RoutingConfig, 'allow'>): Route[] {
  return config.allow.flatMap(id => { const route = parseRoute(id); return route ? [route] : [] })
}

/**
 * Reasoning effort for a session: a fixed level wins, otherwise the model keeps its own default.
 *
 * `auto` deliberately returns undefined. Guessing a level would mean naming an effort the chosen route may not offer, and
 * a route is a whole `provider/model` the operator approved: its own default is the one value known to be valid for it.
 */
export function effortFor(config: Pick<RoutingConfig, 'thinking'>): string | undefined {
  return config.thinking === 'auto' ? undefined : config.thinking
}

/**
 * Chooses the model for one Session.
 *
 * `hard` is the difficulty verdict: at or above the operator's threshold the last approved route is used, otherwise the
 * first. Ordering is the operator's own, so "first" and "last" mean what the list looks like rather than a ranking this
 * code invents. `executorModel` is the Execution settings model and wins when nothing is approved, which keeps a single
 * configuration point for installs that do not use routing.
 */
export function modelFor(config: RoutingConfig | undefined, executorModel: RoleModel | null, hard: boolean): RoleModel | null {
  if (!config) return executorModel
  const approved = routes(config)
  if (!approved.length) return executorModel
  const route = hard ? approved[approved.length - 1]! : approved[0]!
  const effort = effortFor(config)
  return { provider: route.provider, model: route.model, ...effort ? { reasoningEffort: effort } : {} }
}

/**
 * Whether a run may open more than one Session for a job.
 * `single` keeps every job on one Session, which is what an operator choosing that expects.
 */
export const multiSession = (config: RoutingConfig | undefined): boolean => config?.multiSession === 'auto'

/**
 * Where a run executes.
 *
 * DSH has no way to pull an existing Session to the front of the window, so "foreground" cannot mean switching the view.
 * It means the main Session tells the person what it is doing as it happens — a relay when a ticket starts and a notice
 * when it ends — which is what watching a job actually requires. `background` stays silent beyond the receipt the
 * operator opens anyway. `ask` follows a preference stated by the Source, and falls back to background.
 */
export function placementFor(config: RoutingConfig | undefined, asked: 'foreground' | 'background' | undefined): 'foreground' | 'background' {
  if (!config) return asked ?? 'background'
  if (config.placement === 'foreground') return 'foreground'
  if (config.placement === 'background') return 'background'
  return asked ?? 'background'
}

/** Whether a run of this placement reports its progress to the main Session while it happens. */
export const narrated = (placement: 'foreground' | 'background'): boolean => placement === 'foreground'
