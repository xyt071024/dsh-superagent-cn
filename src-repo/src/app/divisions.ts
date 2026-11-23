/**
 * 多会话规划与独立分工会话协调器（M07，对应需求 R02–R05）。
 *
 * 将复杂任务拆分为带有稳定分工 ID、依赖关系和模型槽位的独立持久 DSH 会话（可在宿主会话列表直接打开），
 * 并支持依赖自动唤醒、事件 ID 去重回报、持久待投递队列、并发原子合并、退回多轮复查、请求边界模型记录及 60% 接班路由。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import { key } from '../core/index.ts'
import { KV, type ComplexityVerdict, type DivisionModelCall, type DivisionRecord, type PendingDivisionDelivery, type ReviewHistoryEntry, type TaskPlan } from '../kv.ts'
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

const MAX_REVIEW_ROUNDS = 3
const now = (): string => new Date().toISOString()

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface DomainTrack {
  id: string
  title: string
  pattern: RegExp
}

const DOMAIN_TRACKS: readonly DomainTrack[] = [
  { id: 'api', title: 'API & Backend Implementation', pattern: /\bapi\b|接口|后端|服务端|backend|endpoint|rest|graphql/i },
  { id: 'ui', title: 'Frontend & UI Implementation', pattern: /\bui\b|前端|界面|页面|组件|frontend|client|view/i },
  { id: 'db', title: 'Database & Schema Migration', pattern: /\bdb\b|数据库|数据表|存储|迁移|database|schema|migration|sqlite|sql/i },
  { id: 'auth', title: 'Authentication & Permissions', pattern: /认证|鉴权|权限|登录|\bauth(?:entication|orization)?\b|permission|rbac/i },
  { id: 'security', title: 'Security & Audit', pattern: /安全|审计|漏洞|security|audit|vulnerability/i },
  { id: 'test', title: 'Testing & Verification', pattern: /测试|联调|回归|验收|\btest(?:ing|s)?\b|\bqa\b|\be2e\b|verification/i },
  { id: 'docs', title: 'Documentation & Guides', pattern: /文档|说明|手册|\bdocs?\b|documentation/i },
  { id: 'deploy', title: 'Build & Deployment', pattern: /部署|发布|构建|打包|\bdeploy(?:ment)?\b|release|\bci\b/i },
]

function inferDomainTrack(text: string, usedIds: Set<string>, index: number): { id: string; title: string } {
  for (const track of DOMAIN_TRACKS) {
    if (!usedIds.has(track.id) && track.pattern.test(text)) {
      usedIds.add(track.id)
      return { id: track.id, title: text.trim().slice(0, 80) || track.title }
    }
  }
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 16)
  let candidate = slug && !usedIds.has(slug) ? slug : `part-${index + 1}`
  let suffix = 2
  while (usedIds.has(candidate)) {
    candidate = `part-${index + 1}-${suffix++}`
  }
  usedIds.add(candidate)
  return { id: candidate, title: text.trim().slice(0, 80) || `Deliverable ${index + 1}` }
}

/**
 * 从普通聊天或复杂工单文本中自动提取独立可并行的分工清单（M07-g）：
 * 1. 优先识别显式角色/并行分句（如“一人做 API，一人做前端 UI，一人做测试”或“接口、前端、测试分别开对话并行做”）或编号/列表子项；
 * 2. 其次识别任务中提及的多个独立领域交付物（API/后端、前端/UI、数据库/迁移、认证、安全审计、测试/验证、文档、部署等）；
 * 3. 若未拆分出多项独立交付物，则回退为 1 个独立分析/执行分工，总数严格不超过 maxSessions。
 */
export function planDivisionsFromText(title: string, brief: string, maxSessions: number): DivisionSpec[] {
  const limit = Math.max(1, maxSessions)
  const combined = `${title}\n${brief}`.trim()
  const compact = combined.replace(/(\b[a-zA-Z]{3,}(?:\s+[a-zA-Z]{3,}){1,4})\s*(?:\1\s*){3,}/g, '$1').trim()
  const specs: DivisionSpec[] = []
  const usedIds = new Set<string>()

  // 1. 显式“一人做 X / 一个对话负责 Y / 分别做 Z”分句
  const roleMatches = [...compact.matchAll(/(?:一人|一个(?:人|对话|会话|成员|分工|子任务)?|各自)(?:负责|做|处理|实现|开发|编写|完成)\s*([^，,；;。.\n]+)/g)]
    .map(m => m[1]!.trim())
    .filter(s => s.length > 0 && s.length <= 120)
  if (roleMatches.length >= 2) {
    for (const [idx, clause] of roleMatches.slice(0, limit).entries()) {
      const { id, title: itemTitle } = inferDomainTrack(clause, usedIds, idx)
      specs.push({
        divisionId: id,
        title: itemTitle,
        brief: `Deliverable (${id}): ${clause}.\nContext: ${compact.slice(0, 3000)}\nReport progress and final deliverable using orchestrator_division_report.`,
      })
    }
    return specs
  }

  // 2. 显式编号或项目符号清单
  const bulletMatches = [...compact.matchAll(/(?:^|\n)\s*(?:\d+[.)、]|[-*•])\s*([^\n]+)/g)]
    .map(m => m[1]!.trim())
    .filter(s => s.length > 0 && s.length <= 160)
  if (bulletMatches.length >= 2) {
    for (const [idx, item] of bulletMatches.slice(0, limit).entries()) {
      const { id, title: itemTitle } = inferDomainTrack(item, usedIds, idx)
      specs.push({
        divisionId: id,
        title: itemTitle,
        brief: `Deliverable (${id}): ${item}.\nContext: ${compact.slice(0, 3000)}\nReport progress and final deliverable using orchestrator_division_report.`,
      })
    }
    return specs
  }

  // 3. 显式并列枚举（如“模块 A、模块 B、模块 C 分别开对话并行做”或“拆分为：模块 A、模块 B、模块 C”）
  const enumPrefixMatch = /(?:分成|拆分为?|分为|开启|建立)[^：:\n]{0,20}[：:]\s*([^\n。]+)/.exec(compact)
    ?? /([^\n。；;：:]{4,120}?)\s*(?:分别|各自|并行)(?:开对话|开启|执行|开发|实现|做|处理|进行|完成)/.exec(compact)
  if (enumPrefixMatch?.[1]) {
    const rawItems = enumPrefixMatch[1]
      .split(/[、，,；;]|(?:\s+(?:以及|和|与|and)\s+)/i)
      .map(s => s.replace(/^(?:一人|一个(?:人|对话|会话|成员)?)(?:负责|做|处理|实现|开发|编写|完成)?\s*/, '').trim())
      .filter(s => s.length >= 2 && s.length <= 80 && !/^(?:分成|拆分为?|三个|两个|四个|五个|多个|相互独立|可并行)/.test(s))
    if (rawItems.length >= 2) {
      for (const [idx, item] of rawItems.slice(0, limit).entries()) {
        const { id, title: itemTitle } = inferDomainTrack(item, usedIds, idx)
        specs.push({
          divisionId: id,
          title: itemTitle,
          brief: `Deliverable (${id}): ${item}.\nContext: ${compact.slice(0, 3000)}\nReport progress and final deliverable using orchestrator_division_report.`,
        })
      }
      return specs
    }
  }

  // 4. 多领域/模块交付物识别（如“接口、前端、测试分别开对话并行做”或跨模块重构/迁移/审计）
  const matchedTracks = DOMAIN_TRACKS.filter(track => track.pattern.test(compact))
  if (matchedTracks.length >= 2) {
    for (const track of matchedTracks.slice(0, limit)) {
      usedIds.add(track.id)
      specs.push({
        divisionId: track.id,
        title: `${track.title}: ${title.slice(0, 60)}`,
        brief: `Own the "${track.title}" deliverable for task "${title}".\nTask details: ${compact.slice(0, 3000)}\nReport progress and final deliverable using orchestrator_division_report.`,
      })
    }
    return specs
  }

  // 4. 兜底：单项复杂任务开启 1 个独立调查与执行分工
  return [{
    divisionId: 'investigate',
    title: `Independent investigation: ${title}`,
    brief: `Investigate this task independently without changing files or external state. Report concrete findings and risks using orchestrator_division_report. Task: ${combined.slice(0, 4000)}`,
  }]
}

function deliverableVersionOf(divisions: readonly DivisionRecord[]): string {
  return key(...divisions.map(d => `${d.divisionId}:${d.status}:${d.result ?? ''}:${d.latestProgress ?? ''}`))
}

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

function matchReworkDivisions(divisions: readonly DivisionRecord[], text: string, explicitIds?: readonly string[]): DivisionRecord[] {
  if (explicitIds && explicitIds.length > 0) {
    const set = new Set(explicitIds)
    return divisions.filter(d => set.has(d.divisionId))
  }
  const normalized = text.trim()
  if (!normalized) return []
  return divisions.filter(div => {
    const idToken = new RegExp(`(?:^|[^a-zA-Z0-9_-])${escapeRegExp(div.divisionId)}(?:$|[^a-zA-Z0-9_-])`, 'i')
    if (idToken.test(normalized)) return true
    const title = div.title.trim()
    if (title.length >= 2 && normalized.toLowerCase().includes(title.toLowerCase())) return true
    return false
  })
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

  /** 启动或恢复时扫描所有持久计划：补齐未创建/首次派工失败的分工、补发待投递通知、恢复待审复查会话。 */
  async resume(): Promise<void> {
    for (const plan of this.list()) {
      await this.reconcilePlan(plan.taskId).catch(error => {
        const reason = error instanceof Error ? error.message : String(error)
        this.host.report?.(`division plan ${plan.taskId} could not be resumed: ${reason}`, 'error')
      })
    }
  }

  /**
   * 核对已有计划的每个分工与待投递消息（M07-b / M07-c / M06-b）：
   * - 重试创建/首次派工失败或重启后缺失宿主会话的分工（复用稳定 sessionId 与投递 ID，保护正在运行及已完成成员）。
   * - 若分工已通过 60% 接班切换到新代次会话（generation > 1 或 previousSessions 非空），绝不向接班会话重投首次 division-start，
   *   仅在存在未完成接班激活时恢复接班唤醒（M06-b）。
   * - 重发尚未送达主会话或分工的待投递通知。
   */
  async reconcilePlan(taskId: string): Promise<TaskPlan> {
    const { store, sessions } = this.host
    await this.flushDeliveries(taskId)
    const plan = store.get(KV.sessions.divisions(taskId))
    if (!plan) throw new Error(`Task plan ${taskId} not found`)

    for (const div of plan.divisions) {
      const latest = store.get(KV.sessions.divisions(taskId)) ?? plan
      const currentDiv = latest.divisions.find(d => d.divisionId === div.divisionId) ?? div
      if (currentDiv.status === 'completed' || currentDiv.status === 'stopped' || currentDiv.status === 'blocked') continue
      const depsReady = currentDiv.dependsOn.every(depId =>
        latest.divisions.find(d => d.divisionId === depId)?.status === 'completed')
      if (!depsReady) continue

      const targetSession = this.host.relay.route(currentDiv.sessionId)
      const isHandedOver = (currentDiv.generation ?? 1) > 1 || currentDiv.previousSessions.length > 0
      if (isHandedOver) {
        const gen = currentDiv.pendingActivation?.generation ?? currentDiv.generation ?? 2
        const activeTarget = this.host.relay.route(currentDiv.pendingActivation?.target ?? currentDiv.sessionId)
        const activateId = `activate:division:${latest.taskId}:${currentDiv.divisionId}:g${gen}`
        const hasSuccessorAgent = !!this.host.context.agents.get(activeTarget as SessionId)
        if (currentDiv.pendingActivation || !hasSuccessorAgent) {
          try {
            if (!hasSuccessorAgent) {
              await sessions.ensureDivision(activeTarget, latest.directory, `[${latest.title}] ${currentDiv.title}`, {
                taskId: latest.taskId,
                divisionId: currentDiv.divisionId,
                model: currentDiv.model,
                autoHard: latest.complexity.hard,
              })
            }
            if (currentDiv.pendingActivation && !await sessions.holds(activeTarget, activateId)) {
              await sessions.prompt(activeTarget, activateId,
                'Continue the division task from the handover summary above. Do not repeat completed steps.', 'queue')
            }
            if (currentDiv.pendingActivation) {
              store.atomic(() => {
                const p = store.get(KV.sessions.divisions(taskId))
                const d = p?.divisions.find(x => x.divisionId === currentDiv.divisionId)
                if (p && d?.pendingActivation?.generation === gen) {
                  delete d.pendingActivation
                  d.updatedAt = now()
                  p.updatedAt = d.updatedAt
                  store.set(KV.sessions.divisions(taskId), p)
                }
              })
            }
          } catch {
            // 接班唤醒仍未成功，保留 pendingActivation 供下次 resume 重试
          }
        }
        continue
      }

      const startReqId = `division-start:${latest.taskId}:${currentDiv.divisionId}`
      const hasAgent = !!this.host.context.agents.get(targetSession as SessionId)
      const started = hasAgent && await sessions.holds(targetSession, startReqId)

      const needsLaunch = (currentDiv.status === 'failed' && currentDiv.deliveredEventIds.length === 0)
        || currentDiv.status === 'waiting_deps'
        || currentDiv.status === 'pending'
        || (currentDiv.status === 'running' && !started)
      if (needsLaunch) {
        const outputs = currentDiv.dependsOn.map(depId => {
          const dep = latest.divisions.find(d => d.divisionId === depId)!
          return { divisionId: dep.divisionId, title: dep.title, result: dep.result ?? dep.latestProgress ?? '(completed)' }
        })
        await this.launchDivision(latest, currentDiv, outputs)
      }
    }

    const afterDivs = store.get(KV.sessions.divisions(taskId)) ?? plan
    if (afterDivs.review?.state === 'pending') {
      const reviewSessionId = afterDivs.review.sessionId
      const round = afterDivs.review.round
      const reviewReqId = `div-review-start:${afterDivs.taskId}:r${round}`
      const hasReviewer = !!this.host.context.agents.get(reviewSessionId as SessionId)
      const prompted = hasReviewer && await sessions.holds(reviewSessionId, reviewReqId)
      if (!prompted) {
        await this.startReview(afterDivs, round).catch(() => {})
      }
    }

    await this.flushDeliveries(taskId)
    return store.get(KV.sessions.divisions(taskId)) ?? afterDivs
  }

  /**
   * 从用户对话或任务入口规划并派发工作：
   * - 简单任务或单会话模式：不开额外会话（extraSessions = 0），记录判定依据与未开原因。
   * - 复杂任务（支持未传 divisions 时从文本自动提取多交付物清单 M07-g，以及单项/多项显式委派）：按 maxSessions 预留槽位，绑定独立可打开会话与模型槽位。
   * - 同一 (taskId, planKey) 重放：核对并恢复失败或未就绪的分工，保护正在运行及已完成成员（M07-b）。
   * - 同一 taskId 提交新 planKey 修订计划：按稳定 divisionId 合并，完整保留未变更分工的 completed 状态、成果、会话与回执，仅启动新增或修订项（M07-i）。
   */
  async dispatch(request: DispatchRequest): Promise<{ plan: TaskPlan; reused: boolean; extraSessions: number }> {
    const { store, sessions } = this.host
    const routing = store.settings().routing
    const planKey = request.planKey?.trim() || key(request.originSessionId, request.title, request.brief)
    const taskId = request.taskId?.trim() || `task-${key(request.originSessionId, planKey).slice(0, 12)}`
    const existing = store.get(KV.sessions.divisions(taskId))
    if (existing && existing.planKey === planKey) {
      const reconciled = await this.reconcilePlan(taskId)
      return { plan: reconciled, reused: true, extraSessions: reconciled.divisions.length }
    }

    const explicitSpecs = request.divisions
    const originModel = sessions.sessionModel(request.originSessionId) ?? sessions.sessionModel(this.host.masterId)
    const assessment = assessComplexity({
      threshold: routing.difficultyThreshold,
      explicitDifficulty: request.difficulty,
      brief: request.brief,
      plannedDivisions: explicitSpecs && explicitSpecs.length > 1 ? explicitSpecs.length : undefined,
    })

    const multi = multiSession(routing)
    const specs: DivisionSpec[] = explicitSpecs !== undefined
      ? explicitSpecs
      : (multi && assessment.hard ? planDivisionsFromText(request.title, request.brief, routing.maxSessions) : [])

    let extraSessionsAllowed = true
    let skipReason: string | undefined
    if (!multi) {
      extraSessionsAllowed = false
      skipReason = 'single-session-mode'
    } else if (!assessment.hard) {
      extraSessionsAllowed = false
      skipReason = 'below-difficulty-threshold'
    } else if (specs.length === 0) {
      extraSessionsAllowed = false
      skipReason = 'no-split-needed'
    }

    const complexity: ComplexityVerdict = {
      ...assessment,
      reason: request.reason?.trim() || assessment.reason,
      extraSessionsAllowed,
      ...(skipReason ? { skipReason } : {}),
    }
    const directory = request.directory?.trim() || existing?.directory || this.host.coordinatorCwd
    const timestamp = now()

    if (!extraSessionsAllowed) {
      if (existing && existing.divisions.length > 0) {
        const reconciled = await this.reconcilePlan(taskId)
        return { plan: reconciled, reused: true, extraSessions: reconciled.divisions.length }
      }
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
        createdAt: existing?.createdAt ?? timestamp,
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
    if (existing) {
      for (const spec of specs) {
        const prev = existing.divisions.find(d => d.divisionId === spec.divisionId)
        if (prev && prev.slot < routing.maxSessions && !Object.values(slots).includes(prev.slot)) {
          slots[spec.divisionId] = prev.slot
        }
      }
    }

    const pendingDeliveries: PendingDivisionDelivery[] = [...(existing?.pendingDeliveries ?? [])]
    const deliveredNotificationIds: string[] = [...(existing?.deliveredNotificationIds ?? [])]
    const prevMap = new Map((existing?.divisions ?? []).map(d => [d.divisionId, d]))

    const divisions: DivisionRecord[] = specs.map(spec => {
      const prev = prevMap.get(spec.divisionId)
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

      if (prev) {
        const sameDeps = prev.dependsOn.length === dependsOn.length && prev.dependsOn.every((d, i) => d === dependsOn[i])
        const sameSpec = prev.title === spec.title && prev.brief === spec.brief && sameDeps
        if (sameSpec) {
          return {
            ...prev,
            slot,
            model: prev.model ?? model,
          }
        }
        // 分工说明或依赖发生实质变更：保留原会话与历史记录，若已启动则排入修订通知并转回可运行/等依赖状态
        const reviseId = `revise:${taskId}:${planKey}:${spec.divisionId}`
        if (!deliveredNotificationIds.includes(reviseId) && !pendingDeliveries.some(p => p.id === reviseId)) {
          pendingDeliveries.push({
            id: reviseId,
            kind: 'division',
            divisionId: spec.divisionId,
            targetSessionId: prev.sessionId,
            requestId: `div-revise:${taskId}:${planKey}:${spec.divisionId}`,
            text: `[Division plan revised (${planKey})]\nUpdated brief for "${spec.title}" (${spec.divisionId}):\n${spec.brief}\nReport completion with orchestrator_division_report and a new event_id.`,
          })
        }
        return {
          ...prev,
          title: spec.title,
          brief: spec.brief,
          dependsOn,
          slot,
          status: dependsOn.length === 0 ? 'running' : 'waiting_deps',
          updatedAt: timestamp,
        }
      }

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

    // 若计划修订后仍有未完成的分工，而此前的 review 已经结束，则仅保留历史记录并在全部完成后开启新一轮复查
    const allCompleted = divisions.length > 0 && divisions.every(d => d.status === 'completed')
    const carriedReview = existing?.review
      ? (allCompleted ? existing.review : (existing.review.state === 'pending' ? existing.review : undefined))
      : undefined

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
      pendingDeliveries,
      deliveredNotificationIds,
      ...(carriedReview ? { review: carriedReview } : {}),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    store.atomic(() => {
      store.set(KV.sessions.divisions(taskId), plan)
      for (const div of divisions) {
        store.set(KV.sessions.divisionOwner(div.sessionId), { taskId, divisionId: div.divisionId })
      }
    })

    const reconciled = await this.reconcilePlan(taskId)
    return { plan: reconciled, reused: false, extraSessions: reconciled.divisions.length }
  }

  private async launchDivision(
    plan: TaskPlan,
    div: DivisionRecord,
    dependencyOutputs: { divisionId: string; title: string; result: string }[],
  ): Promise<void> {
    const { store, sessions } = this.host
    const targetSession = this.host.relay.route(div.sessionId)
    const startReqId = `division-start:${plan.taskId}:${div.divisionId}`
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
      if (!await sessions.holds(targetSession, startReqId)) {
        await sessions.prompt(targetSession, startReqId, promptText, 'queue')
      }
      store.atomic(() => {
        const latest = store.get(KV.sessions.divisions(plan.taskId))
        const row = latest?.divisions.find(item => item.divisionId === div.divisionId)
        if (latest && row && row.status !== 'completed') {
          row.status = 'running'
          delete row.error
          row.updatedAt = now()
          latest.updatedAt = row.updatedAt
          store.set(KV.sessions.divisions(plan.taskId), latest)
        }
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      store.atomic(() => {
        const latest = store.get(KV.sessions.divisions(plan.taskId))
        const row = latest?.divisions.find(item => item.divisionId === div.divisionId)
        if (latest && row && row.status !== 'completed') {
          row.status = 'failed'
          row.error = reason
          row.updatedAt = now()
          latest.updatedAt = row.updatedAt
          store.set(KV.sessions.divisions(plan.taskId), latest)
        }
      })
      this.host.report?.(`division ${div.divisionId} (${targetSession}) could not start: ${reason}`, 'error')
    }
  }

  /** 按接收方投递所有尚未送达的分工通知；仅在投递成功后在同一事务内记录收件回执并移除待投递项（M07-c）。 */
  private async flushDeliveries(taskId: string): Promise<void> {
    const { store, sessions } = this.host
    const snapshot = store.get(KV.sessions.divisions(taskId))
    const queue = [...(snapshot?.pendingDeliveries ?? [])]
    if (!snapshot || queue.length === 0) return

    for (const item of queue) {
      const currentPlan = store.get(KV.sessions.divisions(taskId))
      if (!currentPlan) return
      if ((currentPlan.deliveredNotificationIds ?? []).includes(item.id)) {
        store.atomic(() => {
          const latest = store.get(KV.sessions.divisions(taskId))
          if (!latest) return
          latest.pendingDeliveries = (latest.pendingDeliveries ?? []).filter(p => p.id !== item.id)
          store.set(KV.sessions.divisions(taskId), latest)
        })
        continue
      }
      let target: string
      if (item.kind === 'origin') {
        target = this.host.relay.route(currentPlan.originSessionId)
      } else {
        const d = currentPlan.divisions.find(x => x.divisionId === item.divisionId)
        target = this.host.relay.route(d?.sessionId ?? item.targetSessionId)
      }
      try {
        if (item.kind === 'division') {
          const d = currentPlan.divisions.find(x => x.divisionId === item.divisionId)
          if (d && !this.host.context.agents.get(target as SessionId)) {
            await sessions.ensureDivision(target, currentPlan.directory, `[${currentPlan.title}] ${d.title}`, {
              taskId: currentPlan.taskId,
              divisionId: d.divisionId,
              model: d.model,
              autoHard: currentPlan.complexity.hard,
            })
          }
        }
        if (!await sessions.holds(target, item.requestId)) {
          await sessions.prompt(target, item.requestId, item.text, 'queue')
        }
        store.atomic(() => {
          const latest = store.get(KV.sessions.divisions(taskId))
          if (!latest) return
          latest.pendingDeliveries = (latest.pendingDeliveries ?? []).filter(p => p.id !== item.id)
          const delivered = latest.deliveredNotificationIds ?? []
          if (!delivered.includes(item.id)) {
            latest.deliveredNotificationIds = [...delivered.slice(-399), item.id]
          }
          store.set(KV.sessions.divisions(taskId), latest)
        })
      } catch {
        // 接收方暂时离线或投递失败：保留在 pendingDeliveries 中，下次汇报、重放或 resume 时按同一 requestId 重试。
      }
    }
  }

  /** 记录分工汇报、去重并回执、通知主协调者、并唤醒依赖方或触发独立复查（含退回修复后的下一轮复查）。 */
  async reportDivision(input: {
    taskId: string
    divisionId: string
    state: 'progress' | 'completed' | 'blocked' | 'failed'
    summary: string
    result?: string | undefined
    eventId: string
  }): Promise<{ deduplicated: boolean; status: string; unblocked: string[]; reviewSessionId?: string }> {
    const { store } = this.host
    let alreadyRecorded = false
    let recordedStatus = ''
    const toWakeIds: string[] = []

    store.atomic(() => {
      const plan = store.get(KV.sessions.divisions(input.taskId))
      if (!plan) throw new Error(`Task plan ${input.taskId} not found`)
      const div = plan.divisions.find(item => item.divisionId === input.divisionId)
      if (!div) throw new Error(`Division ${input.divisionId} not found in ${input.taskId}`)

      alreadyRecorded = div.deliveredEventIds.includes(input.eventId)
      const nextStatus = input.state === 'progress' ? 'running' : input.state
      const notifyId = `notify:${plan.taskId}:${div.divisionId}:${input.eventId}`
      const notifyReqId = `div-notify:${plan.taskId}:${div.divisionId}:${input.eventId}`
      const notifyText = `[division_report] task=${plan.taskId} division=${div.divisionId} (${div.title}) state=${nextStatus} event_id=${input.eventId}\n${input.summary}`

      if (!alreadyRecorded) {
        div.deliveredEventIds = [...div.deliveredEventIds.slice(-199), input.eventId]
        div.status = nextStatus
        div.latestProgress = input.summary
        if (input.result !== undefined) div.result = input.result
        else if (input.state === 'completed' && div.result === undefined) div.result = input.summary
        if (input.state === 'failed') div.error = input.summary
        div.updatedAt = now()
        plan.updatedAt = div.updatedAt

        if (div.status === 'completed') {
          if (plan.review?.state === 'failed' && !plan.review.limitReached) {
            const pendingRework = plan.review.reworkDivisionIds ?? []
            plan.review.reworkDivisionIds = pendingRework.filter(id => id !== div.divisionId)
          }
          for (const candidate of plan.divisions) {
            if (candidate.status !== 'waiting_deps') continue
            const ready = candidate.dependsOn.every(depId =>
              plan.divisions.find(d => d.divisionId === depId)?.status === 'completed')
            if (ready) {
              candidate.status = 'running'
              candidate.updatedAt = now()
              toWakeIds.push(candidate.divisionId)
            }
          }
        }
      }

      recordedStatus = div.status
      const deliveredIds = plan.deliveredNotificationIds ?? []
      const pendingList = plan.pendingDeliveries ?? []
      if (!deliveredIds.includes(notifyId) && !pendingList.some(p => p.id === notifyId)) {
        const delivery: PendingDivisionDelivery = {
          id: notifyId,
          kind: 'origin',
          targetSessionId: plan.originSessionId,
          requestId: notifyReqId,
          text: notifyText,
        }
        plan.pendingDeliveries = [...pendingList, delivery]
      }
      store.set(KV.sessions.divisions(input.taskId), plan)
    })

    await this.flushDeliveries(input.taskId)

    for (const wakeId of toWakeIds) {
      const currentPlan = store.get(KV.sessions.divisions(input.taskId))
      const nextDiv = currentPlan?.divisions.find(d => d.divisionId === wakeId)
      if (!currentPlan || !nextDiv) continue
      const outputs = nextDiv.dependsOn.map(depId => {
        const dep = currentPlan.divisions.find(d => d.divisionId === depId)!
        return { divisionId: dep.divisionId, title: dep.title, result: dep.result ?? dep.latestProgress ?? '(completed)' }
      })
      await this.launchDivision(currentPlan, nextDiv, outputs)
    }

    const afterPlan = store.get(KV.sessions.divisions(input.taskId))
    let reviewSessionId = afterPlan?.review?.sessionId
    const allDone = !!afterPlan && afterPlan.divisions.length > 0 && afterPlan.divisions.every(d => d.status === 'completed')
    if (allDone && afterPlan && store.settings().executor.reviewEnabled) {
      if (!afterPlan.review) {
        reviewSessionId = await this.startReview(afterPlan, 1).catch(() => afterPlan.review?.sessionId)
      } else if (afterPlan.review.state === 'failed' && !afterPlan.review.limitReached && !(afterPlan.review.reworkDivisionIds?.length)) {
        if (afterPlan.review.round < MAX_REVIEW_ROUNDS) {
          reviewSessionId = await this.startReview(afterPlan, afterPlan.review.round + 1).catch(() => afterPlan.review?.sessionId)
        } else {
          store.atomic(() => {
            const latest = store.get(KV.sessions.divisions(input.taskId))
            if (latest?.review) {
              latest.review.limitReached = true
              latest.review.summary = `Independent review reached its ${MAX_REVIEW_ROUNDS}-round limit.`
              latest.updatedAt = now()
              store.set(KV.sessions.divisions(input.taskId), latest)
            }
          })
        }
      }
    }

    if (alreadyRecorded) {
      return {
        deduplicated: true,
        status: recordedStatus,
        unblocked: [],
        ...(reviewSessionId ? { reviewSessionId } : {}),
      }
    }

    return {
      deduplicated: false,
      status: recordedStatus,
      unblocked: toWakeIds,
      ...(reviewSessionId ? { reviewSessionId } : {}),
    }
  }

  /** 启动绑定真实可打开会话的独立复查（持久绑定任务、轮次、审查会话与交付版本，同一轮重启幂等复用，M07-h）。 */
  async startReview(plan: TaskPlan, round = 1): Promise<string> {
    const { store, sessions } = this.host
    const existing = store.get(KV.sessions.divisions(plan.taskId)) ?? plan
    const reviewSessionId = existing.review?.round === round && existing.review.sessionId
      ? existing.review.sessionId
      : `div-review-${key(plan.taskId, String(round)).slice(0, 12)}-r${round}`
    const reviewDivisionId = `__review_r${round}`

    let updated!: TaskPlan
    store.atomic(() => {
      updated = store.get(KV.sessions.divisions(plan.taskId)) ?? plan
      const prevHistory = updated.review?.history ?? []
      const deliverableVersion = deliverableVersionOf(updated.divisions)
      updated.review = {
        sessionId: reviewSessionId,
        round,
        state: 'pending',
        deliverableVersion,
        ...(prevHistory.length > 0 ? { history: prevHistory } : {}),
      }
      updated.updatedAt = now()
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
    const reqId = `div-review-start:${plan.taskId}:r${round}`
    if (!await sessions.holds(reviewSessionId, reqId)) {
      const summaryLines = updated.divisions.map(d =>
        `- ${d.title} (${d.divisionId}, session ${d.sessionId}): ${d.result ?? d.latestProgress ?? d.status}`)
      await sessions.prompt(reviewSessionId, reqId, [
        `Independently review task ${plan.taskId} ("${updated.title}") in ${updated.directory} (round ${round} of ${MAX_REVIEW_ROUNDS}).`,
        '## Division deliverables',
        ...summaryLines,
        '',
        'Inspect files and deliverables, then call orchestrator_division_review_submit with approved, summary, and findings.',
      ].join('\n'), 'queue')
    }
    return reviewSessionId
  }

  /**
   * 提交独立复查结论（M07-f / M07-h）：
   * - 在同一事务内校验提交者绑定的复查会话、轮次、pending 状态与交付版本；
   * - 若为上一轮/旧复查会话迟到提交，仅将其记入 review.history（state: 'superseded_late'）并拒绝改写当前轮次结论；
   * - 若当前轮次已非 pending（重复提交），直接拒绝；
   * - 若退回则持久记录需返工项与负责人并派回，待修复完成后自动进入下一轮复查。
   */
  async submitReview(input: {
    taskId: string
    approved: boolean
    summary: string
    findings?: string[] | undefined
    reworkDivisionIds?: string[] | undefined
    acceptanceCriteria?: string | undefined
    sessionId?: string | undefined
    round?: number | undefined
  }): Promise<TaskPlan> {
    const { store } = this.host
    let staleError: string | undefined
    store.atomic(() => {
      const plan = store.get(KV.sessions.divisions(input.taskId))
      if (!plan || !plan.review) throw new Error(`No active division review for ${input.taskId}`)
      const round = plan.review.round
      const timestamp = now()
      const history: ReviewHistoryEntry[] = [...(plan.review.history ?? [])]

      const activeReviewer = this.host.relay.route(plan.review.sessionId)
      const callerSession = input.sessionId ? this.host.relay.route(input.sessionId) : undefined
      const wrongRound = input.round !== undefined && input.round !== round
      const wrongSession = callerSession !== undefined && callerSession !== activeReviewer && input.sessionId !== plan.review.sessionId

      if (wrongRound || wrongSession) {
        history.push({
          round: input.round ?? 0,
          sessionId: input.sessionId ?? 'unknown',
          state: 'superseded_late',
          summary: input.summary,
          ...(input.findings ? { findings: input.findings } : {}),
          submittedAt: timestamp,
        })
        plan.review = { ...plan.review, history }
        plan.updatedAt = timestamp
        store.set(KV.sessions.divisions(input.taskId), plan)
        staleError = `Review submission from stale reviewer (${input.sessionId ?? `round ${input.round}`}) rejected; active review is round ${round} (${plan.review.sessionId})`
        return
      }

      if (plan.review.state !== 'pending') {
        throw new Error(`Review round ${round} for ${input.taskId} is already ${plan.review.state}`)
      }

      const currentDeliverableVersion = deliverableVersionOf(plan.divisions)
      if (plan.review.deliverableVersion && plan.review.deliverableVersion !== currentDeliverableVersion) {
        throw new Error(`Deliverables for ${input.taskId} changed during review round ${round}; submit rejected`)
      }

      const pendingList = [...(plan.pendingDeliveries ?? [])]
      const deliveredIds = plan.deliveredNotificationIds ?? []

      if (input.approved) {
        history.push({
          round,
          sessionId: plan.review.sessionId,
          state: 'passed',
          summary: input.summary,
          ...(input.findings ? { findings: input.findings } : {}),
          deliverableVersion: currentDeliverableVersion,
          submittedAt: timestamp,
        })
        plan.review = {
          ...plan.review,
          state: 'passed',
          summary: input.summary,
          ...(input.findings ? { findings: input.findings } : {}),
          reworkDivisionIds: [],
          history,
        }
      } else if (round >= MAX_REVIEW_ROUNDS) {
        history.push({
          round,
          sessionId: plan.review.sessionId,
          state: 'failed',
          summary: input.summary,
          ...(input.findings ? { findings: input.findings } : {}),
          deliverableVersion: currentDeliverableVersion,
          submittedAt: timestamp,
        })
        plan.review = {
          ...plan.review,
          state: 'failed',
          limitReached: true,
          summary: `Independent review reached its ${MAX_REVIEW_ROUNDS}-round limit: ${input.summary}`,
          ...(input.findings ? { findings: input.findings } : {}),
          reworkDivisionIds: [],
          history,
        }
      } else {
        const searchText = [input.summary, ...(input.findings ?? [])].join('\n')
        const matched = matchReworkDivisions(plan.divisions, searchText, input.reworkDivisionIds)
        const reworkIds = matched.length > 0
          ? matched.map(d => d.divisionId)
          : plan.divisions.map(d => d.divisionId)

        if (matched.length > 0) {
          for (const d of matched) {
            d.status = 'running'
            d.updatedAt = timestamp
          }
        }

        history.push({
          round,
          sessionId: plan.review.sessionId,
          state: 'failed',
          summary: input.summary,
          ...(input.findings ? { findings: input.findings } : {}),
          deliverableVersion: currentDeliverableVersion,
          submittedAt: timestamp,
        })
        plan.review = {
          ...plan.review,
          state: 'failed',
          summary: input.summary,
          acceptanceCriteria: input.acceptanceCriteria ?? input.summary,
          ...(input.findings ? { findings: input.findings } : {}),
          reworkDivisionIds: reworkIds,
          history,
        }

        const findingsLines = input.findings?.length ? `\nFindings:\n${input.findings.map(f => `- ${f}`).join('\n')}` : ''
        for (const divId of reworkIds) {
          const d = plan.divisions.find(x => x.divisionId === divId)
          if (!d) continue
          const reworkNotifyId = `rework:${plan.taskId}:r${round}:${divId}`
          if (!deliveredIds.includes(reworkNotifyId) && !pendingList.some(p => p.id === reworkNotifyId)) {
            pendingList.push({
              id: reworkNotifyId,
              kind: 'division',
              divisionId: divId,
              targetSessionId: d.sessionId,
              requestId: `div-rework:${plan.taskId}:r${round}:${divId}`,
              text: `[Independent review round ${round} rejected]\n${input.summary}${findingsLines}\nFix the reported issues and call orchestrator_division_report with state="completed" and a new event_id.`,
            })
          }
        }
      }

      const resultNotifyId = `review-result:${plan.taskId}:r${round}:${plan.review.state}`
      if (!deliveredIds.includes(resultNotifyId) && !pendingList.some(p => p.id === resultNotifyId)) {
        pendingList.push({
          id: resultNotifyId,
          kind: 'origin',
          targetSessionId: plan.originSessionId,
          requestId: `div-review-result:${plan.taskId}:r${round}`,
          text: `[division_review] task=${plan.taskId} round=${round} state=${plan.review.state}\n${plan.review.summary ?? input.summary}`,
        })
      }

      plan.pendingDeliveries = pendingList
      plan.updatedAt = timestamp
      store.set(KV.sessions.divisions(input.taskId), plan)
    })

    if (staleError) throw new Error(staleError)
    await this.flushDeliveries(input.taskId)
    return store.get(KV.sessions.divisions(input.taskId))!
  }

  /**
   * 由协调者或用户向指定分工对话投递补充指令，自动跟随 60% 接班路由并按 requestId 去重。
   * 投递完成后在事务内重新读取最新计划并仅合并本次 requestId 回执，绝不覆盖并发上报的完成状态或模型调用记录（M07-d）。
   */
  async sendToDivision(input: { taskId: string; divisionId: string; message: string; requestId: string }): Promise<{
    sent: boolean; deduplicated: boolean; sessionId: string
  }> {
    const { store, sessions } = this.host
    const snapshot = store.get(KV.sessions.divisions(input.taskId))
    const divSnapshot = snapshot?.divisions.find(item => item.divisionId === input.divisionId)
    if (!snapshot || !divSnapshot) throw new Error(`Division ${input.divisionId} not found in ${input.taskId}`)
    if (divSnapshot.deliveredEventIds.includes(input.requestId)) {
      return { sent: false, deduplicated: true, sessionId: this.host.relay.route(divSnapshot.sessionId) }
    }
    const target = this.host.relay.route(divSnapshot.sessionId)
    await sessions.ensureDivision(target, snapshot.directory, `[${snapshot.title}] ${divSnapshot.title}`, {
      taskId: snapshot.taskId, divisionId: divSnapshot.divisionId, model: divSnapshot.model, autoHard: snapshot.complexity.hard,
    })
    await sessions.prompt(target, `div-send:${input.taskId}:${input.divisionId}:${input.requestId}`, input.message, 'queue')

    store.atomic(() => {
      const latest = store.get(KV.sessions.divisions(input.taskId))
      const latestDiv = latest?.divisions.find(item => item.divisionId === input.divisionId)
      if (!latest || !latestDiv) return
      if (!latestDiv.deliveredEventIds.includes(input.requestId)) {
        latestDiv.deliveredEventIds = [...latestDiv.deliveredEventIds.slice(-199), input.requestId]
      }
      latestDiv.updatedAt = now()
      latest.updatedAt = latestDiv.updatedAt
      store.set(KV.sessions.divisions(input.taskId), latest)
    })
    return { sent: true, deduplicated: false, sessionId: target }
  }

  /** 在请求边界记录该分工对话实际使用的供应商、模型与思考等级。 */
  observeModelCall(sessionId: string, call: Omit<DivisionModelCall, 'at'>): void {
    const { store } = this.host
    const owner = store.get(KV.sessions.divisionOwner(sessionId))
    if (!owner) return
    store.atomic(() => {
      const plan = store.get(KV.sessions.divisions(owner.taskId))
      const div = plan?.divisions.find(item => item.divisionId === owner.divisionId)
      if (!plan || !div) return
      div.modelCalls = [...div.modelCalls.slice(-49), { at: now(), ...call }]
      div.updatedAt = now()
      plan.updatedAt = div.updatedAt
      store.set(KV.sessions.divisions(owner.taskId), plan)
    })
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
      const boundRoundMatch = /^__review_r(\d+)$/.exec(divisionId)
      const boundRound = boundRoundMatch ? Number(boundRoundMatch[1]) : undefined
      tools.push(tool({
        name: 'orchestrator_division_review_submit',
        description: 'Submit the independent review verdict and findings for this task.',
        schema: z.object({
          approved: z.boolean(),
          summary: z.string().min(1).max(4000),
          findings: z.array(z.string().min(1)).optional(),
          rework_division_ids: z.array(z.string().min(1)).optional(),
          acceptance_criteria: z.string().max(4000).optional(),
        }).strict(),
        execute: async args => {
          const updated = await coordinator.submitReview({
            taskId,
            approved: args.approved,
            summary: args.summary,
            findings: args.findings,
            reworkDivisionIds: args.rework_division_ids,
            acceptanceCriteria: args.acceptance_criteria,
            sessionId: _agent.id,
            round: boundRound,
          })
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
