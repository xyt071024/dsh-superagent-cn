/** Checks the Windows fixes against the behaviour they intend, not against the POSIX-only tests they replace. */
import { describe, expect, it } from 'vitest'
import { extname } from 'node:path'
import { command } from '../src/infra/commands.ts'
import { credentialHelper, ghConfigDir, workerGitConfig } from '../src/infra/environment.ts'
import { QqConfigSchema, mentions, plainText, triggerOf } from '../src/sources/qq.ts'

const WINDOWS = process.platform === 'win32'

describe('command', () => {
  it('leaves a real executable alone on every platform', () => {
    expect(command(['C:/tools/gh.exe', 'api', 'user'])).toEqual(['C:/tools/gh.exe', 'api', 'user'])
    expect(command(['gh', 'api', 'user'])).toEqual(['gh', 'api', 'user'])
  })

  it('wraps a batch file in cmd.exe only on Windows', () => {
    const wrapped = command(['C:/tools/gh-agent.cmd', 'api', 'user'])
    if (!WINDOWS) { expect(wrapped).toEqual(['C:/tools/gh-agent.cmd', 'api', 'user']); return }
    // Node refuses to spawn a `.cmd` itself, so the interpreter has to be chosen here.
    expect(extname(wrapped[0]!).toLowerCase()).toBe('.exe')
    expect(wrapped.slice(1, 4)).toEqual(['/d', '/s', '/c'])
    expect(wrapped[4]).toBe('C:/tools/gh-agent.cmd')
    expect(wrapped.slice(5)).toEqual(['api', 'user'])
  })

  it('detects a batch file whatever its case', () => {
    const wrapped = command(['C:/tools/GH.CMD', 'x'])
    expect(wrapped.length).toBe(WINDOWS ? 6 : 2)
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
