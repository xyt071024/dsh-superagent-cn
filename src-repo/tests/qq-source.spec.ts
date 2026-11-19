/** Checks the Windows fixes against the behaviour they intend, not against the POSIX-only tests they replace. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { command } from '../src/infra/commands.ts'
import { credentialHelper, ghConfigDir, prepareShell, workerGitConfig } from '../src/infra/environment.ts'
import { call, recent, poll, pollFailure, QqConfigSchema, mentions, oneBotKind, ONE_BOT_KINDS, plainText, triggerOf } from '../src/sources/qq.ts'
import type { SourceContext } from '../src/sources/host.ts'
import { WebSocketServer } from 'ws'
import { once } from 'node:events'

const WINDOWS = process.platform === 'win32'

describe('command', () => {
  it('leaves a real executable alone on every platform', () => {
    expect(command(['C:/tools/gh.exe', 'api', 'user'])).toEqual(['C:/tools/gh.exe', 'api', 'user'])
    expect(command(['gh', 'api', 'user'])).toEqual(['gh', 'api', 'user'])
  })

  it('refuses missing Windows launchers, including uppercase extensions', () => {
    if (!WINDOWS) { expect(command(['C:/tools/GH.CMD', 'x'])).toEqual(['C:/tools/GH.CMD', 'x']); return }
    expect(() => command(['C:/tools/GH.CMD', 'x'])).toThrow('Cannot read Windows CLI launcher')
  })
})

describe('Windows prepare shell', () => {
  it.skipIf(!WINDOWS)('finds a usable shell and preserves POSIX command and environment semantics', () => {
    const shell = prepareShell()
    expect(existsSync(shell)).toBe(true)
    const output = execFileSync(shell, ['-c', 'printf "%s" "$DSH_SUPERAGENT_DIR"'], {
      encoding: 'utf8', env: { ...process.env, DSH_SUPERAGENT_DIR: 'path with spaces' },
    })
    expect(output).toBe('path with spaces')
  })
})

describe('credentialHelper', () => {
  it('quotes the CLI so a path with spaces stays one argument', () => {
    const helper = credentialHelper('C:/Program Files/gh/bin/gh.exe')
    expect(helper.startsWith('!')).toBe(true)
    expect(helper.endsWith('auth git-credential')).toBe(true)
    expect(helper).toContain('C:/Program Files/gh/bin/gh.exe')
  })
})

describe('ghConfigDir', () => {
  it('is a directory under the state directory, never the operator configuration', () => {
    const dir = ghConfigDir('C:/state')
    expect(dir).not.toContain('.config')
    expect(workerGitConfig('C:/state')).not.toBe(dir)
  })
})

describe('qq plain text', () => {
  it('flattens segments and keeps an @ target readable', () => {
    expect(plainText({ message: [{ type: 'at', data: { qq: '42' } }, { type: 'text', data: { text: '你好' } }] }))
      .toBe('@42 你好')
  })

  it('drops a reply segment, which carries no words', () => {
    expect(plainText({ message: [{ type: 'reply', data: { id: '9' } }, { type: 'text', data: { text: '继续' } }] })).toBe('继续')
  })

  // Each of these used to flatten to an empty string, which reads to the agent exactly like a person who said nothing:
  // a voice note, a shared file or a card arrived as silence and the ticket was routed on no content at all.
  it('names every segment that carries content in another form', () => {
    expect(plainText({ message: [{ type: 'record', data: {} }] })).toBe('[语音]')
    expect(plainText({ message: [{ type: 'video', data: {} }] })).toBe('[视频]')
    expect(plainText({ message: [{ type: 'file', data: { name: '报表.xlsx' } }] })).toBe('[文件: 报表.xlsx]')
    expect(plainText({ message: [{ type: 'location', data: {} }] })).toBe('[位置]')
    expect(plainText({ message: [{ type: 'contact', data: {} }] })).toBe('[名片]')
    expect(plainText({ message: [{ type: 'shake', data: {} }] })).toBe('[窗口抖动]')
  })

  it('takes a card title, so a policy can read what the card is about', () => {
    expect(plainText({ message: [{ type: 'card', data: { title: '周报提醒' } }] })).toBe('[卡片: 周报提醒]')
    expect(plainText({ message: [{ type: 'json', data: { prompt: '[提醒] 打卡' } }] })).toBe('[卡片: [提醒] 打卡]')
    // A card with nothing readable still says it was a card, rather than vanishing into an empty message.
    expect(plainText({ message: [{ type: 'xml', data: {} }] })).toBe('[卡片: 未命名]')
  })

  it('falls back to raw_message when the segments say nothing', () => {
    expect(plainText({ message: [], raw_message: '纯文本' })).toBe('纯文本')
  })
})

describe('qq mentions', () => {
  it('recognises an @ of the agent own account', () => {
    expect(mentions({ message: [{ type: 'at', data: { qq: '3884029032' } }] }, '3884029032')).toBe(true)
  })

  it('does not treat @everyone as naming the agent', () => {
    expect(mentions({ message: [{ type: 'at', data: { qq: 'all' } }] }, '3884029032')).toBe(false)
  })

  it('does not guess when the own account is unknown', () => {
    expect(mentions({ message: [{ type: 'at', data: { qq: '3884029032' } }] }, '')).toBe(false)
  })
})

const config = QqConfigSchema.parse({ endpoint: 'http://127.0.0.1:3000', token: 't' })

describe('qq trigger', () => {
  const group = { message_id: 5, group_id: 7, user_id: 9, time: 1700000000, sender: { nickname: '阿甲' },
    message: [{ type: 'at', data: { qq: '1' } }, { type: 'text', data: { text: '帮个忙' } }] }

  it('accepts a group message that names the agent, and names the Source on its actor', () => {
    const trigger = triggerOf(group, config, '1')
    expect(trigger?.addressed).toBe('mention')
    expect(trigger?.actor.source).toBe('qq')
    expect(trigger?.actor.id).toBe('9')
    expect(trigger?.threads[0]?.id).toBe('group:7')
    expect(trigger?.meta.scope).toBe('group')
  })

  it('ignores a group message that does not name the agent unless the Source observes all', () => {
    const quiet = { ...group, message: [{ type: 'text', data: { text: '路过' } }] }
    expect(triggerOf(quiet, config, '1')).toBeUndefined()
    expect(triggerOf(quiet, { ...config, observeAll: true }, '1')?.addressed).toBeUndefined()
  })

  it('ignores the account own message so it cannot answer itself', () => {
    expect(triggerOf({ ...group, user_id: 1 }, config, '1')).toBeUndefined()
  })

  it('treats a private message as addressed without an @', () => {
    const trigger = triggerOf({ message_id: 6, user_id: 9, time: 1700000000, message: [{ type: 'text', data: { text: '在吗' } }] }, config, '1')
    expect(trigger?.addressed).toBe('direct')
    expect(trigger?.threads[0]?.id).toBe('private:9')
  })

  it('keeps only the listed groups', () => {
    expect(triggerOf(group, { ...config, groups: '8' }, '1')).toBeUndefined()
    expect(triggerOf(group, { ...config, groups: '7 8' }, '1')).toBeDefined()
  })
})


describe('OneBot connectivity', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('rejects HTTP failures even when the response body claims success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok', retcode: 0 }), { status: 401 })))
    await expect(call(config, 'get_login_info')).rejects.toThrow('HTTP 401')
  })

  it('rejects contradictory or invalid protocol responses', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'failed', retcode: 0 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok', retcode: 100 })))
      .mockResolvedValueOnce(new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    await expect(call(config, 'action')).rejects.toThrow()
    await expect(call(config, 'action')).rejects.toThrow()
    await expect(call(config, 'action')).rejects.toThrow()
  })

  it('does not disclose upstream response bodies, tokens or raw network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('test-secret')).mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'failed', wording: 'test-secret', retcode: 100 }))))
    for (let i = 0; i < 2; i++) {
      try { await call(config, 'action'); throw new Error('expected rejection') }
      catch (error) { expect(String(error)).not.toContain('test-secret') }
    }
    expect(JSON.stringify(pollFailure(3, 3, new Error('test-secret')))).not.toContain('test-secret')
  })

  it('reports a failed group list instead of treating it as an empty successful poll', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(recent(config, new AbortController().signal)).rejects.toThrow('offline')
  })

  it('continues reading other groups after one group fails, but fails when all fail', async () => {
    const ok = () => new Response(JSON.stringify({ status: 'ok', retcode: 0, data: { messages: [{ message_id: 3 }] } }))
    const fetch = vi.fn().mockRejectedValueOnce(new Error('group offline')).mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetch)
    expect(await recent({ ...config, groups: '1,2' }, new AbortController().signal)).toHaveLength(1)
    fetch.mockRejectedValue(new Error('all offline'))
    await expect(recent({ ...config, groups: '1,2' }, new AbortController().signal)).rejects.toThrow('all offline')
  })

  it('ignores private echoes from the account itself', () => {
    expect(triggerOf({ user_id: 1, message_id: 1, raw_message: 'echo' }, config, '1')).toBeUndefined()
  })
})


describe('OneBot capability descriptions', () => {
  it('requires an event endpoint for private reception', () => {
    for (const spec of ONE_BOT_KINDS) {
      const kind = oneBotKind(spec.kind, spec.title, spec.description, spec.variable)
      expect(kind.fields.some(field => field.key === 'privateMessages')).toBe(true)
      expect(kind.fields.some(field => field.key === 'eventEndpoint')).toBe(true)
    }
  })
})

it('receives authenticated private events and deduplicates repeated frames', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing WebSocket address')
  let current = QqConfigSchema.parse({ endpoint: 'http://127.0.0.1:3000', eventEndpoint: `ws://127.0.0.1:${address.port}/`, token: 'test-secret', pollSeconds: 2 })
  const state = new Map<string, unknown>()
  const received = vi.fn()
  const ctx = { config: () => current, state: { get: (key: string) => state.get(key), set: (key: string, value: unknown) => state.set(key, value) },
    report: vi.fn(), receive: received } as unknown as SourceContext
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({ status: 'ok', retcode: 0,
    data: url.endsWith('get_login_info') ? { user_id: 1 } : [] }))))
  const connected = once(server, 'connection')
  const controller = new AbortController()
  const running = poll(ctx, 'qq', 'qq-test', controller.signal)
  try {
    const [socket, request] = await connected
    expect(request.headers.authorization).toBe('Bearer test-secret')
    const event = JSON.stringify({ post_type: 'message', message_type: 'private', message_id: 42, user_id: 9, raw_message: '你好' })
    socket.send(event); socket.send(event)
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(1))
    expect(received.mock.calls[0]?.[0]).toMatchObject({ addressed: 'direct', text: '你好' })
    const reconnect = once(server, 'connection')
    socket.terminate()
    const [next] = await reconnect
    next.send(event)
    next.send(JSON.stringify({ post_type: 'message', message_type: 'private', message_id: 43, user_id: 9, raw_message: '再见' }))
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(2))
    // Switching settings takes effect immediately, even before the next HTTP poll.
    current = { ...current, endpoint: 'http://127.0.0.1:3009', token: 'new-secret' }
    next.send(JSON.stringify({ post_type: 'message', message_type: 'private', message_id: 44, user_id: 9, raw_message: '旧连接' }))
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(received).toHaveBeenCalledTimes(2)
  } finally {
    controller.abort()
    await running
    await new Promise<void>(resolve => server.close(() => resolve()))
    vi.unstubAllGlobals()
  }
})

it('persists failed private events and retries them after the source restarts', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing WebSocket address')
  const current = QqConfigSchema.parse({ endpoint: 'http://127.0.0.1:3000', eventEndpoint: `ws://127.0.0.1:${address.port}/`, pollSeconds: 2 })
  const state = new Map<string, unknown>()
  const received = vi.fn().mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValue(undefined)
  const ctx = { config: () => current, state: { get: (key: string) => state.get(key), set: (key: string, value: unknown) => state.set(key, value) },
    report: vi.fn(), receive: received } as unknown as SourceContext
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({ status: 'ok', retcode: 0,
    data: url.endsWith('get_login_info') ? { user_id: 1 } : [] }))))
  const controller = new AbortController()
  const connected = once(server, 'connection')
  let running = poll(ctx, 'qq', 'qq-restart', controller.signal)
  try {
    const [socket] = await connected
    socket.send(JSON.stringify({ post_type: 'message', message_type: 'private', message_id: 51, user_id: 9, raw_message: '排队' }))
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(1))
    expect((state.get('qq-pending:qq-restart') as unknown[]).length).toBe(1)
    controller.abort(); await running
    const restarted = new AbortController()
    running = poll(ctx, 'qq', 'qq-restart', restarted.signal)
    try {
      await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(2))
      expect(state.get('qq-pending:qq-restart')).toEqual([])
    } finally { restarted.abort(); await running }
  } finally {
    controller.abort(); await running
    await new Promise<void>(resolve => server.close(() => resolve()))
    vi.unstubAllGlobals()
  }
})

it('pauses event intake and reports potential loss when the persistent queue is full', async () => {
  const state = new Map<string, unknown>([['qq-pending:qq-full', Array.from({ length: 500 }, (_, id) => ({ account: 'other', message: { message_id: id } }))]])
  const report = vi.fn()
  const ctx = { config: () => QqConfigSchema.parse({ endpoint: 'http://127.0.0.1:3000', eventEndpoint: 'ws://127.0.0.1:1', pollSeconds: 2 }),
    state: { get: (key: string) => state.get(key), set: (key: string, value: unknown) => state.set(key, value) }, report, receive: vi.fn() } as unknown as SourceContext
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 1 } }))))
  const controller = new AbortController(), running = poll(ctx, 'qq', 'qq-full', controller.signal)
  try {
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith('qq-full', expect.objectContaining({ state: 'error', detail: expect.stringContaining('may be missed') })))
    expect((state.get('qq-pending:qq-full') as unknown[]).length).toBe(500)
  } finally { controller.abort(); await running; vi.unstubAllGlobals() }
})
