/**
 * 每日用量记账：按本地事件的 `usage` 累加，供预算上限判断「今天到量了没有」。
 *
 * 为什么不问服务商要统计：那条路需要额外的 API 凭据、有延迟、而且各家的口径不一样。这里只数本机自己
 * 看到的东西 —— 每个 Session 的 `assistant/message` 事件带 `usage` 时就累加 —— 得到的是一个**下限**：
 * 它不会少算本机跑的量，可能比账单少算（例如别处用同一个 key 花掉的），这对于「到线就别再派新活」
 * 是安全的偏保守方向。
 *
 * 记账按本地日期（Asia/Shanghai 的日历日）分桶，跨日自动归零，不需要定时清理。
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** `assistant/message` 里携带的用量，四个桶互不重叠（推理已含在 output 里）。 */
interface Usage { uncachedInputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }

/** 一天的分桶：日期 + 累计 token。 */
export interface DailyUsage { day: string; tokens: number }

/**
 * 进程内的每日累加器。
 *
 * 它只做加法和跨日归零，不落盘：DSH 重启会丢掉今天已数到的量，而上限的用途是「别在同一天里无限花」，
 * 重启后从零开始仍然安全，不会因为多算而误拦正常的工作。
 */
export class UsageMeter {
  private day = ''
  private tokens = 0

  /** 本地日历日，`YYYY-MM-DD`；用本地日期是因为人要按自己的「今天」理解这个上限。 */
  private static today(): string {
    const now = new Date()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const date = String(now.getDate()).padStart(2, '0')
    return `${now.getFullYear()}-${month}-${date}`
  }

  /** 观察一条 Session 事件；只有带 `usage` 的 `assistant/message` 会改变计数。 */
  observe(event: Pick<SessionEvent, 'type' | 'data'>): void {
    if (event.type !== 'assistant/message') return
    const usage = (event.data as { usage?: Usage }).usage
    if (!usage) return
    const total = (usage.uncachedInputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
    if (total <= 0) return
    const today = UsageMeter.today()
    // A new calendar day starts a new count; no timer is needed to reset it.
    if (today !== this.day) { this.day = today; this.tokens = 0 }
    this.tokens += total
  }

  /** 今天到目前为止的用量。 */
  today(): DailyUsage {
    const today = UsageMeter.today()
    if (today !== this.day) { this.day = today; this.tokens = 0 }
    return { day: this.day, tokens: this.tokens }
  }

  /**
   * 是否已经用满 `limit`（0 表示不限）。
   *
   * 用「已经花掉的量」判断，而不是「再加上这一次会不会超」：后者会让最后一次永远跑不完，而前者让已经在跑的
   * 那一轮自然结束，只是不再派新的活。
   */
  exceeded(limit: number): boolean {
    return limit > 0 && this.today().tokens >= limit
  }
}
