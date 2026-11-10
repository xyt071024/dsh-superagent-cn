/**
 * Build static HTML pages from Markdown docs, one language at a time.
 * Each doc gets its own page with a language switcher that stays on the same doc.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..').replace(/^[/\\]/, '') === ''
  ? process.cwd()
  : process.cwd()

const DOCS = [
  '01-overview', '02-flow', '03-collaboration', '04-settings', '05-sources',
  '06-proxy', '07-evolution', '08-cost', '09-deployment',
]

const LANGS = {
  zh: { label: '中文', dir: 'zh', html: '../index.html', home: '返回首页', prev: '上一篇', next: '下一篇' },
  en: { label: 'English', dir: 'en', html: '../en/index.html', home: 'Home', prev: 'Previous', next: 'Next' },
  ja: { label: '日本語', dir: 'ja', html: '../ja/index.html', home: 'ホーム', prev: '前へ', next: '次へ' },
}

const TITLES = {
  zh: ['项目定位与核心概念','完整任务流程','多会话协同机制','设置界面设计','连接源与稳定性','代理方案','自我进化机制','省流与成本控制','部署与工程量'],
  en: ['Positioning and Core Concepts','Complete Task Flow','Multi-Session Collaboration','Settings UI Design','Sources and Stability','Proxy Architecture','Self-Evolution','Cost Control','Deployment'],
  ja: ['位置づけと中核概念','タスクフロー全体','マルチセッション協調','設定 UI 設計','ソースと安定性','プロキシ設計','自己進化','コスト管理','デプロイ'],
}

/** Minimal, dependency-free Markdown to HTML for the subset these docs use. */
function mdToHtml(md) {
  const lines = md.split(/\r?\n/)
  const out = []
  let i = 0
  let inCode = false
  let codeBuf = []
  let codeLang = ''
  let listType = null
  let tableBuf = []

  const inline = (s) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, h) => {
      // Docs live beside each other as .html; README becomes the site index.
      let href = h.replace(/\.md(#.*)?$/, '.html$1')
      if (/(^|\/)README\.html/.test(href)) href = '../../index.html'
      return `<a href="${href}">${t}</a>`
    })

  const flushList = () => { if (listType) { out.push(`</${listType}>`); listType = null } }
  const flushTable = () => {
    if (!tableBuf.length) return
    const rows = tableBuf.filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r))
    if (!rows.length) { tableBuf = []; return }
    const cells = (r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim())
    const head = cells(rows[0])
    out.push('<table><thead><tr>' + head.map(h => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>')
    for (const r of rows.slice(1)) {
      out.push('<tr>' + cells(r).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>')
    }
    out.push('</tbody></table>')
    tableBuf = []
  }

  while (i < lines.length) {
    const line = lines[i]

    // fenced code
    if (/^```/.test(line)) {
      if (!inCode) { flushList(); flushTable(); inCode = true; codeLang = line.slice(3).trim(); codeBuf = [] }
      else {
        inCode = false
        const esc = codeBuf.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        out.push(`<pre><code${codeLang ? ` class="language-${codeLang}"` : ''}>${esc}</code></pre>`)
      }
      i++; continue
    }
    if (inCode) { codeBuf.push(line); i++; continue }

    // table
    if (/^\s*\|/.test(line)) { flushList(); tableBuf.push(line); i++; continue }
    else if (tableBuf.length) flushTable()

    // blank
    if (!line.trim()) { flushList(); i++; continue }

    // hr
    if (/^---+$/.test(line.trim())) { flushList(); out.push('<hr>'); i++; continue }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      flushList()
      const lv = h[1].length
      out.push(`<h${lv}>${inline(h[2].replace(/\s*\{#.*\}$/, ''))}</h${lv}>`)
      i++; continue
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      flushList()
      const buf = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++ }
      out.push('<blockquote>' + mdToHtml(buf.join('\n')) + '</blockquote>')
      continue
    }

    // lists
    const ul = line.match(/^\s*[-*+]\s+(.*)$/)
    const ol = line.match(/^\s*\d+\.\s+(.*)$/)
    if (ul || ol) {
      const want = ul ? 'ul' : 'ol'
      if (listType !== want) { flushList(); out.push(`<${want}>`); listType = want }
      out.push(`<li>${inline((ul || ol)[1])}</li>`)
      i++; continue
    }
    flushList()

    // paragraph
    out.push(`<p>${inline(line)}</p>`)
    i++
  }
  flushList(); flushTable()
  return out.join('\n')
}

function page(lang, idx, bodyHtml) {
  const L = LANGS[lang]
  const title = TITLES[lang][idx]
  const prev = idx > 0 ? `<a class="prev" href="${DOCS[idx - 1]}.html">← ${L.prev}：${TITLES[lang][idx - 1]}</a>` : ''
  const next = idx < DOCS.length - 1 ? `<a class="next" href="${DOCS[idx + 1]}.html">${L.next}：${TITLES[lang][idx + 1]} →</a>` : ''

  // keep the reader on the same doc when switching language
  const switchLink = (targetLang) => {
    const p = targetLang === 'zh' ? `../zh/${DOCS[idx]}.html`
      : targetLang === 'en' ? `../en/${DOCS[idx]}.html`
      : `../ja/${DOCS[idx]}.html`
    const active = targetLang === lang ? ' class="active"' : ''
    return `<a href="${p}"${active} data-lang="${targetLang}">${LANGS[targetLang].label}</a>`
  }

  return `<!DOCTYPE html>
<html lang="${lang === 'zh' ? 'zh-CN' : lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} · Super Agent</title>
<link rel="stylesheet" href="../../assets/style.css">
</head>
<body>

<header>
  <div class="header-inner">
    <div class="brand">
      <span class="logo">◆</span>
      <span class="brand-name">Super Agent</span>
      <span class="brand-sub">for DeepSeek Harness</span>
    </div>
    <nav class="lang-switch" aria-label="Language">
      ${switchLink('zh')}
      ${switchLink('en')}
      ${switchLink('ja')}
    </nav>
  </div>
</header>

<main class="doc">
${bodyHtml}
<nav class="doc-nav">
${prev}
${next}
</nav>
</main>

<footer>
  <p><a href="${L.html}" style="color:inherit">${L.home}</a> · MIT License</p>
</footer>

</body>
</html>`
}

// build
let built = 0, missing = []
for (const lang of Object.keys(LANGS)) {
  const srcDir = path.join('docs', lang)
  const dstDir = path.join('docs', lang)
  for (let idx = 0; idx < DOCS.length; idx++) {
    const name = DOCS[idx]
    const mdPath = path.join(srcDir, `${name}.md`)
    if (!fs.existsSync(mdPath)) { missing.push(`${lang}/${name}`); continue }
    const md = fs.readFileSync(mdPath, 'utf8')
    // Drop the document's own H1 and the breadcrumb line: the page supplies both.
    const body = md
      .replace(/^\s*#\s+.*(\r?\n)+/, '')
      .replace(/^\s*\[←[^\n]*(\r?\n)+/, '')
      .replace(/^---\s*(\r?\n)+/, '')
    const html = page(lang, idx, `<h1>${TITLES[lang][idx]}</h1>\n` + mdToHtml(body))
    fs.writeFileSync(path.join(dstDir, `${name}.html`), html)
    built++
  }
}

console.log(`built ${built} pages`)
if (missing.length) console.log(`missing (${missing.length}): ` + missing.join(', '))
