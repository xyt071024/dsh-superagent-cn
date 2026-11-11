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
 * 缺 `tokenMeter` 或 `compaction` 时**整体不启用**，而不是半跑着悄悄不归档 —— 静默失败比不做更糟。
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
  report(detail: string): void
}

const TICK_MS = 15_000
/** 同一个 Session 两次归档之间至少隔这么久，避免刚压下去又被量上来时反复触发。 */
const COOLDOWN_MS = 120_000

/**
 * 周期检查每个受管 Session 的上下文占比，超过配置值就归档并交接。
 * `start()` 挂 `setInterval`；`stop()` 清掉并等待在跑的那次结束。
 */
export class ContextArchiver {
  private timer?: ReturnType<typeof setInterval>
  private running = false
  private stopped = false
  /** 每个 Session 上次归档的时刻，用于冷却。 */
  private readonly last = new Map<string, number>()
  /** 正在归档的 Session，避免同一轮重复进入。 */
  private readonly busy = new Set<string>()

  constructor(private readonly host: ArchiverHost) {}

  start(): void {
    if (this.stopped) return
    this.timer = setInterval(() => { void this.tick() }, TICK_MS)
    // 不因为一个定时器把宿主进程撑住不退出。
    this.timer.unref?.()
  }

  async stop(): Promise<void> {
    this.stopped = true
    clearInterval(this.timer)
    // 等在跑的那次结束，避免关停时留下半个归档。
    for (let guard = 0; this.running && guard < 100; guard++) await new Promise(done => setTimeout(done, 100))
  }

  /** 一次检查：逐个受管 Session 量占比，够线的归档。串行执行，一个卡住不拖累全部。 */
  async tick(): Promise<void> {
    const config = this.host.budget()
    if (!config.enabled || this.running || this.stopped) return
    const meter = this.host.context.get('tokenMeter') as Meter | undefined
    const compaction = this.host.context.get('compaction') as Compaction | undefined
    if (!meter || !compaction) return
    this.running = true
    try {
      for (const { id, agent } of this.host.managed()) {
        if (this.stopped) break
        // 归档要求空闲会话；忙的时候进去只会拿到 busy，白跑一次还占着锁。
        if (agent.status !== 'idle' || this.busy.has(id)) continue
        if (Date.now() - (this.last.get(id) ?? 0) < COOLDOWN_MS) continue
        const share = this.share(meter, agent)
        if (share === undefined || share * 100 < config.percent) continue
        await this.archive(id, agent, compaction, meter, share)
      }
    } finally { this.running = false }
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
    // 手动归档需要一个空闲会话，`runMaintenance` 是宿主给的那把锁。
    const controller = new AbortController()
    try {
      await compaction.compactNow({ session: agent.session, runMaintenance: agent.runMaintenance.bind(agent) }, controller.signal)
      const archivedAt = Date.now()
      this.last.set(id, archivedAt)
      const after = this.share(meter, agent) ?? 0
      this.host.report(`${id}: archived at ${Math.round(before * 100)}%, now ${Math.round(after * 100)}%`)
      await this.host.steer(id, `archived:${id}:${archivedAt}`,
        `The earlier part of this Session was archived at ${Math.round(before * 100)}% of its context window `
        + `(now ${Math.round(after * 100)}%). It is summarised in this history. Carry on with the work in progress: `
        + `do not restart from the beginning or redo steps that already finished.`)
    } catch (error) {
      // 定时器里抛错会掀掉整个宿主进程，所以这里只记录。
      this.host.report(`${id}: archive failed — ${error instanceof Error ? error.message : String(error)}`)
    } finally { this.busy.delete(id) }
  }
}
