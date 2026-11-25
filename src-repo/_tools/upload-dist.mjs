/**
 * 把 D:\sa-build2\dist 里的成品上传到 GitHub。
 *
 * 两条通道，按文件大小分：
 *  - Releases asset（uploads.github.com）：没有 100 MB 单文件限制，内置包 655 MB 压缩后约 200 MB，只能走这条。
 *  - Contents API（api.github.com）：Pages 站点里的下载文件，单文件上限 100 MB，只放纯净版（0.3 MB）。
 *
 * 为什么不用 git push：这个仓库的 HTTPS 通道在本机经常连不上（DNS 能解，连接超时），
 * 而 api.github.com 一直是通的。Contents API 逐文件提交是唯一稳定的路。
 *
 * 用法：
 *   node _tools/upload-dist.mjs            全部上传
 *   node _tools/upload-dist.mjs --dry      只列清单不传
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const DIST = 'C:/Users/ASUS/Desktop/Super-Agent-项目完整备份-20261115/_work/dist'
const OWNER = 'xyt071024'
const REPO = 'dsh-superagent-cn'
const TAG = process.argv.includes('--tag') ? process.argv[process.argv.indexOf('--tag') + 1] : 'v0.3.17'
/**
 * The token lives outside %TEMP%: Windows disk cleanup removes that directory, and a token that disappears takes
 * the whole release pipeline with it. `GH_TOKEN` wins, then the two known files, and a miss says which paths it tried.
 */
function readToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim()
  const candidates = ['D:/DeepSeekHarness/.secrets/gh_tok.txt', process.env.TEMP + '/gh_tok.txt']
  for (const path of candidates) {
    try { const value = fs.readFileSync(path, 'utf8').trim(); if (value) return value } catch { /* try the next one */ }
  }
  throw new Error(`no GitHub token: set GH_TOKEN or put one at ${candidates.join(' or ')}`)
}
const TOKEN = readToken()
const DRY = process.argv.includes('--dry')
/** `--notes <path>` publishes a Release body; `--tag vX.Y.Z` overrides the target tag. */
const argOf = flag => { const at = process.argv.indexOf(flag); return at >= 0 ? process.argv[at + 1] : undefined }
const NOTES = argOf('--notes')
const TAG_ARG = argOf('--tag')

const api = async (url, options = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'upload-dist',
      ...(options.headers || {}),
    },
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: res.status, json }
}

/** 找到（或建出）目标 Release，返回它的 id 与已有 asset 的信息。 */
async function release() {
  const got = await api(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`)
  if (got.status === 200) {
    return {
      id: got.json.id,
      assets: new Map((got.json.assets ?? []).map(a => [a.name, { id: a.id, size: a.size, state: a.state, digest: a.digest }])),
    }
  }
  if (got.status !== 404) throw new Error(`release lookup failed: ${got.status} ${JSON.stringify(got.json).slice(0, 200)}`)
  const made = await api(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: TAG, name: `Super Agent ${TAG}`, draft: false, prerelease: false }),
  })
  if (made.status !== 201) throw new Error(`release create failed: ${made.status} ${JSON.stringify(made.json).slice(0, 300)}`)
  return { id: made.json.id, assets: new Map() }
}

const FORCE = process.argv.includes('--force')

/**
 * 上传一个 asset。若远端已存在同名且 sha256/大小完全一致的 uploaded asset（且未传 --force），直接跳过避免重复传 200MB；
 * 否则先删掉旧/半截 asset 再上传，并带 3 次自动重试应对瞬时网络抖动。
 */
async function uploadAsset(releaseId, existing, file) {
  const name = path.basename(file)
  const body = fs.readFileSync(file)
  const size = body.length
  const sha256 = crypto.createHash('sha256').update(body).digest('hex')
  const prev = existing.get(name)
  if (prev && !FORCE && prev.state === 'uploaded' && prev.size === size && prev.digest === `sha256:${sha256}`) {
    console.log(`  ✓ ${name}  ${(size / 1048576).toFixed(1)} MB  (already uploaded, sha256 matches)`)
    return true
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const curRel = attempt === 1 ? { assets: existing } : await release()
      const curPrev = curRel.assets.get(name)
      if (curPrev) {
        if (DRY) { console.log(`  would replace ${name}`); return true }
        const del = await api(`https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${curPrev.id}`, { method: 'DELETE' })
        if (del.status !== 204 && del.status !== 404) throw new Error(`delete ${name} failed: ${del.status}`)
      }
      if (DRY) { console.log(`  would upload ${name} (${(size / 1048576).toFixed(1)} MB)`); return true }

      const began = Date.now()
      const res = await fetch(
        `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/zip',
            'Content-Length': String(body.length),
            'User-Agent': 'upload-dist',
          },
          body,
        },
      )
      const text = await res.text()
      if (res.status !== 201) throw new Error(`upload ${name} failed: ${res.status} ${text.slice(0, 300)}`)
      const json = JSON.parse(text)
      const seconds = ((Date.now() - began) / 1000).toFixed(0)
      console.log(`  ✓ ${name}  ${(json.size / 1048576).toFixed(1)} MB  ${seconds}s`)
      return true
    } catch (err) {
      if (attempt === 3) throw err
      console.warn(`  ! ${name} attempt ${attempt} failed (${err.message}), retrying in 4s...`)
      await new Promise(resolve => setTimeout(resolve, 4000))
    }
  }
}

// ---- 主流程 ----
const files = fs.readdirSync(DIST).filter(name => /\.(zip|tgz)$/.test(name)).sort()
if (!files.length) throw new Error(`no packages in ${DIST}; run make-dist.mjs and make-dist-zips.mjs first`)

console.log(`${files.length} 个包：`)
for (const name of files) console.log(`  ${(fs.statSync(path.join(DIST, name)).size / 1048576).toFixed(1)} MB  ${name}`)

const rel = await release()
console.log(`\nRelease ${TAG} (id ${rel.id})，已有 ${rel.assets.size} 个 asset`)

// 先小后大：小包秒完，大包慢慢传；中途失败时已经上去的不会白费。
const ordered = files.sort((a, b) => fs.statSync(path.join(DIST, a)).size - fs.statSync(path.join(DIST, b)).size)
const failed = []
for (const name of ordered) {
  try {
    await uploadAsset(rel.id, rel.assets, path.join(DIST, name))
  } catch (error) {
    console.error(`  ✗ ${name}: ${error.message}`)
    failed.push(name)
  }
  await new Promise(resolve => setTimeout(resolve, 800))
}

console.log(`\n${ordered.length - failed.length} 上传成功${failed.length ? `，${failed.length} 失败：${failed.join(', ')}` : ''}`)
if (failed.length) process.exit(1)

// ---- Release 说明 ----
// A release body is part of the deliverable, not an afterthought: the page a person lands on has to say what changed.
if (NOTES && !DRY) {
  const body = fs.readFileSync(NOTES, 'utf8')
  const patched = await api(`https://api.github.com/repos/${OWNER}/${REPO}/releases/${rel.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Super Agent ${TAG}`, body }),
  })
  if (patched.status !== 200) throw new Error(`release notes failed: ${patched.status} ${JSON.stringify(patched.json).slice(0, 300)}`)
  console.log(`  notes 已更新（${body.length} 字符）`)
}
