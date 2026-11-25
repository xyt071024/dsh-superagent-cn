import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { agentEvents, installModelSelection, type Agent, type ModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { initializeRoleModel, resolveRoleModel } from '../src/app/role-models.ts'
import { Sessions } from '../src/app/sessions.ts'
import { KV } from '../src/kv.ts'
const contexts: Context[] = []

it('selects only adapter-supported automatic efforts and preserves explicit choices', async () => {
  const ctx = new Context(); contexts.push(ctx)
  const capabilities = vi.fn(async () => ({ reasoning: { efforts: [{ id: 'tiny', name: 'Tiny' }, { id: 'deep', name: 'Deep' }] } }))
  const resolve = vi.fn(async (value: unknown) => value)
  ctx.reflect.provide('llm', { resolveModelInfo: capabilities, resolveCallConfig: resolve })
  const model = { provider: 'p', model: 'm' }
  expect(await resolveRoleModel(ctx, model, false)).toEqual({ ...model, reasoningEffort: 'tiny' })
  expect(await resolveRoleModel(ctx, model, true)).toEqual({ ...model, reasoningEffort: 'deep' })
  expect(await resolveRoleModel(ctx, { ...model, reasoningEffort: 'custom' }, true)).toEqual({ ...model, reasoningEffort: 'custom' })
  expect(capabilities).toHaveBeenCalledTimes(2)
})

it('uses the default when capabilities are unavailable or change during automatic selection', async () => {
  const ctx = new Context(); contexts.push(ctx)
  const capabilities = vi.fn().mockRejectedValueOnce(new Error('no metadata')).mockResolvedValue({ reasoning: { efforts: [{ id: 'deep' }] } })
  const resolve = vi.fn(async (value: { reasoningEffort?: string }) => {
    if (value.reasoningEffort) throw new Error('no longer supported')
    return value
  })
  ctx.reflect.provide('llm', { resolveModelInfo: capabilities, resolveCallConfig: resolve })
  const model = { provider: 'p', model: 'm' }
  expect(await resolveRoleModel(ctx, model, true)).toEqual(model)
  expect(await resolveRoleModel(ctx, model, true)).toEqual(model)
  await expect(resolveRoleModel(ctx, { ...model, reasoningEffort: 'deep' }, true)).rejects.toThrow('no longer supported')
})

it('binds configured and inherited models to distinct team child sessions and enforces the task limit', async () => {
  const ctx = new Context(); contexts.push(ctx)
  ctx.reflect.provide('llm', { resolveCallConfig: async (value: unknown) => value,
    resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }) })
  ctx.reflect.provide('sessionPersistence', { flush: async () => {} })
  ctx.reflect.provide('agentTeams', { tryMembership: () => ({ role: 'teammate', name: 'worker', root: {} }) })
  const state = { inherited: { provider: 'parent', model: 'at-start' }, models: [{ provider: 'chosen', model: 'one' }, null], max: 2, slots: {}, autoHard: true }
  const data = new Map<string, unknown>([[KV.sessions.teamModels('ticket'), state]])
  const store = { get: (key: string) => data.get(key), set: (key: string, value: unknown) => data.set(key, value), tickets: { get: () => ({}) } }
  const host = { context: ctx, store, effects: { handle: () => {} }, usage: {} }
  const sessions = new Sessions(host as never)
  const make = (id: string) => {
    const child = new Context(); contexts.push(child)
    child.reflect.provide('tools', { get: () => undefined, restrict: () => () => {}, guard: () => () => {} })
    const session = Session.create(SessionId(id))
    Object.defineProperty(session, 'header', { value: { parentSession: 'worker-ticket' } })
    return { id, ctx: child, session } as unknown as Agent
  }
  const first = make('child-one'), second = make('child-two'), third = make('child-three')
  const bind = (agent: Agent) => (sessions as unknown as { limitSubagent(agent: Agent): Promise<void> }).limitSubagent(agent)
  await bind(first); await bind(second)
  expect(first.session.snapshotEvents().find(event => event.type === 'model/selection')?.data).toMatchObject({ provider: 'chosen', model: 'one', reasoningEffort: 'high' })
  expect(second.session.snapshotEvents().find(event => event.type === 'model/selection')?.data).toMatchObject({ provider: 'parent', model: 'at-start', reasoningEffort: 'high' })
  await expect(bind(third)).rejects.toThrow('2 child-session limit')
})
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())); vi.restoreAllMocks() })
async function fixture() {
  const ctx = new Context(); contexts.push(ctx); await ctx.plugin(SystemPrompt)
  const resolve = vi.fn(async value => value)
  const flush = vi.fn(async () => {})
  ctx.reflect.provide('llm', { resolveCallConfig: resolve })
  ctx.reflect.provide('sessionPersistence', { flush })
  const session = Session.create(SessionId('role-model'))
  const agent = { ctx, session } as Agent
  const host: ModelSelectionRef = { get current() { return session.requestHeader()?.config ?? { provider: 'host', model: 'default', reasoningEffort: ReasoningEffortId('high') } }, assembled: undefined }
  installModelSelection(ctx, host)
  const request = () => agentEvents(ctx, agent).waterfall('agent/request', { turn: 1, step: 1, signal: new AbortController().signal }, async () => ({ provider: 'seed', model: 'seed' }))
  const record = (selection: ModelSelection) => { const event = session.append('request/header', { header: { config: selection }, reason: 'initial' }); ctx.emit('session/event', session, event) }
  return { ctx, agent, host, resolve, flush, request, record }
}
it('keeps prompt variables and initial routing on the role model without saving the host default', async () => {
  const { ctx, agent, request, record, flush } = await fixture()
  await initializeRoleModel(ctx, agent, { provider: 'worker-provider', model: 'worker-model' })
  expect((await ctx.systemPrompt.assemble()).variables).toMatchObject({ provider: 'worker-provider', model: 'worker-model' })
  const selected = await request()
  expect(selected).toEqual({ provider: 'worker-provider', model: 'worker-model' })
  expect(agent.session.snapshotEvents().some(event => event.type === 'model/selection')).toBe(true)
  expect(flush).toHaveBeenCalledOnce()
  record(selected)
  // A retry of the same assembled step keeps the same model even after the header is persisted.
  expect(await request()).toEqual(selected)
  await ctx.systemPrompt.assemble()
  expect(await request()).toEqual(selected)
})
it('lets a later explicit selection win without changing the in-flight assembled step', async () => {
  const { ctx, agent, host, request } = await fixture()
  await initializeRoleModel(ctx, agent, { provider: 'worker', model: 'one' })
  await ctx.systemPrompt.assemble()
  const manual = { provider: 'manual', model: 'two', reasoningEffort: ReasoningEffortId('low') }
  Object.defineProperty(host, 'current', { value: manual, configurable: true })
  const event = agent.session.append('model/selection', manual); ctx.emit('session/event', agent.session, event)
  expect(await request()).toEqual({ provider: 'worker', model: 'one' })
  await ctx.systemPrompt.assemble()
  expect(await request()).toEqual(manual)
})
it.each(['header', 'selection'])('preserves a resumed Session with existing %s', async kind => {
  const { ctx, agent, resolve } = await fixture()
  const existing = { provider: 'existing', model: 'keep' }
  if (kind === 'header') agent.session.append('request/header', { header: { config: existing }, reason: 'initial' })
  else agent.session.append('model/selection', existing)
  await initializeRoleModel(ctx, agent, { provider: 'worker', model: 'new' })
  expect(resolve).not.toHaveBeenCalled()
})
it('inherits the host when unset and fails unavailable routes before recording a selection', async () => {
  const { ctx, agent, resolve, request } = await fixture()
  await initializeRoleModel(ctx, agent, null)
  await ctx.systemPrompt.assemble()
  expect(await request()).toMatchObject({ provider: 'host', model: 'default' })
  resolve.mockRejectedValueOnce(new Error('unknown provider'))
  await expect(initializeRoleModel(ctx, agent, { provider: 'unknown', model: 'x' })).rejects.toThrow('unknown provider')
  expect(agent.session.snapshotEvents().some(event => event.type === 'model/selection')).toBe(false)
})
