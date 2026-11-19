import { createServer as createHttpServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { once } from 'node:events'
import { createServer as createTlsServer } from 'node:tls'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { expect, it } from 'vitest'
import { probeSource } from '../src/app/source-probe.ts'
import type { SourceInstance } from '../src/sources/kind.ts'

const source = (kind: string, config: Record<string, unknown>): SourceInstance => ({ id: kind, kind, enabled: true, config })

it('checks OneBot identity without returning the credential or server response', async () => {
  let authorization = '', action = ''
  const server = createHttpServer((req, res) => {
    authorization = String(req.headers.authorization); action = req.url ?? ''
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 1234, token: 'private-value' } }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test address')
  try {
    const result = await probeSource(source('qq', { endpoint: `http://127.0.0.1:${address.port}`, token: 'private-value' }))
    expect(result).toEqual({ checks: [{ name: 'onebot', state: 'ok' }] })
    expect(authorization).toBe('Bearer private-value')
    expect(action).toBe('/get_login_info')
    expect(JSON.stringify(result)).not.toContain('private-value')
  } finally { server.close(); await once(server, 'close') }
})

it('never sends a mail password to a server that does not offer TLS', async () => {
  const commands: string[] = []
  const server = createTcpServer(socket => {
    socket.write('220 local test\r\n')
    let buffer = ''
    socket.on('data', data => {
      buffer += data.toString()
      let end: number
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2); commands.push(line)
        if (/^EHLO/i.test(line)) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n')
        else if (/^STARTTLS/i.test(line)) socket.write('454 TLS unavailable\r\n')
        else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n')
        else socket.write('250 OK\r\n')
      }
    })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test address')
  try {
    const result = await probeSource(source('mail', { address: 'agent@example.com', secret: 'secret-value',
      imapHost: '127.0.0.1', imapSecure: false, smtpHost: '127.0.0.1', smtpPort: address.port, smtpSecure: false }))
    expect(result).toEqual({ checks: [{ name: 'imap', state: 'unsafe' }, { name: 'smtp', state: 'tls_failed' }] })
    expect(commands.some(line => /^AUTH|^MAIL|^RCPT|^DATA/i.test(line))).toBe(false)
    expect(JSON.stringify(result)).not.toContain('secret-value')
  } finally { server.close(); await once(server, 'close') }
})

it('reports incomplete or unsupported configurations without connecting', async () => {
  expect(await probeSource(source('qq', { endpoint: '' }))).toEqual({ checks: [{ name: 'onebot', state: 'missing' }] })
  expect(await probeSource(source('feishu', {}))).toEqual({ checks: [] })
})

it('distinguishes an authorization rejection from a disconnected endpoint', async () => {
  const server = createHttpServer((_req, res) => { res.writeHead(401); res.end('private server detail') })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test address')
  const config = { endpoint: `http://127.0.0.1:${address.port}`, token: 'private-value' }
  try {
    expect(await probeSource(source('qq', config))).toEqual({ checks: [{ name: 'onebot', state: 'auth_failed' }] })
  } finally { server.close(); await once(server, 'close') }
  expect(await probeSource(source('qq', config))).toEqual({ checks: [{ name: 'onebot', state: 'unreachable' }] })
})

it('verifies encrypted IMAP and SMTP authentication without reading or sending messages', async () => {
  const cert = fileURLToPath(new URL('./fixtures/smtp-test-cert.pem', import.meta.url))
  const key = fileURLToPath(new URL('./fixtures/smtp-test-key.pem', import.meta.url))
  const commands: string[] = []
  const options = { cert: readFileSync(cert), key: readFileSync(key) }
  const imap = createTlsServer(options, socket => {
    socket.write('* OK test ready\r\n')
    let buffer = ''
    socket.on('data', data => {
      buffer += data.toString()
      let end: number
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2); commands.push(line.split(' ').slice(0, 2).join(' '))
        const [tag, verb] = line.split(' ')
        if (verb === 'SELECT') socket.write(`* 0 EXISTS\r\n${tag} OK selected\r\n`)
        else if (verb === 'LOGOUT') socket.end(`* BYE\r\n${tag} OK done\r\n`)
        else socket.write(`${tag} OK authenticated\r\n`)
      }
    })
  })
  const smtp = createTlsServer(options, socket => {
    socket.write('220 test SMTP\r\n')
    let buffer = ''
    socket.on('data', data => {
      buffer += data.toString()
      let end: number
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2); commands.push(line.split(' ')[0]!)
        if (/^EHLO/i.test(line)) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n')
        else if (/^AUTH /i.test(line)) socket.write('235 Authenticated\r\n')
        else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n')
        else socket.write('250 OK\r\n')
      }
    })
  })
  imap.listen(0, '127.0.0.1'); smtp.listen(0, '127.0.0.1')
  await Promise.all([once(imap, 'listening'), once(smtp, 'listening')])
  const ia = imap.address(), sa = smtp.address()
  if (!ia || typeof ia === 'string' || !sa || typeof sa === 'string') throw new Error('Missing test address')
  const config = { address: 'test@example.com', secret: 'test-secret', imapHost: '127.0.0.1', imapPort: ia.port,
    imapSecure: true, smtpHost: '127.0.0.1', smtpPort: sa.port, smtpSecure: true }
  const script = `import { probeSource } from './src/app/source-probe.ts'; const config = JSON.parse(process.argv[1]);
    process.stdout.write(JSON.stringify(await probeSource({ id:'mail', kind:'mail', enabled:true, config })));`
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['--experimental-transform-types', '--no-warnings', '--input-type=module', '-e', script, JSON.stringify(config)],
        { cwd: process.cwd(), env: { ...process.env, NODE_EXTRA_CA_CERTS: cert }, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = '', err = ''
      child.stdout.on('data', data => { out += String(data) }); child.stderr.on('data', data => { err += String(data) })
      child.on('error', reject); child.on('close', code => code === 0 ? resolve(out) : reject(new Error(err)))
    })
    expect(JSON.parse(result)).toEqual({ checks: [{ name: 'imap', state: 'ok' }, { name: 'smtp', state: 'ok' }] })
    expect(commands.some(line => /\b(FETCH|MAIL|RCPT|DATA)\b/i.test(line))).toBe(false)
  } finally {
    imap.close(); smtp.close(); await Promise.all([once(imap, 'close'), once(smtp, 'close')])
  }
})


// The setup checks for OneBot and mail exist so a misconfigured Source says WHAT is wrong instead of showing "waiting"
// forever: that silence was the standing complaint about this project. These tests pin the mapping from a probe state to
// the SetupError code the panel localizes, and pin that no credential ever reaches the message.
it('names what an OneBot Source is missing instead of leaving it silently waiting', async () => {
  const { resolveOneBot, resolveMail } = await import('../src/deployment.ts')
  const { SetupError } = await import('../src/setup.ts')
  const code = async (run: Promise<void>): Promise<string> =>
    run.then(() => 'none', (error: unknown) => (error instanceof SetupError ? error.code : `unexpected:${String(error)}`))

  expect(await code(resolveOneBot({ kind: 'qq', config: {} }))).toBe('onebotEndpointUnset')
  expect(await code(resolveOneBot({ kind: 'qq', config: { endpoint: '   ' } }))).toBe('onebotEndpointUnset')
  // A filled-in but unusable address is its own case: it parses as nothing a gateway can be, so it is reported as a wrong
  // address rather than as a gateway that stayed silent. "localhost:3000" is the classic mistake — a custom scheme, not a URL.
  expect(await code(resolveOneBot({ kind: 'wechat', config: { endpoint: 'not-a-url' } }))).toBe('onebotUnreachable')
  expect(await code(resolveOneBot({ kind: 'wecom', config: { endpoint: 'localhost:3000' } }))).toBe('onebotUnreachable')
  // Nothing listening on that port: the address in the message must be scheme and host only, never the full URL.
  const closed = await new Promise<number>(resolve => {
    const server = createTcpServer(); server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing test address')
      const port = address.port; server.close(() => resolve(port))
    })
  })
  const unreachable = await resolveOneBot({ kind: 'qq', config: { endpoint: `http://127.0.0.1:${closed}/secret-path?token=leak` } })
    .then(() => 'none', (error: unknown) => (error instanceof SetupError ? error.message : String(error)))
  expect(unreachable).toContain('127.0.0.1')
  expect(unreachable).not.toContain('leak')
  expect(unreachable).not.toContain('secret-path')

  // A gateway that answers 401 is an auth problem, which has its own instruction.
  const server = createHttpServer((_req, res) => { res.writeHead(401); res.end('{}') })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test address')
  try {
    expect(await code(resolveOneBot({ kind: 'qq', config: { endpoint: `http://127.0.0.1:${address.port}` } }))).toBe('onebotAuthFailed')
  } finally { server.close(); await once(server, 'close') }

  expect(await code(resolveMail({ kind: 'mail', config: {} }))).toBe('mailAddressUnset')
  expect(await code(resolveMail({ kind: 'mail', config: { address: 'a@b.test' } }))).toBe('mailPasswordUnset')
})
