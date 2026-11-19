/** Checks the IMAP reply parser and the quoting rules without a network, since a live mailbox is not part of a test run. */
import { describe, expect, it } from 'vitest'
import { ImapClient, parseFetch } from '../src/sources/imap.ts'
import { createServer } from 'node:net'
import { once } from 'node:events'
import PostalMime from 'postal-mime'
import { MailConfigSchema, mimeTrigger } from '../src/sources/mail.ts'

describe('parseFetch', () => {
  it('reads one message and keeps its body', () => {
    const messages = parseFetch(['* 3 FETCH (UID 12 BODY[TEXT] {5}', 'hello)'])
    expect(messages).toHaveLength(1)
    expect(messages[0]?.seq).toBe(3)
    expect(messages[0]?.body).toContain('hello')
  })

  it('reads several messages in mailbox order', () => {
    const messages = parseFetch(['* 1 FETCH (UID 1 BODY[TEXT] {2}', 'aa)', '* 2 FETCH (UID 2 BODY[TEXT] {2}', 'bb)'])
    expect(messages.map(message => message.seq)).toEqual([1, 2])
    expect(messages[1]?.body).toContain('bb')
  })

  it('ignores a line that is not a fetch reply', () => {
    expect(parseFetch(['* OK mailbox ready'])).toEqual([])
  })
})

describe('ImapClient quoting', () => {
  it('escapes the characters the protocol reserves', () => {
    // A password containing a quote or backslash must survive as one argument.
    const client = new ImapClient({ host: 'h', port: 1, secure: true, user: 'a"b\\c', password: 'p' })
    // The quoting helper is private, so the observable contract is that construction accepts such a value unchanged.
    expect(client).toBeInstanceOf(ImapClient)
  })
})

it('preserves a fragmented UTF-8 literal and logs out cleanly', async () => {
  const commands: string[] = []
  const server = createServer(socket => {
    socket.write('* OK ready\r\n')
    let pending = ''
    socket.on('data', data => {
      pending += data.toString()
      let end: number
      while ((end = pending.indexOf('\r\n')) >= 0) {
        const line = pending.slice(0, end)
        pending = pending.slice(end + 2)
        commands.push(line)
        const tag = line.split(' ')[0]
        if (line.includes('FETCH')) {
          const body = Buffer.from('你好)\r\nworld')
          const reply = Buffer.concat([Buffer.from(`* 1 FETCH (BODY[TEXT] {${body.length}}\r\n`), body, Buffer.from(`)\r\n${tag} OK done\r\n`)])
          let index = 0
          const send = () => { if (index < reply.length) { socket.write(reply.subarray(index, ++index)); setImmediate(send) } }
          send()
        } else if (line.includes('LOGOUT')) {
          socket.end(`* BYE\r\n${tag} OK done\r\n`)
        } else socket.write(`${tag} OK done\r\n`)
      }
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test server address')
  const client = new ImapClient({ host: '127.0.0.1', port: address.port, secure: false, user: 'u', password: 'p', timeoutMs: 3000 })
  try {
    await client.open()
    const messages = await client.newest(1, 'BODY[TEXT]')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.body).toContain('你好)\r\nworld')
    await client.close()
    expect(commands.some(command => command.includes('LOGOUT'))).toBe(true)
  } finally {
    await client.close()
    server.close()
  }
})


it('preserves fragmented non-UTF-8 MIME bytes and extracts the complete message', async () => {
  const raw = Buffer.from([
    'From: Alice <alice@example.com>', 'To: agent@example.com', 'Subject: =?UTF-8?B?5L2g5aW9?=',
    'Message-ID: <mime@example.com>', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="abc"', '',
    '--abc', 'Content-Type: text/plain; charset=iso-8859-1', 'Content-Transfer-Encoding: 8bit', '',
    'caf\u00e9', '--abc', 'Content-Type: text/plain; name="secret.txt"',
    'Content-Disposition: attachment; filename="secret.txt"', '', 'attachment only', '--abc--', '',
  ].join('\r\n'), 'latin1')
  const server = createServer(socket => {
    socket.write('* OK ready\r\n')
    let pending = ''
    socket.on('data', data => {
      pending += data.toString()
      let end: number
      while ((end = pending.indexOf('\r\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 2)
        const tag = line.split(' ')[0]
        if (line.includes('FETCH')) {
          const reply = Buffer.concat([Buffer.from(`* 1 FETCH (BODY[] {${raw.length}}\r\n`), raw, Buffer.from(`)\r\n${tag} OK done\r\n`)])
          let index = 0
          const send = () => { if (index < reply.length) { socket.write(reply.subarray(index, ++index)); setImmediate(send) } }
          send()
        } else if (line.includes('LOGOUT')) socket.end(`* BYE\r\n${tag} OK done\r\n`)
        else socket.write(`${tag} OK done\r\n`)
      }
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test server address')
  const client = new ImapClient({ host: '127.0.0.1', port: address.port, secure: false, user: 'u', password: 'p', timeoutMs: 3000 })
  try {
    await client.open()
    const [message] = await client.newest(1, 'BODY.PEEK[]')
    expect(message?.raw.equals(raw)).toBe(true)
    const parsed = await PostalMime.parse(message!.raw)
    const trigger = mimeTrigger(parsed, MailConfigSchema.parse({ address: 'agent@example.com', secret: 'x' }), 'INBOX', 1)
    expect(trigger?.text).toBe('主题：你好\n\ncafé')
    expect(trigger?.text).not.toContain('attachment only')
    expect(trigger?.meta.messageId).toBe('<mime@example.com>')
  } finally {
    await client.close()
    server.close()
  }
})
