// Repair a newly staged Windows bundle under this workspace; never touches old staging.
// Usage: node scripts/prepare-windows-bundle.mjs <bundle-directory> <fresh-plugin.tgz>
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [bundleArg, tarArg] = process.argv.slice(2)
if (!bundleArg || !tarArg) throw new Error('Usage: node scripts/prepare-windows-bundle.mjs <bundle-directory> <fresh-plugin.tgz>')
const bundle = fs.realpathSync(bundleArg)
const relative = path.relative(fs.realpathSync(root), bundle)
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Bundle must be a separate directory inside the working copy.')
const payload = path.join(bundle, 'payload')
const modules = path.join(payload, 'node_modules')
const dest = path.join(modules, 'dsh-superagent')
if (!fs.existsSync(path.join(payload, 'profile', 'package.json')) || !fs.statSync(modules).isDirectory()) throw new Error('Bundle is missing profile or dependencies.')
if (fs.existsSync(dest)) throw new Error('A plugin already exists here; leave it unchanged and create a fresh stage.')
const tar = path.resolve(tarArg)
const tarExe = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
const names = execFileSync(tarExe, ['-tzf', tar], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
if (!names.includes('package/package.json') || names.some(n => !n.startsWith('package/') || n.split('/').includes('..') || n.includes('\\'))) throw new Error('Unexpected plugin archive paths.')
const sourceManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const archiveManifest = JSON.parse(execFileSync(tarExe, ['-xOzf', tar, 'package/package.json'], { encoding: 'utf8' }))
const dependencyList = p => Object.entries(p.dependencies ?? {}).sort(([a], [b]) => a.localeCompare(b))
if (archiveManifest.name !== 'dsh-superagent' || archiveManifest.version !== sourceManifest.version || JSON.stringify(dependencyList(archiveManifest)) !== JSON.stringify(dependencyList(sourceManifest))) throw new Error('Plugin archive is stale or its production dependencies do not match the working copy.')
fs.mkdirSync(dest)
try {
  execFileSync(tarExe, ['-xzf', tar, '--strip-components', '1', '-C', dest], { stdio: 'pipe' })
  const pkg = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8'))
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
  if (pkg.name !== 'dsh-superagent' || pkg.version !== expected || !fs.existsSync(path.join(dest, 'cordis.patch.yml'))) throw new Error('Plugin identity, version or bundle patch is invalid.')
  // Resolve each package using Node's search order from the declaring package.
  // Put each transitive dependency below its parent to preserve differing versions.
  function vendor(name, importer, destination, ancestors = new Set()) {
    const requireFrom = createRequire(path.join(importer, 'package.json'))
    const search = requireFrom.resolve.paths(name) ?? []
    const found = search.map(dir => path.join(dir, name)).find(dir => fs.existsSync(path.join(dir, 'package.json')))
    if (!found) throw new Error(`Cannot resolve production dependency ${name} from ${importer}`)
    const source = fs.realpathSync(found)
    if (ancestors.has(source)) return // Node finds cyclic dependencies at their ancestor location.
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
    if (manifest.name !== name) throw new Error(`Resolved unexpected package for ${name}`)
    fs.cpSync(source, destination, { recursive: true, dereference: true, filter: p => path.basename(p) !== 'node_modules' })
    const chain = new Set(ancestors).add(source)
    for (const child of Object.keys(manifest.dependencies ?? {})) vendor(child, source, path.join(destination, 'node_modules', child), chain)
  }
  // Vendoring into the plugin itself ensures resolution cannot fall back to stale
  // sibling packages copied by older staging scripts.
  for (const name of Object.keys(pkg.dependencies ?? {})) vendor(name, root, path.join(dest, 'node_modules', name))
  fs.copyFileSync(tar, path.join(payload, 'dsh-superagent.tgz'))
  fs.mkdirSync(path.join(bundle, 'tools'), { recursive: true })
  fs.copyFileSync(path.join(root, 'scripts', 'windows-profile-bootstrap.mjs'), path.join(bundle, 'tools', 'windows-profile-bootstrap.mjs'))
  fs.writeFileSync(path.join(bundle, 'start.cmd'), [
    '@echo off', 'setlocal', 'cd /d "%~dp0"',
    'set "SA_NODE=%~dp0node\\node.exe"',
    'if not exist "%SA_NODE%" (echo Bundled Node is missing. & exit /b 1)',
    '"%SA_NODE%" "%~dp0tools\\windows-profile-bootstrap.mjs"',
    'if errorlevel 1 (echo Profile setup failed. & exit /b 1)',
    'set "NODE_PATH=%~dp0runtime\\node_modules"',
    '"%SA_NODE%" "%~dp0runtime\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" --profile superagent --no-open',
    'exit /b %errorlevel%', ''
  ].join('\r\n'))
  console.log(`Prepared Windows bundle with dsh-superagent ${pkg.version}.`)
} catch (error) {
  fs.rmSync(dest, { recursive: true, force: true })
  throw error
}
