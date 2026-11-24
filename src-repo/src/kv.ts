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

export interface TaskPlan {
  taskId: string
  title: string
  originSessionId: string
  originModel: { provider: string; model: string; reasoningEffort?: string } | null
  planKey: string
  directory: string
  complexity: ComplexityVerdict
  maxSessions: number
  slots: Record<string, number>
  divisions: DivisionRecord[]
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
    teamModels: family<{ inherited: { provider: string; model: string; reasoningEffort?: string } | null; models: ({ provider: string; model: string; reasoningEffort?: string } | null)[]; max: number; slots: Record<string, number>; autoHard?: boolean }, [ticket: string]>('team-models:'),
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
    divisionOwner: family<{ taskId: string; divisionId: string }, [session: string]>('division-owner:') },
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
