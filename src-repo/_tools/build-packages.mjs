/**
 * Builds the four release packages from the working tree.
 *
 * Two shapes 脳 two modes:
 *   plugin  鈥?the npm tarball a person installs into their own DSH profile (`dsh plugin add <tarball>`)
 *   native  鈥?a ready-to-run bundle: the plugin tarball plus a profile that already wires it up, so unzipping and running
 *             the launcher needs no package manager
 * and each in `stable` (as it is) or `purge` (the same code plus the host hardening that lifts DSH's own limits).
 *
 * The purge packages are built from `src/purge/` next to the plugin source, which is a separate, optional tree: a build
 * that never touches it produces a stable package that contains no host patch at all.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
// Redirected for this rebuild: the working tree here is `02-修改后源码`, which carries the current fixes. The old
// `dsh-superagent-prototype` tree in D:\DeepSeekHarness is 104 files behind it and must not be packaged.
const SOURCE = resolve(ROOT, '02-修改后源码')
const OUT = join(ROOT, '_packages')

const MODES = ['stable', 'purge']
const read = path => JSON.parse(readFileSync(path, 'utf8'))
const pkg = read(join(SOURCE, 'package.json'))
const version = pkg.version

const log = message => console.log(`  ${message}`)
/**
 * Runs a command in `cwd`, returning stdout; a failure stops the build rather than shipping a half-made package.
 * `shell` is on because `npx`/`npm` are `.cmd` shims on Windows, which Node cannot spawn directly.
 */
function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
}

/** Builds the plugin tarball once; both shapes reuse it so they cannot drift apart. */
function tarball() {
  log('building the plugin')
  run('npx', ['tsdown'], SOURCE)
  // `npm pack` writes the tarball name on the last line; its packument noise goes to stderr.
  const name = run('npm', ['pack', '--silent'], SOURCE).trim().split('\n').pop().trim()
  if (!name.endsWith('.tgz')) throw new Error(`npm pack did not report a tarball: ${name}`)
  return join(SOURCE, name)
}

/**
 * Copies the plugin's runtime dependencies beside the tarball, transitively.
 *
 * `bundledDependencies` would be the tidy way, but `npm pack` aborts on this tree once `node_modules` is included
 * ("Exit handler never called"), so the installer gets a `node_modules` next to the package instead: `dsh plugin add`
 * resolves them from there, and an offline machine needs no registry at all.
 * The copy is transitive because a first-level package is useless without its own dependencies (`proper-lockfile` needs
 * `graceful-fs`), and a missing one is only discovered at startup on the user's machine.
 * Resolution goes through Node's own algorithm rather than `node_modules/<name>`, because pnpm keeps most packages
 * nested under `.pnpm` and only links the direct dependencies at the top.
 */
function vendor(dir) {
  const seen = new Map()
  const copy = (name, from) => {
    if (seen.has(name)) return
    seen.set(name, from)
    cpSync(from, join(dir, 'node_modules', name), { recursive: true, dereference: true })
    const manifest = read(join(from, 'package.json'))
    // Each dependency is located from the package that declared it, so its own version range is honoured.
    for (const [next, range] of Object.entries(manifest.dependencies ?? {})) copy(next, locate(next, from, range))
  }
  for (const [dependency, range] of Object.entries(pkg.dependencies ?? {})) copy(dependency, locate(dependency, SOURCE, range))
  log(`vendored ${seen.size} packages (direct and transitive)`)
}

/** Finds a package's real directory the way Node would resolve it from `importer`, following pnpm's `.pnpm` layout. */
function locate(name, importer, range = '') {
  // A dependency's own declaration wins over a hoisted copy: `proper-lockfile` needs `signal-exit@3`, whose module shape
  // differs from v4, so taking the workspace root's newer copy produces an import error only on the user's machine.
  const pnpm = join(SOURCE, 'node_modules', '.pnpm')
  if (range && existsSync(pnpm)) {
    const wanted = range.replace(/^[\^~>=<\s]+/, '').split('.')[0]
    const matches = readdirSync(pnpm).filter(entry => entry === name || entry.startsWith(`${name}@`))
      .filter(entry => {
        const version = entry.startsWith(`${name}@`) ? entry.slice(name.length + 1).split('(')[0] : ''
        return version.split('.')[0] === wanted
      })
    if (matches.length) {
      const candidate = join(pnpm, matches[0], 'node_modules', name)
      if (existsSync(join(candidate, 'package.json'))) return candidate
    }
  }
  let current = importer
  for (;;) {
    const candidate = join(current, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  if (existsSync(pnpm)) {
    const match = readdirSync(pnpm).find(entry => entry === name || entry.startsWith(`${name}@`))
    if (match) {
      const candidate = join(pnpm, match, 'node_modules', name)
      if (existsSync(join(candidate, 'package.json'))) return candidate
    }
  }
  throw new Error(`cannot find ${name}${range ? `@${range}` : ''} from ${importer}; run pnpm install in the source tree`)
}

/**
 * A profile that already points at the plugin, so `dsh --profile superagent` starts working after one install.
 *
 * The tarball is copied *into* the profile, which is what lets the profile move: the launcher installs this directory into
 * `~/.dsh/profiles/<name>`, and a dependency path pointing outside it would break the moment it moves.
 */
function profile(dir, { port, stateDir, purge }) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'cordis.yml'), [
    '# dsh profile root. The tree is composed from the bundles in package.json plus cordis.patch.yml.',
    '[]',
    '',
  ].join('\n'))
  writeFileSync(join(dir, 'cordis.patch.yml'), [
    '- id: webserver',
    '  config:',
    '    host: 127.0.0.1',
    // A placeholder: the launcher picks a free port on the machine that installs this, because a shared default is one a
    // scanner knows in advance and collides with a second install.
    '    port: __PORT__',
    '- id: dsh-superagent',
    '  config:',
    // A `~` is not expanded by the plugin, so the launcher rewrites this line with the real home directory on first run.
    '    stateDir: __STATE_DIR__',
    '    # Keeps the agent PATH and git settings out of process.env, so other plugins in this profile never see them.',
    '    isolateEnvironment: true',
    '# The bundle inserts these Sources disabled; turning one on here keeps its own defaults.',
    '- id: dsh-superagent-qq',
    '  disabled: false',
    '- id: dsh-superagent-mail',
    '  disabled: false',
    '',
  ].join('\n'))
  const dependencies = { 'dsh-superagent': 'file:./dsh-superagent.tgz' }
  // The purge build adds the hardening project as a second plugin of the same profile rather than merging its code in.
  if (purge) dependencies['dsh-purge-community'] = 'latest'
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-superagent',
    private: true,
    dependencies,
    dsh: { profile: { bundles: purge
      ? ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-superagent', 'dsh-purge-community']
      : ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-superagent'] } },
  }, null, 2) + '\n')
}

/**
 * The launcher a native bundle ships.
 *
 * DSH looks for a profile by name under `~/.dsh/profiles/<name>`, so the bundle cannot run from wherever it was unzipped:
 * the launcher installs the shipped `profile/` into that directory on first run, then starts it. Installing (rather than
 * pointing DSH at the unzip folder) is what makes the same bundle work from a download folder, a USB stick or Program Files.
 */
function launchers(dir, { profile: name, port, purge }) {
  const install = [
    'set "TARGET=%USERPROFILE%\\.dsh\\profiles\\' + name + '"',
    // Never silently overwrite an existing install: its state directory holds the operator's tickets and settings.
    'if exist "%TARGET%\\package.json" (',
    '  echo A profile named ' + name + ' already exists at "%TARGET%".',
    '  echo Move it away first, or edit start.cmd to use another name, then run this again.',
    '  exit /b 1',
    ')',
    'mkdir "%TARGET%" 2>nul',
    'xcopy /E /I /Y "%~dp0profile\\*" "%TARGET%\\" >nul',
    'pushd "%TARGET%"',
    // The profile ships placeholders because `~` is not expanded and no port suits every machine. Both are written once,
    // here: a fixed port would be a number a scanner knows in advance and would collide with a second install. The message
    // keeps to words cmd will not re-parse: an escaped quote inside the embedded command is a syntax error there.
    'powershell -NoProfile -Command "$f=\'cordis.patch.yml\'; $t=(Get-Content $f -Raw).Replace(\'__STATE_DIR__\', ($env:USERPROFILE -replace \'\\\\\',\'/\') + \'/.dsh/state/' + name + '\'); $port=0; foreach($p in (Get-Random -Minimum 3082 -Maximum 3183), (Get-Random -Minimum 3082 -Maximum 3183), (Get-Random -Minimum 3082 -Maximum 3183)){ if(-not (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)){ $port=$p; break } }; if($port -eq 0){ $port=3082 }; $t.Replace(\'__PORT__\', [string]$port) | Set-Content $f -NoNewline; Write-Host (\'  port \' + $port + \' - recorded in cordis.patch.yml\')"',
    'call npm install --no-audit --no-fund --silent',
    'popd',
  ]
  writeFileSync(join(dir, 'start.cmd'), [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'where node >nul 2>nul || (echo Node.js not found. Install Node.js 22.19 or newer from https://nodejs.org & exit /b 1)',
    'where npm >nul 2>nul || (echo npm not found. Install Node.js 22.19 or newer from https://nodejs.org & exit /b 1)',
    ...install,
    'where dsh >nul 2>nul',
    'if %errorlevel%==0 (',
    `  dsh --profile ${name} --no-open`,
    ') else (',
    // Never a path from the machine that built this: it would only exist on that machine. Point at the global install instead.
    '  echo dsh was not found on PATH. Install DeepSeek Harness: npm i -g @deepseek-ai/dsh',
    '  exit /b 1',
    ')',
    '',
  ].join('\r\n'))
  writeFileSync(join(dir, 'start.sh'), [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'cd "$(dirname "$0")"',
    'command -v node >/dev/null || { echo "Node.js not found. Install Node.js 22.19 or newer from https://nodejs.org"; exit 1; }',
    'command -v npm  >/dev/null || { echo "npm not found. Install Node.js 22.19 or newer from https://nodejs.org"; exit 1; }',
    `TARGET="$HOME/.dsh/profiles/${name}"`,
    // Never silently overwrite an existing install: its state directory holds the operator's tickets and settings.
    'if [ -f "$TARGET/package.json" ]; then',
    `  echo "A profile named ${name} already exists at $TARGET."`,
    '  echo "Move it away first, or edit start.sh to use another name, then run this again."',
    '  exit 1',
    'fi',
    'mkdir -p "$TARGET"',
    'cp -R ./profile/. "$TARGET"/',
    // The profile ships placeholders because `~` is not expanded and no port suits every machine. Both are written once,
    // here: a fixed port would be a number a scanner knows in advance and would collide with a second install.
    `sed -i.bak "s|__STATE_DIR__|$HOME/.dsh/state/${name}|" "$TARGET/cordis.patch.yml" && rm -f "$TARGET/cordis.patch.yml.bak"`,
    'chosen=""',
    'for _try in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do',
    '  _p=$(( 3082 + (RANDOM % 101) ))',
    // lsof and ss differ per platform; whichever exists answers, and neither existing is not an error.
    '  if command -v lsof >/dev/null; then _busy="$(lsof -nP -iTCP:"$_p" -sTCP:LISTEN 2>/dev/null | tail -n +2 | head -1)";',
    '  elif command -v ss >/dev/null; then _busy="$(ss -lntH "sport = :$_p" 2>/dev/null | head -1)"; else _busy=""; fi',
    '  if [ -z "$_busy" ]; then chosen="$_p"; break; fi',
    'done',
    '[ -n "$chosen" ] || chosen=3082',
    'sed -i.bak "s|__PORT__|$chosen|" "$TARGET/cordis.patch.yml" && rm -f "$TARGET/cordis.patch.yml.bak"',
    'echo "  port $chosen (written to $TARGET/cordis.patch.yml)"',
    '( cd "$TARGET" && npm install --no-audit --no-fund --silent )',
    'command -v dsh >/dev/null || { echo "dsh not found. Install DeepSeek Harness: npm i -g @deepseek-ai/dsh"; exit 1; }',
    `exec dsh --profile ${name} --no-open`,
    '',
  ].join('\n'))
  writeFileSync(join(dir, 'README.txt'), [
    purge ? 'Super Agent 鈥?ready-to-run bundle (purge)' : 'Super Agent 鈥?ready-to-run bundle (stable)',
    '',
    '1. Install Node.js 22.19 or newer (https://nodejs.org).',
    '2. Install DeepSeek Harness: npm i -g @deepseek-ai/dsh',
    '3. Run start.cmd (Windows) or ./start.sh (macOS, Linux).',
    '   The first run installs this profile into ~/.dsh/profiles/' + name + ' and its one dependency.',
    `4. The launcher prints the address with its own token (the port is chosen on your machine at first run).`,
    '',
    'The unzip folder can be anywhere: nothing runs from it after the first launch.',
    'To remove everything, delete ~/.dsh/profiles/' + name + '; nothing else is touched.',
    '',
    ...purge ? [
      'PURGE BUILD: this profile also lists dsh-purge-community, which edits the DSH host itself.',
      'Apply the host patch with `dsh purge apply` once, and `dsh purge revert` to undo it. A DSH upgrade can',
      'invalidate the patch until it is re-applied; see purge.md on the documentation site for what it changes.',
      '',
    ] : [],
  ].join('\n'))
}

const built = tarball()
rmSync(OUT, { recursive: true, force: true })

for (const mode of MODES) {
  const purge = mode === 'purge'
  // plugin shape
  const pluginDir = join(OUT, 'plugin', mode)
  mkdirSync(pluginDir, { recursive: true })
  cpSync(built, join(pluginDir, 'dsh-superagent.tgz'))
  vendor(pluginDir)
  if (purge) {
    // The host hardening is a separate, maintained project (`dsh-purge-community`); this package declares it as the one
    // extra step instead of copying its code, so the two never drift and the operator can update it on its own schedule.
    writeFileSync(join(pluginDir, 'INSTALL.txt'), [
      `Super Agent ${version} 鈥?plugin package (purge)`,
      '',
      'This package is Super Agent plus the host hardening that lifts DSH\'s own limits. The hardening is a separate',
      'project, so it is installed as its own step rather than copied in here:',
      '',
      '  1. dsh plugin add ./dsh-superagent.tgz',
      '  2. dsh plugin add dsh-purge-community',
      '  3. dsh purge apply      # applies the host patch; `dsh purge revert` undoes it',
      '',
      'What the hardening changes, and what it costs, is described in purge.md on the documentation site. Read that',
      'before applying it: it edits the DSH host itself, so a DSH upgrade can invalidate the patch until it is re-applied.',
      '',
    ].join('\n'))
  } else {
    writeFileSync(join(pluginDir, 'INSTALL.txt'), [
      `Super Agent ${version} 鈥?plugin package (stable)`,
      '',
      '  dsh plugin add ./dsh-superagent.tgz',
      '',
      'Then add the Sources you want in Settings 鈫?Sources. This package changes nothing outside its own plugin.',
      '',
    ].join('\n'))
  }

  // native shape
  const nativeDir = join(OUT, 'native', mode)
  mkdirSync(join(nativeDir, 'plugin'), { recursive: true })
  mkdirSync(join(nativeDir, 'profile'), { recursive: true })
  cpSync(built, join(nativeDir, 'plugin', 'dsh-superagent.tgz'))
  vendor(join(nativeDir, 'plugin'))
  profile(join(nativeDir, 'profile'), { port: 3082, stateDir: '~/.dsh/state/superagent', purge })
  // The profile names its dependency relatively, so the tarball travels with it into ~/.dsh/profiles/<name>.
  cpSync(built, join(nativeDir, 'profile', 'dsh-superagent.tgz'))
  launchers(nativeDir, { profile: 'superagent', port: 3082, purge })
  log(`${mode}: plugin + native`)
}

rmSync(built, { force: true })
log(`done: ${OUT}`)

