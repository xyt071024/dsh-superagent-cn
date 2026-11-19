/**
 * 把 D:\sa-build\_stage 下已经铺好的 10 个包目录压成最终交付的 zip。
 *
 * 为什么不用现成工具（三条都是实测过的）：
 *  1. Compress-Archive / .NET Framework 4.x 的 ZipFile 写不出 zip64。内置包有 72,524 个文件，
 *     超过 zip 经典格式 65,535 的条目上限，必须 zip64。
 *  2. Compress-Archive 还会把条目分隔符写成 `\`。Windows 认，macOS/Linux 的 unzip 不认，
 *     整包会摊平成一个目录 —— 这正是 make-zips.mjs 当初手写 zip 的原因，这里沿用同一套规则。
 *  3. 7zr.exe 只有 7z，不带 zip 编码器；完整 7z 本机没装。
 *
 * 与 make-zips.mjs 的另一个差别：那边把压缩后的字节全攒在内存里再落盘，四个 1.8 MB 的包无所谓；
 * 这里单包 655 MB、七万文件、本机可用内存只有 3 GB，所以走真正的流式 ——
 * 先占位写 local header，再边读边压边写，最后 seek 回去补 CRC 和大小。
 *
 * 用法：
 *   node _tools/make-dist-zips.mjs              全部压
 *   node _tools/make-dist-zips.mjs Windows      只压名字含 Windows 的
 *   node _tools/make-dist-zips.mjs Clean        只压纯净版
 */
import fs from 'node:fs'
import path from 'node:path'
import { deflateRawSync, crc32 } from 'node:zlib'

const STAGE = 'C:/Users/ASUS/Desktop/Super-Agent-项目完整备份-20261115/_work/_stage'
const OUT = 'C:/Users/ASUS/Desktop/Super-Agent-项目完整备份-20261115/_work/dist'
const MANIFEST = path.join(STAGE, 'manifest.json')

const filter = process.argv.slice(2)
const MB = bytes => (bytes / 1048576).toFixed(1)

/** zip 规范要求的 CRC-32（IEEE 802.3，反射）。Node 20+ 的 zlib.crc32 支持接续上一段的值。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()
const crcFallback = (buffer, previous = 0) => {
  let crc = (previous ^ 0xffffffff) >>> 0
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
const CRC = typeof crc32 === 'function' ? (buffer, previous = 0) => crc32(buffer, previous) >>> 0 : crcFallback

/** MS-DOS 日期时间，zip 头里存的就是这个。 */
function dosStamp(ms) {
  const d = new Date(ms)
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    day: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/**
 * The permission a file must carry inside the archive.
 *
 * `stat.mode` on this build machine is a Windows attribute and says nothing about the target: it reports `0o666` for
 * everything, so a Unix package shipped with no execute bit at all and `./start.sh` could not run. The mode is
 * therefore chosen from what the file is for, not copied from what it happens to be here.
 *
 * 0755 — things the user runs or that must be executed: the launchers, the bundled Node runtime and its `bin/`
 *        shims, native `.node` addons, and anything the package's own `bin/` mapping points at.
 * 0644 — everything else: source, documentation, data, configuration.
 */
function entryMode(rel, unix) {
  if (!unix) return 0o644
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  const executable = rel === 'start.sh' || rel === 'stop.sh' || rel === 'dsh'
    || /^node(\.exe)?$/.test(base) && (rel === 'node/bin/node' || rel === 'runtime/node/bin/node')
    || /\/node\/bin\//.test(rel)
    || /\/\.bin\//.test(rel)
    || /\.(sh|command)$/.test(base)
    || /\.node$/.test(base)
  return executable ? 0o755 : 0o644
}

/** 一个包内所有条目的元数据（目录在前，与磁盘遍历顺序一致）。 */
function collect(dir, base = dir, out = [], unix = true) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    const rel = path.relative(base, full).split(path.sep).join('/')
    if (stat.isDirectory()) {
      out.push({ name: `${rel}/`, dir: true, mode: 0o755, mtime: stat.mtimeMs, size: 0 })
      collect(full, base, out, unix)
    } else {
      out.push({ name: rel, dir: false, mode: entryMode(rel, unix), mtime: stat.mtimeMs, file: full, size: stat.size })
    }
  }
  return out
}

/** 30 字节 local file header。crc/大小在流式写完之后回填，所以先按 0 写一份占位。 */
function localHeader({ nameLen, crc, compSize, rawSize, method, time, day }) {
  const buffer = Buffer.alloc(30)
  buffer.writeUInt32LE(0x04034b50, 0)
  buffer.writeUInt16LE(45, 4) // 需要解压的版本 4.5 = 支持 zip64
  buffer.writeUInt16LE(0x0800, 6) // 文件名是 UTF-8
  buffer.writeUInt16LE(method, 8)
  buffer.writeUInt16LE(time, 10)
  buffer.writeUInt16LE(day, 12)
  buffer.writeUInt32LE(crc, 14)
  buffer.writeUInt32LE(compSize, 18)
  buffer.writeUInt32LE(rawSize, 22)
  buffer.writeUInt16LE(nameLen, 26)
  buffer.writeUInt16LE(0, 28) // 无 extra 字段
  return buffer
}

/**
 * 压一个目录。
 *
 * 顺序写、不回头 —— 这是 7 万条目能跑完的关键。
 * 早先的版本先占位写 header、压完再 seek 回去补 CRC 与大小，结果每个条目多两次随机写，
 * 在 Windows 上压一个 655 MB 的包要 21 分钟（七万条目 × 每次重定位）。
 *
 * 现在每个条目先在内存里算完 CRC 与压缩结果（最大单文件 81 MB，压完 32 MB，可接受），
 * 然后把 header + 名字 + 数据拼成一次顺序写。没有 seek，没有回填。
 * 内存峰值 = 单文件原始大小 + 压缩结果，与包多大无关。
 */
function zipDir(source, target, unix = true) {
  const entries = collect(source, source, [], unix)
  const fd = fs.openSync(target, 'w')
  let offset = 0

  const append = buffer => {
    let written = 0
    while (written < buffer.length) {
      written += fs.writeSync(fd, buffer, written, buffer.length - written)
    }
    offset += buffer.length
  }

  const centrals = []

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    const { time, day } = dosStamp(entry.mtime)
    const nameBuf = Buffer.from(entry.name, 'utf8')

    let crcValue = 0
    let rawSize = 0
    let compSize = 0
    let data = Buffer.alloc(0)

    if (!entry.dir && entry.size > 0) {
      const raw = fs.readFileSync(entry.file)
      rawSize = raw.length
      crcValue = CRC(raw, 0)
      data = deflateRawSync(raw, { level: 6 })
      compSize = data.length
    }
    const method = rawSize === 0 ? 0 : 8

    const header = localHeader({ nameLen: nameBuf.length, crc: crcValue, compSize, rawSize, method, time, day })
    const entryStart = offset
    append(header)
    append(nameBuf)
    if (compSize) append(data)

    centrals.push({
      nameBuf,
      method,
      time,
      day,
      crc: crcValue,
      compSize,
      rawSize,
      dir: entry.dir,
      mode: entry.mode,
      offset: entryStart,
    })

    if ((index + 1) % 10000 === 0) {
      process.stdout.write(`\r    已写 ${index + 1}/${entries.length} 条  ${MB(offset)} MB   `)
    }
  }

  // ---- central directory ----
  const centralStart = offset
  for (const c of centrals) {
    // 越过 32 位边界时补 zip64 扩展字段（顺序必须是 原始大小 → 压缩后大小 → 偏移量）。
    const need64 = c.rawSize > 0xfffffffe || c.compSize > 0xfffffffe || c.offset > 0xfffffffe
    let extra = Buffer.alloc(0)
    if (need64) {
      extra = Buffer.alloc(4 + 24)
      extra.writeUInt16LE(0x0001, 0)
      extra.writeUInt16LE(24, 2)
      extra.writeBigUInt64LE(BigInt(c.rawSize), 4)
      extra.writeBigUInt64LE(BigInt(c.compSize), 12)
      extra.writeBigUInt64LE(BigInt(c.offset), 20)
    }

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x032e, 4) // made by Unix（3.0）+ 支持 zip64 的宿主版本
    central.writeUInt16LE(45, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(c.method, 10)
    central.writeUInt16LE(c.time, 12)
    central.writeUInt16LE(c.day, 14)
    central.writeUInt32LE(c.crc, 16)
    // 顺序：压缩后在前（20），原始在后（24）。写反了照样能列出文件，但解压时每个文件都报 CRC 错。
    central.writeUInt32LE(need64 ? 0xffffffff : c.compSize, 20)
    central.writeUInt32LE(need64 ? 0xffffffff : c.rawSize, 24)
    central.writeUInt16LE(c.nameBuf.length, 28)
    central.writeUInt16LE(extra.length, 30)
    central.writeUInt16LE(0, 32) // 注释长度
    central.writeUInt16LE(0, 34) // 起始磁盘
    central.writeUInt16LE(0, 36) // 内部属性
    // A directory entry needs its own permission bits, not just the 0x10 directory flag: `0x10` alone tells unzip the
    // entry is a directory and leaves the Unix mode at zero, so `unzip` creates `d---------` and everything inside it
    // becomes unreadable. `0o040000` is S_IFDIR; 0755 matches the tree `collect` records.
    central.writeUInt32LE(c.dir ? (((0o40755) << 16) | 0x10) >>> 0 : (((c.mode & 0o777) | 0o100000) << 16) >>> 0, 38)
    central.writeUInt32LE(need64 ? 0xffffffff : c.offset, 42)
    append(central)
    append(c.nameBuf)
    if (extra.length) append(extra)
  }
  const centralSize = offset - centralStart

  const count = centrals.length
  // 条目数超过 65,535 就必须走 zip64 收尾：EOCD64 record → locator → 普通 EOCD。
  if (count > 0xffff || centralStart > 0xffffffff || centralSize > 0xffffffff) {
    const eocd64 = Buffer.alloc(56)
    eocd64.writeUInt32LE(0x06064b50, 0)
    eocd64.writeBigUInt64LE(44n, 4) // 本记录剩余长度
    eocd64.writeUInt16LE(45, 12)
    eocd64.writeUInt16LE(45, 14)
    eocd64.writeUInt32LE(0, 16)
    eocd64.writeUInt32LE(0, 20)
    eocd64.writeBigUInt64LE(BigInt(count), 24)
    eocd64.writeBigUInt64LE(BigInt(count), 32)
    eocd64.writeBigUInt64LE(BigInt(centralSize), 40)
    eocd64.writeBigUInt64LE(BigInt(centralStart), 48)
    append(eocd64)

    const locator = Buffer.alloc(20)
    locator.writeUInt32LE(0x07064b50, 0)
    locator.writeUInt32LE(0, 4)
    locator.writeBigUInt64LE(BigInt(centralStart + centralSize), 8)
    locator.writeUInt32LE(1, 16)
    append(locator)
  }

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(Math.min(count, 0xffff), 8)
  end.writeUInt16LE(Math.min(count, 0xffff), 10)
  end.writeUInt32LE(Math.min(centralSize, 0xffffffff), 12)
  end.writeUInt32LE(Math.min(centralStart, 0xffffffff), 16)
  end.writeUInt16LE(0, 20)
  append(end)

  fs.closeSync(fd)
  return { entries: count, bytes: fs.statSync(target).size }
}

/**
 * 开盖自检：用 unzip 看得懂的方式读回来，确认权限没有漏。
 *
 * 只靠 CRC 与大小查不出这类错误：压缩数据完好，解开后却是
 * `d---------`，Node 明明在包里却读不到。
 */
function auditArchive(file, unix) {
  const problems = []
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    // Walk the central directory: it is the only place an entry's external attributes are recorded.
    const tail = Buffer.alloc(Math.min(size, 66_000))
    fs.readSync(fd, tail, 0, tail.length, size - tail.length)
    let eocd = -1
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
    if (eocd < 0) return ['no end-of-central-directory record']
    let count = tail.readUInt16LE(eocd + 10), start = tail.readUInt32LE(eocd + 16)
    if (start === 0xffffffff || count === 0xffff) {
      // zip64: locator sits immediately before the classic EOCD.
      let loc = -1
      for (let i = eocd - 20; i >= 0; i--) if (tail.readUInt32LE(i) === 0x07064b50) { loc = i; break }
      if (loc < 0) return ['zip64 locator missing']
      const recordOffset = Number(tail.readBigUInt64LE(loc + 8))
      const head = Buffer.alloc(56)
      fs.readSync(fd, head, 0, 56, recordOffset)
      count = Number(head.readBigUInt64LE(32))
      start = Number(head.readBigUInt64LE(48))
    }
    const block = Buffer.alloc(Math.max(0, size - start))
    fs.readSync(fd, block, 0, block.length, start)
    let at = 0
    const zeroDirs = [], badExec = []
    for (let index = 0; index < count && at + 46 <= block.length; index++) {
      if (block.readUInt32LE(at) !== 0x02014b50) break
      const madeBy = block.readUInt16LE(at + 4) >> 8
      const nameLen = block.readUInt16LE(at + 28), extraLen = block.readUInt16LE(at + 30), commentLen = block.readUInt16LE(at + 32)
      const external = block.readUInt32LE(at + 38)
      const name = block.slice(at + 46, at + 46 + nameLen).toString('utf8')
      const mode = (external >>> 16) & 0o777
      const isDir = name.endsWith('/')
      if (unix && madeBy === 3) {
        if (isDir && mode === 0) zeroDirs.push(name)
        if (!isDir && /^(start\.sh)$|^node\/bin\/node$/.test(name) && !(mode & 0o111)) badExec.push(`${name} (0o${mode.toString(8)})`)
        if (!isDir && /\.node$/.test(name) && !(mode & 0o111)) badExec.push(`${name} (0o${mode.toString(8)})`)
      }
      at += 46 + nameLen + extraLen + commentLen
    }
    if (zeroDirs.length) problems.push(`${zeroDirs.length} directories have mode 0 (unzip makes them d---------), e.g. ${zeroDirs.slice(0, 3).join(', ')}`)
    if (badExec.length) problems.push(`${badExec.length} entries lack the execute bit, e.g. ${badExec.slice(0, 3).join(', ')}`)
  } finally { fs.closeSync(fd) }
  return problems
}

// ---- 主流程 ----
// The staged directories are the source of truth, not the manifest: a run that was interrupted leaves a manifest listing
// only the bundles it got through, and trusting it silently skips the rest. The manifest is useful for `bytes` (the
// uncompressed size, for the compression-ratio line), so it is merged in by label rather than preferred over the tree.
const onDisk = fs.readdirSync(STAGE, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => ({ label: entry.name, dir: path.join(STAGE, entry.name), bytes: 0 }))
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : []
const known = new Map(manifest.map(job => [job.label, job]))
const jobs = onDisk.map(job => ({ ...job, bytes: known.get(job.label)?.bytes ?? 0 }))
const selected = jobs.filter(j => !filter.length || filter.some(f => j.label.includes(f)))
if (!selected.length) {
  console.error(`没有匹配的包。可用：${jobs.map(j => j.label).join(', ')}`)
  process.exit(1)
}

fs.mkdirSync(OUT, { recursive: true })
for (const job of selected) {
  const target = path.join(OUT, `${job.label}.zip`)
  fs.rmSync(target, { force: true })
  const began = Date.now()
  // Windows packages carry no Unix permission bits; the other three do, and must carry the right ones.
  const result = zipDir(job.dir, target, !job.label.includes('Windows'))
  const seconds = ((Date.now() - began) / 1000).toFixed(0)
  process.stdout.write(
    `\r  ${job.label}.zip  ${result.entries} 条  ${MB(result.bytes)} MB  ${seconds}s  (原始 ${MB(job.bytes)} MB)\n`,
  )
  // Verify the archive the way the user's own tool will read it, and refuse to leave a bad one behind. A permission
  // bug here is invisible to every other check: CRC passes, sizes match, and the failure only shows up as
  // "The bundled Node runtime is missing" on a machine that has it.
  const problems = auditArchive(target, !job.label.includes('Windows'))
  if (problems.length) {
    fs.rmSync(target, { force: true })
    console.error(`\n  ✗ ${job.label}.zip 未通过权限自检，已删除：`)
    for (const line of problems.slice(0, 10)) console.error(`      ${line}`)
    if (problems.length > 10) console.error(`      …共 ${problems.length} 处`)
    process.exitCode = 1
  }
}

if (!process.exitCode) console.log(`\n成品在 ${OUT}`)
