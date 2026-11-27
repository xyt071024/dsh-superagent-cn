/**
 * 把 _work/_stage 下已经铺好的包目录压成最终交付的 zip。
 *
 * 为什么不用系统自带 Compress-Archive：
 *  1. .NET Framework / Windows ZipFile 超过 65,535 条目默认或兼容问题，这里统一写入 zip64。
 *  2. Compress-Archive 会把条目路径分隔符写成 `\`，macOS / Linux 解压会出错；这里统一写 `/`。
 *  3. Linux / macOS 需要保留 Unix 权限位（start.sh / node / .node 等 0755，目录 040755）。
 *
 * 性能优化（2026-11）：
 *  - 使用 worker_threads 多核并行读取文件 + 计算 CRC32 + deflateRaw 压缩。
 *  - 按固定索引顺序滑动窗口汇总并写入 4 MB 输出缓冲，彻底避免 24 万次小块 writeSync 系统调用。
 *
 * 用法：
 *   node _build/make-dist-zips.mjs              全部压
 *   node _build/make-dist-zips.mjs Windows      只压名字含 Windows 的
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker, isMainThread, parentPort } from 'node:worker_threads'
import { deflateRawSync, crc32 } from 'node:zlib'

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

if (!isMainThread) {
  parentPort.on('message', ({ index, file }) => {
    try {
      const raw = fs.readFileSync(file)
      const rawSize = raw.length
      if (rawSize === 0) {
        parentPort.postMessage({ index, crcValue: 0, rawSize: 0, compSize: 0, buf: new ArrayBuffer(0) })
        return
      }
      const crcValue = CRC(raw, 0)
      const compressed = deflateRawSync(raw, { level: 6 })
      const compSize = compressed.length
      // Ensure the returned ArrayBuffer matches the exact compressed slice for zero-copy transfer.
      const ab = compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength)
      parentPort.postMessage({ index, crcValue, rawSize, compSize, buf: ab }, [ab])
    } catch (err) {
      parentPort.postMessage({ index, error: err?.message || String(err) })
    }
  })
} else {
  const THIS_FILE = fileURLToPath(import.meta.url)
  const STAGE = process.env.SA_STAGE_DIR || 'C:/Users/ASUS/Desktop/Super-Agent-项目完整备份-20261115/_work/_stage'
  const OUT = process.env.SA_DIST_DIR || 'C:/Users/ASUS/Desktop/Super-Agent-项目完整备份-20261115/_work/dist'
  const MANIFEST = path.join(STAGE, 'manifest.json')

  const filter = process.argv.slice(2)
  const MB = bytes => (bytes / 1048576).toFixed(1)

  function dosStamp(ms) {
    const d = new Date(ms)
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
      day: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    }
  }

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

  function localHeader({ nameLen, crc, compSize, rawSize, method, time, day }) {
    const buffer = Buffer.alloc(30)
    buffer.writeUInt32LE(0x04034b50, 0)
    buffer.writeUInt16LE(45, 4)
    buffer.writeUInt16LE(0x0800, 6)
    buffer.writeUInt16LE(method, 8)
    buffer.writeUInt16LE(time, 10)
    buffer.writeUInt16LE(day, 12)
    buffer.writeUInt32LE(crc, 14)
    buffer.writeUInt32LE(compSize, 18)
    buffer.writeUInt32LE(rawSize, 22)
    buffer.writeUInt16LE(nameLen, 26)
    buffer.writeUInt16LE(0, 28)
    return buffer
  }

  class BufferedWriter {
    constructor(fd, capacity = 4 * 1024 * 1024) {
      this.fd = fd
      this.buf = Buffer.allocUnsafe(capacity)
      this.pos = 0
      this.offset = 0
    }
    flush() {
      if (this.pos === 0) return
      let written = 0
      while (written < this.pos) {
        written += fs.writeSync(this.fd, this.buf, written, this.pos - written)
      }
      this.pos = 0
    }
    append(chunk) {
      const len = chunk.length
      if (len === 0) return
      this.offset += len
      if (len >= this.buf.length) {
        this.flush()
        let written = 0
        while (written < len) {
          written += fs.writeSync(this.fd, chunk, written, len - written)
        }
        return
      }
      if (this.pos + len > this.buf.length) {
        this.flush()
      }
      chunk.copy(this.buf, this.pos)
      this.pos += len
    }
    close() {
      this.flush()
      fs.closeSync(this.fd)
    }
  }

  async function zipDir(source, target, unix = true) {
    const entries = collect(source, source, [], unix)
    const fd = fs.openSync(target, 'w')
    const writer = new BufferedWriter(fd)
    const centrals = []

    const workerCount = Math.min(8, Math.max(2, os.cpus().length))
    const workers = Array.from({ length: workerCount }, () => new Worker(THIS_FILE))
    const idleWorkers = [...workers]
    const readyMap = new Map()
    let nextDispatch = 0
    let nextWrite = 0
    let inFlightCount = 0
    let queuedBytes = 0
    const MAX_IN_FLIGHT_ENTRIES = 256
    const MAX_QUEUED_BYTES = 128 * 1024 * 1024

    try {
      await new Promise((resolve, reject) => {
        let settled = false
        const fail = err => {
          if (settled) return
          settled = true
          reject(err)
        }

        const flushReady = () => {
          while (nextWrite < entries.length) {
            const entry = entries[nextWrite]
            let done
            if (entry.dir || entry.size === 0) {
              done = { crcValue: 0, rawSize: 0, compSize: 0, data: Buffer.alloc(0) }
            } else {
              const item = readyMap.get(nextWrite)
              if (!item) break
              readyMap.delete(nextWrite)
              inFlightCount--
              queuedBytes -= entry.size
              done = item
            }

            const { time, day } = dosStamp(entry.mtime)
            const nameBuf = Buffer.from(entry.name, 'utf8')
            const method = done.rawSize === 0 ? 0 : 8
            const header = localHeader({
              nameLen: nameBuf.length,
              crc: done.crcValue,
              compSize: done.compSize,
              rawSize: done.rawSize,
              method,
              time,
              day,
            })
            const entryStart = writer.offset
            writer.append(header)
            writer.append(nameBuf)
            if (done.compSize) writer.append(done.data)

            centrals.push({
              nameBuf,
              method,
              time,
              day,
              crc: done.crcValue,
              compSize: done.compSize,
              rawSize: done.rawSize,
              dir: entry.dir,
              mode: entry.mode,
              offset: entryStart,
            })

            nextWrite++
            if (nextWrite % 20000 === 0) {
              console.log(`    [${path.basename(target)}] 已写 ${nextWrite}/${entries.length} 条  ${MB(writer.offset)} MB`)
            }
          }

          if (nextWrite === entries.length && !settled) {
            settled = true
            resolve()
          }
        }

        const pump = () => {
          for (;;) {
            flushReady()
            if (settled) return
            let dispatched = false
            while (idleWorkers.length > 0 && nextDispatch < entries.length) {
              if (inFlightCount >= MAX_IN_FLIGHT_ENTRIES) break
              if (queuedBytes >= MAX_QUEUED_BYTES && inFlightCount > 0) break
              const entry = entries[nextDispatch]
              if (entry.dir || entry.size === 0) {
                nextDispatch++
                dispatched = true
                continue
              }
              const idx = nextDispatch++
              inFlightCount++
              queuedBytes += entry.size
              const worker = idleWorkers.pop()
              worker.postMessage({ index: idx, file: entry.file })
              dispatched = true
            }
            if (!dispatched) break
          }
        }

        for (const worker of workers) {
          worker.on('message', msg => {
            if (msg.error) {
              fail(new Error(msg.error))
              return
            }
            readyMap.set(msg.index, {
              crcValue: msg.crcValue,
              rawSize: msg.rawSize,
              compSize: msg.compSize,
              data: Buffer.from(msg.buf),
            })
            idleWorkers.push(worker)
            pump()
          })
          worker.on('error', fail)
          worker.on('exit', code => {
            if (!settled && code !== 0) fail(new Error(`Zip worker exited with code ${code}`))
          })
        }

        pump()
      })

      // ---- central directory ----
      const centralStart = writer.offset
      for (const c of centrals) {
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
        central.writeUInt16LE(0x032e, 4)
        central.writeUInt16LE(45, 6)
        central.writeUInt16LE(0x0800, 8)
        central.writeUInt16LE(c.method, 10)
        central.writeUInt16LE(c.time, 12)
        central.writeUInt16LE(c.day, 14)
        central.writeUInt32LE(c.crc, 16)
        central.writeUInt32LE(need64 ? 0xffffffff : c.compSize, 20)
        central.writeUInt32LE(need64 ? 0xffffffff : c.rawSize, 24)
        central.writeUInt16LE(c.nameBuf.length, 28)
        central.writeUInt16LE(extra.length, 30)
        central.writeUInt16LE(0, 32)
        central.writeUInt16LE(0, 34)
        central.writeUInt16LE(0, 36)
        central.writeUInt32LE(c.dir ? (((0o40755) << 16) | 0x10) >>> 0 : (((c.mode & 0o777) | 0o100000) << 16) >>> 0, 38)
        central.writeUInt32LE(need64 ? 0xffffffff : c.offset, 42)
        writer.append(central)
        writer.append(c.nameBuf)
        if (extra.length) writer.append(extra)
      }
      const centralSize = writer.offset - centralStart

      const count = centrals.length
      if (count > 0xffff || centralStart > 0xffffffff || centralSize > 0xffffffff) {
        const eocd64 = Buffer.alloc(56)
        eocd64.writeUInt32LE(0x06064b50, 0)
        eocd64.writeBigUInt64LE(44n, 4)
        eocd64.writeUInt16LE(45, 12)
        eocd64.writeUInt16LE(45, 14)
        eocd64.writeUInt32LE(0, 16)
        eocd64.writeUInt32LE(0, 20)
        eocd64.writeBigUInt64LE(BigInt(count), 24)
        eocd64.writeBigUInt64LE(BigInt(count), 32)
        eocd64.writeBigUInt64LE(BigInt(centralSize), 40)
        eocd64.writeBigUInt64LE(BigInt(centralStart), 48)
        writer.append(eocd64)

        const locator = Buffer.alloc(20)
        locator.writeUInt32LE(0x07064b50, 0)
        locator.writeUInt32LE(0, 4)
        locator.writeBigUInt64LE(BigInt(centralStart + centralSize), 8)
        locator.writeUInt32LE(1, 16)
        writer.append(locator)
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
      writer.append(end)
    } finally {
      for (const worker of workers) worker.terminate().catch(() => {})
      writer.close()
    }

    return { entries: entries.length, bytes: fs.statSync(target).size }
  }

  function auditArchive(file, unix) {
    const problems = []
    const fd = fs.openSync(file, 'r')
    try {
      const size = fs.fstatSync(fd).size
      const tail = Buffer.alloc(Math.min(size, 66_000))
      fs.readSync(fd, tail, 0, tail.length, size - tail.length)
      let eocd = -1
      for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
      if (eocd < 0) return ['no end-of-central-directory record']
      let count = tail.readUInt16LE(eocd + 10), start = tail.readUInt32LE(eocd + 16)
      if (start === 0xffffffff || count === 0xffff) {
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
    const result = await zipDir(job.dir, target, !job.label.includes('Windows'))
    const seconds = ((Date.now() - began) / 1000).toFixed(1)
    process.stdout.write(
      `\r  ${job.label}.zip  ${result.entries} 条  ${MB(result.bytes)} MB  ${seconds}s  (原始 ${MB(job.bytes)} MB)\n`,
    )
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
}
