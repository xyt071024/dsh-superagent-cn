/** Checks mail parsing: the header decoding, the body split, and the trigger rules an inbox depends on. */
import { describe, expect, it } from 'vitest'
import { MailConfigSchema, bodyOf, decodeHeader, triggerOf } from '../src/sources/mail.ts'

const config = MailConfigSchema.parse({ address: 'agent@example.com', secret: 'x' })

describe('decodeHeader', () => {
  it('decodes a base64 encoded word, which is how a Chinese subject arrives', () => {
    const encoded = '=?UTF-8?B?5L2g5aW9?=' // 你好
    expect(decodeHeader(encoded)).toBe('你好')
  })

  it('decodes a Q encoded word with an underscore for a space', () => {
    expect(decodeHeader('=?utf-8?Q?hello_world?=')).toBe('hello world')
  })

  it('leaves plain text alone', () => {
    expect(decodeHeader('Quarterly report')).toBe('Quarterly report')
  })
})

describe('bodyOf', () => {
  it('returns what follows the blank line between head and body', () => {
    expect(bodyOf('Subject: x\r\n\r\nline one\r\nline two')).toBe('line one\r\nline two')
  })

  it('returns nothing for a message with no body', () => {
    expect(bodyOf('Subject: x\r\n\r\n')).toBe('')
  })
})

const mail = [
  'From: =?UTF-8?B?5byg5LiJ?= <zhang@example.com>',
  'To: agent@example.com',
  'Subject: =?UTF-8?B?6K+35L+u5LiA5LiL6L+Z5Liq6ZSZ?=',
  'Date: Wed, 11 Nov 2026 03:00:00 +0000',
  'Message-ID: <abc@example.com>',
  '',
  '这个报错怎么解决？',
].join('\r\n')

describe('triggerOf', () => {
  it('turns a mail into an addressed trigger', () => {
    const trigger = triggerOf(mail, config, 'INBOX', 1)
    expect(trigger?.actor.source).toBe('mail')
    expect(trigger?.actor.id).toBe('zhang@example.com')
    expect(trigger?.addressed).toBe('direct')
    expect(trigger?.id).toBe('mail:<abc@example.com>')
    expect(trigger?.text).toContain('这个报错怎么解决')
    expect(trigger?.meta.messageId).toBe('<abc@example.com>')
  })

  it('keeps the subject so an assessment can judge intent without the body', () => {
    expect(triggerOf(mail, config, 'INBOX', 1)?.text).toContain('主题：')
  })

  it('ignores a copy of what the agent itself sent', () => {
    const own = mail.replace('zhang@example.com', 'agent@example.com')
    expect(triggerOf(own, config, 'INBOX', 1)).toBeUndefined()
  })

  it('falls back to the mailbox position when a message has no Message-ID', () => {
    const bare = mail.replace(/Message-ID:.*\r\n/, '')
    expect(triggerOf(bare, config, 'INBOX', 7)?.id).toBe('mail:INBOX:7')
  })
})
