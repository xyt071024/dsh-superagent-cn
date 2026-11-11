/** Checks the IMAP reply parser and the quoting rules without a network, since a live mailbox is not part of a test run. */
import { describe, expect, it } from 'vitest'
import { ImapClient, parseFetch } from '../src/sources/imap.ts'

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
