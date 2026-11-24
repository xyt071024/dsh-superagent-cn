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

/** Reserve a stable per-task slot in O(used) without allocating a max-sized array. Never reassign an existing valid session slot on restart. */
export function reserveSessionSlot(slots: Record<string, number>, id: string, max: number): number {
  const existing = slots[id]
  if (existing !== undefined && existing >= 0 && existing < max) return existing
  const used = new Set(Object.values(slots).filter(slot => slot >= 0 && slot < max))
  let slot = 0
  while (slot < max && used.has(slot)) slot++
  if (slot >= max) throw new Error(`This task has reached its ${max} child-session limit`)
  slots[id] = slot
  return slot
}

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
const MULTI_MODULE_CUE = /(?:前端|后端|数据库|接口|API|测试|部署|文档|迁移|重构|认证|登录|权限|路由|组件|模块|frontend|backend|database|schema|migration|auth|endpoint|test|deploy|refactor)/gi
const PARALLEL_CUE = /(?:并且|同时|分别|并行|独立|拆分|以及|另外|此外|parallel|independently|separate|split|across\s+modules?)/i
const SIMPLE_EDIT_CUE = /(?:改成|改为|替换为|typo|错别字|拼写|改一下|仅需|只改|端口|port\s*\d+|重命名|rename|explain|解释|总结|翻译)/i

/**
 * 综合评估任务复杂度（M07）：
 * 1. 若有显式评分（人工或规划器），优先按评分对比 threshold；
 * 2. 缺分时结合跨模块/多交付物/并行结构信号与长度，避免把“简短难题”漏判为简单、或把“贴了长日志的简单修改”误判为难题。
 */
export function assessComplexity(input: {
  threshold?: number | undefined
  explicitDifficulty?: number | null | undefined
  brief?: string | undefined
  plannedDivisions?: number | undefined
}): { hard: boolean; score: number; threshold: number; source: 'explicit' | 'planner' | 'heuristic'; reason: string; signals: string[] } {
  const threshold = input.threshold ?? 60
  if (input.explicitDifficulty !== undefined && input.explicitDifficulty !== null) {
    const score = Math.max(0, Math.min(100, Math.round(input.explicitDifficulty)))
    return {
      hard: score >= threshold,
      score,
      threshold,
      source: 'explicit',
      reason: score >= threshold ? `Explicit difficulty ${score} >= threshold ${threshold}` : `Explicit difficulty ${score} < threshold ${threshold}`,
      signals: ['explicit-difficulty'],
    }
  }
  if (input.plannedDivisions !== undefined && input.plannedDivisions > 1) {
    const score = Math.max(threshold, Math.min(100, 60 + input.plannedDivisions * 10))
    return {
      hard: true,
      score,
      threshold,
      source: 'planner',
      reason: `Planner proposed ${input.plannedDivisions} independent divisions`,
      signals: [`divisions:${input.plannedDivisions}`],
    }
  }
  const text = (input.brief ?? '').trim()
  if (!text) {
    return { hard: false, score: 0, threshold, source: 'heuristic', reason: 'Empty brief', signals: [] }
  }
  const signals: string[] = []
  const modules = new Set((text.match(MULTI_MODULE_CUE) ?? []).map(item => item.toLowerCase()))
  const listItems = (text.match(/(?:^|\n)\s*(?:\d+[.)]|[-*•])\s+\S/g) ?? []).length
  const parallel = PARALLEL_CUE.test(text)
  if (modules.size >= 3) signals.push(`modules:${modules.size}`)
  if (listItems >= 2) signals.push(`steps:${listItems}`)
  if (parallel) signals.push('parallel-cue')

  // 简短难题：虽然字数不多，但明确涉及跨模块协作（>=3 个不同模块/层）或显式多步骤拆分。
  if ((modules.size >= 3 && (parallel || modules.size >= 4)) || (listItems >= 2 && (modules.size >= 2 || parallel))) {
    const score = Math.min(100, Math.max(threshold, 65 + modules.size * 5 + listItems * 5))
    return {
      hard: score >= threshold,
      score,
      threshold,
      source: 'heuristic',
      reason: `Cross-module or multi-step work detected (${signals.join(', ')})`,
      signals,
    }
  }

  // 冗长简单题：大段贴出日志/代码块，而实际指令只是单点改动或问答。
  const fencedLen = (text.match(/```[\s\S]*?```/g) ?? []).reduce((sum, block) => sum + block.length, 0)
  const logLines = text.split('\n').filter(line => /^\s*(?:\[|\d{4}-\d{2}-\d{2}|at\s+\S+|Error:|WARN|INFO|DEBUG)/.test(line)).length
  const proseOnly = text.replace(/```[\s\S]*?```/g, '').trim()
  if ((fencedLen > text.length * 0.55 || logLines >= 8) && proseOnly.length < 240 && SIMPLE_EDIT_CUE.test(proseOnly) && modules.size < 3) {
    signals.push('pasted-context-single-edit')
    const score = Math.min(40, threshold - 1)
    return {
      hard: false,
      score,
      threshold,
      source: 'heuristic',
      reason: 'Long pasted log/snippet with a single localized change',
      signals,
    }
  }

  const lengthScore = Math.min(100, Math.round((text.length * 100) / HARD_BRIEF_CHARS))
  if (text.length * 100 >= HARD_BRIEF_CHARS * threshold) signals.push(`length:${text.length}`)
  return {
    hard: text.length * 100 >= HARD_BRIEF_CHARS * threshold,
    score: lengthScore,
    threshold,
    source: 'heuristic',
    reason: lengthScore >= threshold ? `Brief length (${text.length} chars) reached threshold ${threshold}%` : `Brief length (${text.length} chars) below threshold ${threshold}%`,
    signals,
  }
}

export const isHard = (config: RoutingConfig | undefined, brief: string | undefined): boolean => {
  return assessComplexity({ threshold: config?.difficultyThreshold ?? 60, brief }).hard
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
