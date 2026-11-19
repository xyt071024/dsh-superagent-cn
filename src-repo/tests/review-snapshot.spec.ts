import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { reviewSnapshot } from '../src/app/review-snapshot.ts'

describe('Git review snapshot', () => {
  it('detects tracked, staged, untracked and deleted changes, and refuses non-repositories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'review-snapshot-'))
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' }, stdio: 'pipe' })
    try {
      git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid')
      writeFileSync(join(root, 'tracked.txt'), 'one'); git('add', 'tracked.txt'); git('commit', '-qm', 'initial')
      const initial = await reviewSnapshot(root)
      expect(await reviewSnapshot(root)).toBe(initial)
      writeFileSync(join(root, 'tracked.txt'), 'two')
      const modified = await reviewSnapshot(root); expect(modified).not.toBe(initial)
      git('add', 'tracked.txt')
      const staged = await reviewSnapshot(root); expect(staged).not.toBe(modified)
      writeFileSync(join(root, 'new.txt'), 'new')
      const untracked = await reviewSnapshot(root); expect(untracked).not.toBe(staged)
      rmSync(join(root, 'tracked.txt'))
      expect(await reviewSnapshot(root)).not.toBe(untracked)
      mkdirSync(join(root, 'subdir'))
      await expect(reviewSnapshot(join(root, 'subdir'))).rejects.toThrow('root of a Git worktree')
      const empty = mkdtempSync(join(tmpdir(), 'review-not-git-'))
      try { await expect(reviewSnapshot(empty)).rejects.toThrow() } finally { rmSync(empty, { recursive: true, force: true }) }
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 20_000)
})
