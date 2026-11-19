import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, posix, relative, resolve, sep, win32, type PlatformPath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NUMBERED = /^(\d{3})-[a-z0-9-]+\.md$/
const numbered = readdirSync(join(ROOT, 'docs')).filter(name => NUMBERED.test(name)).sort()
const entries = ['README.md', 'SETUP.md']
const documents = [...entries, ...readdirSync(join(ROOT, 'docs')).filter(name => name.endsWith('.md')).map(name => `docs/${name}`)]
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')
function links(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(/\]\(([^)\s]+)\)/g)].map(match => match[1]!.split('#')[0]!).filter(target => target && !/^[a-z]+:/.test(target))
}
/**
 * Every file under `directory`, as a repo-relative path with `/` separators.
 *
 * `relative` yields backslashes on Windows while the document writes forward slashes, so the two lists never matched and
 * the table looked empty no matter what it contained. Normalising here is what makes the comparison platform-independent.
 */
const files = (directory: string): string[] => readdirSync(join(ROOT, directory), { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile()).map(entry => relative(ROOT, join(entry.parentPath, entry.name)).split(sep).join('/'))
/**
 * Extract repo-relative file paths from the first column of a table under `## <heading>` in `docs/007-architecture.md`.
 * Bare filenames inherit the directory of the preceding path in the same cell.
 */
function listed(heading: string): string[] {
  const lines = read('docs/007-architecture.md').split('\n')
  const start = lines.indexOf(`## ${heading}`)
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  // The first two rows are the header and its separator.
  const rows = lines.slice(start, end < 0 ? undefined : end).filter(line => line.startsWith('| ')).slice(2)
  return rows.flatMap(row => {
    let directory = ''
    return [...row.split('|')[1]!.matchAll(/`([^`]+)`/g)].map(([, name]) => {
      if (!name!.includes('/')) return posix.join(directory, name!)
      directory = posix.dirname(name!)
      return name!
    })
  })
}

function earlierDocument(linked: string, current: string, docs: string, paths: Pick<PlatformPath, 'basename' | 'dirname'>): boolean {
  const number = NUMBERED.exec(paths.basename(linked))?.[1]
  return paths.dirname(linked) === docs && number !== undefined && number < current.slice(0, 3)
}

describe('documentation', () => {
  it('numbers documents consecutively from 000', () => {
    expect(numbered.map(name => name.slice(0, 3))).toEqual(numbered.map((_, index) => String(index).padStart(3, '0')))
  })
  it('links numbered documents only to earlier numbered documents', () => {
    const violations = numbered.flatMap(name => links(join(ROOT, 'docs', name)).flatMap(target => {
      const linked = resolve(ROOT, 'docs', target)
      if (!linked.endsWith('.md')) return []
      return earlierDocument(linked, name, join(ROOT, 'docs'), { basename, dirname }) ? [] : [`${name} → ${target}`]
    }))
    expect(violations).toEqual([])
  })
  it('checks numbered link ordering for Windows and POSIX paths', () => {
    for (const [paths, docs] of [[win32, 'C:\\repo\\docs'], [posix, '/repo/docs']] as const) {
      const current = '002-authorization.md'
      expect(earlierDocument(paths.join(docs, '001-domain.md'), current, docs, paths)).toBe(true)
      expect(earlierDocument(paths.join(docs, '002-authorization.md'), current, docs, paths)).toBe(false)
      expect(earlierDocument(paths.join(docs, '003-execution.md'), current, docs, paths)).toBe(false)
      expect(earlierDocument(paths.join(docs, 'other.md'), current, docs, paths)).toBe(false)
      expect(earlierDocument(paths.join(docs, 'nested', '001-domain.md'), current, docs, paths)).toBe(false)
    }
  })
  it('resolves every local link', () => {
    const files = [...entries.map(name => join(ROOT, name)), ...numbered.map(name => join(ROOT, 'docs', name))]
    const missing = files.flatMap(file => links(file).filter(target => !existsSync(resolve(dirname(file), target))).map(target => `${file.slice(ROOT.length + 1)} → ${target}`))
    expect(missing).toEqual([])
  })
  it('leaves no merge conflict markers in any document', () => {
    expect(documents.filter(path => /^(<{7}|>{7}) /m.test(read(path)))).toEqual([])
  })
  it('lists every module of src in the module table of 007 Architecture, and only files that exist', () => {
    const modules = listed('Modules')
    expect(files('src').filter(path => !modules.includes(path))).toEqual([])
    expect(modules.filter(path => !existsSync(join(ROOT, path)))).toEqual([])
  })
  it('lists every test in the test table of 007 Architecture, and only files that exist', () => {
    const tests = listed('Tests')
    expect(files('tests').filter(path => /\.spec\.tsx?$/.test(path) && !tests.includes(path))).toEqual([])
    expect(tests.filter(path => !existsSync(join(ROOT, path)))).toEqual([])
  })
})
