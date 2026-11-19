/** Resolves and seeds per-role default models on newly created sessions without mutating the global DSH default. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { RoleModel } from '../policy.ts'

/** Resolve a configured route through the live provider; catalog membership is not a restriction. */
export async function resolveRoleModel(ctx: Context, model: RoleModel, autoHard?: boolean): Promise<ModelSelection> {
  let effort = model.reasoningEffort
  if (!effort && autoHard !== undefined) {
    try {
      const info = await ctx.llm.resolveModelInfo(model.provider, model.model, AbortSignal.timeout(3000))
      const supported = info.reasoning?.efforts ?? []
      // Adapter metadata is ordered from least to greatest; identifiers are opaque.
      effort = (autoHard ? supported.at(-1) : supported[0])?.id
    } catch { /* Capability lookup is optional; leave the provider's default in place. */ }
  }
  const config = { provider: model.provider, model: model.model }
  let value
  try {
    value = await ctx.llm.resolveCallConfig({ ...config, ...(effort ? { reasoningEffort: ReasoningEffortId(effort) } : {}) })
  } catch (error) {
    // A dynamic provider may change its capability list between the two queries.
    // Only automatic choices may fall back; explicitly configured effort must be honored or rejected.
    if (model.reasoningEffort || !effort || autoHard === undefined) throw error
    value = await ctx.llm.resolveCallConfig(config)
  }
  return { provider: value.provider, model: value.model, ...(value.reasoningEffort ? { reasoningEffort: value.reasoningEffort } : {}) }
}

/** Seed a role's configured model onto a brand-new session before its first request, leaving later manual or durable selections intact. */
export async function initializeRoleModel(ctx: Context, agent: Agent, model: RoleModel | null, overrideInherited = false, autoHard?: boolean): Promise<void> {
  if (!model) return
  if (overrideInherited && agent.session.inheritedEventCount > 0) {
    // A fork may inherit its parent's selection; only the child's own selection or request makes its route durable.
    if (agent.session.snapshotEvents(agent.session.inheritedEventCount).some(event => event.type === 'model/selection' || event.type === 'request/header')) return
  } else if (agent.session.requestHeader() || agent.session.snapshotEvents().some(event => event.type === 'model/selection')) return
  const selected = await resolveRoleModel(ctx, model, autoHard)
  // Avoid selectModel because it mutates the global DSH default; inject the selection for the initial request only.
  agent.session.append('model/selection', selected)
  let initial = true
  let assembled: ModelSelection | undefined
  agent.ctx.effect(() => {
    const disposers = [
      agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
        const selection = initial ? selected : undefined
        const result = await next()
        assembled = selection
        return selection ? { ...result, variables: { ...result.variables, provider: selection.provider, model: selection.model } } : result
      }, { prepend: true }),
      agent.ctx.on('agent/request', async (_payload, next) => {
        const result = await next()
        if (!assembled) return result
        const { reasoningEffort: _inherited, ...rest } = result
        return { ...rest, ...assembled }
      }, { prepend: true }),
      ctx.on('session/event', (session, event) => {
        if (session === agent.session && (event.type === 'request/header' || event.type === 'model/selection')) initial = false
      }),
    ]
    return () => disposers.forEach(dispose => dispose())
  })
  await ctx.sessionPersistence.flush()
}
