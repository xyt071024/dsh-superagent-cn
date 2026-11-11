/**
 * Self-inspection for the orchestrator: what this installation is, what it is missing, and what it has been doing.
 *
 * An agent that cannot see its own state cannot improve it. Every other tool here acts on a person's work; these act on
 * the installation itself, which is what letting it improve itself requires.
 */
import { z } from 'zod'
import { existsSync } from 'node:fs'
import type { Settings } from '../policy.ts'
import type { Store } from './store.ts'
import type { SourceRegistry } from '../sources/registry.ts'
import type { HealthMap } from './views/sources.ts'

/** One thing the installation lacks, stated as the concrete next action rather than a category of problem. */
export interface Gap { code: string; detail: string; fix: string }

/** Counts over a stated window, so a number always means the same thing. */
export interface Activity {
  days: number
  tickets: number
  open: number
  ended: number
  waiting: number
}

/**
 * Compares what this installation is against what a working one needs.
 *
 * Every gap names the one action that closes it. "The mail Source is unconfigured" leaves the reader to work out what to
 * do, and that is the failure this function exists to avoid.
 */
export function inspect(settings: Settings, sources: Pick<SourceRegistry, 'instances'>, health: HealthMap, store: Store,
  days = 7): { gaps: Gap[]; activity: Activity; sources: { id: string; kind: string; enabled: boolean; state: string }[] } {
  const gaps: Gap[] = []
  const instances = sources.instances(settings)
  const list = instances.map(instance => {
    const entry = health[instance.id]
    return { id: instance.id, kind: instance.kind, enabled: instance.enabled, state: entry?.state ?? 'unknown' }
  })
  if (!list.some(source => source.enabled && source.state === 'ready')) {
    gaps.push({ code: 'noLiveSource', detail: 'No Source is receiving anything, so no work can arrive.',
      fix: 'Open Settings → Sources and finish the account fields of one Source; it reports 运行中 once a poll succeeds.' })
  }
  // `unknown` means the Source registered but has not reported yet — it is starting, not broken, so it gets no gap of its
  // own beyond the no-live-source one, which already covers an installation where nothing has come up.
  for (const source of list.filter(entry => entry.enabled && (entry.state === 'paused' || entry.state === 'error'))) {
    gaps.push({ code: `source_${source.state}`, detail: `${source.id} is ${source.state}: ${health[source.id]?.detail ?? 'no detail'}`,
      fix: source.state === 'paused'
        ? `Open Settings → Sources → ${source.id} and supply what it is waiting for.`
        : `Open Settings → Sources → ${source.id}: its last poll failed, and the detail above names why.` })
  }
  // A Source that is installed but has no instance never receives: the registry lists it, the poller does not run it.
  if (!instances.length) {
    gaps.push({ code: 'noSource', detail: 'No Source is installed, so the Orchestrator has nothing to listen to.',
      fix: 'Enable a Source in the bundle configuration, then give it an account in Settings → Sources.' })
  }
  if (!Object.values(settings.policy.sources).some(part => part.allowed.length)) {
    gaps.push({ code: 'emptyAllowList', detail: 'Every Source list is empty, so nothing becomes an explicit request.',
      fix: 'Open Settings → Sources and add your own account to the list of the Source you use.' })
  }
  if (!settings.routing.allow.length) {
    gaps.push({ code: 'noApprovedModel', detail: 'No model is approved for workers, so every Session runs on the Execution model.',
      fix: 'Open Settings → Routing → Approved models and tick the models a worker may use, cheapest first.' })
  }
  if (settings.routing.multiSession === 'single') {
    gaps.push({ code: 'singleSession', detail: 'Every job runs in one Session, so a hard job never spreads across models.',
      fix: 'Open Settings → Routing → Multiple Sessions and choose 自动拆分.' })
  }
  if (settings.eval.mode === 'observe') {
    gaps.push({ code: 'observeOnly', detail: 'Assessments are recorded but never accepted, so the agent accepts no work on its own.',
      fix: 'Open Settings → Eval and choose 自动 once the rules describe what you want accepted.' })
  }
  if (!instances.some(instance => instance.kind === 'mail')) {
    gaps.push({ code: 'noMailSource', detail: 'No mailbox is connected, so work cannot arrive by mail.',
      fix: 'Turn on the Mail Source and fill in the address and the app password.' })
  }
  if (!settings.executor.prepare.trim()) {
    gaps.push({ code: 'noPrepare', detail: 'No prepare command runs, so each ticket starts from an empty directory.',
      fix: 'Open Settings → Execution → Prepare command and add what prepares a workspace, such as a clone or a worktree.' })
  }

  const since = Date.now() - days * 86_400_000
  const tickets = store.tickets.list()
  return {
    gaps,
    activity: {
      days,
      tickets: tickets.length,
      open: tickets.filter(ticket => !ticket.ended).length,
      ended: tickets.filter(ticket => !!ticket.ended && Date.parse(ticket.ended.at) >= since).length,
      waiting: tickets.filter(ticket => !!ticket.attention).length,
    },
    sources: list,
  }
}

/**
 * Code-side hygiene an agent can check without a compiler: which open tickets name a directory that no longer exists.
 * The build and the test run belong to the operator's toolchain, so this names what to run rather than running it.
 */
export function hygiene(store: Store): { open: number; missing: string[] } {
  const open = store.tickets.open()
  const missing = open.flatMap(ticket => {
    const directory = ticket.execution?.directory
    return directory && !existsSync(directory) ? [`${ticket.id} → ${directory}`] : []
  })
  return { open: open.length, missing }
}

export const InspectSchema = z.object({ days: z.number().int().min(1).max(90).optional() }).strict()
export type InspectInput = z.infer<typeof InspectSchema>
