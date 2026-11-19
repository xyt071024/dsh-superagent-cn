import fs from 'node:fs'
import path from 'node:path'

/** Refuse Windows-only or wrong-architecture DSH trees before constructing a Unix bundle. */
export function checkUnixDependencies(modules, platform, arch) {
  if (!['linux', 'darwin'].includes(platform) || !['x64', 'arm64'].includes(arch) || (platform === 'linux' && arch !== 'x64')) {
    throw new Error('Unsupported release target')
  }
  function packageDir(name) {
    const dir = path.join(modules, name)
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    if (manifest.name !== name) throw new Error(`Invalid dependency: ${name}`)
    return dir
  }
  packageDir('@deepseek-ai/dsh')
  const targets = [`@img/sharp-${platform}-${arch}`, `@koromix/koffi-${platform}-${arch}`,
    `sherpa-onnx-${platform === 'darwin' ? 'darwin' : 'linux'}-${arch}`,
    `node-addon-require-builtin-${platform}-${arch}${platform === 'linux' ? '-gnu' : ''}`]
  packageDir(`@img/sharp-libvips-${platform}-${arch}`)
  function binaries(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const file = path.join(dir, entry.name)
      return entry.isDirectory() ? binaries(file) : entry.isFile() && entry.name.endsWith('.node') ? [file] : []
    })
  }
  function matches(file) {
    const header = Buffer.alloc(20)
    const fd = fs.openSync(file, 'r')
    try { if (fs.readSync(fd, header, 0, header.length, 0) !== header.length) return false } finally { fs.closeSync(fd) }
    if (platform === 'linux') return header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && header[5] === 1 && header.readUInt16LE(18) === 62
    return header.readUInt32LE(0) === 0xfeedfacf && header.readUInt32LE(4) === (arch === 'x64' ? 0x01000007 : 0x0100000c)
  }
  for (const name of targets) {
    const dir = packageDir(name)
    if (!binaries(dir).some(matches)) throw new Error(`No matching native binary in ${name}`)
  }
  const pty = path.join(packageDir('node-pty'), 'prebuilds', `${platform}-${arch}`)
  if (!fs.existsSync(pty) || !binaries(pty).some(matches)) throw new Error('No matching node-pty prebuild')
}
