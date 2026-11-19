/** Checks mail parsing: the header decoding, the body split, and the trigger rules an inbox depends on. */
import { describe, expect, it } from 'vitest'
import PostalMime from 'postal-mime'
import { MailConfigSchema, bodyOf, decodeHeader, htmlText, mailboxesOf, mailConfigProblem, mailReadHealth, mimeTrigger, triggerOf } from '../src/sources/mail.ts'

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


describe('mail setup and health', () => {
  it('reads INBOX when the mailbox list is blank', () => {
    expect(mailboxesOf(' , ')).toEqual(['INBOX'])
    expect(mailboxesOf('INBOX,Archive')).toEqual(['INBOX', 'Archive'])
  })
  it('identifies the missing inbound setting', () => {
    expect(mailConfigProblem({ ...config, address: '' })?.code).toBe('mailMissingAddress')
    expect(mailConfigProblem({ ...config, secret: '' })?.code).toBe('mailMissingSecret')
    expect(mailConfigProblem({ ...config, imapHost: '' })?.code).toBe('mailMissingImapHost')
    expect(mailConfigProblem(config)).toBeUndefined()
  })
  it('does not claim SMTP was verified by an IMAP read', () => {
    expect(mailReadHealth(config, 2)).toMatchObject({ code: 'mailImapReady', values: { count: '2' } })
    expect(mailReadHealth({ ...config, smtpHost: '' }, 0)).toMatchObject({ state: 'error', code: 'mailMissingSmtpHost' })
  })
})


describe('MIME mail parsing', () => {
  it('decodes a base64 text part and ignores an attachment', async () => {
    const raw = [
      'From: a@example.com', 'Subject: test', 'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="b"', '', '--b',
      'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', '5L2g5aW9',
      '--b', 'Content-Type: text/plain', 'Content-Disposition: attachment; filename="x.txt"', '', 'secret attachment', '--b--', '',
    ].join('\r\n')
    const result = mimeTrigger(await PostalMime.parse(raw), config, 'INBOX', 1)
    expect(result?.text).toBe('主题：test\n\n你好')
    expect(result?.text).not.toContain('secret attachment')
  })
  it('decodes quoted-printable HTML-only messages to readable text', async () => {
    const raw = ['From: a@example.com', 'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable', '', '<p>=E4=BD=A0=E5=A5=BD &amp; hello</p>'].join('\r\n')
    const result = mimeTrigger(await PostalMime.parse(raw), config, 'INBOX', 1)
    expect(result?.text).toBe('你好 & hello')
    expect(htmlText('<script>bad()</script><p>ok<br>next</p>')).toBe('ok\nnext')
  })
})
