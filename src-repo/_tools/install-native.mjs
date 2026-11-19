/**
 * 把各平台的原生包装配进对应平台的内置包。
 *
 * 为什么不在 Windows 上"编译"：这些模块（sharp / koffi / sherpa-onnx / node-addon-require-builtin）都是
 * 预编译分发的 —— 它们把每个平台的二进制单独发布成一个 npm 包，运行时按 platform+arch 挑一个加载。
 * 所以跨平台打包不需要编译，只需要把对应平台的那个包下载下来放进去。这也是市面所有跨平台 Node 项目的做法。
 *
 * 版本必须与主包声明一致，否则运行时版本检查会拒。声明来源在各自主包的 optionalDependencies 里。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const CACHE = 'C:/Users/ASUS/Desktop/Super-Agent-项目完整备份-20261115/_work/_native-cache'
const STAGE = 'C:/Users/ASUS/Desktop/Super-Agent-项目完整备份-20261115/_work/_stage'

/** 每个目标平台需要哪些原生包，版本取自 `_probe/dsh-min/node_modules` 里主包的 optionalDependencies。 */
const NATIVE = {
  'macOS-arm64': [
    '@img/sharp-darwin-arm64@0.35.5',
    '@img/sharp-libvips-darwin-arm64@1.3.4',
    '@koromix/koffi-darwin-arm64@3.1.1',
    'sherpa-onnx-darwin-arm64@1.13.8',
    'node-addon-require-builtin-darwin-arm64@0.1.9',
  ],
  'macOS-x64': [
    '@img/sharp-darwin-x64@0.35.5',
    '@img/sharp-libvips-darwin-x64@1.3.4',
    '@koromix/koffi-darwin-x64@3.1.1',
    'sherpa-onnx-darwin-x64@1.13.8',
    'node-addon-require-builtin-darwin-x64@0.1.9',
  ],
  'Linux-x64': [
    '@img/sharp-linux-x64@0.35.5',
    '@img/sharp-libvips-linux-x64@1.3.4',
    '@koromix/koffi-linux-x64@3.1.1',
    'sherpa-onnx-linux-x64@1.13.8',
    'node-addon-require-builtin-linux-x64-gnu@0.1.9',
  ],
}

/** 从 `name@version` 得到缓存文件名。 */
const cacheFile = spec => {
  const at = spec.lastIndexOf('@')
  const name = spec.slice(0, at)
  const version = spec.slice(at + 1)
  return path.join(CACHE, `${name.replace(/[/@]/g, '_')}-${version}.tgz`)
}

/** 解一个 npm tgz 到 dest（成员名以 package/ 开头，去掉这一段）。 */
function extractTgz(tgz, dest) {
  const buf = zlib.gunzipSync(fs.readFileSync(tgz))
  let off = 0
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512)
    if (header.every(b => b === 0)) break
    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    if (!rawName) break
    const type = String.fromCharCode(header[156])
    const size = parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim(), 8) || 0
    const mode = parseInt(header.subarray(100, 108).toString('ascii').replace(/\0.*$/, '').trim(), 8) || 0o644
    const data = buf.subarray(off + 512, off + 512 + size)
    const rel = rawName.replace(/^package\//, '')
    if (rel && !rel.startsWith('..')) {
      const target = path.join(dest, rel)
      if (type === '5') fs.mkdirSync(target, { recursive: true })
      else {
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, data)
        // .dylib / .so / .node 可能要执行位，但 node 加载不需要；保留 tar 里的 mode 更稳妥。
        if (mode & 0o111) { try { fs.chmodSync(target, mode & 0o777) } catch { /* Windows 无 POSIX 位 */ } }
      }
    }
    off += 512 + Math.ceil(size / 512) * 512
  }
}

/** 把某个目标平台的原生包装配进它的内置包。 */
export function installNative(os, arch, stageDir) {
  const key = `${os}-${arch}`
  const list = NATIVE[key]
  if (!list) throw new Error(`No native set for ${key}`)
  const modules = path.join(stageDir, 'runtime', 'node_modules')
  if (!fs.existsSync(modules)) throw new Error(`No runtime/node_modules in ${stageDir}`)
  const done = []
  for (const spec of list) {
    const file = cacheFile(spec)
    if (!fs.existsSync(file)) throw new Error(`Missing cached native package: ${file}`)
    const name = spec.slice(0, spec.lastIndexOf('@'))
    const dest = path.join(modules, name)
    fs.mkdirSync(dest, { recursive: true })
    extractTgz(file, dest)
    done.push(name)
  }
  return done
}

if (process.argv[1] && process.argv[1].endsWith('install-native.mjs')) {
  const targets = [
    ['macOS', 'arm64'], ['macOS', 'x64'], ['Linux', 'x64'],
  ]
  for (const [os, arch] of targets) {
    const label = `Super-Agent-Bundled-${os}-${arch}-Stable-v0.3.5`
    const dir = path.join(STAGE, label)
    if (!fs.existsSync(dir)) { console.log(`  跳过 ${label}（未铺）`); continue }
    const done = installNative(os, arch, dir)
    console.log(`  ${label}: 装入 ${done.length} 个原生包`)
  }
}
