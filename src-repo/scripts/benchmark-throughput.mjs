#!/usr/bin/env node
/**
 * 单会话 vs 多会话并发输出吞吐实测工具（对应需求 R06 与修改记录项 7）。
 *
 * 计量口径（严禁使用单条峰值相加代替实测合计）：
 * - 单条生成速度：outputTokens / ((lastTokenAt - firstTokenAt) / 1000)
 * - 多条并行合计吞吐：sum(outputTokens) / ((max(lastTokenAt) - min(firstTokenAt)) / 1000)
 * - 同时记录派工到首段输出延迟（TTFT / 排队）、是否限流（HTTP 429）、重叠并发区间占比以及派工到汇总总墙钟耗时。
 *
 * 用法：
 *   node scripts/benchmark-throughput.mjs --mock-server --rounds 3 --concurrency 3
 *   node scripts/benchmark-throughput.mjs --endpoint https://api.example.com/v1/chat/completions --model <model> --api-key-env OPENAI_API_KEY --rounds 3 --concurrency 3
 */
import http from 'node:http'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

/** 根据单次流式请求原始时间戳与 token 数计算准确吞吐指标。 */
export function computeRunMetrics(input) {
  const spanMs = Math.max(1, input.lastTokenAtMs - input.firstTokenAtMs)
  const generationSeconds = spanMs / 1000
  return {
    lane: input.lane,
    dispatchAtMs: input.dispatchAtMs,
    firstTokenAtMs: input.firstTokenAtMs,
    lastTokenAtMs: input.lastTokenAtMs,
    completedAtMs: input.completedAtMs,
    ttftMs: Math.max(0, input.firstTokenAtMs - input.dispatchAtMs),
    generationSeconds,
    outputTokens: input.outputTokens,
    tokensPerSecond: input.outputTokens / generationSeconds,
    rateLimited: !!input.rateLimited,
    httpStatus: input.httpStatus ?? 200,
  }
}

/**
 * 严格按指定口径汇总一轮（单会话或并行多会话）的真实吞吐与并发重叠证明：
 * 合计生成吞吐 = 三条输出 token 总数 ÷ (最晚末段输出时间 - 最早首段输出时间) 秒数。
 */
export function summarizeRound(round, mode, runs) {
  if (!Array.isArray(runs) || runs.length === 0) throw new Error('Round must contain at least one stream run')
  const totalOutputTokens = runs.reduce((sum, r) => sum + r.outputTokens, 0)
  const earliestDispatch = Math.min(...runs.map(r => r.dispatchAtMs))
  const latestComplete = Math.max(...runs.map(r => r.completedAtMs))
  const earliestFirstTokenAtMs = Math.min(...runs.map(r => r.firstTokenAtMs))
  const latestLastTokenAtMs = Math.max(...runs.map(r => r.lastTokenAtMs))
  const aggregateWindowSeconds = Math.max(0.001, (latestLastTokenAtMs - earliestFirstTokenAtMs) / 1000)
  const aggregateTokensPerSecond = totalOutputTokens / aggregateWindowSeconds
  const maxStart = Math.max(...runs.map(r => r.firstTokenAtMs))
  const minEnd = Math.min(...runs.map(r => r.lastTokenAtMs))
  const overlapSeconds = runs.length > 1 ? Math.max(0, (minEnd - maxStart) / 1000) : 0
  return {
    round,
    mode,
    concurrency: runs.length,
    runs,
    totalOutputTokens,
    earliestFirstTokenAtMs,
    latestLastTokenAtMs,
    aggregateWindowSeconds,
    aggregateTokensPerSecond,
    overlapSeconds,
    overlappingLanesConfirmed: runs.length > 1 ? overlapSeconds > 0 : false,
    wallClockSeconds: Math.max(0.001, (latestComplete - earliestDispatch) / 1000),
    rateLimitedCount: runs.filter(r => r.rateLimited).length,
  }
}

async function runOpenAiSseStream(opts) {
  const dispatchAtMs = performance.now()
  const res = await fetch(opts.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: opts.model,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: opts.maxTokens,
      messages: [{ role: 'user', content: opts.prompt }],
    }),
  })
  if (res.status === 429 || !res.ok || !res.body) {
    const done = performance.now()
    return computeRunMetrics({
      lane: opts.lane,
      dispatchAtMs,
      firstTokenAtMs: done,
      lastTokenAtMs: done,
      completedAtMs: done,
      outputTokens: 0,
      rateLimited: res.status === 429,
      httpStatus: res.status,
    })
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let firstTokenAtMs
  let lastTokenAtMs
  let usageCompletionTokens
  let chunkTokenEstimate = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const raw of lines) {
      const line = raw.trim()
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        const parsed = JSON.parse(data)
        if (typeof parsed.usage?.completion_tokens === 'number') {
          usageCompletionTokens = parsed.usage.completion_tokens
        }
        const delta = (parsed.choices?.[0]?.delta?.content ?? '') + (parsed.choices?.[0]?.delta?.reasoning_content ?? '')
        if (delta.length > 0) {
          const ts = performance.now()
          if (firstTokenAtMs === undefined) firstTokenAtMs = ts
          lastTokenAtMs = ts
          chunkTokenEstimate += Math.max(1, Math.round(delta.length / 4))
        }
      } catch { /* ignore keepalive lines */ }
    }
  }
  const completedAtMs = performance.now()
  return computeRunMetrics({
    lane: opts.lane,
    dispatchAtMs,
    firstTokenAtMs: firstTokenAtMs ?? completedAtMs,
    lastTokenAtMs: lastTokenAtMs ?? firstTokenAtMs ?? completedAtMs,
    completedAtMs,
    outputTokens: usageCompletionTokens ?? chunkTokenEstimate,
    httpStatus: res.status,
  })
}

/** 启动本地可控流式 SSE 模拟服务器，用于不消耗外部额度地验证测速口径和并行重叠计算。 */
export function startMockSseServer(options = {}) {
  const totalTokens = options.tokensPerResponse ?? 60
  const chunkTokens = options.chunkTokens ?? 5
  const intervalMs = options.chunkIntervalMs ?? 15
  const ttftMs = options.ttftMs ?? 20
  const rateLimitAt = options.rateLimitAfterRequests ?? 0
  let count = 0
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
    count++
    if (rateLimitAt > 0 && count > rateLimitAt) {
      res.writeHead(429, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'rate limited' }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' })
    let emitted = 0
    const startTimer = setTimeout(() => {
      const tick = setInterval(() => {
        const next = Math.min(chunkTokens, totalTokens - emitted)
        emitted += next
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'word '.repeat(next) } }] })}\n\n`)
        if (emitted >= totalTokens) {
          clearInterval(tick)
          res.write(`data: ${JSON.stringify({ choices: [], usage: { completion_tokens: totalTokens } })}\n\n`)
          res.write('data: [DONE]\n\n')
          res.end()
        }
      }, intervalMs)
      req.on('close', () => clearInterval(tick))
    }, ttftMs)
    req.on('close', () => clearTimeout(startTimer))
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve({
        url: `http://127.0.0.1:${addr.port}/v1/chat/completions`,
        close: () => new Promise(r => server.close(() => r())),
      })
    })
  })
}

export async function runThroughputBenchmark(options) {
  const rounds = Math.max(1, options.rounds ?? 3)
  const concurrency = Math.max(2, options.concurrency ?? 3)
  const prompt = options.prompt ?? 'Provide a structured 200-token technical summary of deterministic distributed task orchestration.'
  const maxTokens = options.maxTokens ?? 256
  const singleRounds = []
  const parallelRounds = []

  for (let r = 1; r <= rounds; r++) {
    const single = await runOpenAiSseStream({
      endpoint: options.endpoint,
      apiKey: options.apiKey ?? '',
      model: options.model,
      prompt,
      maxTokens,
      lane: 1,
    })
    singleRounds.push(summarizeRound(r, 'single', [single]))

    const parallel = await Promise.all(
      Array.from({ length: concurrency }, (_, i) => runOpenAiSseStream({
        endpoint: options.endpoint,
        apiKey: options.apiKey ?? '',
        model: options.model,
        prompt,
        maxTokens,
        lane: i + 1,
      })),
    )
    parallelRounds.push(summarizeRound(r, 'parallel', parallel))
  }

  const avg = nums => nums.reduce((a, b) => a + b, 0) / Math.max(1, nums.length)
  const singleAvgTokPerSec = avg(singleRounds.map(r => r.aggregateTokensPerSecond))
  const parallelAvgTokPerSec = avg(parallelRounds.map(r => r.aggregateTokensPerSecond))
  return {
    singleRounds,
    parallelRounds,
    summary: {
      rounds,
      concurrency,
      singleAvgTokPerSec: Number(singleAvgTokPerSec.toFixed(2)),
      parallelAvgAggregateTokPerSec: Number(parallelAvgTokPerSec.toFixed(2)),
      speedupRatio: Number((parallelAvgTokPerSec / Math.max(0.001, singleAvgTokPerSec)).toFixed(2)),
      allParallelRoundsOverlapped: parallelRounds.every(r => r.overlappingLanesConfirmed),
      totalRateLimited: [...singleRounds, ...parallelRounds].reduce((s, r) => s + r.rateLimitedCount, 0),
    },
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const args = process.argv.slice(2)
  const flag = name => args.includes(name)
  const value = (name, fallback = '') => {
    const idx = args.indexOf(name)
    return idx >= 0 ? (args[idx + 1] ?? fallback) : fallback
  }
  const rounds = Number(value('--rounds', '3'))
  const concurrency = Number(value('--concurrency', '3'))
  if (flag('--mock-server')) {
    const mock = await startMockSseServer()
    try {
      const result = await runThroughputBenchmark({ endpoint: mock.url, model: 'mock-stream', rounds, concurrency })
      console.log(JSON.stringify(result, null, 2))
    } finally {
      await mock.close()
    }
  } else {
    const endpoint = value('--endpoint')
    const model = value('--model')
    const apiKeyEnv = value('--api-key-env', 'OPENAI_API_KEY')
    const apiKey = process.env[apiKeyEnv] ?? ''
    if (!endpoint || !model) {
      console.error('Usage: node scripts/benchmark-throughput.mjs --mock-server | --endpoint <url> --model <id> [--api-key-env ENV] [--rounds 3] [--concurrency 3]')
      process.exit(1)
    }
    const result = await runThroughputBenchmark({ endpoint, apiKey, model, rounds, concurrency })
    console.log(JSON.stringify(result, null, 2))
  }
}
