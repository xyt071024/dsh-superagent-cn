/** Validation bounds shared between host schemas and management panel forms. */
export const LIMITS = {
  ruleName: 100,
  ruleInstruction: 2000,
  evalTimeoutSeconds: { min: 30, max: 600 },
  maxWorkers: { min: 1, max: 16 },
  /** Difficulty estimation only chooses a model, so the threshold is a plain percentage. */
  difficultyThreshold: { min: 0, max: 100 },
  prepareCommand: 4000,
  promptMaxChars: { min: 1000, max: 1_000_000 },
  admissionContextMaxPages: { min: 1, max: 100 },
  admissionContextTimeoutMs: { min: 1, max: 90_000 },
  /** 归档阈值：低于 20% 就成了「刚开个头就归档」，高于 95% 之前窗口已经满了。 */
  archivePercent: { min: 20, max: 95 },
  /** 多长时间算长任务：1 分钟到一天。 */
  longTaskMinutes: { min: 1, max: 1440 },
} as const
