/** Validation bounds shared between host schemas and management panel forms. */
export const LIMITS = {
  ruleName: 100,
  ruleInstruction: 2000,
  evalTimeoutSeconds: { min: 30, max: 600 },
  maxWorkers: { min: 1, max: 16 },
  prepareCommand: 4000,
  promptMaxChars: { min: 1000, max: 1_000_000 },
  admissionContextMaxPages: { min: 1, max: 100 },
  admissionContextTimeoutMs: { min: 1, max: 90_000 },
  /** Difficulty verdict (0–100) at or above which the strongest approved model is used and a ticket may be split. */
  difficultyThreshold: { min: 0, max: 100 },
  /** Share of the context window at which a session is archived; 20 so nothing is archived the moment it starts. */
  archivePercent: { min: 20, max: 95 },
  /** Minutes after which a running ticket counts as long enough to say something about. */
  longTaskMinutes: { min: 1, max: 600 },
} as const
