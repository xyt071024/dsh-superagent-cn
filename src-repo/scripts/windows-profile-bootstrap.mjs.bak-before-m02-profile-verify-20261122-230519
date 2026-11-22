// Installed in a Windows bundle as tools/windows-profile-bootstrap.mjs.
// Prepare only a new profile; an existing profile belongs to the user.
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

if (fs.existsSync(target)) {
  if (!fs.existsSync(manifest)) throw new Error(`Profile directory already exists but is incomplete: ${target}. It was left unchanged.`)
  console.log(`Using existing profile without changing it: ${target}`)
} else {
  const source = path.join(bundle, 'payload', 'profile')
  const modules = path.join(bundle, 'payload', 'node_modules')
  const pluginManifest = JSON.parse(fs.readFileSync(path.join(modules, 'dsh-superagent', 'package.json'), 'utf8'))
  if (pluginManifest.name !== 'dsh-superagent') throw new Error('Bundled plugin package is invalid.')
  const profileManifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
  if (profileManifest.dsh?.profile?.bundles?.includes('dsh-purge-community') && !fs.existsSync(path.join(modules, 'dsh-purge-community', 'package.json'))) {
    throw new Error('Purge profile requires dsh-purge-community, but this bundle does not contain it.')
  }
  fs.mkdirSync(profiles, { recursive: true })
  const temp = fs.mkdtempSync(path.join(profiles, '.superagent-install-'))
  try {
    fs.cpSync(source, temp, { recursive: true })
    fs.cpSync(modules, path.join(temp, 'node_modules'), { recursive: true })
    fs.copyFileSync(path.join(bundle, 'payload', 'dsh-superagent.tgz'), path.join(temp, 'dsh-superagent.tgz'))
    const free = port => new Promise(resolve => {
      const server = createServer()
      server.once('error', () => resolve(false))
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
    })
    let port = 0
    for (let p = 3082; p <= 3182 && !port; p++) if (await free(p)) port = p
    if (!port) throw new Error('No free port found in 3082–3182.')
    const patch = path.join(temp, 'cordis.patch.yml')
    const text = fs.readFileSync(patch, 'utf8')
    if (!text.includes('__STATE_DIR__') || !text.includes('__PORT__')) throw new Error('Profile placeholders are missing.')
    const state = path.join(home, 'state', 'superagent').replaceAll('\\', '/')
    // JSON strings are valid YAML scalars, including spaces and special characters.
    fs.writeFileSync(patch, text.replaceAll('__STATE_DIR__', JSON.stringify(state)).replaceAll('__PORT__', String(port)))
    fs.renameSync(temp, target)
    console.log(`Installed new profile in ${target} (port ${port}).`)
  } catch (error) {
    fs.rmSync(temp, { recursive: true, force: true })
    throw error
  }
}
