/**
 * 把 README 与 Pages 站点推上 GitHub。
 *
 * 为什么不用 git push：这个仓库的 HTTPS 通道在本机经常连不上（DNS 能解，连接超时），而 api.github.com 一直是通的。
 * Contents API 逐文件提交是唯一稳定的路，代价是每个文件要单独带 sha。
 *
 * 用法：
 *   node _tools/upload-docs.mjs --dry
 *   node _tools/upload-docs.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const OWNER = 'xyt071024'
const REPO = 'dsh-superagent-cn'
const ROOT = 'C:/Users/ASUS/Desktop/Super-Agent-项目完整备份-20261115'
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

const api = async (url, options = {}) => {
  const res = await fetch(url, { ...options, headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json',
    'User-Agent': 'upload-docs', ...(options.headers || {}) } })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: res.status, json }
}

/** 上传一个文件到仓库路径；已存在时带 sha 覆盖，不存在时新建。 */
async function put(remote, content, message) {
  const got = await api(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(remote).replace(/%2F/g, '/')}`)
  const sha = got.status === 200 ? got.json.sha : undefined
  if (DRY) { console.log(`  would write ${remote} (${content.length} bytes${sha ? ', replace' : ', new'})`); return }
  const res = await api(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(remote).replace(/%2F/g, '/')}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: Buffer.from(content, 'utf8').toString('base64'), ...sha ? { sha } : {} }),
  })
  if (res.status !== 200 && res.status !== 201) throw new Error(`write ${remote} failed: ${res.status} ${JSON.stringify(res.json).slice(0, 300)}`)
  console.log(`  ✓ ${remote}`)
}

// 中文 README 是仓库门面；英文和日文各自独立成文，不在同一页并排放三种语言。
const PAGES = path.join(ROOT, '_pages-0310')
const files = [
  ['README.md', path.join(ROOT, '_remote', 'README.md'), 'docs: README for v0.3.11'],
  // 英文与日文各自整篇，不在同一页并排三种语言。
  ['README.en.md', path.join(ROOT, '_remote', 'README.en.md'), 'docs: English README for v0.3.11'],
  ['README.ja.md', path.join(ROOT, '_remote', 'README.ja.md'), 'docs: Japanese README for v0.3.11'],
  ['CHANGELOG.md', path.join(ROOT, '_remote', 'CHANGELOG.md'), 'docs: changelog for v0.3.11'],
  // Pages 站点的安装页：三语各一份，下载链接里的版本号随发行版走。
  // 站点根是仓库根：中文首页与安装页在根，英文在 en/，日文在 ja/。
  ['install.html', path.join(PAGES, 'install.html'), 'docs: install page for v0.3.9'],
  ['en/install.html', path.join(PAGES, 'en-install.html'), 'docs: install page for v0.3.9'],
  ['ja/install.html', path.join(PAGES, 'ja-install.html'), 'docs: install page for v0.3.9'],
  ['index.html', path.join(PAGES, 'index.html'), 'docs: landing page for v0.3.9'],
  ['install.md', path.join(PAGES, 'install.md'), 'docs: install guide for v0.3.9'],
]

for (const [remote, local, message] of files) {
  if (!fs.existsSync(local)) throw new Error(`missing ${local}`)
  await put(remote, fs.readFileSync(local, 'utf8'), message)
}

console.log(DRY ? '\ndry run: nothing written' : '\ndocs done')
