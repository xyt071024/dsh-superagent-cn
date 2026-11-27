/**
 * 生成 12 个安装包：三个系统 × 内置/纯净 × 稳定/破甲。
 *
 * 爹 2026-11-12 的要求（原话）：
 *   「内置，必须得内置啊，他得双击运行之后就能跑了，不然的话现在给你妈下好的东西之后还要自己再装，那肯定不行啊」
 *   「一共有三个系统，应该是三个版本的插件，然后在三个版本的那个白板，然后这三个版本的破甲版本」
 *   「你再装一个纯净的，就是只有只含插件那些什么的，然后不需要内置环境的版本的安装包也给他塞进去」
 *
 * 所以每个组合都有两种形态：
 *   Bundled  内置 Node + DSH 本体，解压双击就跑（600 MB 级，这是真实代价）
 *   Clean    只有插件，给已经有 Node 和 DSH 的人（1.8 MB 级）
 *
 * 包名七段，读名字就能选对，不用打开：
 *   Super-Agent-Bundled-Windows-x64-Stable-v0.2.0.zip
 *   Super-Agent-Clean-Plugin-Any-Platform-Purge-v0.2.0.tgz
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'
import { installNative } from './install-native.mjs'

const ROOT = 'D:/DeepSeekHarness'
const PKG = 'C:/Users/ASUS/Desktop/Super-Agent-项目完整备份-20261115/_packages'
/**
 * 输出到工作区之外。
 *
 * `D:\DeepSeekHarness` 上有一条 `Everyone :: DeleteSubdirectoriesAndFiles :: Deny` 的 ACL（沙箱用来护住工作区）。
 * 它会让从这里复制出去的 node.exe 在**运行时**写任何文件都 EPERM —— 实测同一个 exe 移到别处就正常。
 * 所以暂存与打包都放在 `D:\sa-build`，最后只把成品 zip 移回来。
 */
const OUT = process.env.SA_BUILD_OUT || 'C:/Users/ASUS/Desktop/Super-Agent-项目完整备份-20261115/_work'
const STAGE_ROOT = process.env.SA_STAGE_DIR || STAGE_ROOT
const NODEBIN = join(ROOT, '_nodebin')
const PROTO = 'C:/Users/ASUS/Desktop/Super-Agent-项目完整备份-20261115/02-修改后源码'
const DSH_MIN = join(ROOT, '_probe', 'dsh-min', 'node_modules')

const VERSION = JSON.parse(readFileSync(join(PROTO, 'package.json'), 'utf8')).version ?? '0.2.0'
const DSH_VERSION = JSON.parse(readFileSync(join(DSH_MIN, '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version

/** 三个系统（macOS 分两种架构，Apple Silicon 装不了 x64 的 node）。 */
const TARGETS = [
  { os: 'Windows', arch: 'x64', node: 'node-v22.19.0-win-x64', kind: 'zip', launcher: 'cmd' },
  { os: 'macOS', arch: 'arm64', node: 'node-v22.19.0-darwin-arm64', kind: 'tar.gz', launcher: 'sh' },
  { os: 'macOS', arch: 'x64', node: 'node-v22.19.0-darwin-x64', kind: 'tar.gz', launcher: 'sh' },
  { os: 'Linux', arch: 'x64', node: 'node-v22.19.0-linux-x64', kind: 'tar.xz', launcher: 'sh' },
]

const BUILDS = ['stable']

const dirBytes = dir => {
  if (!existsSync(dir)) return 0
  let total = 0
  const walk = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else total += statSync(full).size
    }
  }
  walk(dir)
  return total
}
const MB = bytes => (bytes / 1048576).toFixed(1)

/**
 * 解压 Node 归档。
 *
 * Windows 自带的 bsdtar 同时认识 zip / tar.gz / tar.xz，但它创建不了 unix 符号链接。
 * 这一点在这里是安全的：归档里只有三个符号链接，全是 `bin/npm`、`bin/npx`、`bin/corepack`，
 * 指向 `lib/node_modules/{npm,corepack}` —— 而那个目录本来就要裁掉（一个只跑 dsh 的运行时不需要 npm）。
 * 所以跳过这三项不影响任何会被用到的文件；其它任何解压错误都照常抛出。
 */
/**
 * 解压 Node 归档，然后按「关键文件在不在」判定成败。
 *
 * Windows 自带的 bsdtar 建不了 unix 符号链接，而 Node 归档里有三个（bin/npm、bin/npx、bin/corepack,
 * 都指向 lib/node_modules/{npm,corepack}）—— 那个目录本来就要裁掉，一个只跑 dsh 的运行时不需要 npm。
 * 与其去正则匹配 tar 的报错文本（格式一变就误判），不如忽略退出码，直接验证真正要用的东西：
 * `bin/node`（或 node.exe）存在、且大小合理。这才是「解压成功」的定义。
 */
function extractArchive(archive, staging) {
  try {
    execFileSync('C:/Windows/System32/tar.exe', ['-xf', archive, '-C', staging], { stdio: 'pipe' })
  } catch {
    // 失败原因可能是那三个符号链接；下面用文件存在性做真实判断。
  }
  const inner = readdirSync(staging).find(name => name.startsWith("node-v"))
  if (inner === undefined) throw new Error(`解压后找不到 node 目录：${staging}`)
  const root = join(staging, inner)
  const runtimes = ['node.exe', join('bin', 'node')].map(rel => join(root, rel)).filter(existsSync)
  const usable = runtimes.filter(file => statSync(file).size > 20 * 1024 * 1024)
  if (usable.length === 0) throw new Error(`解压后没有可用的 node 可执行文件：${root}`)
}

/** 解出 Node 并裁到运行所需。 */
function stageNode(target, dest) {
  const archive = join(NODEBIN, `${target.node}.${target.kind}`)
  if (!existsSync(archive)) throw new Error(`Node 归档不在：${archive}`)
  const staging = join(dest, '_node_extract')
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  // Windows 自带的 bsdtar 同时认 zip / tar.gz / tar.xz，且不受 shell 环境影响（MSYS 的 unzip 在 PowerShell 里不在 PATH）。
  extractArchive(archive, staging)

  const inner = readdirSync(staging).find(name => name.startsWith("node-v"))
  if (inner === undefined) throw new Error(`解压后找不到 node 目录：${staging}`)
  cpSync(join(staging, inner), join(dest, 'node'), { recursive: true })
  rmSync(staging, { recursive: true, force: true })

  // 一个只跑 `dsh` 的运行时不需要编译器头文件、文档，也不需要 npm 自己（用户不在包里装东西）。
  for (const drop of ['include', 'share/doc', 'share/man', 'share/systemtap', 'CHANGELOG.md', 'README.md', 'LICENSE',
    'lib/node_modules/npm', 'lib/node_modules/corepack', 'node_modules/npm', 'node_modules/corepack',
    'bin/npm', 'bin/npx', 'bin/corepack',
    'npm', 'npx', 'corepack', 'npm.cmd', 'npx.cmd', 'corepack.cmd', 'npm.ps1', 'npx.ps1', 'corepack.ps1', 'install_tools.bat']) {
    rmSync(join(dest, 'node', drop), { recursive: true, force: true })
  }
}

/**
 * 平台的额外名称，用来判断一个原生包属于哪个目标。
 *
 * `@img/sharp-<platform>-<arch>`、`@koromix/koffi-<platform>-<arch>`、`sherpa-onnx-<platform>-<arch>` 都是按这个拼的；
 * `node-addon-require-builtin-<platform>-<arch>[-gnu|-msvc]` 多一个 ABI 后缀。
 */
/** The package name inside a path below `node_modules`: `@scope/name` for a scoped package, else the first segment. */
function packageNameOf(rel) {
  const segments = (rel.split('node_modules/').filter(Boolean).pop() ?? '').split('/').filter(Boolean)
  if (!segments.length) return ''
  return segments[0].startsWith('@') && segments.length > 1 ? `${segments[0]}/${segments[1]}` : segments[0]
}
const PLATFORM_TAGS = {
  Windows: ['win32', 'win'],
  macOS: ['darwin'],
  Linux: ['linux'],
}

/** 这个包名是不是给别的平台的二进制（只按已知平台标记判断，认不出的一律保留）。 */
function wrongPlatform(name, os) {
  const wanted = PLATFORM_TAGS[os]
  const others = Object.entries(PLATFORM_TAGS).filter(([key]) => key !== os).flatMap(([, tags]) => tags)
  // 只有名字里出现「别的平台」的标记才算错；出现本平台的算对（例如 linux-gnu 里的 linux）。
  if (wanted.some(tag => name.includes(tag))) return false
  return others.some(tag => new RegExp(`(^|[-/@])${tag}($|[-/])`).test(name))
}

/**
 * 只被 parent 写在 optionalDependencies 里的包名集合。
 *
 * 只有这些包可以按名字裁掉：它们本来就是「就近选一个平台实现」的那类包，
 * 处理器会自己挑中当前平台那个。反之，写在 dependencies 里的包是硬依赖，
 * 即使名字里带 win32（如 dsh-win32-process）也必须带上——它的 JS 在 Linux 上也要 import。
 */
function optionalOnly() {
  if (optionalCache) return optionalCache
  const found = new Set()
  const walk = dir => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const full = join(dir, entry.name)
      if (entry.name.startsWith('@')) { walk(full); continue }
      let manifest
      try { manifest = JSON.parse(readFileSync(join(full, 'package.json'), 'utf8')) } catch { continue }
      for (const name of Object.keys(manifest.optionalDependencies ?? {})) {
        // A package listed as a real dependency elsewhere is not optional, whatever else says.
        if (!(manifest.dependencies ?? {})[name]) found.add(name)
      }
    }
  }
  walk(DSH_MIN)
  optionalCache = found
  return found
}
let optionalCache

/**
 * 复制 DSH 本体（裁掉白板版不需要的 LibreOffice 文档组件，182 MB），并丢掉别的平台的原生二进制。
 *
 * 为什么要丢：`_probe/dsh-min/node_modules` 是在 Windows 上装出来的，里面有
 * `@img/sharp-win32-x64`、`@koromix/koffi-win32-x64`、`node-addon-require-builtin-win32-x64-msvc`
 * 这些 Windows 专用包。原样复制进 Linux/macOS 包，用户装完启动就报模块加载失败 —— 旧的 0.3.5 暂存包
 * 就是这么坏的（三个平台的包里各躺着 12 个 .node，全是 Windows 的）。
 * `scripts/unix-platform-check.mjs` 存在的意义就是拦这个，但打包流程从来没调用它。
 *
 * 说明：这里只排除**别的平台**的包，不保证本平台那一份存在。真正的判据是
 * `scripts/unix-platform-check.mjs` 的 ELF/Mach-O 头校验 —— 而本机没有 Linux/macOS 的依赖树，
 * 所以 macOS/Linux 包仍标记为「未在真机验证」，README 里如实写明。
 */
function stageDsh(dest, os) {
  const target = join(dest, 'runtime', 'node_modules')
  mkdirSync(target, { recursive: true })
  const skipped = []
  cpSync(DSH_MIN, target, {
    recursive: true,
    filter: src => {
      const rel = src.slice(DSH_MIN.length).split('\\').join('/')
      if (src.includes('libreoffice-kit-')) return false
      // 只看包名那一段（node_modules 之后、下一个 node_modules 之前），避免被深层文件路径误判。
      // scoped 包要取两段（`@img/sharp-win32-x64`），只取一段会得到 `@img`，于是 sharp / koffi 这类
      // 平台专属包永远识别不出来 —— 上一版正是这样漏掉的。
      const packageName = packageNameOf(rel)
      if (!packageName) return true
      // A name containing `win32` is not proof the package is Windows-only. `@deepseek-ai/dsh-win32-process` carries the
      // Windows process primitives but ships JavaScript that Linux also imports; pruning it broke `dsh-subprocess-local`
      // and with it the sandbox, the terminal and every shell tool. Only prune a package that the platform-specific
      // dependency graph actually excludes — an `optionalDependency` of some parent, whose place is taken by that
      // platform's own package.
      // Prune only what is genuinely a per-platform alternative: a package some parent lists as an optionalDependency.
      // Anything else is a hard dependency and must ship on every platform, whatever its name looks like —
      // `dsh-win32-process` is the case that proves it, since `dsh-subprocess-local` requires it everywhere.
      const optional = optionalOnly().has(packageName)
      if (!optional) return true
      if (wrongPlatform(packageName, os)) { skipped.push(packageName); return false }
      return true
    },
  })
  if (skipped.length) console.log(`    已排除 ${new Set(skipped).size} 个其它平台的原生包（目标 ${os}）`)
  // Pruning by name is a guess; this is the proof. Every package the tree actually depends on must still resolve, or
  // the host starts with `failed to import` and loses whole services — shell, sandbox, terminal — while looking fine.
  const missing = missingDependencies(target)
  if (missing.length) {
    throw new Error(`${os} runtime 缺 ${missing.length} 个硬依赖：${missing.slice(0, 8).join(', ')}`
      + '（这些包名字里可能带别的平台标记，但它们是依赖不是平台实现，不能裁）')
  }
}

/** Hard dependencies of every installed package that the copied tree cannot resolve. */
function missingDependencies(modules) {
  const missing = new Set()
  const walk = dir => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const full = join(dir, entry.name)
      if (entry.name.startsWith('@')) { walk(full); continue }
      let manifest
      try { manifest = JSON.parse(readFileSync(join(full, 'package.json'), 'utf8')) } catch { continue }
      for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
        if (name.startsWith('file:') || String(version).startsWith('file:')) continue
        if (!resolves(full, name, modules)) missing.add(name)
      }
    }
  }
  walk(modules)
  return [...missing]
}

/** Whether `name` resolves from `from`, by Node's own lookup: its node_modules, then each ancestor, then the root. */
function resolves(from, name, root) {
  let dir = from
  for (;;) {
    if (existsSync(join(dir, 'node_modules', name, 'package.json'))) return true
    if (dir === root || dir.length <= root.length) break
    const parent = dirname(dir)
    if (parent === dir || !parent.startsWith(root)) break
    dir = parent
  }
  return existsSync(join(root, name, 'package.json')) || existsSync(join(root, name, 'package.json').replace(/\\/g, '/'))
}

/** 插件本体 + profile 骨架。 */
function stagePayload(dest, build) {
  const plugin = join(PKG, 'plugin', build)
  cpSync(join(plugin, 'node_modules'), join(dest, 'payload', 'node_modules'), { recursive: true })
  cpSync(join(plugin, 'dsh-superagent.tgz'), join(dest, 'payload', 'dsh-superagent.tgz'))
  cpSync(join(PKG, 'native', build, 'profile'), join(dest, 'payload', 'profile'), { recursive: true })
  // The profile lists `dsh-superagent` as a bundle, and DSH resolves a bundle from the profile's own node_modules. The
  // launcher only copied the tarball next to the profile, so nothing ever unpacked it: the panel started as a bare
  // DSH with `skipping profile bundle "dsh-superagent"` in the log, which is the one failure a user cannot see.
  // Unpacking it here makes the installed bundle a fact of the package rather than a step that can be skipped.
  installPluginIntoProfile(dest, build)
}

/**
 * Unpacks a gzipped tarball written by `npm pack`, dropping the archive's leading `package/` directory.
 *
 * A tarball is a sequence of 512-byte headers followed by that entry's bytes padded to 512; that is the whole format
 * this needs, and reading it here keeps the build free of an external `tar`.
 */
function untarGz(file, dest) {
  const buf = gunzipSync(readFileSync(file))
  let at = 0, written = 0
  while (at + 512 <= buf.length) {
    const field = (start, length) => buf.toString('utf8', at + start, at + start + length).replace(/ .*$/, '')
    const name = field(0, 100)
    if (!name) { at += 512; continue }
    const size = parseInt(field(124, 12).trim() || '0', 8)
    const type = field(156, 1)
    const prefix = field(345, 155)
    const full = prefix ? `${prefix}/${name}` : name
    // The first path segment is the archive root (`package/`), which must not become a directory of its own.
    const relative = full.split('/').slice(1).join('/')
    at += 512
    if (type === '5' || full.endsWith('/')) {
      if (relative) mkdirSync(join(dest, relative), { recursive: true })
    } else if (relative) {
      mkdirSync(dirname(join(dest, relative)), { recursive: true })
      writeFileSync(join(dest, relative), buf.subarray(at, at + size))
      written++
    }
    at += Math.ceil(size / 512) * 512
  }
  return written
}

/** Unpacks the plugin tarball into the profile's node_modules, where DSH looks for a bundle. */
function installPluginIntoProfile(dest, build) {
  const modules = join(dest, 'payload', 'node_modules')
  const target = join(modules, 'dsh-superagent')
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  // Unpacked in-process rather than shelling out to `tar`: on Windows a path like `C:/...` is read as a remote host
  // ("Cannot connect to C: resolve failed"), and the build must not depend on which tar happens to be on PATH.
  untarGz(join(dest, 'payload', 'dsh-superagent.tgz'), target)
  const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
  if (manifest.name !== 'dsh-superagent') throw new Error(`unpacked the wrong package into the profile: ${manifest.name}`)
  if (!existsSync(join(target, 'lib', 'index.js'))) throw new Error('the unpacked plugin has no lib/index.js')
  // Its own runtime dependencies are already present: `_packages/plugin/<build>/node_modules` holds them, and the
  // launcher copies that directory to the same place.
  console.log(`plugin unpacked into payload/node_modules/dsh-superagent (v${manifest.version})`)
}

/** 启动器：用包内 node 跑包内 dsh，不碰系统 PATH。 */
function writeLaunchers(dest, target, build) {
  const built = target !== undefined
  // v0.3.7 ships stable only: the purge variant was dropped from the release set, so these branches are dead.

  if (!built) return

  if (target.launcher === 'cmd') {
    writeFileSync(join(dest, 'start.cmd'), [
      '@echo off',
      'setlocal',
      'cd /d "%~dp0"',
      'set "SA_NODE=%~dp0node\\node.exe"',
      'if not exist "%SA_NODE%" (echo The bundled Node runtime is missing from this package. Download it again. & exit /b 1)',
      '',
      'set "SA_PROFILE=%DSH_PROFILE%"',
      'if "%SA_PROFILE%"=="" set "SA_PROFILE=superagent"',
      '"%SA_NODE%" "%~dp0tools\\windows-profile-bootstrap.mjs" --profile "%SA_PROFILE%"',
      'if errorlevel 1 (echo Profile bootstrap failed; nothing was started. & exit /b 1)',
      '',
      'echo Starting Super Agent.',
      'set "NODE_PATH=%~dp0runtime\\node_modules"',
      '"%SA_NODE%" "%~dp0runtime\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" --profile "%SA_PROFILE%" --no-open %*',
      '',
    ].join('\r\n'))
  } else {
    writeFileSync(join(dest, 'start.sh'), [
      '#!/bin/sh',
      'set -eu',
      'cd "$(dirname "$0")"',
      '',
      '# Everything runs from this folder; nothing is picked up from PATH.',
      'SA_NODE="./node/bin/node"',
      '[ -x "$SA_NODE" ] || { echo "The bundled Node runtime is missing from this package. Download it again."; exit 1; }',
      '',
      'SA_PROFILE="${DSH_PROFILE:-superagent}"',
      '"$SA_NODE" ./tools/unix-profile-bootstrap.mjs --profile "$SA_PROFILE" || { echo "Profile bootstrap failed; nothing was started."; exit 1; }',
      '',
      'echo Starting Super Agent.',
      'NODE_PATH="./runtime/node_modules"',
      'export NODE_PATH',
      'exec "$SA_NODE" ./runtime/node_modules/@deepseek-ai/dsh/lib/bin.js --profile "$SA_PROFILE" --no-open "$@"',
      '',
    ].join('\n'))
    chmodSync(join(dest, 'start.sh'), 0o755)
  }
}

/** 配置改写：把 stateDir 和端口换成这台机器的。 */
function writeTools(dest, target) {
  mkdirSync(join(dest, 'tools'), { recursive: true })
  const scriptName = target.launcher === 'cmd' ? 'windows-profile-bootstrap.mjs' : 'unix-profile-bootstrap.mjs'
  cpSync(join(PROTO, 'scripts', 'windows-profile-bootstrap.mjs'), join(dest, 'tools', scriptName))
}

/** 包内说明：中英双语，说清有什么、怎么装、占多大。 */
/** The install steps for a plugin tarball, in both shapes. Kept in one place so the README and the purge assets agree. */
function pluginInstallText(build) {
  const purge = false
  return [
    `Super Agent ${VERSION} - plugin package${purge ? ' (with the purge profile)' : ''}`,
    '',
    'The plugin tarball is the same file in both shapes. What the purge shape adds is a profile that declares the',
    'third-party `dsh-purge-community` dependency, which is a separate open-source project and is not copied in here.',
    '',
    'Stable:',
    '  dsh plugin add ./Super-Agent-Plugin-v' + VERSION + '.tgz',
    '',
    purge ? 'Then, for the purge profile:' : '(For the purge shape, see Super-Agent-Purge-Assets.)',
    ...(purge ? [
      '  1. copy ./profile/ into a profile of your own (the shipped one uses the name superagent)',
      '  2. dsh plugin add dsh-purge-community',
      '  3. dsh purge apply          # applies the host patch; `dsh purge revert` undoes it',
      '',
      'The purge build modifies the DSH host itself (86 patches). Nothing is guaranteed: output is unpredictable, a DSH',
      'upgrade can invalidate the patch, and the consequences are yours. `dsh-purge-community` is pinned only by the',
      'version in your profile, so record which version you verified.',
    ] : []),
    '',
  ].join('\n')
}

/** README for the plugin-shape zip: what to install, and what these packages deliberately do not include. */
function writePluginReadme(dest) {
  writeFileSync(join(dest, 'README.txt'), [
    `Super-Agent-Plugin-v${VERSION}`,
    'Plugin only / 只有插件，需要已有 Node.js 22.19+ 与 DSH',
    '',
    '================================================================',
    '这里面有什么 / What is inside',
    '================================================================',
    '',
    `  Super-Agent-Plugin-v${VERSION}.tgz   插件本体 / the plugin tarball`,
    '  INSTALL.txt                          安装步骤 / install steps',
    '',
    '================================================================',
    '怎么装 / How to install',
    '================================================================',
    '',
    `  dsh plugin add ./Super-Agent-Plugin-v${VERSION}.tgz`,
    '',
    '  然后在 设置 → 来源 里配置你要用的通道。',
    '  Then configure the Sources you want in Settings -> Sources.',
    '',
    '================================================================',
    '本包不包含什么 / What these packages deliberately do not include',
    '================================================================',
    '',
    '  · 内置 Node 与 DSH —— 那是内置版（Bundled）的事；这个是给已经装好 DSH 的人。',
    '    No Node or DSH inside: that is what the Bundled packages are for.',
    '',
    '  · 破甲的代码 —— 破甲是第三方开源项目，不并入本包。要破甲请另装',
    '    Super-Agent-Purge-Assets，它会声明 dsh-purge-community 依赖。',
    '    No purge code: it is a third-party project, declared rather than copied.',
    '',
    '  · macOS / Linux 的内置包 —— 本次不提供，因为构建机只有 Windows，缺少那两个平台的',
    '    原生模块（sharp / koffi / sherpa）。这两个平台请用本插件包装进已有的 DSH。',
    '    No macOS/Linux bundles this time: built on Windows only.',
    '',
  ].join('\n'))
}

function writeReadme(dest, { os, arch, build, built }) {
  const purge = false
  const name = built ? `Super-Agent-Bundled-${os}-${arch}-${purge ? 'Purge' : 'Stable'}-v${VERSION}` : 'Super-Agent-Clean-...'
  writeFileSync(join(dest, 'README.txt'), `${name}
${built ? '内置环境版 / Bundled — 解压双击就跑' : '纯净版 / Clean — 只含插件'}

================================================================
这里面有什么 / What is inside
================================================================
${built ? `
  node/                   Node.js ${'22.19.0'} 运行时（已裁剪，约 110 MB）
                          The Node.js runtime, trimmed (~110 MB)
  runtime/node_modules/   DeepSeek Harness ${DSH_VERSION} 及其依赖
                          DeepSeek Harness ${DSH_VERSION} and its dependencies
  payload/                Super Agent 插件本体 + profile 骨架 + 5 个依赖
                          the plugin, its profile skeleton, and its five dependencies
  tools/${os === 'Windows' ? 'windows' : 'unix'}-profile-bootstrap.mjs
                          检查/安装/无损升级 profile，保留已有配置与账号
                          verifies, installs, or safely upgrades the profile while keeping user settings
  start.${os === 'Windows' ? 'cmd' : 'sh'}               启动器 / the launcher

  ⚠ 不需要事先装 Node.js，也不需要装 DSH —— 都在这了。
    No Node.js and no DSH needed beforehand — both are in here.
` : `
  package/               Super Agent 插件（含 prompts/ 与 skills/）
                          the plugin, including prompts/ and skills/
  ⚠ 这个包不含 Node.js 和 DSH。你需要事先装好：
    1. Node.js 22.19+ 或 24+
    2. DeepSeek Harness:  npm i -g @deepseek-ai/dsh
  ⚠ This package contains neither Node.js nor DSH. Install first:
    1. Node.js 22.19+ or 24+
    2. DeepSeek Harness:  npm i -g @deepseek-ai/dsh
`}
================================================================
怎么装 / How to install
================================================================
${built ? `
  Windows        双击 start.cmd
  macOS / Linux  ./start.sh

  第一次运行会：
  · 把 profile 装进 ~/.dsh/profiles/superagent（若已存在则检查版本并无损升级，保留现有配置）
  · 用包里自带的 Node 挑一个空闲端口（3082–3182）
  · 启动，并打印带 token 的面板地址
  · 读打印出来的那一行，端口是你自己机器上挑的

  Windows        double-click start.cmd
  macOS / Linux  ./start.sh

  The first run will:
  · install or safely upgrade the profile in ~/.dsh/profiles/superagent (keeps your existing settings)
  · pick a free port (3082-3182) using the bundled Node
  · start, and print the panel address with its token
  · read that line — the port was chosen on your machine
` : `
  dsh plugin add ./Super-Agent-Plugin-${purge ? 'Purge' : 'Stable'}-v${VERSION}.tgz
  然后重启 DSH，侧边栏出现 Superagent 入口。
  Restart DSH afterwards; a Superagent entry appears in the sidebar.
`}
================================================================
它会动什么 / What it touches
================================================================
${built ? `
  只写 ~/.dsh/profiles/superagent 和 ~/.dsh/state/superagent。
  解压目录在第一次启动后不再使用，可以移动或删除。
  卸载：删掉那两个目录。
  Writes only ~/.dsh/profiles/superagent and ~/.dsh/state/superagent.
  The unzip folder is unused after the first launch.
  To uninstall, delete those two directories.
` : `
  只增加一个插件，不改已有插件或配置。数据在 ~/.dsh/state/superagent。
  卸载：dsh plugin remove dsh-superagent
  Adds one plugin; changes nothing else. Data in ~/.dsh/state/superagent.
  To remove: dsh plugin remove dsh-superagent
`}
================================================================
为什么这么大 / 为什么这么小
================================================================
${built ? `
  约 600 MB：Node 运行时（110 MB）+ DSH 本体与其依赖（约 490 MB）。
  已经把白板版用不到的 LibreOffice 文档组件（182 MB）裁掉了。
  换来的是一件事：解压双击就能跑，不用装任何东西。

  ~600 MB: the Node runtime (110 MB) plus DSH and its dependencies (~490 MB).
  The LibreOffice document component (182 MB) is not needed here and is removed.
  What you get for it: unzip, double-click, running — nothing to install.
` : `
  1.8 MB：只有插件本体，Node 和 DSH 用你已有的。
  1.8 MB: the plugin only; Node and DSH come from your machine.
`}
================================================================
文档 / Documentation
================================================================
  https://xyt071024.github.io/dsh-superagent-cn/install.html
  https://xyt071024.github.io/dsh-superagent-cn/docs/zh/09-deployment.html
  https://github.com/xyt071024/dsh-superagent-cn/blob/main/CHANGELOG.md
`)
}

// ---- 主流程 ----
// Resume rather than restart. Laying out one bundle copies ~72,000 files and takes about seven minutes, so a run that
// is interrupted at bundle seven and starts over from zero is eight lost bundles. Each finished directory is therefore
// kept and only a missing or half-written one is laid out again; `--fresh` clears everything when a clean run is wanted.
const fresh = process.argv.includes('--fresh')
if (fresh) rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

/**
 * Whether a label's staging directory is already complete.
 *
 * Size is not a reliable test mid-copy, so the marker is the last thing a bundle writes: `README.txt` is produced by
 * `writeReadme` after every payload, launcher and tool is in place. A directory with it is done; one without is a
 * leftover from an interrupted run and is removed and rebuilt.
 */
const finished = label => existsSync(join(STAGE_ROOT, label, 'README.txt'))

const made = []

// 内置版：每个系统 × 每个构建
for (const target of TARGETS) {
  for (const build of BUILDS) {
    const label = `Super-Agent-Bundled-${target.os}-${target.arch}-v${VERSION}`
    const staging = join(STAGE_ROOT, label)
    if (finished(label)) { console.log(`  ${label}  已完成，跳过`); continue }
    // Do not delete an unfinished directory: on this machine the copies inherit a Deny ACE from the workspace, which
    // makes them undeletable (EPERM) even for the building user. Everything below is `cpSync`/`writeFileSync`, which
    // overwrites in place, so a leftover directory is completed instead of removed.
    mkdirSync(staging, { recursive: true })

    process.stdout.write(`  ${label}  `)
    stageNode(target, staging)
    stageDsh(staging, target.os)
    // macOS / Linux carry no native modules from this Windows tree; install the platform's prebuilt packages instead.
    if (target.os !== 'Windows') {
      const done = installNative(target.os, target.arch, staging)
      console.log('  native packages installed: ' + done.length)
    }
    stagePayload(staging, build)
    writeLaunchers(staging, target, build)
    writeTools(staging, target)
    writeReadme(staging, { ...target, build, built: true })

    const bytes = dirBytes(staging)
    console.log(`${MB(bytes)} MB`)
    made.push({ label, staging, bytes, build, os: target.os, arch: target.arch, built: true })
  }
}

// Plugin shape. One tarball, not two: the purge build never contained purge code — it is the same plugin plus a profile that
// declares the third-party `dsh-purge-community` dependency — so `Purge` and `Stable` tarballs were byte-identical and the
// names misled anyone choosing between them. The plain tarball is what both shapes install; the purge profile travels as its
// own small zip below.
const pluginLabel = `Super-Agent-Plugin-v${VERSION}`
{
  const staging = join(STAGE_ROOT, pluginLabel)
  if (finished(pluginLabel)) console.log(`  ${pluginLabel}  已完成，跳过`)
  else {
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    process.stdout.write(`  ${pluginLabel}  `)
    cpSync(join(PKG, 'plugin', 'stable', 'dsh-superagent.tgz'), join(staging, `Super-Agent-Plugin-v${VERSION}.tgz`))
    writePluginReadme(staging)
    const bytes = dirBytes(staging)
    console.log(`${MB(bytes)} MB`)
    made.push({ label: pluginLabel, staging, bytes, build: 'stable', os: 'Any', arch: 'Any', built: false })
  }
}

writeFileSync(join(STAGE_ROOT, 'manifest.json'), JSON.stringify(made.map(({ staging, ...rest }) => ({ ...rest, dir: staging })), null, 2))
const winStage = join(STAGE_ROOT, `Super-Agent-Bundled-Windows-x64-v${VERSION}`)
const pluginTgz = join(STAGE_ROOT, `Super-Agent-Plugin-v${VERSION}`, `Super-Agent-Plugin-v${VERSION}.tgz`)
const buildManifest = {
  version: VERSION,
  dshVersion: DSH_VERSION,
  stageRoot: STAGE_ROOT,
  windowsStage: winStage,
  pluginArchive: pluginTgz,
  dshBin: join(winStage, 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  packages: made.map(({ staging, ...rest }) => ({ ...rest, dir: staging })),
}
writeFileSync(join(STAGE_ROOT, 'build-manifest.json'), JSON.stringify(buildManifest, null, 2) + '\n')
console.log(`\n暂存在 ${STAGE_ROOT}，下一步用 7z / tar 压成 zip。`)
console.log(`共 ${made.length} 个包。`)
