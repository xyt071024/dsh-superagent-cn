import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lockSync } from 'proper-lockfile'
import { acquireStateLock, StateLockError } from '../src/infra/state-lock.ts'

describe('state-lock: 区分活实例锁与强制终止遗留锁的安全恢复', () => {
  it('正常获取与释放会同时清理 .lock 目录与 .lock-owner.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sa-lock-clean-'))
    try {
      const handle = acquireStateLock(dir, { onCompromised: () => {} })
      expect(existsSync(`${dir}.lock`)).toBe(true)
      expect(existsSync(join(dir, '.lock-owner.json'))).toBe(true)
      expect(handle.owner.pid).toBe(process.pid)

      // 同进程二次抢占绝不删除活锁，并保留 already being held 错误语义
      expect(() => acquireStateLock(dir, { onCompromised: () => {} })).toThrow(StateLockError)
      expect(() => acquireStateLock(dir, { onCompromised: () => {} })).toThrow(/already being held/)
      expect(existsSync(`${dir}.lock`)).toBe(true)

      handle.release()
      expect(existsSync(`${dir}.lock`)).toBe(false)
      expect(existsSync(join(dir, '.lock-owner.json'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(`${dir}.lock`, { recursive: true, force: true })
    }
  })

  it('真实子进程持有活锁时严禁删除，强制终止子进程后 0 秒即可安全回收遗留锁', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sa-lock-subproc-'))
    const holderScript = [
      'import { mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";',
      'import { hostname } from "node:os";',
      'import { join } from "node:path";',
      'import { lockSync } from "proper-lockfile";',
      'const dir = realpathSync(process.argv[1]);',
      'mkdirSync(dir, { recursive: true });',
      'lockSync(dir, { stale: 30000, realpath: false, onCompromised: () => {} });',
      'const st = statSync(`${dir}.lock`, { bigint: true });',
      'writeFileSync(join(dir, ".lock-owner.json"), JSON.stringify({',
      '  pid: process.pid,',
      '  hostname: hostname(),',
      '  startedAt: new Date().toISOString(),',
      '  lockIno: String(st.ino),',
      '  lockBirthtimeMs: Number(st.birthtimeMs),',
      '  token: "child-token-1"',
      '}));',
      'console.log("LOCKED:" + process.pid);',
      'setInterval(() => {}, 60000);',
    ].join('\n')

    const child = spawn(process.execPath, ['--input-type=module', '-e', holderScript, dir], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    try {
      await new Promise<void>((resolve, reject) => {
        let stderr = ''
        child.stderr.on('data', chunk => { stderr += String(chunk) })
        child.stdout.on('data', chunk => {
          if (String(chunk).includes('LOCKED:')) resolve()
        })
        child.once('exit', code => reject(new Error(`holder exited early (${code}): ${stderr}`)))
      })

      // 1) 子进程存活期间：严禁删锁，抛出包含活 PID 的 StateLockError
      let liveErr: unknown
      try {
        acquireStateLock(dir, { onCompromised: () => {} })
      } catch (err) {
        liveErr = err
      }
      expect(liveErr).toBeInstanceOf(StateLockError)
      expect((liveErr as StateLockError).code).toBe('ELOCKED')
      expect((liveErr as StateLockError).ownerAlive).toBe(true)
      expect((liveErr as Error).message).toContain(`PID ${child.pid}`)
      expect(existsSync(`${dir}.lock`)).toBe(true)

      // 2) 强制终止子进程（Windows TerminateProcess / POSIX SIGKILL）：不会触发 onExit 清理
      const exitDone = new Promise<void>(resolve => child.once('exit', () => resolve()))
      child.kill('SIGKILL')
      await exitDone
      expect(existsSync(`${dir}.lock`)).toBe(true)

      // 3) 0 秒立即重启获取锁：应立即回收已死子进程遗留锁并成功持锁，无需干等 30 秒 stale
      const logs: string[] = []
      const started = Date.now()
      const recovered = acquireStateLock(dir, {
        staleMs: 30_000,
        onCompromised: () => {},
        log: msg => logs.push(msg),
      })
      const elapsedMs = Date.now() - started
      expect(elapsedMs).toBeLessThan(3000)
      expect(recovered.reclaimedFromPid).toBe(child.pid)
      expect(recovered.owner.pid).toBe(process.pid)
      expect(logs.some(line => line.includes(`PID ${child.pid}`))).toBe(true)
      recovered.release()
    } finally {
      try { child.kill('SIGKILL') } catch {}
      rmSync(dir, { recursive: true, force: true })
      rmSync(`${dir}.lock`, { recursive: true, force: true })
    }
  })

  it('无 owner 元数据的旧版锁与 inode 已变更的竞态新锁绝不被强制删除', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sa-lock-legacy-'))
    const releaseLegacy = lockSync(dir, { stale: 30_000, onCompromised: () => {} })
    try {
      // 1) 无 .lock-owner.json 的旧版活锁：必须拒绝并给出等待提示，不得强删
      expect(() => acquireStateLock(dir, { staleMs: 30_000, onCompromised: () => {} })).toThrow(/without owner PID metadata/)
      expect(existsSync(`${dir}.lock`)).toBe(true)

      // 2) 竞态保护：若 .lock-owner.json 记录的是旧死 PID 的旧 inode，与当前 .lock 目录真实 inode 不匹配，绝不删除当前新锁
      writeFileSync(join(dir, '.lock-owner.json'), JSON.stringify({
        pid: 999_999_123,
        hostname: hostname(),
        startedAt: new Date().toISOString(),
        lockIno: '18446744073709551000',
        lockBirthtimeMs: 1,
        token: 'stale-race-token',
      }))
      expect(() => acquireStateLock(dir, {
        staleMs: 30_000,
        onCompromised: () => {},
        isAlive: () => 'dead',
      })).toThrow(StateLockError)
      expect(existsSync(`${dir}.lock`)).toBe(true)
      const ownerStill = JSON.parse(readFileSync(join(dir, '.lock-owner.json'), 'utf8'))
      expect(ownerStill.token).toBe('stale-race-token')
    } finally {
      releaseLegacy()
      rmSync(dir, { recursive: true, force: true })
      rmSync(`${dir}.lock`, { recursive: true, force: true })
    }
  })
})
