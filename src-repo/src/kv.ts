/**
 * Typed key-value store keys and key families grouped by the single component that owns and writes each family.
 * Readers and writers refer to a record by its entry here so each key is spelled once with its value type.
 */
import type { PromptVersion } from './app/prompts.ts'
import type { SettingsVersion } from './app/store.ts'
import type { SettingsSave } from './policy.ts'
import type { Retry } from './sources/github.ts'

/**
 * One ticket's Session handover, persisted across every step so a crash resumes instead of repeating or losing work.
 *
 * `idle` is the starting point and also the state after a move that was never attempted; `prepared` means the summary
 * exists and is durable but no Session was created yet; `created` means the target Session exists; `summarised` means the
 * summary was delivered to it; `committed` means `current` was switched to it, which is the only point readers move;
 * `failed` means the attempt stopped and the ticket stays on `current` with the reason recorded.
 */
export interface Relay {
  /** Session the ticket is committed to. Readers use this field and nothing else. */
  current: string
  /** Sessions this ticket has already moved away from, oldest first. */
  previous: string[]
  /** Session being prepared. Present only while a move is in flight; never a routing target. */
  target?: string
  /** Last step that completed. */
  stage: 'idle' | 'prepared' | 'created' | 'summarised' | 'committed' | 'failed'
  /** When the record last advanced. */
  at: string
  /** Request id of the handover in flight, so a retry after a crash delivers the summary once. */
  requestId?: string
  /**
   * The handover summary of the move in flight.
   *
   * Cleared when the move commits: the summary now lives in the new Session's own history, and keeping it here would
   * make the next handover reuse the previous one's text.
   */
  summary?: string
  /** Why the last attempt stopped. The ticket keeps working on `current` when this is set. */
  error?: string
  /**
   * How many times this ticket has been handed over.
   *
   * A generation number, not a timestamp: two moves in the same second must produce different Session names, and it
   * makes a resumed move provably the same move rather than a new one.
   */
  generation?: number
  /**
   * Set once the target Session exists but must not act yet.
   *
   * The summary is delivered while the ticket still belongs to the old Session, and the new one is woken only after
   * the pointer commits. Without this flag a move that is refused after delivery leaves a second worker running the
   * same task — two Sessions doing one job.
   */
  held?: boolean
  /**
   * 指针已提交但尚未确认完成激活的目标会话与代次。
   * 仅在唤醒投递确认（或 holds 命中）后清除；若唤醒瞬态失败或进程崩溃，启动恢复时会用同一代次幂等重试。
   */
  pendingActivation?: { target: string; generation: number }
}

/** 复杂任务规划的分工会话状态。 */
export type DivisionStatus = 'pending' | 'waiting_deps' | 'running' | 'blocked' | 'completed' | 'failed' | 'stopped'

/** 分工会话在请求边界实际记录的模型与思考等级调用轨迹。 */
export interface DivisionModelCall {
  at: string
  provider?: string
  model?: string
  reasoningEffort?: string
}

/** 任务难度与是否开启多会话的判定依据。 */
export interface ComplexityVerdict {
  hard: boolean
  score: number
  threshold: number
  source: 'explicit' | 'planner' | 'heuristic'
  reason: string
  signals: string[]
  extraSessionsAllowed: boolean
  skipReason?: string
}

/** 分工会话内的结构化任务步骤清单项（对标 TodoWrite 规范，持久化保存并随接班保留）。 */
export interface DivisionTodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority?: 'high' | 'medium' | 'low' | undefined
}

/** 单个独立可打开分工对话的持久记录。 */
export interface DivisionRecord {
  divisionId: string
  title: string
  brief: string
  dependsOn: string[]
  slot: number
  sessionId: string
  previousSessions: string[]
  generation: number
  model: { provider: string; model: string; reasoningEffort?: string } | null
  modelCalls: DivisionModelCall[]
  status: DivisionStatus
  latestProgress?: string
  result?: string
  /** 当前分工的结构化执行步骤清单。 */
  todos?: DivisionTodoItem[] | undefined
  /** 当前分工的要求修订号（计划修改或复查打回重做时递增，M07-k）。 */
  revision?: number | undefined
  /** 历次已完成修订的历史成果记录（M07-k）。 */
  resultHistory?: { revision: number; result: string; summary?: string | undefined; at: string }[] | undefined
  error?: string
  /** 已处理的事件/回执 ID，用于去重并避免回报循环。 */
  deliveredEventIds: string[]
  /** 指针已切换但尚未确认完成唤醒的目标分工会话与代次（M06-a）。 */
  pendingActivation?: { target: string; generation: number } | undefined
  createdAt: string
  updatedAt: string
}

/** 待投递的分工通知（进度回报、退回返工、复查结果），与状态变更同事务写入并在恢复时按接收方幂等重发（M07-c）。 */
export interface PendingDivisionDelivery {
  id: string
  kind: 'origin' | 'division'
  divisionId?: string | undefined
  targetSessionId: string
  requestId: string
  text: string
}

/** 一次任务（工单或聊天派工）的多会话规划与运行记录。 */
export interface ReviewHistoryEntry {
  round: number
  sessionId: string
  state: 'passed' | 'failed' | 'superseded_late'
  summary: string
  findings?: string[] | undefined
  deliverableVersion?: string | undefined
  submittedAt: string
}

/** 超出当前任务允许上限（maxSessions）而暂缓创建独立会话的分工项，保持可见以便留给主会话或后续批次（M07-m）。 */
export interface DeferredDivisionRecord {
  divisionId: string
  title: string
  brief: string
  dependsOn: string[]
  status: 'deferred'
  reason: 'max-sessions-limit'
}

/** 同一任务内可由空闲或等待依赖成员主动领取、独立完成并交回原负责人合并的工作项（R04 动态补位）。 */
export type WorkItemStatus = 'open' | 'claimed' | 'submitted' | 'merged' | 'merge_failed' | 'conflict' | 'failed'

export type WorkItemKind = 'code' | 'docs' | 'research' | 'config' | 'other'
export type WorkItemVerificationMode = 'test_required' | 'manual_acceptance'
export type WorkItemVerificationFailureReason =
  | 'missing_verification'
  | 'untrusted_claim'
  | 'test_failed'
  | 'stale_verification'
  | 'conflict'
  | 'concurrent_in_flight'

/** 受控验证执行器签发的不可伪造工作项验证凭据，严格绑定交付版本与运行 ID。 */
export interface WorkItemVerificationCredential {
  runId: string
  deliverableVersion: string
  command: string
  args: string[]
  exitCode: number
  passed: boolean
  verifiedAt: string
  outputExcerpt: string
  source: 'controlled_runner'
}

export interface WorkItemActiveVerification {
  runId: string
  eventId: string
  deliverableVersion: string
  command: string
  args: string[]
  startedAt: string
}

export interface WorkItemVerificationHistoryEntry {
  runId: string
  eventId: string
  deliverableVersion: string
  command?: string | undefined
  status: 'passed' | 'failed' | 'stale' | 'conflict' | 'rejected'
  exitCode?: number | undefined
  reason?: string | undefined
  at: string
}

export interface DivisionWorkItem {
  itemId: string
  title: string
  brief: string
  /** 工作项类别（默认 code）；文档/调研类可采用人工验收并记录方式，代码类默认必须提供当前版本真实验证凭据。 */
  kind?: WorkItemKind | undefined
  /** 合并验证要求：test_required 要求受控运行器签发当前版本通过凭据；manual_acceptance 允许人工验收并留存方式与说明。 */
  verificationMode?: WorkItemVerificationMode | undefined
  /** 当前成果交付版本指纹：每次 submitWorkItem 提交新产物自动递进，用于防止旧版本测试凭据解锁新改动。 */
  deliverableVersion?: string | undefined
  /** 原负责人分工 ID（负责验收与合并成果）。 */
  ownerDivisionId: string
  /** 当前实际领取执行该项的分工 ID（空闲或等待依赖成员补位）。 */
  assigneeDivisionId?: string | undefined
  dependsOn: string[]
  status: WorkItemStatus
  deliverable?: string | undefined
  summary?: string | undefined
  /** 实际参与编写/产出该工作项的分工 ID 列表，用于最终复核回避校验。 */
  contributors: string[]
  mergedBy?: string | undefined
  mergeNote?: string | undefined
  /** 验收方式与说明（automated_test / manual_acceptance）。 */
  acceptanceMethod?: 'automated_test' | 'manual_acceptance' | undefined
  acceptanceNote?: string | undefined
  /** 合并验证门禁状态、执行命令、真实输出、在途任务、可信凭据、失败归因与历史记录。 */
  verificationStatus?: 'passed' | 'failed' | 'conflict' | undefined
  verificationFailureReason?: WorkItemVerificationFailureReason | undefined
  verificationCommand?: string | undefined
  verificationOutput?: string | undefined
  activeVerification?: WorkItemActiveVerification | undefined
  verificationCredential?: WorkItemVerificationCredential | undefined
  verificationHistory?: WorkItemVerificationHistoryEntry[] | undefined
  conflictFiles?: string[] | undefined
  /** 空闲成员补位通知与超时回退记录（防止无人应答时无限等待）。 */
  offeredTo?: string[] | undefined
  offeredAt?: string | undefined
  offerExpiresAt?: string | undefined
  offerTimedOutAt?: string | undefined
  /** 独立复核记录（经 canReviewWorkItem 真实入口校验）。 */
  reviewedBy?: string | undefined
  reviewState?: 'pending' | 'passed' | 'failed' | undefined
  reviewNote?: string | undefined
  claimRevision: number
  claimEventIds: string[]
  submitEventIds: string[]
  mergeEventIds: string[]
  createdAt: string
  updatedAt: string
}

/** 分工成员之间的定向协助、澄清、接手与合并消息记录（带 eventId 去重与防循环统计）。 */
export interface DivisionPeerMessage {
  id: string
  fromDivisionId: string
  toDivisionId: string
  kind: 'help_request' | 'clarification' | 'claim_notice' | 'handoff_result' | 'merge_confirm' | 'work_offer' | 'merge_failed' | 'review_result'
  content: string
  itemId?: string | undefined
  eventId: string
  at: string
}

/** 派工、补位、超时回退、合并与复核的审计轨迹。 */
export interface DivisionHandoffAudit {
  kind: 'dispatch' | 'offer' | 'claim' | 'offer_timeout' | 'merge_failed' | 'merged' | 'review'
  actor: string
  itemId?: string | undefined
  at: string
  detail?: string | undefined
}

/** §4.2 投机草稿实际外发目标（渠道 Outbox 或 DSH 会话）。 */
export interface SpeculativeDraftTarget {
  kind: 'outbox' | 'session'
  channel?: { source: string; thread: string; address: Record<string, string> } | undefined
  ticketId?: string | undefined
  sessionId?: string | undefined
}

/** §4.2 投机草稿可恢复发件台账（按稳定 deliveryKey 索引，确保并发双确认与崩溃重启后绝不重复发送）。 */
export interface SpeculativeDraftDeliveryRecord {
  deliveryKey: string
  draftId: string
  claimToken: string
  state: 'claimed' | 'dispatched' | 'acknowledged' | 'failed'
  externalDeliveryId?: string | undefined
  error?: string | undefined
  updatedAt: string
}

/** §4.2 投机执行草稿：先形成未发布草稿，原子认领后按稳定投递键交付一次，撤销或无价值时零外发静默丢弃。 */
export interface SpeculativeDraft {
  draftId: string
  triggerId: string
  title: string
  content: string
  /** 稳定幂等投递键，创建时确定，跨重试与重启保持不变。 */
  deliveryKey: string
  /** 绑定的真实渠道 Outbox 或会话目标，供真实事件/工具/HTTP 入口直接外发。 */
  target?: SpeculativeDraftTarget | undefined
  status: 'draft' | 'delivering' | 'delivered' | 'delivery_failed' | 'revoked' | 'discarded'
  claimToken?: string | undefined
  deliveryAttempts?: number | undefined
  reason?: string | undefined
  deliveryId?: string | undefined
  confirmedBy?: string | undefined
  confirmedAt?: string | undefined
  revokedAt?: string | undefined
  discardedAt?: string | undefined
  lastError?: string | undefined
  createdAt: string
  updatedAt: string
}

export interface TaskPlan {
  taskId: string
  title: string
  originSessionId: string
  /** 记录首次触发该分工计划的会话/来源标识。 */
  triggeredBy?: string | undefined
  originModel: { provider: string; model: string; reasoningEffort?: string } | null
  /** 记录发起任务时模型解析来源，严禁静默回退到协调器默认模型。 */
  originModelSource?: 'session-selection' | 'session-request' | 'host-default' | 'unresolved' | undefined
  planKey: string
  /** 发起聊天归属的宿主工作区 ID（保证分工会话出现在同一工作区侧栏，R02）。 */
  workspaceId?: string | undefined
  directory: string
  complexity: ComplexityVerdict
  maxSessions: number
  slots: Record<string, number>
  divisions: DivisionRecord[]
  /** 同任务内可独立拆分、领取、回报与合并的细粒度工作项（R04）。 */
  workItems?: DivisionWorkItem[] | undefined
  /** 分工成员之间的定向求助、澄清、接手与合并消息（R04）。 */
  peerMessages?: DivisionPeerMessage[] | undefined
  /** 首次派工、空闲补位通知、认领、超时回退及合并/复核审计轨迹。 */
  handoffAudit?: DivisionHandoffAudit[] | undefined
  /** 超出 maxSessions 限额而未开启独立会话的其余分工项，保持可见以便留给主会话或后续批次（M07-m）。 */
  deferredDivisions?: DeferredDivisionRecord[] | undefined
  /** 计划修订时被移除并已停止的分工历史记录（M07-l）。 */
  removedDivisions?: DivisionRecord[] | undefined
  pendingDeliveries?: PendingDivisionDelivery[] | undefined
  deliveredNotificationIds?: string[] | undefined
  /** 跨计划修订的复查历史与递增序号（M07-j）。 */
  reviewHistory?: ReviewHistoryEntry[] | undefined
  reviewSeq?: number | undefined
  review?: {
    sessionId: string
    round: number
    state: 'pending' | 'passed' | 'failed'
    summary?: string | undefined
    acceptanceCriteria?: string | undefined
    findings?: string[] | undefined
    reworkDivisionIds?: string[] | undefined
    limitReached?: boolean | undefined
    deliverableVersion?: string | undefined
    history?: ReviewHistoryEntry[] | undefined
  } | undefined
  createdAt: string
  updatedAt: string
}

/** Key of a KV record whose value has type `V`; a plain string represents an untyped key. */
export type Key<V> = string & { readonly __value?: V }
/** Family of KV records sharing a prefix: callable to build a key from its name parts, and exposing `prefix` for listing. */
export type Family<V, A extends unknown[]> = ((...name: A) => Key<V>) & { readonly prefix: string }
/** Define a single typed KV key; external Source plugins use `record` and `family` to type their own keys. */
export const record = <V>(key: string) => key as Key<V>
/** Define a KV key family whose keys join `prefix` and name parts with `:` (or a custom `format`). */
export function family<V, A extends unknown[] = [string]>(prefix: string, format = (...name: A) => name.join(':')): Family<V, A> {
  return Object.assign((...name: A) => `${prefix}${format(...name)}` as Key<V>, { prefix })
}

export const KV = {
  /** Store: current database schema version. */
  store: { schema: record<number>('schema') },
  /** Settings: current revision, per-block revision, and saved settings snapshots (including the current one). */
  settings: { revision: record<number>('settings-revision'),
    block: family<number, [block: SettingsSave]>('settings-block-revision:'),
    version: family<SettingsVersion, [revision: number]>('settings-version:') },
  /** Prompts: current revision and saved prompt versions. */
  prompts: { revision: record<number>('prompt-revision'), version: family<PromptVersion, [revision: number]>('prompt-version:'),
    /** The built-in text of a prompt part an override was edited from, by its `base`, which shows what an upgrade changed. */
    builtIn: family<string, [base: string]>('prompt-built-in:') },
  /**
   * Runtime: the Session the main Session is currently on, and the ones it has already been handed on from.
   *
   * `masterId` used to be written once and never changed, which made "the main Session also hands over at the threshold"
   * impossible: every reader held one fixed ID. It is now the *current* generation, and `masterPrevious` records the
   * sessions it replaced so input typed into an old window can still be routed (see the relay's superseded routes).
   * Both are durable: a restart must not lose which Session the panel should be showing.
   */
  runtime: { masterId: record<string>('master-id'), masterPrevious: record<string[]>('master-previous'),
    /** 主协调会话切换指针已提交但尚未确认激活时的持久记录，用于重启/恢复时幂等重唤醒。 */
    masterActivation: record<{ target: string; generation: number }>('master-activation'),
    usage: record<{ day: string; tokens: number }>('daily-usage') },
  /** Sessions: prompt revisions each Session has worked under, ordered oldest first; the last entry (`.at(-1)`) is its active revision. */
  sessions: { prompts: family<number[], [session: string]>('session-prompts:'),
    teamModels: family<{ inherited: { provider: string; model: string; reasoningEffort?: string } | null; models: ({ provider: string; model: string; reasoningEffort?: string } | null)[]; overrides?: Record<string, { provider: string; model: string; reasoningEffort?: string }> | undefined; max: number; slots: Record<string, number>; autoHard?: boolean }, [ticket: string]>('team-models:'),
    /** 用户在普通聊天中显式启用 Super Agent 自动分工协调预设的持久标记（重启后自动恢复权限）。 */
    chatCoordinator: family<boolean, [session: string]>('chat-coordinator:'),
    /**
     * The ticket a Session works on, written when the Session is created and kept for its whole life.
     *
     * This is the only way a Session is recognised as a ticket's worker. Names are never parsed for it: a relayed
     * Session is `worker-<ticket>-r<generation>`, which a prefix slice would turn into a ticket ID that does not exist,
     * and a name can carry a newline, so `startsWith('worker-')` is not a decision this plugin can make safely.
     */
    owner: family<string, [session: string]>('session-ticket:'),
    /**
     * Handover record for a ticket being moved to a fresh Session because the old one filled up its context window.
     *
     * `current` is the Session the ticket is committed to and changes only at commit, so every reader keeps talking to a
     * Session that exists and holds the summary; `target` is the one being prepared and is never routed to. `stage` is
     * the last step that completed, and a record a crash left at a middle stage is resumed from there rather than
     * restarted, which keeps the move idempotent.
     */
    relay: family<Relay, [ticket: string]>('session-relay:'),
    /** 子会话接班后持久保留的父会话、所属工单及接力状态。 */
    subagentParent: family<string, [session: string]>('subagent-parent:'),
    subagentTicket: family<string, [session: string]>('subagent-ticket:'),
    subagentRelay: family<Relay, [rootSession: string]>('subagent-relay:'),
    /** 多会话分工规划记录（M07），按 taskId / ticketId 索引。 */
    divisions: family<TaskPlan, [taskId: string]>('task-divisions:'),
    /** 反向索引：把独立分工会话 ID 映射到所属任务和分工 ID。 */
    divisionOwner: family<{ taskId: string; divisionId: string }, [session: string]>('division-owner:'),
    /** §4.2 投机执行草稿记录：未发布草稿 → 原子认领交付 / 撤销 / 无价值静默丢弃。 */
    speculativeDraft: family<SpeculativeDraft, [draftId: string]>('speculative-draft:'),
    /** §4.2 投机执行草稿发件台账（按稳定 deliveryKey 索引，支持崩溃与重启后的幂等恢复）。 */
    speculativeDelivery: family<SpeculativeDraftDeliveryRecord, [deliveryKey: string]>('speculative-delivery:') },
  /** Schema 11 migration: legacy main-Session queues imported into the effect table. */
  queues: { relays: record<{ id: string; text: string }[]>('relay-queue'), unsubscribed: record<string[]>('subscription-results'),
    prompts: record<number | null>('prompt-notification'), settings: record<number | null>('settings-notification') },
  /** Per-Source resolved display names mapping a named ID (such as a Feishu chat ID) to its display name. */
  sources: { labels: family<Record<string, string>, [source: string]>('source-labels:') },
  /**
   * GitHub Source: notification cursor and pending retries; per-Issue/PR read cursor shared by notification and polled reads;
   * per-stream cursor, start times by kind, and ETag; default-branch CI state; and per-PR CI fingerprint and revision (`revision`
   * counts reported CI changes so each produces a distinct Trigger ID).
   */
  github: { since: record<string>('github-since'), retries: record<Record<string, Retry>>('github-retry'),
    cursor: family<string, [number: number]>('github-cursor:'),
    stream: family<{ since: string; started: Record<string, string>; etag?: string }, [stream: string]>('github-stream:'),
    branchCi: record<{ branch?: string; failures?: string[]; revision: number }>('github-branch-ci'),
    ci: family<{ fingerprint: string; revision: number }, [number: number]>('github-ci:') },
  /**
   * Feishu Source: known chats (`true` for direct messages); per-chat history cursor and active topics mapped from topic ID
   * to last-seen timestamp; and per-polled-thread seen message IDs and initialization flag.
   */
  feishu: { chats: record<Record<string, boolean>>('feishu-chats'), history: family<string, [chat: string]>('feishu-history:'),
    topics: family<Record<string, string>, [chat: string]>('feishu-history-threads:'),
    seen: family<string[], [thread: string]>('thread-seen:'), initialized: family<boolean, [thread: string]>('thread-initialized:') },
  /** Message ids already turned into triggers, per mailbox, so a re-read of the same mail does not open a second ticket. */
  mail: { seen: family<string[], [mailbox: string]>('mail-seen:') },
  /** Message ids already seen, per OneBot instance: two bridges on the same endpoint must not share a cursor. */
  qq: { seen: family<string[], [instance: string]>('qq-seen:'),
    pending: family<Array<{ account: string; message: Record<string, unknown> }>, [instance: string]>('qq-pending:') },
}
