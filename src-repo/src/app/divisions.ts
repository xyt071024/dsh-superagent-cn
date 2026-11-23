/**
 * 多会话规划与独立分工会话协调器（M07，对应需求 R02–R05）。
 *
 * 将复杂任务拆分为带有稳定分工 ID、依赖关系和模型槽位的独立持久 DSH 会话（可在宿主会话列表直接打开），
 * 并支持依赖自动唤醒、事件 ID 去重回报、请求边界模型记录以及 60% 上下文接班后继续路由。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { z } from 'zod'
import { key } from '../core/index.ts'
import { KV, type ComplexityVerdict, type DivisionModelCall, type DivisionRecord, type TaskPlan } from '../kv.ts'
import type { RoleModel } from '../policy.ts'
import { assessComplexity, multiSession, reserveSessionSlot } from './routing.ts'
import type { SessionRelay } from './relay.ts'
import type { Sessions } from './sessions.ts'
import type { Store } from './store.ts'
import { tool, type Tool } from './tools/tool.ts'

export interface DivisionSpec {
  divisionId: string
  title: string
  brief: string
  dependsOn?: string[] | undefined
}

export interface DispatchRequest {
  taskId?: string | undefined
  title: string
  originSessionId: string
  directory?: string | undefined
  brief: string
  difficulty?: number | null | undefined
  reason?: string | undefined
  planKey?: string | undefined
  divisions?: DivisionSpec[] | undefined
}

export interface DivisionsHost {
  readonly context: Context
  readonly store: Store
  readonly sessions: Pick<Sessions, 'ensureDivision' | 'prompt' | 'holds' | 'sessionModel'>
  readonly relay: Pick<SessionRelay, 'route'>
  readonly masterId: string
  readonly coordinatorCwd: string
  report?(detail: string, state?: 'ready' | 'error'): void
}

const now = (): string => new Date().toISOString()

function detectCycle(divisions: readonly DivisionSpec[]): string | undefined {
  const map = new Map(divisions.map(d => [d.divisionId, d.dependsOn ?? []]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const dfs = (id: string): string | undefined => {
    if (visited.has(id)) return undefined
    if (visiting.has(id)) return id
    visiting.add(id)
    for (const dep of map.get(id) ?? []) {
      if (!map.has(dep)) return `unknown dependency "${dep}" on "${id}"`
      const hit = dfs(dep)
      if (hit) return hit
    }
    visiting.delete(id)
    visited.add(id)
    return undefined
  }
  for (const d of divisions) {
    const issue = dfs(d.divisionId)
    if (issue) return issue.startsWith('unknown ') ? issue : `dependency cycle involving "${issue}"`
  }
  return undefined
}

/** Coordinates multi-session planning, independent division sessions, dependencies, and reviews. */
export class DivisionCoordinator {
  constructor(private readonly host: DivisionsHost) {}

  get(taskId: string): TaskPlan | undefined {
    return this.host.store.get(KV.sessions.divisions(taskId))
  }

  list(): TaskPlan[] {
    return this.host.store.keys(KV.sessions.divisions)
      .map(name => this.host.store.get(name))
      .filter((plan): plan is TaskPlan => plan !== undefined)
  }

  /**
   * 从用户对话或任务入口规划并派发工作：
   * - 简单任务或单会话模式：不开额外会话（extraSessions = 0），记录判定依据与未开原因。
   * - 复杂多分工任务：按 maxSessions 预留槽位，绑定独立可打开会话与模型槽位，按依赖启动可执行分工。
   * - 同一 (taskId, planKey) 重放幂等：直接返回已有计划，不重复开新会话。
   */
  async dispatch(request: DispatchRequest): Promise<{ plan: TaskPlan; reused: boolean; extraSessions: number }> {
    const { store, sessions } = this.host
    const routing = store.settings().routing
    const planKey = request.planKey?.trim() || key(request.originSessionId, request.title, request.brief)
    const taskId = request.taskId?.trim() || `task-${key(request.originSessionId, planKey).slice(0, 12)}`
    const existing = store.get(KV.sessions.divisions(taskId))
    if (existing && existing.planKey === planKey) {
      return { plan: existing, reused: true, extraSessions: existing.divisions.length }
    }

    const specs = request.divisions ?? []
    const originModel = sessions.sessionModel(request.originSessionId) ?? sessions.sessionModel(this.host.masterId)
    const assessment = assessComplexity({
      threshold: routing.difficultyThreshold,
      explicitDifficulty: request.difficulty,
      brief: request.brief,
      plannedDivisions: specs.length > 1 ? specs.length : undefined,
    })

    const multi = multiSession(routing)
    let extraSessionsAllowed = true
    let skipReason: string | undefined
    if (!multi) {
      extraSessionsAllowed = false
      skipReason = 'single-session-mode'
    } else if (!assessment.hard) {
      extraSessionsAllowed = false
      skipReason = 'below-difficulty-threshold'
    } else if (specs.length <= 1) {
      extraSessionsAllowed = false
      skipReason = specs.length === 0 ? 'no-split-needed' : 'single-division'
    }

    const complexity: ComplexityVerdict = {
      ...assessment,
      reason: request.reason?.trim() || assessment.reason,
      extraSessionsAllowed,
      ...(skipReason ? { skipReason } : {}),
    }
    const directory = request.directory?.trim() || this.host.coordinatorCwd
    const timestamp = now()

    if (!extraSessionsAllowed) {
      const plan: TaskPlan = {
        taskId,
        title: request.title,
        originSessionId: request.originSessionId,
        originModel,
        planKey,
        directory,
        complexity,
        maxSessions: routing.maxSessions,
        slots: {},
        divisions: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      store.set(KV.sessions.divisions(taskId), plan)
      return { plan, reused: false, extraSessions: 0 }
    }

    if (specs.length > routing.maxSessions) {
      throw new Error(`Cannot open ${specs.length} division sessions; maxSessions limit is ${routing.maxSessions}`)
    }
    const duplicate = specs.find((d, index) => specs.findIndex(other => other.divisionId === d.divisionId) !== index)
    if (duplicate) throw new Error(`Duplicate divisionId: ${duplicate.divisionId}`)
    const cycleError = detectCycle(specs)
    if (cycleError) throw new Error(`Invalid division dependencies: ${cycleError}`)

    const slots: Record<string, number> = {}
    const divisions: DivisionRecord[] = specs.map(spec => {
      const slot = reserveSessionSlot(slots, spec.divisionId, routing.maxSessions)
      const configured = routing.sessionModels[slot] ?? null
      const baseModel = configured ?? originModel
      const model: RoleModel | null = baseModel
        ? {
            provider: baseModel.provider,
            model: baseModel.model,
            ...(routing.thinking !== 'auto'
              ? { reasoningEffort: routing.thinking }
              : baseModel.reasoningEffort ? { reasoningEffort: baseModel.reasoningEffort } : {}),
          }
        : null
      const dependsOn = [...(spec.dependsOn ?? [])]
      const sessionId = `div-${key(`${taskId}:${spec.divisionId}`, '1').slice(0, 14)}-r1`
      return {
        divisionId: spec.divisionId,
        title: spec.title,
        brief: spec.brief,
        dependsOn,
        slot,
        sessionId,
        previousSessions: [],
        generation: 1,
        model,
        modelCalls: [],
        status: dependsOn.length === 0 ? 'running' : 'waiting_deps',
        deliveredEventIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    })

    const plan: TaskPlan = {
      taskId,
      title: request.title,
      originSessionId: request.originSessionId,
      originModel,
      planKey,
      directory,
      complexity,
      maxSessions: routing.maxSessions,
      slots,
      divisions,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    store.atomic(() => {
      store.set(KV.sessions.divisions(taskId), plan)
      for (const div of divisions) {
        store.set(KV.sessions.divisionOwner(div.sessionId), { taskId, divisionId: div.divisionId })
      }
    })

    for (const div of divisions) {
      if (div.status === 'running') {
        await this.launchDivision(plan, div, [])
      }
    }
    return { plan: store.get(KV.sessions.divisions(taskId)) ?? plan, reused: false, extraSessions: divisions.length }
  }

  private async launchDivision(
    plan: TaskPlan,
    div: DivisionRecord,
    dependencyOutputs: { divisionId: string; title: string; result: string }[],
  ): Promise<void> {
    const { store, sessions } = this.host
    const targetSession = this.host.relay.route(div.sessionId)
    try {
      await sessions.ensureDivision(targetSession, plan.directory, `[${plan.title}] ${div.title}`, {
        taskId: plan.taskId,
        divisionId: div.divisionId,
        model: div.model,
        autoHard: plan.complexity.hard,
      })
      const depSection = dependencyOutputs.length > 0
        ? [
            '',
            '## Upstream dependency deliverables',
            ...dependencyOutputs.map(dep => `- **${dep.title} (${dep.divisionId})**: ${dep.result}`),
          ]
        : []
      const promptText = [
        `You own division "${div.title}" (${div.divisionId}) for task ${plan.taskId} ("${plan.title}").`,
        `Working directory: ${plan.directory}`,
        '',
        '## Division assignment',
        div.brief,
        ...depSection,
        '',
        'Report progress, blockers, or final completion with orchestrator_division_report (include a unique event_id).',
      ].join('\n')
      await sessions.prompt(targetSession, `division-start:${plan.taskId}:${div.divisionId}`, promptText, 'queue')
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const latest = store.get(KV.sessions.divisions(plan.taskId))
      const row = latest?.divisions.find(item => item.divisionId === div.divisionId)
      if (latest && row) {
        row.status = 'failed'
        row.error = reason
        row.updatedAt = now()
        latest.updatedAt = row.updatedAt
        store.set(KV.sessions.divisions(plan.taskId), latest)
      }
      this.host.report?.(`division ${div.divisionId} (${targetSession}) could not start: ${reason}`, 'error')
    }
  }

  /** 记录分工汇报、去重并回执、通知主协调者、并唤醒依赖方或触发独立复查。 */
  async reportDivision(input: {
    taskId: string
    divisionId: string
    state: 'progress' | 'completed' | 'blocked' | 'failed'
    summary: string
    result?: string | undefined
    eventId: string
  }): Promise<{ deduplicated: boolean; status: string; unblocked: string[]; reviewSessionId?: string }> {
    const { store, sessions } = this.host
    const plan = store.get(KV.sessions.divisions(input.taskId))
    if (!plan) throw new Error(`Task plan ${input.taskId} not found`)
    const div = plan.divisions.find(item => item.divisionId === input.divisionId)
    if (!div) throw new Error(`Division ${input.divisionId} not found in ${input.taskId}`)
    if (div.deliveredEventIds.includes(input.eventId)) {
      return { deduplicated: true, status: div.status, unblocked: [], ...(plan.review ? { reviewSessionId: plan.review.sessionId } : {}) }
    }

    div.deliveredEventIds = [...div.deliveredEventIds.slice(-199), input.eventId]
    div.status = input.state === 'progress' ? 'running' : input.state
    div.latestProgress = input.summary
    if (input.result !== undefined) div.result = input.result
    else if (input.state === 'completed' && div.result === undefined) div.result = input.summary
    if (input.state === 'failed') div.error = input.summary
    div.updatedAt = now()
    plan.updatedAt = div.updatedAt

    const toWake: DivisionRecord[] = []
    if (div.status === 'completed') {
      for (const candidate of plan.divisions) {
        if (candidate.status !== 'waiting_deps') continue
        const ready = candidate.dependsOn.every(depId => plan.divisions.find(d => d.divisionId === depId)?.status === 'completed')
        if (ready) {
          candidate.status = 'running'
          candidate.updatedAt = now()
          toWake.push(candidate)
        }
      }
    }
    store.set(KV.sessions.divisions(input.taskId), plan)

    const originTarget = this.host.relay.route(plan.originSessionId)
    const notifyText = `[division_report] task=${plan.taskId} division=${div.divisionId} (${div.title}) state=${div.status} event_id=${input.eventId}\n${input.summary}`
    await sessions.prompt(originTarget, `div-notify:${plan.taskId}:${div.divisionId}:${input.eventId}`, notifyText, 'queue')
      .catch(() => { /* 主会话可能未加载；报告已持久写入任务板 */ })

    for (const nextDiv of toWake) {
      const outputs = nextDiv.dependsOn.map(depId => {
        const dep = plan.divisions.find(d => d.divisionId === depId)!
        return { divisionId: dep.divisionId, title: dep.title, result: dep.result ?? dep.latestProgress ?? '(completed)' }
      })
      await this.launchDivision(plan, nextDiv, outputs)
    }

    let reviewSessionId = plan.review?.sessionId
    const allDone = plan.divisions.length > 0 && plan.divisions.every(d => d.status === 'completed')
    if (allDone && !plan.review && store.settings().executor.reviewEnabled) {
      reviewSessionId = await this.startReview(plan)
    }
    return {
      deduplicated: false,
      status: div.status,
      unblocked: toWake.map(d => d.divisionId),
      ...(reviewSessionId ? { reviewSessionId } : {}),
    }
  }

  /** 启动绑定真实可打开会话的独立复查。 */
  async startReview(plan: TaskPlan, round = 1): Promise<string> {
    const { store, sessions } = this.host
    const reviewSessionId = `div-review-${key(plan.taskId, String(round)).slice(0, 12)}-r${round}`
    const reviewDivisionId = `__review_r${round}`
    const updated = store.get(KV.sessions.divisions(plan.taskId)) ?? plan
    updated.review = { sessionId: reviewSessionId, round, state: 'pending' }
    updated.updatedAt = now()
    store.atomic(() => {
      store.set(KV.sessions.divisions(plan.taskId), updated)
      store.set(KV.sessions.divisionOwner(reviewSessionId), { taskId: plan.taskId, divisionId: reviewDivisionId })
    })
    const evalModel = store.settings().eval.model ?? updated.originModel
    await sessions.ensureDivision(reviewSessionId, updated.directory, `[复查 R${round}] ${updated.title}`, {
      taskId: plan.taskId,
      divisionId: reviewDivisionId,
      model: evalModel,
      autoHard: true,
    })
    const summaryLines = updated.divisions.map(d => `- ${d.title} (${d.divisionId}, session ${d.sessionId}): ${d.result ?? d.latestProgress ?? d.status}`)
    await sessions.prompt(reviewSessionId, `div-review-start:${plan.taskId}:r${round}`, [
      `Independently review task ${plan.taskId} ("${updated.title}") in ${updated.directory}.`,
      '## Division deliverables',
      ...summaryLines,
      '',
      'Inspect files and deliverables, then call orchestrator_division_review_submit with approved, summary, and findings.',
    ].join('\n'), 'queue')
    return reviewSessionId
  }

  async submitReview(input: { taskId: string; approved: boolean; summary: string; findings?: string[] | undefined }): Promise<TaskPlan> {
    const { store, sessions } = this.host
    const plan = store.get(KV.sessions.divisions(input.taskId))
    if (!plan || !plan.review) throw new Error(`No active division review for ${input.taskId}`)
    plan.review = {
      ...plan.review,
      state: input.approved ? 'passed' : 'failed',
      summary: input.summary,
      ...(input.findings ? { findings: input.findings } : {}),
    }
    plan.updatedAt = now()
    store.set(KV.sessions.divisions(input.taskId), plan)
    const originTarget = this.host.relay.route(plan.originSessionId)
    await sessions.prompt(originTarget, `div-review-result:${plan.taskId}:r${plan.review.round}`,
      `[division_review] task=${plan.taskId} round=${plan.review.round} state=${plan.review.state}\n${input.summary}`, 'queue')
      .catch(() => {})
    return plan
  }

  /** 由协调者或用户向指定分工对话投递补充指令，自动跟随 60% 接班路由并按 requestId 去重。 */
  async sendToDivision(input: { taskId: string; divisionId: string; message: string; requestId: string }): Promise<{
    sent: boolean; deduplicated: boolean; sessionId: string
  }> {
    const { store, sessions } = this.host
    const plan = store.get(KV.sessions.divisions(input.taskId))
    const div = plan?.divisions.find(item => item.divisionId === input.divisionId)
    if (!plan || !div) throw new Error(`Division ${input.divisionId} not found in ${input.taskId}`)
    if (div.deliveredEventIds.includes(input.requestId)) {
      return { sent: false, deduplicated: true, sessionId: this.host.relay.route(div.sessionId) }
    }
    const target = this.host.relay.route(div.sessionId)
    await sessions.ensureDivision(target, plan.directory, `[${plan.title}] ${div.title}`, {
      taskId: plan.taskId, divisionId: div.divisionId, model: div.model, autoHard: plan.complexity.hard,
    })
    await sessions.prompt(target, `div-send:${input.taskId}:${input.divisionId}:${input.requestId}`, input.message, 'queue')
    div.deliveredEventIds = [...div.deliveredEventIds.slice(-199), input.requestId]
    div.updatedAt = now()
    plan.updatedAt = div.updatedAt
    store.set(KV.sessions.divisions(input.taskId), plan)
    return { sent: true, deduplicated: false, sessionId: target }
  }

  /** 在请求边界记录该分工对话实际使用的供应商、模型与思考等级。 */
  observeModelCall(sessionId: string, call: Omit<DivisionModelCall, 'at'>): void {
    const owner = this.host.store.get(KV.sessions.divisionOwner(sessionId))
    if (!owner) return
    const plan = this.host.store.get(KV.sessions.divisions(owner.taskId))
    const div = plan?.divisions.find(item => item.divisionId === owner.divisionId)
    if (!plan || !div) return
    div.modelCalls = [...div.modelCalls.slice(-49), { at: now(), ...call }]
    div.updatedAt = now()
    plan.updatedAt = div.updatedAt
    this.host.store.set(KV.sessions.divisions(owner.taskId), plan)
  }

  /** 为独立分工会话及独立复查会话注册的工具集。 */
  divisionTools(_agent: Agent, taskId: string, divisionId: string): Tool[] {
    const coordinator = this
    const isReviewer = divisionId.startsWith('__review_')
    const tools: Tool[] = [
      tool({
        name: 'orchestrator_division_context',
        description: 'Read this task plan, your division brief, and the completed deliverables of your upstream dependencies.',
        schema: z.object({}).strict(),
        execute: async () => {
          const plan = coordinator.get(taskId)
          if (!plan) throw new Error(`Task plan ${taskId} not found`)
          const self = plan.divisions.find(d => d.divisionId === divisionId)
          const deps = (self?.dependsOn ?? []).map(depId => {
            const dep = plan.divisions.find(d => d.divisionId === depId)
            return dep ? { divisionId: dep.divisionId, title: dep.title, status: dep.status, result: dep.result ?? dep.latestProgress } : { divisionId: depId }
          })
          return { taskId: plan.taskId, title: plan.title, directory: plan.directory, division: self, dependencies: deps, review: plan.review }
        },
      }),
    ]
    if (isReviewer) {
      tools.push(tool({
        name: 'orchestrator_division_review_submit',
        description: 'Submit the independent review verdict and findings for this task.',
        schema: z.object({
          approved: z.boolean(),
          summary: z.string().min(1).max(4000),
          findings: z.array(z.string().min(1)).optional(),
        }).strict(),
        execute: async args => {
          const updated = await coordinator.submitReview({ taskId, approved: args.approved, summary: args.summary, findings: args.findings })
          return { recorded: true, review: updated.review }
        },
      }))
    } else {
      tools.push(tool({
        name: 'orchestrator_division_report',
        description: 'Report progress, blocked status, failed status, or final completion of this division to the coordinator and dependent divisions.',
        schema: z.object({
          state: z.enum(['progress', 'completed', 'blocked', 'failed']),
          summary: z.string().min(1).max(4000),
          result: z.string().max(10000).optional(),
          event_id: z.string().min(1).max(120).describe('Unique idempotency ID for this report event.'),
        }).strict(),
        execute: async args => coordinator.reportDivision({
          taskId, divisionId, state: args.state, summary: args.summary, result: args.result, eventId: args.event_id,
        }),
      }))
    }
    return tools
  }
}
