// Self-test for scripts/windows-profile-bootstrap.mjs, which ships as tools/windows-profile-bootstrap.mjs and is renamed
// to tools/unix-profile-bootstrap.mjs on Unix.
//
// Usage: node scripts/profile-bootstrap-selftest.mjs
//
// Every case runs against a throwaway DSH_HOME: the real ~/.dsh is never read or written. The bundle each case uses is
// assembled in a temp directory from the files this repository ships, so no build or network access is involved.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const NL = String.fromCharCode(10)
const scripts = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scripts, '..')
const bootstrap = path.join(scripts, 'windows-profile-bootstrap.mjs')
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version

const results = []
const say = line => console.log(line)
const json = value => JSON.stringify(value, null, 2) + NL
const digest = file => (fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null)
const readVersion = profile => {
  const file = path.join(profile, 'node_modules', 'dsh-superagent', 'package.json')
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).version : null
}

/** Assemble a bundle shaped like the shipped payload, from the files in this repository. */
function makeBundle(base, pluginVersion, extraDependencies = {}) {
  const bundle = path.join(base, 'bundle')
  const payload = path.join(bundle, 'payload')
  const plugin = path.join(payload, 'node_modules', 'dsh-superagent')
  fs.mkdirSync(path.join(payload, 'profile'), { recursive: true })
  fs.mkdirSync(path.join(plugin, 'lib'), { recursive: true })
  fs.mkdirSync(path.join(bundle, 'tools'), { recursive: true })
  fs.copyFileSync(bootstrap, path.join(bundle, 'tools', 'windows-profile-bootstrap.mjs'))
  fs.writeFileSync(path.join(payload, 'profile', 'package.json'), json({
    name: 'dsh-profile-superagent',
    private: true,
    dependencies: { 'dsh-superagent': 'file:./dsh-superagent.tgz' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-superagent'] } },
  }))
  fs.writeFileSync(path.join(payload, 'profile', 'cordis.patch.yml'), [
    '- id: webserver',
    '  config:',
    '    host: 127.0.0.1',
    '    port: __PORT__',
    '- id: dsh-superagent',
    '  config:',
    '    stateDir: __STATE_DIR__',
    '    isolateEnvironment: true',
    '',
  ].join(NL))
  fs.writeFileSync(path.join(plugin, 'package.json'), json({ name: 'dsh-superagent', version: pluginVersion, main: 'lib/index.js', dependencies: extraDependencies }))
  fs.writeFileSync(path.join(plugin, 'lib', 'index.js'), 'export default {}' + NL)
  fs.writeFileSync(path.join(payload, 'dsh-superagent.tgz'), 'not a real tarball')
  for (const name of Object.keys(extraDependencies)) {
    fs.mkdirSync(path.join(payload, 'node_modules', name), { recursive: true })
    fs.writeFileSync(path.join(payload, 'node_modules', name, 'package.json'), json({ name, version: '1.0.0' }))
    if (name.includes('/')) {
      fs.mkdirSync(path.join(payload, 'node_modules', path.dirname(name)), { recursive: true })
    }
  }
  return bundle
}

/** Run the bootstrap the way start.cmd and start.sh do, with DSH_HOME pointing at the case's own home. */
function run(bundle, home) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(bundle, 'tools', 'windows-profile-bootstrap.mjs')], {
      env: { ...process.env, DSH_HOME: home },
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return { code: 0, out: stdout }
  } catch (error) {
    return { code: error.status ?? 1, out: String(error.stdout ?? '') + String(error.stderr ?? '') }
  }
}

const record = (name, pass, detail) => {
  results.push({ name, pass })
  say((pass ? 'PASS  ' : 'FAIL  ') + name)
  for (const line of String(detail).trim().split(NL)) say('        ' + line)
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-selftest-'))
const fresh = () => {
  const base = fs.mkdtempSync(path.join(work, 'case-'))
  fs.mkdirSync(path.join(base, 'home'), { recursive: true })
  return base
}

try {
  // 1. first run installs the profile
  {
    const base = fresh()
    const bundle = makeBundle(base, version)
    const home = path.join(base, 'home', '.dsh')
    const r = run(bundle, home)
    const profile = path.join(home, 'profiles', 'superagent')
    const pass = r.code === 0 && readVersion(profile) === version && fs.existsSync(path.join(profile, 'cordis.patch.yml'))
    record('new install', pass, 'exit=' + r.code + ' installed=' + readVersion(profile) + ' expected=' + version + NL + r.out)
  }

  // 2. second run reuses the profile and changes nothing at all
  {
    const base = fresh()
    const bundle = makeBundle(base, version)
    const home = path.join(base, 'home', '.dsh')
    run(bundle, home)
    const profile = path.join(home, 'profiles', 'superagent')
    const before = { pkg: digest(path.join(profile, 'package.json')), patch: digest(path.join(profile, 'cordis.patch.yml')), mtime: fs.statSync(profile).mtimeMs }
    const r = run(bundle, home)
    const after = { pkg: digest(path.join(profile, 'package.json')), patch: digest(path.join(profile, 'cordis.patch.yml')), mtime: fs.statSync(profile).mtimeMs }
    const pass = r.code === 0 && /Using existing profile without changing it/.test(r.out)
      && before.pkg === after.pkg && before.patch === after.patch && before.mtime === after.mtime
    record('second run reuses, no change', pass,
      'exit=' + r.code + ' package.json same=' + (before.pkg === after.pkg) + ' cordis.patch.yml same=' + (before.patch === after.patch) + NL + r.out)
  }

  // 3. an older plugin is upgraded in place and the user's own settings survive
  {
    const base = fresh()
    const bundle = makeBundle(base, version)
    const home = path.join(base, 'home', '.dsh')
    run(bundle, home)
    const profile = path.join(home, 'profiles', 'superagent')
    const pkgFile = path.join(profile, 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
    pkg.dsh.profile.bundles.push('user-own-bundle')
    fs.writeFileSync(pkgFile, json(pkg))
    fs.writeFileSync(path.join(profile, 'node_modules', 'dsh-superagent', 'package.json'),
      json({ name: 'dsh-superagent', version: '0.3.9', main: 'lib/index.js' }))
    const patchBefore = digest(path.join(profile, 'cordis.patch.yml'))
    const r = run(bundle, home)
    const merged = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
    const keptUser = merged.dsh.profile.bundles.includes('user-own-bundle')
    const patchSame = digest(path.join(profile, 'cordis.patch.yml')) === patchBefore
    const pass = r.code === 0 && readVersion(profile) === version && keptUser && patchSame
    record('old version upgraded, user config kept', pass,
      'exit=' + r.code + ' now=' + readVersion(profile) + ' user-own-bundle kept=' + keptUser + ' patch untouched=' + patchSame + NL + r.out)
  }

  // 4. a profile with no plugin at all is repaired
  {
    const base = fresh()
    const bundle = makeBundle(base, version)
    const home = path.join(base, 'home', '.dsh')
    const profile = path.join(home, 'profiles', 'superagent')
    fs.mkdirSync(profile, { recursive: true })
    fs.copyFileSync(path.join(bundle, 'payload', 'profile', 'package.json'), path.join(profile, 'package.json'))
    fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), '# the user wrote this' + NL)
    const r = run(bundle, home)
    const pass = r.code === 0 && readVersion(profile) === version
      && fs.existsSync(path.join(profile, 'node_modules', 'dsh-superagent', 'lib', 'index.js'))
    record('missing plugin repaired', pass, 'exit=' + r.code + ' now=' + readVersion(profile) + NL + r.out)
  }

  // 5. a plugin whose own dependency is gone is repaired too
  {
    const base = fresh()
    const bundle = makeBundle(base, version, { zod: '*' })
    const home = path.join(base, 'home', '.dsh')
    run(bundle, home)
    const profile = path.join(home, 'profiles', 'superagent')
    // Remove the sibling the plugin declares: loading it would fail, which looks exactly like a missing plugin.
    fs.rmSync(path.join(profile, 'node_modules', 'zod'), { recursive: true, force: true })
    const patchBefore = digest(path.join(profile, 'cordis.patch.yml'))
    const r = run(bundle, home)
    const restored = fs.existsSync(path.join(profile, 'node_modules', 'zod', 'package.json'))
    const pass = r.code === 0 && restored && digest(path.join(profile, 'cordis.patch.yml')) === patchBefore
    record('missing dependency repaired', pass,
      'exit=' + r.code + ' zod restored=' + restored + ' patch untouched=' + (digest(path.join(profile, 'cordis.patch.yml')) === patchBefore) + NL + r.out)
  }

  // 5b. a scoped sibling dependency (@scope/name) is restored too: the shipped payload has one.
  {
    const base = fresh()
    const bundle = makeBundle(base, version, { '@tencent-connect/qqbot-nodejs': '*' })
    const home = path.join(base, 'home', '.dsh')
    run(bundle, home)
    const profile = path.join(home, 'profiles', 'superagent')
    fs.rmSync(path.join(profile, 'node_modules', '@tencent-connect'), { recursive: true, force: true })
    const r = run(bundle, home)
    const restored = fs.existsSync(path.join(profile, 'node_modules', '@tencent-connect', 'qqbot-nodejs', 'package.json'))
    const pass = r.code === 0 && restored
    record('scoped dependency restored', pass, 'exit=' + r.code + ' restored=' + restored + NL + r.out)
  }

  // 6. a profile with no package.json is refused and left byte-identical
  {
    const base = fresh()
    const bundle = makeBundle(base, version)
    const home = path.join(base, 'home', '.dsh')
    const profile = path.join(home, 'profiles', 'superagent')
    fs.mkdirSync(profile, { recursive: true })
    fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), '# keep me' + NL)
    const before = { patch: digest(path.join(profile, 'cordis.patch.yml')), entries: fs.readdirSync(profile).sort().join(',') }
    const r = run(bundle, home)
    const after = { patch: digest(path.join(profile, 'cordis.patch.yml')), entries: fs.readdirSync(profile).sort().join(',') }
    const pass = r.code !== 0 && /incomplete/.test(r.out) && before.patch === after.patch && before.entries === after.entries
    record('incomplete profile refused, unchanged', pass,
      'exit=' + r.code + ' same files=' + (before.entries === after.entries) + ' patch untouched=' + (before.patch === after.patch) + NL + r.out)
  }

  // 7. a bundle that is missing its own plugin never produces a profile
  {
    const base = fresh()
    const bundle = makeBundle(base, version)
    fs.rmSync(path.join(bundle, 'payload', 'node_modules', 'dsh-superagent', 'lib', 'index.js'))
    const home = path.join(base, 'home', '.dsh')
    const r = run(bundle, home)
    const profile = path.join(home, 'profiles', 'superagent')
    const pass = r.code !== 0 && !fs.existsSync(profile)
    record('bundle without plugin entry refused', pass, 'exit=' + r.code + ' profile created=' + fs.existsSync(profile) + NL + r.out)
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}

const failed = results.filter(r => !r.pass)
say('')
say(results.length - failed.length + '/' + results.length + ' passed')
if (failed.length) {
  say('failed: ' + failed.map(r => r.name).join('; '))
  process.exitCode = 1
}