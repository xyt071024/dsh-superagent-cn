/** The bundle's patch, read with the entry-list dialect DSH reads bundle patches with, and the agent preset it defines. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ROUTER_PRESET, WORKER_PRESET } from '../src/app/sessions.ts'

interface Row { id?: string; name: string; disabled?: unknown; config?: Record<string, unknown> & { plugins?: Row[] } | Row[] }
/** The patch as DSH reads it: Cordis's include plugin parses `!!js` scalars, and applies the inserts to an entry list. */
async function patched(): Promise<Row[]> {
  const cordis = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/cordis/package.json'))
  const include = cordis.resolve('@deepseek-ai/cordis-plugin-include')
  const { entryListSchema, applyEntryPatches } = await import(include) as {
    entryListSchema: unknown; applyEntryPatches(data: Row[], patches: unknown[], warn: (message: string) => void): Row[] }
  const yaml = await import(createRequire(include).resolve('js-yaml')) as { load(text: string, options: { schema: unknown }): unknown }
  const patches = yaml.load(readFileSync(join(import.meta.dirname, '..', 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema }) as unknown[]
  const warnings: string[] = []
  const rows = applyEntryPatches([], patches, message => { warnings.push(message) })
  expect(warnings).toEqual([])
  return rows
}
/** Every plugin row of a preset, those inside groups too. */
const flat = (rows: readonly Row[]): Row[] => rows.flatMap(row => [row, ...Array.isArray(row.config) ? flat(row.config) : []])

/** A preset the patch defines, by its id. */
const presetOf = (rows: readonly Row[], id: string) => rows.map(row => row.config as { id?: string; order?: number; plugins: Row[] })
  .find(config => config?.id === id)!

it('defines the worker preset Executor Sessions run under, with a shell that moves long commands to the background', async () => {
  const rows = await patched()
  // Every Source that is its own plugin is inserted here, and each one also needs a build entry and an `exports` line.
  // `qq-watch` serves QQ, WeChat and WeCom from one factory; `mail-watch` serves IMAP/SMTP.
  expect(rows.map(row => row.id)).toEqual(['dsh-superagent', 'dsh-superagent-github', 'dsh-superagent-qq', 'dsh-superagent-qqbot', 'dsh-superagent-mail',
    'dsh-superagent-feishu', 'dsh-superagent-worker-preset', 'dsh-superagent-router-preset'])
  const preset = presetOf(rows, WORKER_PRESET)
  expect(preset.id).toBe(WORKER_PRESET)
  const plugins = flat(preset.plugins)
  const named = (name: string) => plugins.filter(row => row.name === name).map(row => row.config)
  expect(named('@deepseek-ai/dsh-bash-sandbox')).toEqual([{ timeoutMs: 5000, maxTimeoutMs: 5000 }])
  expect(named('@deepseek-ai/dsh-pwsh-sandbox')).toEqual([{ timeoutMs: 5000, maxTimeoutMs: 5000 }])
  expect(named('@deepseek-ai/dsh-tool-jobs')).toEqual([{ waitTimeoutMs: 5000, maxWaitTimeoutMs: 5000 }])
  expect(named('@deepseek-ai/dsh-tool-web')).toEqual([expect.objectContaining({ fetch: false })])
  // Spawned subagents run under standard, whose shell moves a command to the background only after 60 s; forked ones, which would run under
  // this preset, are left out.
  expect(named('@deepseek-ai/dsh-tool-subagent')).toEqual([expect.objectContaining({ provider: 'spawn', agentPreset: 'standard' })])
  // What a worker needs, and none of what asks a person, presents, plans, changes the profile, schedules, sets goals or runs workflows.
  for (const name of ['@deepseek-ai/dsh-tool-fs', '@deepseek-ai/dsh-tool-fs-search', '@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-skill',
    '@deepseek-ai/dsh-tool-todo', '@deepseek-ai/dsh-tool-subagent', '@deepseek-ai/dsh-tool-subagent-control', '@deepseek-ai/dsh-compaction-basic',
    '@deepseek-ai/dsh-compaction-tool-result-pruner', '@deepseek-ai/dsh-agent-instructions']) expect(named(name).length).toBeGreaterThan(0)
  const names = plugins.map(row => row.name)
  for (const name of ['@deepseek-ai/dsh-tool-ask-user', '@deepseek-ai/dsh-tool-present', '@deepseek-ai/dsh-plan-mode', '@deepseek-ai/dsh-plugin-manager/tools',
    '@deepseek-ai/dsh-plugin-market/tools', '@deepseek-ai/dsh-tool-schedule', '@deepseek-ai/dsh-tool-goal', '@deepseek-ai/dsh-command-goal',
    '@deepseek-ai/dsh-tool-workflow', '@deepseek-ai/dsh-workflow-ptc']) expect(names).not.toContain(name)
})

// The executor reads `ctx.get('agentTeams')` to split a hard ticket and to start an independent reviewer, and `WORK_TOOLS`
// allow-lists the Team tools. An allow list naming a tool the host never loaded is this project's recurring failure: the
// preset must mount the Team service itself, and the Team service needs durable session storage to keep a roster.
it('mounts Agent Teams in the worker preset, with the durable session storage its roster needs', async () => {
  const plugins = flat(presetOf(await patched(), WORKER_PRESET).plugins)
  const names = plugins.map(row => row.name)
  for (const name of ['@deepseek-ai/dsh-experimental-agent-team', '@deepseek-ai/dsh-experimental-tool-agent-team',
    '@deepseek-ai/dsh-session-persistence-jsonl']) expect(names, name).toContain(name)
  // Isolated, as every other service this preset provides is: without the isolate row the group stays inactive.
  const group = plugins.find(row => row.id === 'teams')!
  expect(group.name).toBe('cordis:group')
  expect((group as unknown as { isolate?: Record<string, unknown> }).isolate).toEqual({ agentTeams: true })
})

it('defines the router preset the main Session runs under: the worker\'s 5-second shell and job waits, and only the tools it uses', async () => {
  const rows = await patched()
  const router = presetOf(rows, ROUTER_PRESET), worker = presetOf(rows, WORKER_PRESET)
  expect(router.order).toBe(91)
  const plugins = flat(router.plugins)
  const named = (preset: Row[], name: string) => preset.filter(row => row.name === name).map(row => row.config)
  for (const name of ['@deepseek-ai/dsh-bash-sandbox', '@deepseek-ai/dsh-pwsh-sandbox', '@deepseek-ai/dsh-tool-jobs']) {
    expect(named(plugins, name), name).toEqual(named(flat(worker.plugins), name))
  }
  // The tools its allow list keeps: skill, bash, read, read_image and the job tools; the file tools only read.
  for (const name of ['@deepseek-ai/dsh-tool-skill', '@deepseek-ai/dsh-skill-filesystem', '@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-jobs',
    '@deepseek-ai/dsh-agent-instructions', '@deepseek-ai/dsh-time-context', '@deepseek-ai/dsh-compaction-basic',
    '@deepseek-ai/dsh-compaction-tool-result-pruner']) expect(named(plugins, name).length, name).toBeGreaterThan(0)
  expect(named(plugins, '@deepseek-ai/dsh-tool-fs')).toEqual([{ write: false, edit: false }])
  const names = plugins.map(row => row.name)
  for (const name of ['@deepseek-ai/dsh-tool-subagent', '@deepseek-ai/dsh-tool-subagent-control', '@deepseek-ai/dsh-tool-web', '@deepseek-ai/dsh-tool-fs-search',
    '@deepseek-ai/dsh-tool-todo', '@deepseek-ai/dsh-tool-ask-user', '@deepseek-ai/dsh-tool-present', '@deepseek-ai/dsh-plan-mode',
    '@deepseek-ai/dsh-plugin-manager/tools', '@deepseek-ai/dsh-plugin-market/tools', '@deepseek-ai/dsh-tool-schedule', '@deepseek-ai/dsh-tool-goal',
    '@deepseek-ai/dsh-command-goal', '@deepseek-ai/dsh-tool-workflow', '@deepseek-ai/dsh-workflow-ptc']) expect(names, name).not.toContain(name)
})
