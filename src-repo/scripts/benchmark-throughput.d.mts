export interface StreamRunMetrics {
  lane: number
  dispatchAtMs: number
  firstTokenAtMs: number
  lastTokenAtMs: number
  completedAtMs: number
  ttftMs: number
  generationSeconds: number
  outputTokens: number
  tokensPerSecond: number
  rateLimited: boolean
  httpStatus: number
}

export interface RoundMetrics {
  round: number
  mode: 'single' | 'parallel'
  concurrency: number
  runs: StreamRunMetrics[]
  totalOutputTokens: number
  earliestFirstTokenAtMs: number
  latestLastTokenAtMs: number
  aggregateWindowSeconds: number
  aggregateTokensPerSecond: number
  overlapSeconds: number
  overlappingLanesConfirmed: boolean
  wallClockSeconds: number
  rateLimitedCount: number
}

export function computeRunMetrics(input: {
  lane: number
  dispatchAtMs: number
  firstTokenAtMs: number
  lastTokenAtMs: number
  completedAtMs: number
  outputTokens: number
  rateLimited?: boolean
  httpStatus?: number
}): StreamRunMetrics

export function summarizeRound(round: number, mode: 'single' | 'parallel', runs: StreamRunMetrics[]): RoundMetrics

export function startMockSseServer(options?: {
  tokensPerResponse?: number
  chunkTokens?: number
  chunkIntervalMs?: number
  ttftMs?: number
  rateLimitAfterRequests?: number
}): Promise<{ url: string; close: () => Promise<void> }>

export function runThroughputBenchmark(options: {
  endpoint: string
  apiKey?: string
  model: string
  prompt?: string
  maxTokens?: number
  rounds?: number
  concurrency?: number
}): Promise<{ singleRounds: RoundMetrics[]; parallelRounds: RoundMetrics[]; summary: Record<string, number | boolean> }>
