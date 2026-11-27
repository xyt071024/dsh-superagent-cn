/** PID-aware, live-instance-safe state directory locking on top of `proper-lockfile`. */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { hostname as osHostname } from 'node:os'
import { join } from 'node:path'
import { lockSync } from 'proper-lockfile'

/** Persistent metadata describing the process that currently holds a state directory lock. */
export interface StateLockOwner {
  pid: number
  hostname: string
  startedAt: string
  lockIno: string
  lockBirthtimeMs: number
  token: string
}

/** Handle returned after acquiring the exclusive lock for a state directory. */
export interface StateLockHandle {
  readonly owner: StateLockOwner
  readonly reclaimedFromPid?: number | undefined
  release(): void
}

/** Options controlling lock staleness, compromise handling, diagnostics, and testable liveness probes. */
export interface StateLockOptions {
  staleMs?: number | undefined
  onCompromised: (error: Error) => void
  log?: ((message: string) => void) | undefined
  isAlive?: ((pid: number) => 'alive' | 'dead' | 'unknown') | undefined
  hostname?: string | undefined
  pid?: number | undefined
}

/**
 * Raised when a state directory lock is already held by a live process or an unverified legacy lock.
 * Carries `code = 'ELOCKED'` and optional owner metadata so operators can identify the holding process
 * without ever deleting a live instance's lock.
 */
export class StateLockError extends Error {
  readonly code = 'ELOCKED'
  readonly stateDir: string
  readonly owner?: StateLockOwner | undefined
  readonly ownerAlive?: boolean | undefined

  constructor(message: string, details: { stateDir: string; owner?: StateLockOwner | undefined; ownerAlive?: boolean | undefined }) {
    super(message)
    this.name = 'StateLockError'
    this.stateDir = details.stateDir
    this.owner = details.owner
    this.ownerAlive = details.ownerAlive
  }
}

const OWNER_FILENAME = '.lock-owner.json'
const RECLAIM_STALE_MS = 5_000

/** Probes OS process liveness via signal 0 without signalling or modifying the target process. */
export function isProcessAlive(pid: number): 'alive' | 'dead' | 'unknown' {
  if (!Number.isInteger(pid) || pid <= 0) return 'unknown'
  if (pid === process.pid) return 'alive'
  try {
    process.kill(pid, 0)
    return 'alive'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'EPERM') return 'alive'
    if (code === 'ESRCH') return 'dead'
    return 'unknown'
  }
}

function readOwnerFile(ownerPath: string): StateLockOwner | undefined {
  try {
    const parsed = JSON.parse(readFileSync(ownerPath, 'utf8')) as Partial<StateLockOwner>
    if (
      typeof parsed.pid === 'number' && Number.isInteger(parsed.pid) && parsed.pid > 0
      && typeof parsed.hostname === 'string' && parsed.hostname.length > 0
      && typeof parsed.startedAt === 'string'
      && typeof parsed.lockIno === 'string'
      && typeof parsed.lockBirthtimeMs === 'number'
      && typeof parsed.token === 'string' && parsed.token.length > 0
    ) {
      return parsed as StateLockOwner
    }
  } catch {
    // Missing or unreadable metadata is treated conservatively as unknown/legacy.
  }
  return undefined
}

function sameLockIdentity(lockStat: { ino: bigint; birthtimeMs: bigint | number }, owner: StateLockOwner): boolean {
  const currentIno = String(lockStat.ino)
  if (owner.lockIno !== '0' && currentIno !== '0') {
    return currentIno === owner.lockIno
  }
  return Math.abs(Number(lockStat.birthtimeMs) - owner.lockBirthtimeMs) < 50
}

function tryAcquireReclaimMutex(reclaimDir: string): boolean {
  try {
    mkdirSync(reclaimDir)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') return false
    try {
      const st = statSync(reclaimDir)
      if (Date.now() - st.mtimeMs > RECLAIM_STALE_MS) {
        rmSync(reclaimDir, { recursive: true, force: true })
        mkdirSync(reclaimDir)
        return true
      }
    } catch {
      return false
    }
    return false
  }
}

/**
 * Acquires the exclusive lock for `stateDir` and records PID/inode owner metadata beside it.
 *
 * - Live owner on the same host (including the current process): never removes the lock; throws
 *   `StateLockError` (`code: 'ELOCKED'`, message includes `already being held` and the live PID).
 * - Provably terminated owner on the same host (e.g. Windows hard kill / crash leaving `${stateDir}.lock`
 *   within the 30s `proper-lockfile` stale window): verifies lock directory identity under an atomic
 *   reclaim mutex, removes the orphaned empty lock directory, and acquires cleanly right away.
 * - Legacy lock without owner metadata: never force-deletes; reports clear wait guidance until stale expiry.
 */
export function acquireStateLock(stateDir: string, options: StateLockOptions): StateLockHandle {
  const staleMs = options.staleMs ?? 30_000
  const host = options.hostname ?? osHostname()
  const selfPid = options.pid ?? process.pid
  const checkAlive = options.isAlive ?? isProcessAlive

  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const canonicalDir = realpathSync(stateDir)
  const lockDir = `${canonicalDir}.lock`
  const reclaimDir = `${canonicalDir}.lock.reclaiming`
  const ownerPath = join(canonicalDir, OWNER_FILENAME)

  const acquireOnce = (reclaimedFromPid?: number): StateLockHandle => {
    const rawRelease = lockSync(canonicalDir, {
      stale: staleMs,
      realpath: false,
      onCompromised: options.onCompromised,
    })
    let lockIno = '0'
    let lockBirthtimeMs = Date.now()
    try {
      const st = statSync(lockDir, { bigint: true })
      lockIno = String(st.ino)
      lockBirthtimeMs = Number(st.birthtimeMs)
    } catch {
      // Fall back to timestamp identity if stat fails unexpectedly.
    }
    const owner: StateLockOwner = {
      pid: selfPid,
      hostname: host,
      startedAt: new Date().toISOString(),
      lockIno,
      lockBirthtimeMs,
      token: randomUUID(),
    }
    try {
      writeFileSync(ownerPath, JSON.stringify(owner, null, 2), { encoding: 'utf8', mode: 0o600 })
    } catch {
      // Non-fatal: proper-lockfile itself still guards the directory.
    }
    let released = false
    return {
      owner,
      ...(reclaimedFromPid !== undefined ? { reclaimedFromPid } : {}),
      release() {
        if (released) return
        released = true
        try {
          const current = readOwnerFile(ownerPath)
          if (current?.token === owner.token) {
            rmSync(ownerPath, { force: true })
          }
        } catch {
          // Best-effort metadata cleanup before releasing proper-lockfile.
        }
        rawRelease()
      },
    }
  }

  try {
    return acquireOnce()
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ELOCKED') throw error
  }

  // Lock is currently held; distinguish a live instance from an orphaned lock left by a hard-killed process.
  const owner = readOwnerFile(ownerPath)
  if (!owner) {
    let remainSec = Math.ceil(staleMs / 1000)
    try {
      const st = statSync(lockDir)
      const remainMs = Math.max(1000, staleMs - (Date.now() - st.mtimeMs))
      remainSec = Math.ceil(remainMs / 1000)
    } catch {
      // Lock may have vanished between attempts; retry once below only if gone.
    }
    throw new StateLockError(
      `Lock file is already being held for state directory "${canonicalDir}" without owner PID metadata. `
      + `If another instance is running, stop it or use a different --profile; if an older version was force-terminated, retry after ~${remainSec}s.`,
      { stateDir: canonicalDir },
    )
  }

  if (owner.hostname !== host) {
    throw new StateLockError(
      `Lock file is already being held for state directory "${canonicalDir}" by PID ${owner.pid} on host "${owner.hostname}" (started ${owner.startedAt}). `
      + `Stop that instance first or use a different --profile.`,
      { stateDir: canonicalDir, owner, ownerAlive: true },
    )
  }

  const alive = owner.pid === selfPid ? 'alive' : checkAlive(owner.pid)
  if (alive !== 'dead') {
    throw new StateLockError(
      `Lock file is already being held for state directory "${canonicalDir}" by running process PID ${owner.pid} (started ${owner.startedAt}). `
      + `Stop that running instance first or launch with a different --profile.`,
      { stateDir: canonicalDir, owner, ownerAlive: true },
    )
  }

  // Owner process is confirmed dead on this host (ESRCH). Reclaim only if the lock directory still matches that dead owner.
  if (!tryAcquireReclaimMutex(reclaimDir)) {
    throw new StateLockError(
      `Lock file is already being held for state directory "${canonicalDir}" while another startup is recovering it. Retry in a moment.`,
      { stateDir: canonicalDir, owner, ownerAlive: false },
    )
  }

  let reclaimed = false
  try {
    const freshOwner = readOwnerFile(ownerPath)
    let lockStat: { ino: bigint; birthtimeMs: bigint | number } | undefined
    try {
      lockStat = statSync(lockDir, { bigint: true })
    } catch {
      lockStat = undefined
    }
    if (
      lockStat
      && freshOwner
      && freshOwner.token === owner.token
      && freshOwner.pid === owner.pid
      && freshOwner.hostname === host
      && freshOwner.pid !== selfPid
      && checkAlive(freshOwner.pid) === 'dead'
      && sameLockIdentity(lockStat, freshOwner)
    ) {
      rmSync(ownerPath, { force: true })
      rmdirSync(lockDir)
      reclaimed = true
      options.log?.(
        `reclaimed orphaned state directory lock from terminated PID ${freshOwner.pid} (started ${freshOwner.startedAt}) at ${canonicalDir}`,
      )
    }
  } finally {
    rmSync(reclaimDir, { recursive: true, force: true })
  }

  try {
    return acquireOnce(reclaimed ? owner.pid : undefined)
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ELOCKED') throw error
    const current = readOwnerFile(ownerPath)
    throw new StateLockError(
      current
        ? `Lock file is already being held for state directory "${canonicalDir}" by running process PID ${current.pid} (started ${current.startedAt}). Stop that running instance first or launch with a different --profile.`
        : `Lock file is already being held for state directory "${canonicalDir}". Stop the running instance first or launch with a different --profile.`,
      { stateDir: canonicalDir, owner: current, ownerAlive: true },
    )
  }
}
