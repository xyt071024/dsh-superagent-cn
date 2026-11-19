import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkUnixDependencies } from '../scripts/unix-platform-check.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function native(platform, arch) {
  const data = Buffer.alloc(64)
  if (platform === 'linux') { Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(data); data[5] = 1; data.writeUInt16LE(62, 18) }
  else { data.writeUInt32LE(0xfeedfacf, 0); data.writeUInt32LE(arch === 'x64' ? 0x01000007 : 0x0100000c, 4) }
  return data
}

test('checks target binaries and rejects Windows or wrong architecture', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-platform-check-'))
  try {
    for (const [platform, arch] of [['linux', 'x64'], ['darwin', 'x64'], ['darwin', 'arm64']]) {
      const modules = path.join(temp, `${platform}-${arch}`)
      const names = ['@deepseek-ai/dsh', `@img/sharp-${platform}-${arch}`, `@img/sharp-libvips-${platform}-${arch}`,
        `@koromix/koffi-${platform}-${arch}`, `sherpa-onnx-${platform}-${arch}`,
        `node-addon-require-builtin-${platform}-${arch}${platform === 'linux' ? '-gnu' : ''}`, 'node-pty']
      for (const name of names) {
        const dir = path.join(modules, name); fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name }))
        if (!['@deepseek-ai/dsh', `@img/sharp-libvips-${platform}-${arch}`, 'node-pty'].includes(name)) fs.writeFileSync(path.join(dir, 'addon.node'), native(platform, arch))
      }
      const pty = path.join(modules, 'node-pty', 'prebuilds', `${platform}-${arch}`)
      fs.mkdirSync(pty, { recursive: true }); fs.writeFileSync(path.join(pty, 'pty.node'), native(platform, arch))
      assert.doesNotThrow(() => checkUnixDependencies(modules, platform, arch))
      const bad = path.join(modules, `@koromix/koffi-${platform}-${arch}`, 'addon.node')
      fs.writeFileSync(bad, platform === 'linux' ? Buffer.alloc(64) : native('darwin', arch === 'x64' ? 'arm64' : 'x64'))
      assert.throws(() => checkUnixDependencies(modules, platform, arch), /No matching native binary/)
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})

test('shared bootstrap respects a separate DSH_HOME and preserves an existing profile', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-unix-profile-'))
  try {
    const bundle = path.join(temp, 'bundle'), tools = path.join(bundle, 'tools'), payload = path.join(bundle, 'payload')
    fs.mkdirSync(tools, { recursive: true }); fs.mkdirSync(path.join(payload, 'profile'), { recursive: true })
    fs.mkdirSync(path.join(payload, 'node_modules', 'dsh-superagent'), { recursive: true })
    fs.copyFileSync(path.join(root, 'scripts', 'windows-profile-bootstrap.mjs'), path.join(tools, 'unix-profile-bootstrap.mjs'))
    fs.writeFileSync(path.join(payload, 'profile', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['dsh-superagent'] } } }))
    fs.writeFileSync(path.join(payload, 'profile', 'cordis.patch.yml'), 'state: __STATE_DIR__\nport: __PORT__\n')
    fs.writeFileSync(path.join(payload, 'node_modules', 'dsh-superagent', 'package.json'), JSON.stringify({ name: 'dsh-superagent' }))
    fs.writeFileSync(path.join(payload, 'dsh-superagent.tgz'), 'test fixture')
    const home = path.join(temp, 'isolated dsh home')
    const env = { ...process.env, DSH_HOME: home, HOME: path.join(temp, 'other home') }
    const run = () => spawnSync(process.execPath, [path.join(tools, 'unix-profile-bootstrap.mjs')], { env, encoding: 'utf8' })
    const first = run(); assert.equal(first.status, 0, first.stderr)
    const patch = path.join(home, 'profiles', 'superagent', 'cordis.patch.yml')
    const original = fs.readFileSync(patch, 'utf8'); assert.ok(original.includes(home.replaceAll('\\', '/')))
    const second = run(); assert.equal(second.status, 0, second.stderr); assert.equal(fs.readFileSync(patch, 'utf8'), original)
    assert.ok(!fs.existsSync(path.join(env.HOME, '.dsh')))
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})
