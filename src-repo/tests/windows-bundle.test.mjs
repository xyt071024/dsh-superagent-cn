import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkgVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version

/**
 * Resolve Windows bundle test inputs from environment variables or a build manifest written by
 * `_build/make-dist.mjs` (never hardcoded to legacy machine-specific 0.3.5 paths).
 */
function resolveWindowsBundleInputs() {
  const manifestCandidates = [
    process.env.SA_BUILD_MANIFEST,
    path.resolve(root, '../_work/_stage/build-manifest.json'),
  ].filter(Boolean)

  let manifest = null
  let manifestPath = null
  for (const candidate of manifestCandidates) {
    if (fs.existsSync(candidate)) {
      manifest = JSON.parse(fs.readFileSync(candidate, 'utf8'))
      manifestPath = candidate
      break
    }
  }

  const stage = process.env.SA_WINDOWS_STAGE || manifest?.windowsStage || ''
  const archive = process.env.SA_PLUGIN_ARCHIVE || manifest?.pluginArchive || ''
  const dsh = process.env.SA_DSH_BIN || manifest?.dshBin || (stage ? path.join(stage, 'runtime/node_modules/@deepseek-ai/dsh/lib/bin.js') : '')
  const nodeBin = process.env.SA_NODE_BIN || (stage && fs.existsSync(path.join(stage, 'node/node.exe')) ? path.join(stage, 'node/node.exe') : process.execPath)
  const runtimeNodeModules = stage ? path.join(stage, 'runtime/node_modules') : ''
  return { manifestPath, manifestVersion: manifest?.version ?? null, stage, archive, dsh, nodeBin, runtimeNodeModules }
}

test('Windows bundle helper scripts and manifest contract are present and guard invalid inputs', () => {
  const prepareScript = path.join(root, 'scripts/prepare-windows-bundle.mjs')
  const bootstrapScript = path.join(root, 'scripts/windows-profile-bootstrap.mjs')
  assert.ok(fs.existsSync(prepareScript), 'missing scripts/prepare-windows-bundle.mjs')
  assert.ok(fs.existsSync(bootstrapScript), 'missing scripts/windows-profile-bootstrap.mjs')

  // Syntax check both scripts without executing them
  for (const script of [prepareScript, bootstrapScript]) {
    const check = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' })
    assert.equal(check.status, 0, check.stderr)
  }

  // Invoking prepare-windows-bundle without args must exit non-zero with usage
  const noArgs = spawnSync(process.execPath, [prepareScript], { encoding: 'utf8' })
  assert.notEqual(noArgs.status, 0)
  assert.match(noArgs.stderr, /Usage: node scripts\/prepare-windows-bundle\.mjs/)

  // If a build manifest is explicitly specified via SA_BUILD_MANIFEST, it must exist and match package.json version
  if (process.env.SA_BUILD_MANIFEST) {
    assert.ok(fs.existsSync(process.env.SA_BUILD_MANIFEST), `SA_BUILD_MANIFEST not found: ${process.env.SA_BUILD_MANIFEST}`)
    const manifest = JSON.parse(fs.readFileSync(process.env.SA_BUILD_MANIFEST, 'utf8'))
    assert.equal(manifest.version, pkgVersion, `Build manifest version ${manifest.version} != package.json ${pkgVersion}`)
  }
})

const inputs = resolveWindowsBundleInputs()
const required = process.env.SA_REQUIRE_WINDOWS_BUNDLE === '1'
const missing = [
  !inputs.stage || !fs.existsSync(inputs.stage) ? `stage (${inputs.stage || 'unset'})` : null,
  !inputs.archive || !fs.existsSync(inputs.archive) ? `archive (${inputs.archive || 'unset'})` : null,
  !inputs.dsh || !fs.existsSync(inputs.dsh) ? `dsh (${inputs.dsh || 'unset'})` : null,
].filter(Boolean)

test(
  'fresh Windows payload installs current plugin and bundled DSH resolves its configuration',
  { skip: !required && missing.length > 0 ? `Windows bundle artifacts not present (${missing.join(', ')}); set SA_BUILD_MANIFEST or SA_WINDOWS_STAGE/SA_PLUGIN_ARCHIVE/SA_DSH_BIN` : false },
  () => {
    if (missing.length > 0) {
      assert.fail(`SA_REQUIRE_WINDOWS_BUNDLE=1 is set, but required Windows bundle artifacts are missing: ${missing.join(', ')}`)
    }
    const { stage, archive, dsh, nodeBin, runtimeNodeModules } = inputs
    const scratch = fs.mkdtempSync(path.join(root, '.windows-bundle-test-'))
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'superagent-dsh-test-'))
    try {
      const bundle = path.join(scratch, 'bundle')
      fs.mkdirSync(bundle)
      fs.cpSync(path.join(stage, 'payload'), path.join(bundle, 'payload'), { recursive: true })
      // Remove pre-unpacked plugin copy from staged payload so prepare-windows-bundle exercises full unpack + vendoring.
      fs.rmSync(path.join(bundle, 'payload/node_modules/dsh-superagent'), { recursive: true, force: true })

      let result = spawnSync(process.execPath, [path.join(root, 'scripts/prepare-windows-bundle.mjs'), bundle, archive], { encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)

      const home = path.join(isolated, 'separate dsh home')
      const env = {
        ...process.env,
        NODE_PATH: '',
        USERPROFILE: path.join(isolated, 'different windows home'),
        DSH_HOME: home,
      }
      const bootstrap = path.join(bundle, 'tools/windows-profile-bootstrap.mjs')
      result = spawnSync(process.execPath, [bootstrap], { encoding: 'utf8', env })
      assert.equal(result.status, 0, result.stderr)

      const target = path.join(home, 'profiles/superagent')
      const patch = path.join(target, 'cordis.patch.yml')
      const installedManifest = path.join(target, 'node_modules/dsh-superagent/package.json')
      assert.ok(fs.existsSync(installedManifest))
      assert.equal(JSON.parse(fs.readFileSync(installedManifest, 'utf8')).version, pkgVersion)

      const pluginRoot = path.join(target, 'node_modules/dsh-superagent')
      for (const name of ['postal-mime', 'proper-lockfile', 'zod']) {
        assert.ok(fs.existsSync(path.join(pluginRoot, 'node_modules', name, 'package.json')), `missing ${name}`)
      }

      result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import {createRequire} from 'node:module'; import {pathToFileURL} from 'node:url';
        import {readFileSync, existsSync, realpathSync} from 'node:fs'; import {join, relative, isAbsolute} from 'node:path';
        const root=process.argv[2], seen=new Set();
        function check(pkg) {
          const manifest=join(pkg,'package.json'), r=createRequire(manifest), data=JSON.parse(readFileSync(manifest));
          for (const name of Object.keys(data.dependencies || {})) {
            const dir=r.resolve.paths(name).map(p=>join(p,name)).find(p=>existsSync(join(p,'package.json')));
            if (!dir) throw Error('Missing dependency '+name);
            const actual=realpathSync(dir), rel=relative(root,actual);
            if (rel.startsWith('..') || isAbsolute(rel)) throw Error('Dependency resolved outside profile: '+actual);
            if (!seen.has(actual)) { seen.add(actual); check(actual); }
          }
        }
        check(root); const r=createRequire(process.argv[1]);
        await import(pathToFileURL(r.resolve('postal-mime')).href); r('proper-lockfile'); r('zod');
      `, path.join(pluginRoot, 'package.json'), pluginRoot], { encoding: 'utf8', env })
      assert.equal(result.status, 0, result.stderr)

      const before = fs.readFileSync(patch, 'utf8')
      assert.ok(before.includes(home.replaceAll('\\', '/')))
      assert.ok(!before.includes('__STATE_DIR__'))
      result = spawnSync(process.execPath, [bootstrap], { encoding: 'utf8', env })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(fs.readFileSync(patch, 'utf8'), before)

      const dshEnv = { ...env, ...(runtimeNodeModules && fs.existsSync(runtimeNodeModules) ? { NODE_PATH: runtimeNodeModules } : {}) }
      result = spawnSync(nodeBin, [dsh, '--profile', 'superagent', '--dump-config'], { encoding: 'utf8', env: dshEnv, timeout: 45_000 })
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /dsh-superagent-qq/)
      assert.match(result.stdout, /dsh-superagent-mail/)
      assert.doesNotMatch(result.stderr, /cannot resolve profile bundle "dsh-superagent"/)

      // A purge-flavored profile must not silently start with a missing dependency.
      const payloadManifest = path.join(bundle, 'payload/profile/package.json')
      const purgeProfile = JSON.parse(fs.readFileSync(payloadManifest, 'utf8'))
      purgeProfile.dsh.profile.bundles.push('dsh-purge-community')
      fs.writeFileSync(payloadManifest, JSON.stringify(purgeProfile))
      const purgeHome = path.join(scratch, 'purge-home')
      result = spawnSync(process.execPath, [bootstrap], { encoding: 'utf8', env: { ...env, DSH_HOME: purgeHome } })
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /requires dsh-purge-community/)
      assert.ok(!fs.existsSync(path.join(purgeHome, 'profiles/superagent')))

      const incompleteHome = path.join(scratch, 'incomplete-home')
      const incomplete = path.join(incompleteHome, 'profiles/superagent')
      fs.mkdirSync(incomplete, { recursive: true })
      fs.writeFileSync(path.join(incomplete, 'keep.txt'), 'existing data')
      result = spawnSync(process.execPath, [bootstrap], { encoding: 'utf8', env: { ...env, DSH_HOME: incompleteHome } })
      assert.notEqual(result.status, 0)
      assert.equal(fs.readFileSync(path.join(incomplete, 'keep.txt'), 'utf8'), 'existing data')
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true })
      fs.rmSync(isolated, { recursive: true, force: true })
    }
  },
)
