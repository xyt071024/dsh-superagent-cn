// Usage: node prepare-unix-bundle.mjs <new-stage> <plugin.tgz> <linux|darwin> <x64|arm64> <native-node_modules>
// Build on the target Unix host: Windows chmod cannot guarantee archive permissions.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { checkUnixDependencies } from './unix-platform-check.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [stageArg, archive, platform, arch, modulesArg] = process.argv.slice(2)
if (!stageArg || !archive || !platform || !arch || !modulesArg) throw new Error('Expected stage, archive, platform, architecture and target dependency tree')
if (process.platform !== platform || process.arch !== arch) throw new Error('Build must run on the target Unix platform and architecture')
const stage = fs.realpathSync(stageArg)
const rel = path.relative(fs.realpathSync(root), stage)
if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Stage must be a separate directory inside the working copy')
const modules = fs.realpathSync(modulesArg)
checkUnixDependencies(modules, platform, arch)
const runtime = path.join(stage, 'runtime', 'node_modules')
if (fs.existsSync(runtime)) throw new Error('Runtime already exists; create a fresh staging directory')
const node = path.join(stage, 'node', 'bin', 'node')
if (!fs.statSync(node).isFile()) throw new Error('Bundled Node is missing')
// Refuse a Node executable for a different OS or architecture before installing the payload.
const header = Buffer.alloc(20); const fd = fs.openSync(node, 'r')
try { if (fs.readSync(fd, header, 0, 20, 0) !== 20) throw new Error('Invalid Node executable') } finally { fs.closeSync(fd) }
const correctNode = platform === 'linux'
  ? header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && header[5] === 1 && header.readUInt16LE(18) === 62
  : header.readUInt32LE(0) === 0xfeedfacf && header.readUInt32LE(4) === (arch === 'x64' ? 0x01000007 : 0x0100000c)
if (!correctNode) throw new Error('Bundled Node does not match the target platform')
fs.mkdirSync(path.dirname(runtime), { recursive: true })
// cpSync copies the contents of `modules` into `runtime`, which is runtime/node_modules: the result is
// runtime/node_modules/<package>, not runtime/node_modules/node_modules/<package>. The plugin is therefore where
// NODE_PATH resolution expects it. Verified by tests/unix-bundle.test.mjs and the packaging smoke run.
fs.cpSync(modules, runtime, { recursive: true, dereference: true })
execFileSync(process.execPath, [path.join(root, 'scripts', 'prepare-windows-bundle.mjs'), stage, archive], { stdio: 'inherit' })
const tools = path.join(stage, 'tools')
fs.renameSync(path.join(tools, 'windows-profile-bootstrap.mjs'), path.join(tools, 'unix-profile-bootstrap.mjs'))
fs.rmSync(path.join(stage, 'start.cmd'))
// The launcher only starts the shared bootstrap and then the host: it copies nothing itself, so there is no copy
// destination that can nest a level deeper. Profile setup, reuse and repair all live in the bootstrap script that
// the Windows bundle also ships (renamed below), so both platforms run one implementation.
const start = path.join(stage, 'start.sh')
fs.writeFileSync(start, [
  '#!/bin/sh', 'set -eu', 'cd -P "$(dirname "$0")"',
  'SA_NODE="./node/bin/node"', '[ -x "$SA_NODE" ] || { echo "Bundled Node is missing or not executable" >&2; exit 1; }',
  '"$SA_NODE" ./tools/unix-profile-bootstrap.mjs',
  'NODE_PATH="$(pwd)/runtime/node_modules"; export NODE_PATH',
  'exec "$SA_NODE" ./runtime/node_modules/@deepseek-ai/dsh/lib/bin.js --profile superagent --no-open', ''
].join('\n'), { mode: 0o755 })
fs.chmodSync(start, 0o755)
fs.chmodSync(node, 0o755)
console.log(`Prepared ${platform}-${arch} staging; runtime smoke tests are still required.`)
