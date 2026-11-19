import { createServer, type Server, type Socket } from 'node:net'
import { readFileSync } from 'node:fs'
import { createSecureContext, TLSSocket } from 'node:tls'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import PostalMime from 'postal-mime'
import { MailConfigSchema, sendMail } from '../src/sources/mail.ts'

const certificate = fileURLToPath(new URL('./fixtures/smtp-test-cert.pem', import.meta.url))
const privateKey = fileURLToPath(new URL('./fixtures/smtp-test-key.pem', import.meta.url))
let server: Server | undefined
const sockets = new Set<Socket>()
afterEach(async () => {
  for (const socket of sockets) socket.destroy()
  sockets.clear()
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
  server = undefined
})

async function fakeSmtp(options: { starttls?: boolean; rejectAuth?: boolean } = {}) {
  const captured: { message?: string; from?: string; to?: string; auth?: string; authEncrypted?: boolean } = {}
  const secureContext = createSecureContext({ key: readFileSync(privateKey), cert: readFileSync(certificate) })
  server = createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.write('220 local test SMTP\r\n')
    function handle(stream: Socket, encrypted: boolean) {
      let buffer = '', message = '', data = false
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        let end: number
        while ((end = buffer.indexOf('\r\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 2)
          if (data) {
            if (line === '.') { captured.message = message; data = false; stream.write('250 queued\r\n') }
            else message += `${line.startsWith('..') ? line.slice(1) : line}\r\n`
          } else if (/^EHLO /i.test(line)) stream.write(!encrypted && options.starttls
            ? '250-localhost\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n' : '250-localhost\r\n250 AUTH PLAIN\r\n')
          else if (/^STARTTLS$/i.test(line) && options.starttls && !encrypted) {
            stream.removeListener('data', onData)
            stream.write('220 Ready to start TLS\r\n', () => {
              const secure = new TLSSocket(stream, { isServer: true, secureContext })
              secure.on('error', () => {})
              handle(secure, true)
            })
            return
          } else if (/^STARTTLS$/i.test(line)) stream.write('454 TLS not available\r\n')
          else if (/^AUTH PLAIN /i.test(line)) {
            captured.auth = Buffer.from(line.slice(11), 'base64').toString('utf8'); captured.authEncrypted = encrypted
            stream.write(options.rejectAuth ? '535 Authentication failed\r\n' : '235 Authenticated\r\n')
          } else if (/^MAIL FROM:/i.test(line)) { captured.from = line; stream.write('250 OK\r\n') }
          else if (/^RCPT TO:/i.test(line)) { captured.to = line; stream.write('250 OK\r\n') }
          else if (/^DATA$/i.test(line)) { data = true; stream.write('354 send message\r\n') }
          else if (/^QUIT$/i.test(line)) stream.end('221 bye\r\n')
          else stream.write('250 OK\r\n')
        }
      }
      stream.on('data', onData)
    }
    handle(socket, false)
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  return { captured, port: address.port }
}

/** Separate process loads the test CA at Node startup; the production sender still verifies certificates. */
function secureSend(port: number, password = 'test-password'): Promise<void> {
  const input = JSON.stringify({ address: 'agent@example.com', secret: password, smtpHost: '127.0.0.1', smtpPort: port, smtpSecure: false })
  const script = `import { sendMail, MailConfigSchema } from './src/sources/mail.ts';
    await sendMail(MailConfigSchema.parse(JSON.parse(process.argv[1])), 'recipient@example.com', '测试主题', '第一行\\n.第二行');`
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-transform-types', '--no-warnings', '--input-type=module', '-e', script, input],
      { cwd: process.cwd(), env: { ...process.env, NODE_EXTRA_CA_CERTS: certificate }, stdio: ['ignore', 'ignore', 'pipe'] })
    let error = ''
    child.stderr.on('data', chunk => { error += String(chunk) })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve() : reject(new Error(error)))
  })
}

describe('SMTP in-process delivery', () => {
  it('refuses an unencrypted server before sending authentication', async () => {
    const { captured, port } = await fakeSmtp()
    const config = MailConfigSchema.parse({ address: 'agent@example.com', secret: 'test-password', smtpHost: '127.0.0.1', smtpPort: port, smtpSecure: false })
    await expect(sendMail(config, 'recipient@example.com', 'subject', 'text')).rejects.toThrow()
    expect(captured.auth).toBeUndefined()
    expect(captured.message).toBeUndefined()
  })

  it('sends authenticated Unicode mail only after STARTTLS', async () => {
    const { captured, port } = await fakeSmtp({ starttls: true })
    await secureSend(port)
    expect(captured.auth).toBe('\0agent@example.com\0test-password')
    expect(captured.authEncrypted).toBe(true)
    expect(captured.from).toContain('agent@example.com')
    expect(captured.to).toContain('recipient@example.com')
    const parsed = await PostalMime.parse(captured.message!)
    expect(parsed.subject).toBe('测试主题')
    expect(parsed.text?.replace(/\r\n/g, '\n').trim()).toBe('第一行\n.第二行')
  })

  it('reports encrypted authentication failure without accepting a message', async () => {
    const { captured, port } = await fakeSmtp({ starttls: true, rejectAuth: true })
    await expect(secureSend(port, 'incorrect')).rejects.toThrow()
    expect(captured.authEncrypted).toBe(true)
    expect(captured.message).toBeUndefined()
  })
})
