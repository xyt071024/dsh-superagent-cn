import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QQBotInboundMessage } from '@tencent-connect/qqbot-nodejs'
import type { SourceContext } from '../src/sources/host.ts'
import type { OutboundMessage } from '../src/core/index.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import { SettingsSchema } from '../src/policy.ts'

const mock = vi.hoisted(() => ({ bots: [] as any[] }))
vi.mock('@tencent-connect/qqbot-nodejs', () => ({
  QQBot: class {
    handlers: Record<string, (...args: any[]) => any> = {}
    resolve?: () => void
    send = vi.fn().mockResolvedValue({})
    stop = vi.fn(() => this.resolve?.())
    constructor(public options: unknown) { mock.bots.push(this) }
    on(event: string, handler: (...args: any[]) => any) { this.handlers[event] = handler; return this }
    start() { return new Promise<void>(resolve => { this.resolve = resolve }) }
  },
}))
import { QqBotConfigSchema, qqBotKind, qqBotTrigger, watchQqBot } from '../src/sources/qqbot.ts'

const config = QqBotConfigSchema.parse({ appId: 'app', appSecret: 'secret' })
const direct = { kind: 'c2c', rawEventType: 'C2C_MESSAGE_CREATE', senderId: 'user-openid', content: 'hello',
  messageId: 'msg-1', timestamp: '2026-11-14T10:00:00Z', replyTarget: { scope: 'c2c', targetId: 'user-openid', msgId: 'msg-1' } } as QQBotInboundMessage
const group = { ...direct, kind: 'group', rawEventType: 'GROUP_AT_MESSAGE_CREATE', groupOpenid: 'group-openid', senderId: 'member-openid' } as QQBotInboundMessage

afterEach(() => { vi.useRealTimers(); mock.bots.length = 0 })
describe('official QQ bot', () => {
  it('converts C2C and group mentions into separate authorized source identities and reply targets', () => {
    expect(qqBotTrigger(direct, config)).toMatchObject({ source: 'qqbot', addressed: 'direct', actor: { source: 'qqbot', id: 'user-openid' },
      channel: { address: { scope: 'c2c', target: 'user-openid', messageId: 'msg-1' } } })
    expect(qqBotTrigger(group, config)).toMatchObject({ addressed: 'mention', actor: { id: 'member-openid' },
      channel: { address: { scope: 'group', target: 'group-openid', messageId: 'msg-1' } } })
    expect(qqBotTrigger({ ...group, rawEventType: 'GROUP_MESSAGE_CREATE' }, config)?.addressed).toBeUndefined()
  })
  it('ignores disabled scopes, bots, invalid events, and unsupported guilds', () => {
    expect(qqBotTrigger(direct, { ...config, directMessages: false })).toBeUndefined()
    expect(qqBotTrigger(group, { ...config, groupMessages: false })).toBeUndefined()
    expect(qqBotTrigger({ ...group, senderIsBot: true }, config)).toBeUndefined()
    expect(qqBotTrigger({ ...group, groupOpenid: '' }, config)).toBeUndefined()
    expect(qqBotTrigger({ ...direct, kind: 'guild' }, config)).toBeUndefined()
  })
  it('is visible but disabled by default, while respecting a saved enabled setting', () => {
    const fresh = new SourceRegistry(() => SettingsSchema.parse({}))
    fresh.register(qqBotKind)
    expect(fresh.instances().find(item => item.id === 'qqbot')).toMatchObject({ installed: true, enabled: false })
    const enabled = new SourceRegistry(() => SettingsSchema.parse({ sources: { qqbot: { enabled: true, config } } }))
    enabled.register(qqBotKind)
    expect(enabled.instance('qqbot')?.enabled).toBe(true)
  })
  it('stores the secret as a password field and defaults to an empty allowlist', () => {
    expect(qqBotKind.fields.find(field => field.key === 'appSecret')?.type).toBe('password')
    expect(qqBotKind.policy?.schema.parse({}).allowed).toEqual([])
  })
  it('uses the original message for replies and a stable retry sequence', async () => {
    const trigger = qqBotTrigger(group, config)!
    const message: OutboundMessage = { id: 'reply-1', channel: trigger.channel!, text: 'done', kind: 'reply' }
    await qqBotKind.channel!.send({ config, commands: {} as never }, message)
    await qqBotKind.channel!.send({ config, commands: {} as never }, message)
    const first = mock.bots[0].send.mock.calls[0][0]
    const second = mock.bots[1].send.mock.calls[0][0]
    expect(first).toMatchObject({ target: { scope: 'group', targetId: 'group-openid', msgId: 'msg-1' }, content: 'done' })
    expect(first.extra.msg_seq).toBe(second.extra.msg_seq)
    expect(mock.bots[0].stop).toHaveBeenCalled()
    await expect(qqBotKind.channel!.send({ config, commands: {} as never }, { ...message, channel: { ...message.channel, address: {} } })).rejects.toThrow()
  })
  it('starts a single bot, forwards messages and stops on abort', async () => {
    vi.useFakeTimers()
    const receive = vi.fn().mockResolvedValue(undefined)
    const report = vi.fn()
    const ctx = { ready: Promise.resolve(), configured: () => true, config: () => config, receive, report } as unknown as SourceContext
    const controller = new AbortController()
    const running = watchQqBot(ctx, controller.signal)
    await vi.waitFor(() => expect(mock.bots).toHaveLength(1))
    await mock.bots[0].handlers.message({}, direct)
    expect(receive).toHaveBeenCalledOnce()
    mock.bots[0].handlers.ready({})
    expect(report).toHaveBeenCalledWith('qqbot', expect.objectContaining({ state: 'ready' }))
    // SDK start() remains pending after ready and resolves only when stopped.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mock.bots).toHaveLength(1)
    expect(mock.bots[0].stop).not.toHaveBeenCalled()
    controller.abort()
    await running
    expect(mock.bots[0].stop).toHaveBeenCalled()
  })
})
