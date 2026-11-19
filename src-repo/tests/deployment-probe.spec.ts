import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { expect, it } from 'vitest'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { executable, resolveFeishuBot, workerProbe, type Machine, type Probe } from '../src/deployment.ts'
import { command, Commands } from '../src/infra/commands.ts'

it('runs a real probe with a clean PATH and the requested environment without an env executable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'probe-'))
  const bin = join(dir, 'worker-bin')
  mkdirSync(bin)
  const previous = process.env.PATH
  process.env.PATH = [bin, previous ?? ''].join(delimiter)
  const runtime = { spawn: ({ argv, cwd, env }: { argv: string[]; cwd: string; env?: Record<string, string> }) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env: { ...process.env, ...env } })
    let stdout = '', stderr = ''
    child.stdout.on('data', data => { stdout += String(data) })
    child.stderr.on('data', data => { stderr += String(data) })
    const reader = (value: () => string) => ({ readFrom: () => ({ text: value(), nextOffset: 0, lossy: false }) })
    return { done: new Promise(resolve => child.on('close', code => resolve({ exitCode: code }))),
      collected: { stdout: reader(() => stdout), stderr: reader(() => stderr) } }
  } } as unknown as SubprocessRuntime
  try {
    const probe = workerProbe(runtime, dir, dir, new AbortController().signal)
    const result = JSON.parse(await probe([process.execPath, '-e', 'process.stdout.write(JSON.stringify({path:process.env.PATH,flag:process.env.PROBE_FLAG}))'], { PROBE_FLAG: 'works' }))
    expect(result.flag).toBe('works')
    expect(result.path.split(delimiter)).not.toContain(bin)
  } finally {
    if (previous === undefined) delete process.env.PATH
    else process.env.PATH = previous
    rmSync(dir, { recursive: true, force: true })
  }
})

it.runIf(process.platform === 'win32')('runs a Windows npm launcher directly through Node and preserves special arguments', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'npm shim '))
  try {
    const launcher = join(dir, 'sample.cmd')
    const entry = join(dir, 'node_modules', 'sample', 'cli.js')
    mkdirSync(join(dir, 'node_modules', 'sample'), { recursive: true })
    writeFileSync(entry, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
    writeFileSync(launcher, '@ECHO off\r\nendLocal & "%_prog%" "%dp0%\\node_modules\\sample\\cli.js" %*\r\n')
    expect(executable('sample', dir)).toBe(launcher)
    expect(command([launcher, 'a&b'])[0]).toBe(process.execPath)
    const commands = new Commands(() => { throw new Error('not needed') }, {}, new AbortController().signal)
    const args = ['a&b', 'hello world', '%TEMP%', 'quote"here']
    expect(JSON.parse(await commands.run(launcher, args))).toEqual(args)
    const localNode = join(dir, 'node.exe')
    writeFileSync(localNode, '')
    expect(command([launcher])[0]).toBe(localNode)
    writeFileSync(launcher, '@echo off\r\necho not an npm launcher\r\n')
    expect(() => command([launcher, 'unsafe'])).toThrow('Unsupported Windows CLI launcher')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

it('passes Feishu notifier settings as process environment rather than a command', async () => {
  const calls: Array<{ argv: string[]; env?: Record<string, string> }> = []
  const probe: Probe = async (argv, env) => {
    calls.push({ argv, env })
    if (argv.includes('status')) return JSON.stringify({ appId: 'cli_test', identities: { bot: { status: 'ready' } } })
    if (argv.includes('strict-mode')) return 'strict-mode: bot'
    return JSON.stringify({ bot: { open_id: 'ou_test', app_name: 'Test' } })
  }
  const bot = await resolveFeishuBot({ stateDir: tmpdir() } as Machine, { cli: process.execPath }, probe)
  expect(bot?.botId).toBe('ou_test')
  expect(calls).toHaveLength(3)
  for (const call of calls) {
    expect(call.argv[0]).toBe(process.execPath)
    expect(call.env).toMatchObject({ LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' })
  }
})
