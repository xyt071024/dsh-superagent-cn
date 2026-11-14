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
 * code invents.
 *
 * `operatorModel` is whatever the person is using in their own Session right now. It is a *fallback* by default rather
 * than an override, but the earlier version was worse than that: whenever the approved list was non-empty the operator's
 * model was ignored outright, so someone who had ticked a single model got that model for every worker no matter what
 * they had selected in the panel. `inheritOperatorModel: 'prefer'` is the default now and fixes exactly that — their
 * current choice wins, and the approved list only decides when they have not chosen anything this Session.
 *
 * With `'strict'`, the approved list always wins when it has an entry, which is the right behaviour for an install where
 * the whole point is that workers run on a curated set of models.
 */
export function modelFor(config: RoutingConfig | undefined, operatorModel: RoleModel | null, hard: boolean,
  inherit: 'prefer' | 'strict' = 'prefer'): RoleModel | null {
  // Nothing chosen this Session: the approved list, or the Execution model, is all there is.
  if (!config) return operatorModel
  const approved = routes(config)
  if (!approved.length) return operatorModel
  if (inherit === 'prefer' && operatorModel) return operatorModel
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
 * Whether a ticket counts as hard, by the operator's threshold.
 *
 * There is no separate difficulty estimate anywhere in this project — nothing scores a ticket 0–100, and the threshold had
 * only a schema and a default with no reader. Rather than leave a knob that does nothing, the verdict is taken from the one
 * size signal a ticket actually carries: the length of the assignment it was given. A ticket whose brief is long is the one
 * worth the strongest approved model and worth splitting; a one-line brief is not.
 *
 * The mapping is deliberately simple and stated here so it can be argued with: the threshold is a percentage, and the brief
 * reaches it at `HARD_BRIEF_CHARS` characters' worth of instruction. It is a proxy, not a measurement, and the panel says so.
 */
const HARD_BRIEF_CHARS = 1200
export const isHard = (config: RoutingConfig | undefined, brief: string | undefined): boolean => {
  if (!brief) return false
  const threshold = config?.difficultyThreshold ?? 60
  return brief.length * 100 >= HARD_BRIEF_CHARS * threshold
}

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
