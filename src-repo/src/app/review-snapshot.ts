/** Fingerprint a Git worktree for an independent review. This does not execute user hooks. */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstat, readFile, readlink } from 'node:fs/promises'
import { promisify } from 'node:util'
import { isAbsolute, relative, resolve, sep } from 'node:path'

const run = promisify(execFile)
const maxBytes = 256 * 1024 * 1024

/** Includes the index, all tracked files and non-ignored untracked files, including deletions and symlink targets. */
export async function reviewSnapshot(directory: string): Promise<string> {
  const cwd = resolve(directory)
  const git = async (...args: string[]) => (await run('git', ['-C', cwd, ...args], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } })).stdout
  const root = (await git('rev-parse', '--show-toplevel')).toString('utf8').trim()
  if (resolve(root) !== cwd) throw new Error('Review requires the root of a Git worktree')
  const hash = createHash('sha256')
  const add = (data: Buffer) => { hash.update(`${data.length}:`); hash.update(data) }
  const head = await git('rev-parse', '--verify', 'HEAD')
  const index = await git('ls-files', '--stage', '-z')
  add(head); add(index)
  const listing = await git('ls-files', '-z', '--cached', '--others', '--exclude-standard')
  const names = listing.toString('utf8').split('\0').filter(Boolean).sort()
  let total = 0
  for (const name of new Set(names)) {
    const path = resolve(cwd, name), inside = relative(cwd, path)
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error('Unsafe Git worktree path')
    add(Buffer.from(name))
    let before
    try { before = await lstat(path) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { add(Buffer.from('deleted')); continue }
      throw error
    }
    if (before.isSymbolicLink()) { add(Buffer.from('symlink')); add(Buffer.from(await readlink(path))); continue }
    if (!before.isFile()) throw new Error('Cannot review a non-file worktree entry')
    total += before.size
    if (total > maxBytes) throw new Error('Worktree is too large for an independent review snapshot')
    add(Buffer.from(`file:${before.mode}`)); add(await readFile(path))
    const after = await lstat(path)
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error('Worktree changed during review snapshot')
  }
  if (!(await git('rev-parse', '--verify', 'HEAD')).equals(head) || !(await git('ls-files', '--stage', '-z')).equals(index)
    || !(await git('ls-files', '-z', '--cached', '--others', '--exclude-standard')).equals(listing))
    throw new Error('Git state changed during review snapshot')
  return hash.digest('hex')
}
