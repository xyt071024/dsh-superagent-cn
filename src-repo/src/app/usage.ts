/**
 * 每日用量记账：按本地事件的 `usage` 累加，供预算上限判断「今天到量了没有」。
 *
 * 为什么不问服务商要统计：那条路需要额外的 API 凭据、有延迟、而且各家的口径不一样。这里只数本机自己
 * 看到的东西 —— 每个 Session 的 `assistant/message` 事件带 `usage` 时就累加 —— 得到的是一个**下限**：
 * 未上报用量的调用和其他设备上的调用不会计入；已经运行的任务也可能超过限额，因此这不是服务商账单的硬上限。
 *
 * 记账按 Asia/Shanghai 日历日分桶，跨日自动归零。
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** `assistant/message` 里携带的用量，四个桶互不重叠（推理已含在 output 里）。 */
interface Usage { uncachedInputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }

/** 一天的分桶：日期 + 累计 token。 */
export interface DailyUsage { day: string; tokens: number }

/** 每次记录后同步保存，以便重启后继续遵守预算。 */
export class UsageMeter {
  private day = ''
  private tokens = 0

  constructor(private readonly storage?: { load(): DailyUsage | undefined; save(value: DailyUsage): void },
    private readonly clock: () => Date = () => new Date()) {
    const saved = storage?.load()
    if (saved && typeof saved.day === 'string' && Number.isFinite(saved.tokens) && saved.tokens >= 0) {
      this.day = saved.day; this.tokens = saved.tokens
    }
  }

  private currentDay(): string {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(this.clock())
    const part = (name: string) => parts.find(item => item.type === name)!.value
    return `${part('year')}-${part('month')}-${part('day')}`
  }

  /** 观察一条 Session 事件；只有带 `usage` 的 `assistant/message` 会改变计数。 */
  observe(event: Pick<SessionEvent, 'type' | 'data'>): void {
    if (event.type !== 'assistant/message') return
    const usage = (event.data as { usage?: Usage }).usage
    if (!usage) return
    const total = (usage.uncachedInputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
    if (!Number.isFinite(total) || total <= 0) return
    const today = this.currentDay()
    // A new calendar day starts a new count; no timer is needed to reset it.
    if (today !== this.day) { this.day = today; this.tokens = 0 }
    this.tokens += total
    this.storage?.save({ day: this.day, tokens: this.tokens })
  }

  /** 今天到目前为止的用量。 */
  today(): DailyUsage {
    const today = this.currentDay()
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
