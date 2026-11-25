/**
 * 把本地 v0.3.10 源码整棵同步进仓库的 src-repo/。
 *
 * 为什么不用逐个 Contents API：266 个文件 = 266 次 PUT，慢且中途失败会留下半棵树。Git Trees API 一次建树、
 * 一次提交，要么全成要么全不成。
 *
 * 用法：node _tools/sync-src.mjs --dry | node _tools/sync-src.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const OWNER = 'xyt071024', REPO = 'dsh-superagent-cn', PREFIX = 'src-repo'
const ROOT = 'C:/Users/ASUS/Desktop/Super-Agent-项目完整备份-20261115'
const SRC = path.join(ROOT, '02-修改后源码')
const DRY = process.argv.includes('--dry')

function readToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim()
  for (const p of ['D:/DeepSeekHarness/.secrets/gh_tok.txt', process.env.TEMP + '/gh_tok.txt']) {
    try { const v = fs.readFileSync(p, 'utf8').trim(); if (v) return v } catch { /* next */ }
  }
  throw new Error('no GitHub token: set GH_TOKEN or put one at D:/DeepSeekHarness/.secrets/gh_tok.txt')
}
const TOKEN = readToken()
const api = async (url, options = {}) => {
  const res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json',
    'User-Agent': 'sync-src', ...(options.headers || {}) } })
  const text = await res.text()
  let json; try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: res.status, json }
}

// What belongs in the repository: the source tree a stranger needs to build the same plugin, plus the tools that
// turn it into a release. Logs, backups, caches and node_modules stay out.
const DIRS = ['src', 'tests', 'prompts', 'skills', 'locale', 'docs', 'examples', 'scripts']
const FILES = ['package.json', 'tsdown.config.ts', 'cordis.patch.yml', 'README.md', 'LICENSE', 'tsconfig.json',
  'SETUP.md', 'pnpm-lock.yaml', 'vitest.config.ts', '.gitignore']
const TOOLS = ['build-packages.mjs', 'make-dist.mjs', 'make-dist-zips.mjs', 'install-native.mjs',
  'sync-src.mjs', 'upload-dist.mjs', 'upload-docs.mjs']
const SKIP = /\.(bak|log|pyc)$|__pycache__|node_modules|\.DS_Store|^_t/

function collect() {
  const out = []
  for (const dir of DIRS) {
    const root = path.join(SRC, dir)
    if (!fs.existsSync(root)) continue
    const walk = base => {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        const full = path.join(base, entry.name)
        if (SKIP.test(entry.name)) continue
        if (entry.isDirectory()) { walk(full); continue }
        out.push({ repo: `${PREFIX}/${path.relative(SRC, full).split(path.sep).join('/')}`, local: full })
      }
    }
    walk(root)
  }
  for (const name of FILES) {
    const full = path.join(SRC, name)
    if (fs.existsSync(full)) out.push({ repo: `${PREFIX}/${name}`, local: full })
  }
  // 构建脚本在 _build/，发布脚本在 _tools/；两处都找，避免同名脚本只同步一半。
  for (const name of TOOLS) {
    const full = [path.join(ROOT, '_build', name), path.join(ROOT, '_tools', name)].find(p => fs.existsSync(p))
    if (full) out.push({ repo: `${PREFIX}/_tools/${name}`, local: full })
  }
  return out
}

const files = collect()
const skipped = files.filter(f => fs.statSync(f.local).size > 40 * 1024 * 1024)
if (skipped.length) throw new Error(`too large for the tree API: ${skipped.map(f => f.repo).join(', ')}`)
console.log(`${files.length} files to sync into ${PREFIX}/`)
if (DRY) { for (const f of files.slice(0, 5)) console.log(`  ${f.repo}`); console.log('  …'); process.exit(0) }

const head = await api(`https://api.github.com/repos/${OWNER}/${REPO}/git/ref/heads/main`)
if (head.status !== 200) throw new Error(`cannot read main: ${head.status}`)
const baseSha = head.json.object.sha, baseTree = head.json.object.sha

// Upload blobs in parallel batches; each blob is content-addressed, so a retry cannot corrupt anything.
const tree = []
let done = 0
for (let i = 0; i < files.length; i += 12) {
  const batch = files.slice(i, i + 12)
  const results = await Promise.all(batch.map(async file => {
    const content = fs.readFileSync(file.local)
    const blob = await api(`https://api.github.com/repos/${OWNER}/${REPO}/git/blobs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
    })
    if (blob.status !== 201) throw new Error(`blob ${file.repo} failed: ${blob.status} ${JSON.stringify(blob.json).slice(0, 200)}`)
    // 100755 for what must be executable (the service script, shell entrypoints), 100644 otherwise.
    const executable = /(^|\/)scripts\/dsh-superagent$|\.sh$/.test(file.repo)
    return { path: file.repo, mode: executable ? '100755' : '100644', type: 'blob', sha: blob.json.sha }
  }))
  tree.push(...results)
  done += batch.length
  process.stdout.write(`\r  uploaded ${done}/${files.length} blobs`)
}
console.log()

const made = await api(`https://api.github.com/repos/${OWNER}/${REPO}/git/trees`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ base_tree: baseTree, tree }),
})
if (made.status !== 201) throw new Error(`tree failed: ${made.status} ${JSON.stringify(made.json).slice(0, 300)}`)

const version = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8')).version
const commit = await api(`https://api.github.com/repos/${OWNER}/${REPO}/git/commits`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: `src: sync the v${version} source tree\n\nsrc-repo was still 0.2.0, so the published plugin could not be rebuilt or audited from the repository. This brings src, tests (including tests/relay.spec.ts), prompts, skills, locale, docs, scripts and _tools in line with the released package.`, tree: made.json.sha, parents: [baseSha] }),
})
if (commit.status !== 201) throw new Error(`commit failed: ${commit.status} ${JSON.stringify(commit.json).slice(0, 300)}`)

const moved = await api(`https://api.github.com/repos/${OWNER}/${REPO}/git/refs/heads/main`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sha: commit.json.sha, force: false }),
})
if (moved.status !== 200) throw new Error(`ref update failed: ${moved.status} ${JSON.stringify(moved.json).slice(0, 300)}`)
console.log(`\nsrc-repo synced to v${version}: ${commit.json.sha.slice(0, 8)} (${files.length} files)`)
