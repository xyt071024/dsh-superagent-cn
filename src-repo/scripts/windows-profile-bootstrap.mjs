// Installed in a bundle as tools/windows-profile-bootstrap.mjs, and renamed to tools/unix-profile-bootstrap.mjs on Unix.
// One file serves both platforms: nothing below depends on how the bundle was packaged.
//
// A new profile is installed whole. A profile the user already has is never rewritten in place: it is reused when its
// plugin is current, and otherwise only node_modules/dsh-superagent is replaced, after the two files that hold the
// user's own settings have been copied aside. Every copy and move is checked; a failed repair puts the old state back.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const bundle = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const configured = process.env.DSH_HOME?.trim()
const expanded = configured === '~' ? os.homedir() : configured?.startsWith('~/') || configured?.startsWith('~\\') ? path.join(os.homedir(), configured.slice(2)) : configured
const home = path.resolve(expanded || path.join(os.homedir(), '.dsh'))
const profiles = path.join(home, 'profiles')
const target = path.join(profiles, 'superagent')
const manifest = path.join(target, 'package.json')

const payload = path.join(bundle, 'payload')
const sourceProfile = path.join(payload, 'profile')
const sourceModules = path.join(payload, 'node_modules')
const sourcePlugin = path.join(sourceModules, 'dsh-superagent')
const PLUGIN = 'dsh-superagent'

const stamp = () => {
  const d = new Date()
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function fail(message) {
  throw new Error(message)
}

function readJson(file, what) {
  if (!fs.existsSync(file)) fail(`${what} is missing: ${file}`)
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    return fail(`${what} is not valid JSON: ${file} (${error.message})`)
  }
}

// What makes a profile usable is not "package.json exists". The host loads the plugin from node_modules, so the entry
// has to be there, its version has to be the one this bundle ships, and the patch layer has to exist for the plugin to
// be configured at all. Checking only package.json is what let a profile with no plugin, or with 0.3.9, start.
function inspectProfile(dir, expectedVersion) {
  const installed = path.join(dir, 'node_modules', PLUGIN)
  const problems = []
  let version
  if (!fs.existsSync(path.join(installed, 'package.json'))) {
    problems.push(`node_modules/${PLUGIN}/package.json is missing`)
  } else {
    try {
      version = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version
      if (version !== expectedVersion) problems.push(`installed plugin is ${version}, this bundle ships ${expectedVersion}`)
    } catch (error) {
      problems.push(`node_modules/${PLUGIN}/package.json is unreadable (${error.message})`)
    }
  }
  if (!fs.existsSync(path.join(installed, 'lib', 'index.js'))) problems.push(`node_modules/${PLUGIN}/lib/index.js is missing`)
  if (!fs.existsSync(path.join(dir, 'cordis.patch.yml'))) problems.push('cordis.patch.yml is missing')
  // A plugin whose own dependencies are absent fails while loading, which looks the same as a missing plugin. The
  // bundle ships them beside it, so checking them here turns that into a repair instead of a crash during start.
  let dependencies = {}
  try { dependencies = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).dependencies ?? {} } catch { /* reported above */ }
  for (const name of Object.keys(dependencies)) {
    if (!fs.existsSync(path.join(dir, 'node_modules', name, 'package.json'))) problems.push(`node_modules/${name} is missing`)
  }
  return { usable: problems.length === 0, problems, version }
}

// The bundle's own copy is checked before it is used for anything: a bundle missing its plugin would otherwise produce
// a profile that looks installed and cannot start.
function readBundledPlugin() {
  const info = readJson(path.join(sourcePlugin, 'package.json'), 'Bundled plugin package')
  if (info.name !== PLUGIN) fail(`Bundled plugin package is invalid: name is ${info.name}`)
  if (!info.version) fail('Bundled plugin package has no version')
  if (!fs.existsSync(path.join(sourcePlugin, 'lib', 'index.js'))) fail(`Bundled plugin entry is missing: ${path.join(sourcePlugin, 'lib', 'index.js')}`)
  const profileInfo = readJson(path.join(sourceProfile, 'package.json'), 'Bundled profile manifest')
  if (profileInfo.dsh?.profile?.bundles?.includes('dsh-purge-community') && !fs.existsSync(path.join(sourceModules, 'dsh-purge-community', 'package.json'))) {
    fail('Purge profile requires dsh-purge-community, but this bundle does not contain it.')
  }
  return info
}

async function freePort() {
  const free = port => new Promise(resolve => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
  for (let p = 3082; p <= 3182; p++) if (await free(p)) return p
  return fail('No free port found in 3082-3182.')
}

// The dependency set is copied by name so a staged plugin is checked with exactly what the bundle ships beside it.
function copyPluginTree(from, to) {
  fs.cpSync(from, to, { recursive: true, dereference: true })
  if (!fs.existsSync(path.join(to, 'package.json'))) fail(`Copy did not produce ${path.join(to, 'package.json')}`)
}

function installFresh(pluginInfo) {
  fs.mkdirSync(profiles, { recursive: true })
  const temp = fs.mkdtempSync(path.join(profiles, '.superagent-install-'))
  try {
    fs.cpSync(sourceProfile, temp, { recursive: true })
    fs.cpSync(sourceModules, path.join(temp, 'node_modules'), { recursive: true })
    fs.copyFileSync(path.join(payload, 'dsh-superagent.tgz'), path.join(temp, 'dsh-superagent.tgz'))
    const patch = path.join(temp, 'cordis.patch.yml')
    const text = fs.readFileSync(patch, 'utf8')
    if (!text.includes('__STATE_DIR__') || !text.includes('__PORT__')) fail('Profile placeholders are missing.')
    const state = path.join(home, 'state', 'superagent').replaceAll('\\', '/')
    return { temp, patch, text, state, version: pluginInfo.version }
  } catch (error) {
    fs.rmSync(temp, { recursive: true, force: true })
    throw error
  }
}

// Repair keeps the user's files. package.json is merged additively (it is JSON, so the operation is exact);
// cordis.patch.yml is YAML and is left untouched rather than merged by text, and the output says so.
function mergeProfileManifest(file, pluginVersion) {
  const info = readJson(file, 'Profile manifest')
  const bundles = Array.isArray(info.dsh?.profile?.bundles) ? [...info.dsh.profile.bundles] : []
  for (const name of ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', PLUGIN]) {
    if (!bundles.includes(name)) bundles.splice(name === PLUGIN ? bundles.length : 0, 0, name)
  }
  info.dsh = { ...info.dsh, profile: { ...info.dsh?.profile, bundles } }
  info.dependencies = { ...info.dependencies, [PLUGIN]: 'file:./dsh-superagent.tgz' }
  fs.writeFileSync(file, JSON.stringify(info, null, 2) + '\n')
  return pluginVersion
}

function repair(pluginInfo) {
  const backup = path.join(target, `.backup-${stamp()}`)
  const nodeModules = path.join(target, 'node_modules')
  const installed = path.join(nodeModules, PLUGIN)
  const aside = path.join(nodeModules, `.${PLUGIN}-replaced-${stamp()}`)
  const backups = []
  for (const name of ['package.json', 'cordis.patch.yml']) {
    const from = path.join(target, name)
    if (!fs.existsSync(from)) continue
    fs.mkdirSync(backup, { recursive: true })
    const to = path.join(backup, name)
    fs.copyFileSync(from, to)
    if (!fs.existsSync(to)) fail(`Backup was not written: ${to}`)
    backups.push([from, to])
  }

  fs.mkdirSync(nodeModules, { recursive: true })
  const stage = fs.mkdtempSync(path.join(profiles, '.superagent-stage-'))
  let staged = false
  let movedAside = false
  try {
    const stagedPlugin = path.join(stage, PLUGIN)
    copyPluginTree(sourcePlugin, stagedPlugin)
    // Validate the staged copy before anything in the profile is touched: identity, version, entry, manifest readable.
    const stagedInfo = readJson(path.join(stagedPlugin, 'package.json'), 'Staged plugin manifest')
    if (stagedInfo.name !== PLUGIN || stagedInfo.version !== pluginInfo.version) fail('Staged plugin identity or version is wrong.')
    if (!fs.existsSync(path.join(stagedPlugin, 'lib', 'index.js'))) fail('Staged plugin entry is missing.')

    // The plugin resolves its dependencies as siblings inside node_modules; a stale profile may not have them at all.
    // Scoped packages are one level deeper (@scope/name), so they are walked rather than skipped: skipping them left
    // the profile unusable with only @scope packages missing, which is exactly the shape of a real bundle's payload.
    for (const entry of fs.readdirSync(sourceModules, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === PLUGIN) continue
      if (entry.name.startsWith('@')) {
        for (const inner of fs.readdirSync(path.join(sourceModules, entry.name), { withFileTypes: true })) {
          if (!inner.isDirectory()) continue
          const from = path.join(sourceModules, entry.name, inner.name)
          const to = path.join(nodeModules, entry.name, inner.name)
          if (!fs.existsSync(path.join(to, 'package.json'))) fs.cpSync(from, to, { recursive: true, dereference: true })
        }
        continue
      }
      const to = path.join(nodeModules, entry.name)
      if (!fs.existsSync(path.join(to, 'package.json'))) fs.cpSync(path.join(sourceModules, entry.name), to, { recursive: true, dereference: true })
    }

    if (fs.existsSync(installed)) {
      fs.renameSync(installed, aside)
      movedAside = true
    }
    fs.renameSync(stagedPlugin, installed)
    staged = true
    if (!fs.existsSync(path.join(installed, 'lib', 'index.js'))) fail('Replaced plugin has no lib/index.js.')

    mergeProfileManifest(manifest, pluginInfo.version)
    fs.copyFileSync(path.join(payload, 'dsh-superagent.tgz'), path.join(target, 'dsh-superagent.tgz'))

    if (movedAside) fs.rmSync(aside, { recursive: true, force: true })
    return backup
  } catch (error) {
    // Put the profile back exactly as it was, then let the failure surface: a launcher that starts a half-repaired
    // profile is worse than one that stops and says what happened.
    if (staged && fs.existsSync(installed)) fs.rmSync(installed, { recursive: true, force: true })
    if (movedAside && fs.existsSync(aside)) {
      try { fs.renameSync(aside, installed) } catch { /* the throw below reports the repair failure */ }
    }
    for (const [from, to] of backups) {
      try { fs.copyFileSync(to, from) } catch { /* the throw below reports the repair failure */ }
    }
    throw new Error(`Repair failed, the profile was left as it was: ${error.message}`)
  } finally {
    fs.rmSync(stage, { recursive: true, force: true })
  }
}

const pluginInfo = readBundledPlugin()

if (!fs.existsSync(target)) {
  const staged = installFresh(pluginInfo)
  try {
    const port = await freePort()
    // JSON strings are valid YAML scalars, including spaces and special characters.
    const text = staged.text.replaceAll('__STATE_DIR__', JSON.stringify(staged.state)).replaceAll('__PORT__', String(port))
    fs.writeFileSync(staged.patch, text)
    const check = inspectProfile(staged.temp, pluginInfo.version)
    if (!check.usable) fail(`Staged profile is not usable: ${check.problems.join('; ')}`)
    fs.renameSync(staged.temp, target)
    console.log(`Installed new profile in ${target} (port ${port}).`)
  } catch (error) {
    fs.rmSync(staged.temp, { recursive: true, force: true })
    throw error
  }
} else if (!fs.existsSync(manifest)) {
  // Nothing here says what the profile is meant to contain, so there is no safe way to keep it and no safe way to
  // overwrite it: report it and leave every byte alone.
  fail(`Profile directory already exists but is incomplete: ${target}. It was left unchanged.`)
} else {
  const expected = pluginInfo.version
  const state = inspectProfile(target, expected)
  if (state.usable) {
    console.log(`Using existing profile without changing it: ${target} (plugin ${state.version}).`)
  } else {
    console.log(`Profile at ${target} needs repair: ${state.problems.join('; ')}.`)
    const backup = repair(pluginInfo)
    const after = inspectProfile(target, expected)
    if (!after.usable) fail(`Repair did not make the profile usable: ${after.problems.join('; ')}`)
    console.log(`Upgraded ${PLUGIN} to ${expected} in ${target}.`)
    console.log(`  user settings kept: package.json merged additively, cordis.patch.yml left as it was (backup ${backup}).`)
  }
}
