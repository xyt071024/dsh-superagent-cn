/**
 * 安全可控的 GitHub Release 资产上传脚本（支持草稿、预发布、非覆盖保护与版本强校验）。
 *
 * 用法：
 *   node _tools/upload-dist.mjs --tag v0.4.0-rc.1 --prerelease --dist _work/dist-v0.4.0-rc.1 --notes _release-body-040rc1.md
 *   node _tools/upload-dist.mjs --tag v0.4.0 --draft --dist _work/dist-v0.4.0 --notes _release-body-040.md
 *   node _tools/upload-dist.mjs --dry ...
 *
 * 安全护栏：
 *   1. 默认版本从 `02-修改后源码/package.json` 动态读取（禁止硬编码旧版号）；
 *   2. 含 `-` 的预发布标签（如 `-rc.1` / `-beta.1`）必须显式传入 `--prerelease` 或 `--draft`，否则直接拒绝执行，绝不误覆盖 `latest`；
 *   3. 校验待上传目录中所有 `.zip` / `.tgz` 文件名必须携带与目标标签一致的版本号；
 *   4. 若远端同名资产已存在且 SHA-256 / 大小不一致，默认拒绝静默替换，仅在显式传入 `--replace`（或 `--force`）时允许覆盖。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OWNER = process.env.SA_GH_OWNER || 'xyt071024'
const REPO = process.env.SA_GH_REPO || 'dsh-superagent-cn'

const argOf = flag => {
  const at = process.argv.indexOf(flag)
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1] : undefined
}
const hasFlag = flag => process.argv.includes(flag)

function defaultVersionFromSource() {
  const pkgPath = path.join(ROOT, '02-修改后源码', 'package.json')
  if (fs.existsSync(pkgPath)) {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version
  }
  const fallbackPkg = path.join(ROOT, 'package.json')
  if (fs.existsSync(fallbackPkg)) {
    return JSON.parse(fs.readFileSync(fallbackPkg, 'utf8')).version
  }
  throw new Error('Cannot determine default version: pass --tag vX.Y.Z explicitly')
}

const TAG = argOf('--tag') || `v${defaultVersionFromSource()}`
const EXPECTED_VERSION = TAG.startsWith('v') ? TAG.slice(1) : TAG
const IS_PRERELEASE_TAG = EXPECTED_VERSION.includes('-')
const DIST = path.resolve(ROOT, argOf('--dist') || '_work/dist')
const NOTES = argOf('--notes')
const TARGET_COMMITISH = argOf('--target')
const DRAFT = hasFlag('--draft')
const PRERELEASE = hasFlag('--prerelease')
const DRY = hasFlag('--dry')
const REPLACE = hasFlag('--replace') || hasFlag('--force')
const PUBLISH = hasFlag('--publish')

if (IS_PRERELEASE_TAG && !PRERELEASE && !DRAFT) {
  console.error(`REFUSED: Prerelease tag "${TAG}" must be uploaded with --prerelease or --draft (never as a normal latest Release).`)
  process.exit(1)
}

function readToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim()
  const candidates = ['D:/DeepSeekHarness/.secrets/gh_tok.txt', path.join(process.env.TEMP || '', 'gh_tok.txt')]
  for (const candidate of candidates) {
    try {
      const value = fs.readFileSync(candidate, 'utf8').trim()
      if (value) return value
    } catch { /* try next */ }
  }
  throw new Error(`no GitHub token: set GH_TOKEN or put one at ${candidates.join(' or ')}`)
}
const TOKEN = DRY ? '' : readToken()

const api = async (url, options = {}) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
          Accept: 'application/vnd.github+json',
          'User-Agent': 'superagent-upload-dist',
          ...(options.headers || {}),
        },
      })
      const text = await res.text()
      let json
      try { json = JSON.parse(text) } catch { json = { raw: text } }
      return { status: res.status, json }
    } catch (err) {
      if (attempt === 3) throw err
      console.warn(`  ! API request attempt ${attempt} failed (${err?.message || err}), retrying in 3s...`)
      await new Promise(resolve => setTimeout(resolve, 3000))
    }
  }
}

/** 查找已有 Release（含 draft），不存在时按显式 draft/prerelease/target_commitish 参数创建。 */
async function findOrCreateRelease() {
  // List releases includes drafts (GET /releases/tags/:tag does NOT find draft releases)
  const listed = await api(`https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=50`)
  if (listed.status !== 200) {
    throw new Error(`release list failed: ${listed.status} ${JSON.stringify(listed.json).slice(0, 200)}`)
  }
  const existing = (listed.json ?? []).find(r => r.tag_name === TAG)
  if (existing) {
    if (IS_PRERELEASE_TAG && !existing.prerelease && !existing.draft) {
      throw new Error(`REFUSED: Existing release for prerelease tag "${TAG}" is marked non-prerelease/non-draft (id=${existing.id}).`)
    }
    return {
      id: existing.id,
      draft: Boolean(existing.draft),
      prerelease: Boolean(existing.prerelease),
      assets: new Map((existing.assets ?? []).map(a => [a.name, { id: a.id, size: a.size, state: a.state, digest: a.digest }])),
    }
  }
  if (DRY) {
    return { id: '<dry-run>', draft: DRAFT, prerelease: PRERELEASE, assets: new Map() }
  }
  const payload = {
    tag_name: TAG,
    name: `Super Agent ${TAG}`,
    draft: DRAFT,
    prerelease: PRERELEASE,
    ...(TARGET_COMMITISH ? { target_commitish: TARGET_COMMITISH } : {}),
  }
  const made = await api(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (made.status !== 201) throw new Error(`release create failed: ${made.status} ${JSON.stringify(made.json).slice(0, 300)}`)
  return { id: made.json.id, draft: Boolean(made.json.draft), prerelease: Boolean(made.json.prerelease), assets: new Map() }
}

async function uploadAsset(releaseId, existing, file) {
  const name = path.basename(file)
  const body = fs.readFileSync(file)
  const size = body.length
  const sha256 = crypto.createHash('sha256').update(body).digest('hex')
  const prev = existing.get(name)

  if (prev && prev.state === 'uploaded' && prev.size === size && prev.digest === `sha256:${sha256}`) {
    console.log(`  ✓ ${name}  ${(size / 1048576).toFixed(1)} MB  (already uploaded, sha256 matches)`)
    return true
  }
  if (prev && prev.state === 'uploaded' && !REPLACE) {
    throw new Error(`asset "${name}" already exists on ${TAG} with different digest/size (remote=${prev.digest || prev.size}, local=sha256:${sha256}); pass --replace to overwrite explicitly`)
  }
  if (DRY) {
    console.log(`  [dry] would ${prev ? 'replace' : 'upload'} ${name} (${(size / 1048576).toFixed(1)} MB, sha256:${sha256})`)
    return true
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const curRel = attempt === 1 ? { assets: existing } : await findOrCreateRelease()
      const curPrev = curRel.assets.get(name)
      if (curPrev) {
        const del = await api(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${curPrev.id}`, { method: 'DELETE' })
        if (del.status !== 204 && del.status !== 404) throw new Error(`delete ${name} failed: ${del.status}`)
      }
      const began = Date.now()
      const res = await fetch(
        `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': name.endsWith('.tgz') ? 'application/gzip' : 'application/zip',
            'Content-Length': String(body.length),
            'User-Agent': 'superagent-upload-dist',
          },
          body,
        },
      )
      const text = await res.text()
      if (res.status !== 201) throw new Error(`upload ${name} failed: ${res.status} ${text.slice(0, 300)}`)
      const json = JSON.parse(text)
      const seconds = ((Date.now() - began) / 1000).toFixed(0)
      console.log(`  ✓ ${name}  ${(json.size / 1048576).toFixed(1)} MB  ${seconds}s  sha256:${sha256.slice(0, 12)}`)
      return true
    } catch (err) {
      if (attempt === 3) throw err
      console.warn(`  ! ${name} attempt ${attempt} failed (${err.message}), retrying in 4s...`)
      await new Promise(resolve => setTimeout(resolve, 4000))
    }
  }
}

// ---- 主流程 ----
if (!fs.existsSync(DIST)) {
  throw new Error(`dist directory not found: ${DIST}`)
}
const files = fs.readdirSync(DIST).filter(name => /\.(zip|tgz)$/.test(name)).sort()
if (!files.length) throw new Error(`no packages in ${DIST}; run make-dist.mjs and make-dist-zips.mjs first`)

const mismatched = files.filter(name => !name.includes(`v${EXPECTED_VERSION}.`))
if (mismatched.length) {
  throw new Error(`REFUSED: dist directory ${DIST} contains assets not matching tag "${TAG}": ${mismatched.join(', ')}`)
}

console.log(`Target: ${OWNER}/${REPO}  tag=${TAG}  draft=${DRAFT}  prerelease=${PRERELEASE}${TARGET_COMMITISH ? `  target=${TARGET_COMMITISH}` : ''}  replace=${REPLACE}${DRY ? '  [DRY RUN]' : ''}`)
console.log(`Dist:   ${DIST} (${files.length} files)`)
for (const name of files) {
  const full = path.join(DIST, name)
  const stat = fs.statSync(full)
  const sha = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
  console.log(`  ${(stat.size / 1048576).toFixed(1).padStart(5)} MB  ${sha}  ${name}`)
}

const rel = DRY ? { id: '<dry-run>', draft: DRAFT, prerelease: PRERELEASE, assets: new Map() } : await findOrCreateRelease()
console.log(`\nRelease ${TAG} (id ${rel.id}, draft=${rel.draft}, prerelease=${rel.prerelease})，已有 ${rel.assets.size} 个 asset`)

const ordered = [...files].sort((a, b) => fs.statSync(path.join(DIST, a)).size - fs.statSync(path.join(DIST, b)).size)
const failed = []
for (const name of ordered) {
  try {
    await uploadAsset(rel.id, rel.assets, path.join(DIST, name))
  } catch (error) {
    console.error(`  ✗ ${name}: ${error.message}`)
    failed.push(name)
  }
  if (!DRY) await new Promise(resolve => setTimeout(resolve, 800))
}

console.log(`\n${ordered.length - failed.length} 上传成功${failed.length ? `，${failed.length} 失败：${failed.join(', ')}` : ''}`)
if (failed.length) process.exit(1)

if ((NOTES || PUBLISH) && !DRY) {
  const patchPayload = {
    name: `Super Agent ${TAG}`,
    prerelease: PRERELEASE || rel.prerelease,
    ...(NOTES ? { body: fs.readFileSync(NOTES, 'utf8') } : {}),
    ...(PUBLISH ? { draft: false } : {}),
  }
  const patched = await api(`https://api.github.com/repos/${OWNER}/${REPO}/releases/${rel.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patchPayload),
  })
  if (patched.status !== 200) throw new Error(`release notes/state patch failed: ${patched.status} ${JSON.stringify(patched.json).slice(0, 300)}`)
  console.log(`  release metadata updated (draft=${patched.json.draft}, prerelease=${patched.json.prerelease}${NOTES ? `, notes=${patchPayload.body.length} chars` : ''})`)
}
