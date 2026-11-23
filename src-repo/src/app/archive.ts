/**
 * 上下文自动归档：按「这一轮会话的上下文占了窗口多少」决定何时归档、把活交接给新的上下文继续。
 *
 * 为什么需要它：一个工单可能跑几十轮，父会话拆出去的子会话也可能各自跑到窗口满。DSH 自带的
 * `compaction-basic` 按**固定比例**触发（默认窗口的 80%，用户改不了），而真正要的是「我设 65% 就 65%」。
 * 这里只做**可配置比例的触发与归档后的交接**，归档本身仍交给宿主的压缩服务：
 *
 * 1. 每 15 秒量一次本插件管理的每个 Session 的上下文压力（`ctx.tokenMeter`）。
 * 2. 超过 `budget.archivePercent` 就对那个会话触发一次归档。
 * 3. 归档走宿主的 `ctx.compaction.compactNow` —— 摘要、游标记账、失败回滚全用宿主那一套，不自己造。
 * 4. 归档完把「上一个上下文已归档，接着干」作为一条 steer 交给同一个 Session，这就是交接。
 *
 * 不做的：不替宿主决定保留多少尾部（那是它的策略），不新建 Session（那是 routing 的事）。
 * 会话缺少 `tokenMeter` 或 `compaction` 时不归档该会话，并在健康状态中报告缺少的服务。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** 只取 `ctx.tokenMeter` 用得到的那一个方法，避免为一个类型多背一个 peer 依赖。 */
interface Meter {
  contextPressure(session: Agent['session']): { pressureTokens?: number; projectedTokens?: number; contextWindow?: number }
}
/** 只取 `ctx.compaction` 用得到的那一个方法。 */
interface Compaction {
  compactNow(agent: unknown, signal: AbortSignal): Promise<unknown>
}

/** 归档动作的依赖，全部从宿主取。 */
export interface ArchiverHost {
  readonly context: Context
  /** 受管理的 Session（主会话与各工单会话），由 `Sessions` 维护。 */
  managed(): readonly { id: string; agent: Agent }[]
  /** 当前设置里的归档配置。 */
  budget(): { percent: number; enabled: boolean }  /** 归档完成后把交接文本交给该 Session，以 steer 投递。 */
  steer(id: string, requestId: string, text: string): Promise<void>
  /** 归档结果写进健康面板，让人在界面上看得到。 */
  report(detail: string, state?: 'ready' | 'error'): void
  /**
   * Move a ticket's work from its current Session to a fresh one.
   *
   * Called instead of compaction when the Session belongs to a ticket and the operator asked for a handover rather
   * than an in-place shrink. Returns the Session the ticket is committed to afterwards, or the reason it stayed put —
   * a running Team, undelivered input, an unreadable transcript, or a ticket whose Session is not the one this
   * archiver measured. A refusal is not an error: the caller keeps the old Session alive and reports the reason, and
   * this archiver then compacts in place, which creates no Session.
   */
  relay?(ticketId: string, fromSession: string, percent: number): Promise<{ moved: string } | { refused: string }>
  /**
   * Hand the main coordinator's work to a fresh Session; the same contract as `relay`, without a ticket.
   *
   * The operator's rule is that *every* Session continues in a new one at the threshold, and the main Session used
   * to be the single exception: it had no ticket, so `relay` was never called for it and it only ever compacted in
   * place. Absent on a host that predates this, in which case the main Session compacts as before.
   */
  masterRelay?(fromSession: string, percent: number): Promise<{ moved: string } | { refused: string }>
  /** Whether a managed Session is the main coordinator, which is moved by `masterRelay` rather than by its ticket. */
  isMaster?(session: string): boolean
  /** Map a managed Session back to its ticket, or `undefined` for the main Session. */
  ticketOf(session: string): string | undefined
  /** 独立分工会话（M07）到所属任务和分工的映射，超阈值时优先走分工接力。 */
  divisionOf?(session: string): { taskId: string; divisionId: string } | undefined
  divisionRelay?(taskId: string, divisionId: string, fromSession: string, percent: number): Promise<{ moved: string } | { refused: string }>
  /** 子会话（M06）达阈值时走保留父子关系、模型槽与共享状态的接力路径。 */
  isSubagent?(session: string): boolean
  subagentRelay?(fromSession: string, percent: number): Promise<{ moved: string } | { refused: string }>
}

const TICK_MS = 15_000
const STOP_TIMEOUT_MS = 10_000
const ARCHIVE_TIMEOUT_MS = 120_000
/** 同一个 Session 两次归档之间至少隔这么久，避免刚压下去又被量上来时反复触发。 */
const COOLDOWN_MS = 120_000

/**
 * 周期检查每个受管 Session 的上下文占比，超过配置值就归档并交接。
 * `start()` 挂 `setInterval`；`stop()` 取消正在运行的操作，最多等待 10 秒。
 */
export class ContextArchiver {
  private timer?: ReturnType<typeof setInterval>
  private running?: Promise<void>
  private readonly stopping = new AbortController()
  private stopped = false
  /** 每个 Session 上次归档的时刻，用于冷却。 */
  private readonly last = new Map<string, number>()
  /** 正在归档的 Session，避免同一轮重复进入。 */
  private readonly busy = new Set<string>()
  private readonly pending = new Set<Promise<void>>()
  /** A compaction that did not reduce pressure must not repeatedly wake an idle worker. */
  private readonly unchanged = new Map<string, number>()

  constructor(private readonly host: ArchiverHost) {}

  start(): void {
    if (this.stopped || this.timer) return
    this.timer = setInterval(() => { void this.tick() }, TICK_MS)
    // 不因为一个定时器把宿主进程撑住不退出。
    this.timer.unref?.()
  }

  async stop(): Promise<void> {
    this.stopped = true
    clearInterval(this.timer)
    this.stopping.abort()
    const running = Promise.allSettled([...(this.running ? [this.running] : []), ...this.pending])
    if (!this.running && this.pending.size === 0) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const settled = await Promise.race([
      running.then(() => true),
      new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), STOP_TIMEOUT_MS) }),
    ]).finally(() => { clearTimeout(timer) })
    if (!settled) this.host.report('Archive did not stop after cancellation; host compaction is still running', 'error')
  }

  /** Serializes checks and waits for any active compaction to settle before stopping. */
  tick(): Promise<void> {
    const config = this.host.budget()
    if (!config.enabled || this.running || this.stopped) return Promise.resolve()
    const running = this.check(config.percent)
    this.running = running
    return running.finally(() => { if (this.running === running) this.running = undefined })
  }

  private async check(percent: number): Promise<void> {
    for (const { id, agent } of this.host.managed()) {
      if (this.stopped) break
      if (agent.status !== 'idle' || this.busy.has(id)) continue
      if (Date.now() - (this.last.get(id) ?? 0) < COOLDOWN_MS) continue
      // Compaction is normally isolated in the agent preset, not in the host's root context.
      const meter = (agent.ctx.get('tokenMeter') ?? this.host.context.get('tokenMeter')) as Meter | undefined
      const compaction = (agent.ctx.get('compaction') ?? this.host.context.get('compaction')) as Compaction | undefined
      if (!meter || !compaction) {
        this.host.report(`${id}: archive unavailable — missing ${!meter ? 'tokenMeter' : 'compaction'}`, 'error')
        continue
      }
      const share = this.share(meter, agent)
      if (share === undefined) continue
      if (share * 100 < percent) { this.unchanged.delete(id); continue }
      const previous = this.unchanged.get(id)
      if (previous !== undefined && Math.abs(share - previous) < 0.05) continue
      await this.archive(id, agent, compaction, meter, share)
    }
  }

  /** 当前上下文占窗口的比例；取不到窗口或压力时返回 undefined（不猜）。 */
  private share(meter: Meter, agent: Agent): number | undefined {
    try {
      const { pressureTokens, projectedTokens, contextWindow } = meter.contextPressure(agent.session)
      if (!contextWindow || contextWindow <= 0) return undefined
      // projectedTokens 是「下一次请求会花多少」，比 pressureTokens 更贴近即将发生的事，优先用它。
      const used = projectedTokens ?? pressureTokens
      return used === undefined ? undefined : used / contextWindow
    } catch { return undefined }
  }

  private async archive(id: string, agent: Agent, compaction: Compaction, meter: Meter, before: number): Promise<void> {
    this.busy.add(id)
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, this.stopping.signal])
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopWait!: () => void
    const interrupted = new Promise<void>(resolve => {
      stopWait = resolve
      signal.addEventListener('abort', stopWait, { once: true })
      if (signal.aborted) resolve()
      timer = setTimeout(() => {
        this.host.report(`${id}: archive timed out; cancellation requested`, 'error')
        controller.abort()
      }, ARCHIVE_TIMEOUT_MS)
    })
    // Keep the session busy until the host actually settles, including if it ignores cancellation.
    const task = (async () => {
      try {
        // A ticket with a live Team or undelivered input cannot be moved without losing state, so the host answers
        // `undefined` and this falls through to compaction — the old behaviour, still correct, just not a handover.
        const ticketId = this.host.ticketOf(id)
        // The main coordinator owns no ticket, so it is handed over through its own relay; without one it compacts
        // in place exactly as before. Checked first because a coordinator Session never has a ticket.
        if (ticketId === undefined && this.host.isMaster?.(id) && this.host.masterRelay) {
          const answer = await this.host.masterRelay(id, before)
          const moved = 'moved' in answer ? answer.moved : undefined
          if (moved !== undefined) {
            this.last.set(id, Date.now())
            this.unchanged.delete(id)
            this.host.report(`${id}: handed over to ${moved} at ${Math.round(before * 100)}%`, 'ready')
            return
          }
          this.host.report(`${id}: no handover (${'refused' in answer ? answer.refused : 'unavailable'}); compacting the main Session instead`, 'ready')
        }
        const division = ticketId === undefined ? this.host.divisionOf?.(id) : undefined
        if (division && this.host.divisionRelay) {
          const answer = await this.host.divisionRelay(division.taskId, division.divisionId, id, before)
          const moved = 'moved' in answer ? answer.moved : undefined
          if (moved !== undefined) {
            this.last.set(id, Date.now())
            this.unchanged.delete(id)
            this.host.report(`${id}: division relayed to ${moved} at ${Math.round(before * 100)}%`, 'ready')
            return
          }
          this.host.report(`${id}: no handover (${'refused' in answer ? answer.refused : 'unavailable'}); compacting division Session instead`, 'ready')
        }
        if (ticketId !== undefined && this.host.relay) {
          // The handover text is built from the old Session's own transcript and ticket, not from a fixed sentence: a
          // claim that history is attached is only true if something actually read that history.
          const answer = await this.host.relay(ticketId, id, before)
          const moved = 'moved' in answer ? answer.moved : undefined
          if (moved !== undefined) {
            this.last.set(id, Date.now())
            this.unchanged.delete(id)
            this.host.report(`${id}: relayed to ${moved} at ${Math.round(before * 100)}%`)
            return
          }
          // Saying why keeps the operator from reading a compaction as a handover: no new Session was created.
          this.host.report(`${id}: no handover (${'refused' in answer ? answer.refused : 'unavailable'}); compacting this Session instead, so no new Session was created`, 'ready')
        }
        if (ticketId === undefined && !division && !this.host.isMaster?.(id) && this.host.isSubagent?.(id) && this.host.subagentRelay) {
          const answer = await this.host.subagentRelay(id, before)
          const moved = 'moved' in answer ? answer.moved : undefined
          if (moved !== undefined) {
            this.last.set(id, Date.now())
            this.unchanged.delete(id)
            this.host.report(`${id}: subagent relayed to ${moved} at ${Math.round(before * 100)}%`, 'ready')
            return
          }
          this.host.report(`${id}: no handover (${'refused' in answer ? answer.refused : 'unavailable'}); compacting subagent Session instead`, 'ready')
        }
        const result = await compaction.compactNow({ session: agent.session, runMaintenance: agent.runMaintenance.bind(agent) }, signal)
        if (signal.aborted) return
        if (result === null) {
          this.unchanged.set(id, before)
          this.host.report(`${id}: archive was unavailable; waiting for a meaningful change before retrying`, 'error')
          return
        }
        const archivedAt = Date.now()
        this.last.set(id, archivedAt)
        const measured = this.share(meter, agent)
        const after = measured ?? 0
        if (measured !== undefined && measured >= before - 0.01) {
          this.unchanged.set(id, measured)
          this.host.report(`${id}: archive did not reduce context pressure; waiting for a meaningful change before retrying`, 'error')
          return
        } else this.unchanged.delete(id)
        this.host.report(`${id}: archived at ${Math.round(before * 100)}%, now ${Math.round(after * 100)}%`)
        await this.host.steer(id, `archived:${id}:${archivedAt}`,
          `The earlier part of this Session was archived at ${Math.round(before * 100)}% of its context window `
          + `(now ${Math.round(after * 100)}%). It is summarised in this history. Carry on with the work in progress: `
          + `do not restart from the beginning or redo steps that already finished.`)
      } catch (error) {
        if (!signal.aborted) this.host.report(`${id}: archive failed — ${error instanceof Error ? error.message : String(error)}`, 'error')
      } finally { this.busy.delete(id) }
    })()
    this.pending.add(task)
    void task.finally(() => { this.pending.delete(task) })
    try { await Promise.race([task, interrupted]) }
    finally { clearTimeout(timer); signal.removeEventListener('abort', stopWait) }
  }
}
