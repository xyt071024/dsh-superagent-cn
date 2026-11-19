import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stage = 'D:/sa3/_stage/Super-Agent-Bundled-Windows-x64-Stable-v0.3.5'
const archive = path.join(root, 'artifacts/dsh-superagent-0.3.5.tgz')
const dsh = 'D:/DeepSeekHarness/_probe/dsh-min/node_modules/@deepseek-ai/dsh/lib/bin.js'

test('fresh Windows payload installs plugin and DSH resolves its configuration', { skip: !fs.existsSync(archive) || !fs.existsSync(stage) || !fs.existsSync(dsh) }, () => {
  const scratch = fs.mkdtempSync(path.join(root, '.windows-bundle-test-'))
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'superagent-dsh-test-'))
  try {
    const bundle = path.join(scratch, 'bundle')
    fs.mkdirSync(bundle)
    fs.cpSync(path.join(stage, 'payload'), path.join(bundle, 'payload'), { recursive: true })
    let result = spawnSync(process.execPath, [path.join(root, 'scripts/prepare-windows-bundle.mjs'), bundle, archive], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const home = path.join(isolated, 'separate dsh home')
    const env = { ...process.env, NODE_PATH: '', USERPROFILE: path.join(isolated, 'different windows home'), DSH_HOME: home }
    const bootstrap = path.join(bundle, 'tools/windows-profile-bootstrap.mjs')
    result = spawnSync(process.execPath, [bootstrap], { encoding: 'utf8', env })
    assert.equal(result.status, 0, result.stderr)
    const target = path.join(home, 'profiles/superagent')
    const patch = path.join(target, 'cordis.patch.yml')
    assert.ok(fs.existsSync(path.join(target, 'node_modules/dsh-superagent/package.json')))
    const pluginRoot = path.join(target, 'node_modules/dsh-superagent')
    for (const name of ['postal-mime', 'proper-lockfile', 'zod']) assert.ok(fs.existsSync(path.join(pluginRoot, 'node_modules', name, 'package.json')), `missing ${name}`)
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
    result = spawnSync(process.execPath, [dsh, '--profile', 'superagent', '--dump-config'], { encoding: 'utf8', env, timeout: 30000 })
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
})
