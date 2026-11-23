#!/usr/bin/env bash
# Super Agent installer for macOS and Linux.
#
# Usage: curl -fsSL https://xyt071024.github.io/dsh-superagent-cn/install.sh | bash
#
# Safe to pipe into bash: nothing is written outside the profile directory, no existing configuration is overwritten, and
# a failure stops the run instead of printing "done" over a broken install.

set -euo pipefail

# Named SA_* because PROFILE is a common shell variable and this script may be sourced in a shell the user keeps.
SA_PROFILE="${SUPERAGENT_PROFILE:-superagent}"
SA_PURGE=0
# Empty means "ask the release which file this run installs" (step 4). A value here is an explicit override for a
# mirror or a package built by hand, and it is used as given.
SA_BUNDLE="${SUPERAGENT_BUNDLE:-}"
# No shared default port: an install every user puts on 3082 is a port a scanner knows in advance, and two such installs
# cannot coexist. A random port in a documented range is found by reading this run's output, not by guessing.
SA_PORT=""
if [ -n "${SUPERAGENT_PORT:-}" ]; then SA_PORT="$SUPERAGENT_PORT"; fi
SA_PORT_RANGE_FROM=3082
SA_PORT_RANGE_TO=3182

for arg in "$@"; do
  case "$arg" in
    --purge) SA_PURGE=1 ;;
    --profile=*) SA_PROFILE="${arg#*=}" ;;
    --port=*) SA_PORT="${arg#*=}" ;;
    --help|-h)
      cat <<'HELP'
Super Agent installer

  --purge             install the purge build instead of the stable one
  --profile=NAME      profile name (default: superagent)
  --port=PORT         panel port (a free port in 3082-3182 is chosen when this is omitted)
HELP
      exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

info() { printf '  %s\n' "$1"; }
ok()   { printf 'OK  %s\n' "$1"; }
warn() { printf '!   %s\n' "$1"; }
die()  { printf 'X   %s\n' "$1" >&2; exit 1; }

echo ""
echo "Super Agent installer"
echo "---------------------"
echo ""

# ---------- 1. environment ----------
echo "[1/6] Checking the environment"

command -v node >/dev/null || die "Node.js is not installed. Install Node.js 22.19 or newer from https://nodejs.org and run this again."
SA_NODE="$(node -v | tr -d 'v')"
SA_MAJOR="${SA_NODE%%.*}"
SA_REST="${SA_NODE#*.}"
SA_MINOR="${SA_REST%%.*}"
# A major-only test passes 22.0, which the plugin cannot start on.
if [ "$SA_MAJOR" -lt 22 ] || { [ "$SA_MAJOR" -eq 22 ] && [ "$SA_MINOR" -lt 19 ]; }; then
  die "Node.js $SA_NODE is too old. Node.js 22.19 or newer, or 24+, is required."
fi
ok "Node.js v$SA_NODE"

command -v dsh >/dev/null || die "dsh was not found. Install DeepSeek Harness first: npm i -g @deepseek-ai/dsh"
ok "dsh found"

# curl downloads the package; a missing one fails here rather than mid-install.
command -v curl >/dev/null || die "curl is required to download the package."
command -v tar  >/dev/null || die "tar is required to unpack the package."

# ---------- 2. port ----------
echo ""
# lsof and ss differ per platform; whichever exists answers the question, and neither existing is not an error.
sa_port_busy() {
  local port="$1" busy=""
  if command -v lsof >/dev/null; then
    busy="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tail -n +2 | head -1)"
  elif command -v ss >/dev/null; then
    busy="$(ss -lntH "sport = :$port" 2>/dev/null | head -1)"
  fi
  [ -n "$busy" ]
}

if [ -z "$SA_PORT" ]; then
  # Another install of this must not collide with this one, so try random ports rather than a fixed default.
  sa_try=0
  while [ "$sa_try" -lt 40 ]; do
    SA_PORT=$(( SA_PORT_RANGE_FROM + (RANDOM % (SA_PORT_RANGE_TO - SA_PORT_RANGE_FROM + 1)) ))
    if ! sa_port_busy "$SA_PORT"; then break; fi
    SA_PORT=""
    sa_try=$(( sa_try + 1 ))
  done
  [ -n "$SA_PORT" ] || die "No free port in $SA_PORT_RANGE_FROM-$SA_PORT_RANGE_TO. Run this again with --port=<free port>."
  info "port $SA_PORT chosen (a free one in $SA_PORT_RANGE_FROM-$SA_PORT_RANGE_TO; pass --port to choose another)"
else
  echo "[2/6] Checking port $SA_PORT"
  sa_port_busy "$SA_PORT" && die "Port $SA_PORT is already in use. Stop it, or run this again without --port to get a free one."
  ok "port $SA_PORT is free"
fi

# ---------- 3. profile ----------
echo ""
echo "[3/6] Preparing the profile"

# The profile directory must be where the `dsh` command will look for it. DSH honours `DSH_HOME` when it is set, and
# falls back to `~/.dsh` otherwise; hard-coding `$HOME/.dsh` wrote the configuration to one place while `dsh plugin add`
# installed the package into another, and the final check then reported the install as incomplete.
SA_ROOT="${DSH_HOME:-$HOME/.dsh}"
SA_DIR="$SA_ROOT/profiles/$SA_PROFILE"
SA_STATE="$SA_ROOT/state/$SA_PROFILE"

# The plugin hands `stateDir` straight to Node's path handling, which on Windows does not understand a MSYS path such
# as `/d/home/...` — the directory is simply never created, and the profile looks installed while all data goes nowhere.
# When this script runs under MSYS/Cygwin (Git Bash, and the bundled bash this project is tested with), convert the path
# to the native form first. Plain Linux and macOS have no `cygpath` and need no conversion.
if command -v cygpath >/dev/null 2>&1; then
  SA_STATE="$(cygpath -m "$SA_STATE")"
  SA_DIR_NATIVE="$(cygpath -m "$SA_DIR")"
else
  SA_DIR_NATIVE="$SA_DIR"
fi
info "state directory: $SA_STATE"
mkdir -p "$SA_DIR"
ok "$SA_DIR"

# ---------- 4. plugin ----------
echo ""
echo "[4/6] Installing the plugin"

# Releases name the package after its version: `Super-Agent-Plugin-v0.3.10.tgz`. An address that says only
# `releases/latest/download/Super-Agent-Plugin.tgz` resolves to the newest tag and then asks that tag for a file it does
# not contain, so every default install answered 404. The file name is read from the release instead.

# Older releases separated the two builds with a segment (`-Stable-` -> `-Purge-`, version intact). From v0.3.6 the
# stable name has no segment, so the segment is inserted before the version. A name of neither shape yields nothing, and
# the caller stops rather than downloading the stable build under a purge label.
sa_purge_name() {
  case "$1" in
    *-Stable-*) printf '%s' "$1" | sed 's/-Stable-/-Purge-/' ;;
    Super-Agent-Plugin-v*.tgz) printf '%s' "$1" | sed 's/^Super-Agent-Plugin-v/Super-Agent-Plugin-Purge-v/' ;;
    *) printf '' ;;
  esac
}

# The pinned address is the fallback for a run that cannot reach the API at all (offline, proxy, rate limit). It names
# one exact asset, so it moves together with the version and never guesses.
SA_PINNED_VERSION='0.3.14'
SA_PINNED_URL="https://github.com/xyt071024/dsh-superagent-cn/releases/download/v$SA_PINNED_VERSION/Super-Agent-Plugin-v$SA_PINNED_VERSION.tgz"
SA_API="https://api.github.com/repos/xyt071024/dsh-superagent-cn/releases/latest"

# Sets SA_ASSET, SA_ASSET_URL and SA_ASSET_ORIGIN for the build this run wants. Deliberately not a subshell: `die`
# called from here has to stop the script the way every other failure does.
sa_resolve_bundle() {
  SA_ASSET=""
  SA_ASSET_URL=""
  SA_ASSET_ORIGIN=""
  if [ -n "$SA_BUNDLE" ]; then
    _sa_leaf="${SA_BUNDLE##*/}"
    SA_ASSET_ORIGIN=given
    if [ "$SA_PURGE" -eq 1 ]; then
      _sa_new="$(sa_purge_name "$_sa_leaf")"
      [ -n "$_sa_new" ] || die "cannot derive a purge package name from $_sa_leaf; pass the exact purge URL or drop --purge"
      SA_ASSET="$_sa_new"
      SA_ASSET_URL="${SA_BUNDLE%/*}/$_sa_new"
    else
      SA_ASSET="$_sa_leaf"
      SA_ASSET_URL="$SA_BUNDLE"
    fi
    return 0
  fi

  _sa_json=""
  # `-A` matters as much as `User-Agent` does on the PowerShell side: the API answers 403 to a request without one, and
  # that then reads as a broken installer rather than the rejected request it is.
  _sa_json="$(curl -fsSL --retry 2 --max-time 20 -A "Super-Agent-Installer" -H "Accept: application/vnd.github+json" "$SA_API" 2>/dev/null)" || _sa_json=""

  # Read once here: the success path reports it, and the no-match path quotes it back.
  _sa_tag="$(printf '%s' "$_sa_json" | grep -oE '"tag_name": *"[^"]*"' | head -n 1 | sed -E 's/.*"([^"]*)"/\1/')" || _sa_tag=""
  if [ -n "$_sa_json" ]; then
    # The patterns are literal so that a purge name can never be matched by the stable one, and the jq regex is kept
    # apart from the grep text patterns because the two syntaxes differ.
    if [ "$SA_PURGE" -eq 1 ]; then
      _sa_re='^Super-Agent-Plugin-Purge-v[0-9.]+\.tgz$'
      _sa_name_pat='"name": *"Super-Agent-Plugin-Purge-v[0-9.]+\.tgz"'
      _sa_url_pat='"browser_download_url": *"[^" ]*/Super-Agent-Plugin-Purge-v[0-9.]+\.tgz"'
    else
      _sa_re='^Super-Agent-Plugin-v[0-9.]+\.tgz$'
      _sa_name_pat='"name": *"Super-Agent-Plugin-v[0-9.]+\.tgz"'
      _sa_url_pat='"browser_download_url": *"[^" ]*/Super-Agent-Plugin-v[0-9.]+\.tgz"'
    fi
    if command -v jq >/dev/null 2>&1; then
      # jq is preferred when present: it reads the payload as JSON instead of as text.
      SA_ASSET="$(printf '%s' "$_sa_json" | jq -r --arg re "$_sa_re" '[.assets[].name | select(test($re))] | first // empty')" || SA_ASSET=""
      if [ -n "$SA_ASSET" ]; then
        SA_ASSET_URL="$(printf '%s' "$_sa_json" | jq -r --arg n "$SA_ASSET" '.assets[] | select(.name == $n) | .browser_download_url')" || SA_ASSET_URL=""
      fi
    fi
    if [ -z "$SA_ASSET_URL" ]; then
      # No jq, or jq found nothing: two quoted strings per asset are all that is needed, and the API writes one of
      # each per line. The sed keeps the last quoted run of the match, which is the name and then the whole URL.
      SA_ASSET="$(printf '%s' "$_sa_json" | grep -oE "$_sa_name_pat" | head -n 1 | sed -E 's/.*"([^"]+)"/\1/')" || SA_ASSET=""
      if [ -n "$SA_ASSET" ]; then
        SA_ASSET_URL="$(printf '%s' "$_sa_json" | grep -oE "$_sa_url_pat" | head -n 1 | sed -E 's/.*"([^"]+)"/\1/')" || SA_ASSET_URL=""
      fi
    fi
    if [ -n "$SA_ASSET_URL" ]; then
      SA_ASSET_ORIGIN="release ${_sa_tag:-unknown}"
      return 0
    fi
  fi

  if [ -n "$_sa_json" ]; then
    # The release was readable and simply has no asset of this shape. Falling back here would hide that: with --purge
    # it means the release publishes no purge build, and the pinned address would fail for exactly the same reason.
    _sa_have="$(printf '%s' "$_sa_json" | grep -oE '"name": *"[^"]*\.tgz"' | sed -E 's/.*"([^"]+)"/\1/' | paste -sd ", " -)"
    if [ "$SA_PURGE" -eq 1 ]; then
      die "release ${_sa_tag:-latest} has no purge package (looked for $_sa_name_pat). Assets present: ${_sa_have:-none}"
    fi
    die "release ${_sa_tag:-latest} has no plugin package (looked for $_sa_name_pat). Assets present: ${_sa_have:-none}"
  fi

  # Nothing resolvable came out of the payload: use the pinned asset. A purge run still stops when the pinned name has
  # no purge form, instead of installing the stable build under a purge label.
  _sa_leaf="${SA_PINNED_URL##*/}"
  SA_ASSET="$_sa_leaf"
  SA_ASSET_URL="$SA_PINNED_URL"
  SA_ASSET_ORIGIN="pinned v$SA_PINNED_VERSION"
  if [ "$SA_PURGE" -eq 1 ]; then
    _sa_new="$(sa_purge_name "$_sa_leaf")"
    [ -n "$_sa_new" ] || die "cannot derive a purge package name for v$SA_PINNED_VERSION"
    SA_ASSET="$_sa_new"
    SA_ASSET_URL="${SA_PINNED_URL%/*}/$_sa_new"
  fi
}

sa_resolve_bundle

SA_WORK="$(mktemp -d)"
# The trap is what makes an interrupted run reversible: nothing survives except the profile.
trap 'rm -rf "$SA_WORK"' EXIT

info "package $SA_ASSET from $SA_ASSET_ORIGIN"
info "downloading $SA_ASSET_URL"
curl -fsSL --retry 3 --max-time 300 -o "$SA_WORK/dsh-superagent.tgz" "$SA_ASSET_URL" \
  || die "download failed: $SA_ASSET_URL"

# A 404 arrives as an HTML or JSON body carrying the status; saved to disk that body is a plausible file which only
# fails later inside `dsh plugin add`. The gzip magic bytes are what a .tgz actually starts with.
SA_MAGIC="$(head -c 2 "$SA_WORK/dsh-superagent.tgz" | od -An -tx1 | tr -d ' \n')"
[ "$SA_MAGIC" = "1f8b" ] \
  || die "the downloaded file is not a gzip package, so $SA_ASSET_URL did not return one"
info "$SA_ASSET  sha256 $( { shasum -a 256 "$SA_WORK/dsh-superagent.tgz" 2>/dev/null || sha256sum "$SA_WORK/dsh-superagent.tgz"; } | cut -d' ' -f1)"

# The package is passed by path: a bare name resolves to whatever the registry calls `dsh-superagent`, which is not this build.
#
# --profile is required, not inferred: `dsh plugin` forwards its arguments to pnpm inside the profile directory, and which
# profile that is comes from the option alone. Without it the command exits with
# "required option '--profile <name>' not specified" and installs nothing — which is exactly what this installer did
# until the flag was added.
dsh plugin --profile "$SA_PROFILE" add "$SA_WORK/dsh-superagent.tgz" \
  || die "dsh plugin add failed; the package download is repeatable from $SA_ASSET_URL"
ok "plugin installed from the downloaded package"

# ---------- 5. configuration ----------
echo ""
echo "[5/6] Writing the configuration"

SA_CONFIG="$SA_DIR/cordis.patch.yml"
# `dsh plugin add` above already initialised the profile, so this file exists by now holding DSH's own empty default
# (`[]`, plus comment lines). Treating "the file exists" as "someone else's install" therefore refused to write our
# settings on every single run: a fresh install ended up with an empty patch layer and Super Agent never loaded.
# The real question is whether the file has entries of its own, so comments and blank lines are stripped first.
SA_MEANINGFUL="$(grep -vE '^[[:space:]]*(#|$)' "$SA_CONFIG" 2>/dev/null | tr -d '[:space:]' || true)"
if [ -f "$SA_CONFIG" ] && [ -n "$SA_MEANINGFUL" ] && [ "$SA_MEANINGFUL" != "[]" ]; then
  # An existing file belongs to another install. Backup and stop: merging YAML by text is how a working profile loses
  # its plugin list, and this script cannot know what the operator added.
  SA_BACKUP="$SA_CONFIG.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$SA_CONFIG" "$SA_BACKUP"
  warn "existing cordis.patch.yml kept as $SA_BACKUP; Super Agent settings were NOT added"
  info "append the block below to that file yourself, or rerun after moving it away:"
  cat <<BLOCK

  - id: dsh-superagent
    config:
      stateDir: $SA_STATE
      isolateEnvironment: true
  - id: dsh-superagent-qq
    disabled: false

BLOCK
else
  cat > "$SA_CONFIG" <<YAML
- id: webserver
  config:
    host: 127.0.0.1
    port: $SA_PORT

# Super Agent. stateDir must be an absolute path; the plugin does not expand ~.
- id: dsh-superagent
  config:
    stateDir: $SA_STATE
    # Keeps the agent PATH and git settings out of process.env, so other plugins never see them.
    isolateEnvironment: true
- id: dsh-superagent-qq
  disabled: false
YAML
  ok "wrote $SA_CONFIG"
fi

# The profile must name the bundles it composes, and `dsh plugin add` only ever adds the plugin's own bundle. Without
# `@deepseek-ai/dsh-web-app`, nothing provides the webserver, session controller, workspace registry or agent presets, so
# every Super Agent component sits in "pending (waiting for services)" and no panel ever appears. This is separate from
# the patch layer above: that one configures components, this one decides which components exist.
SA_PKG="$SA_DIR/package.json"
if [ -f "$SA_PKG" ]; then
  node - "$SA_PKG" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
const bundles = pkg.dsh?.profile?.bundles ?? []
if (!bundles.includes('@deepseek-ai/dsh-web-app')) {
  // After dsh-base and before the plugin, which is the order a working profile uses.
  const at = bundles.indexOf('dsh-superagent')
  bundles.splice(at === -1 ? bundles.length : at, 0, '@deepseek-ai/dsh-web-app')
  pkg.dsh = { ...pkg.dsh, profile: { ...pkg.dsh?.profile, bundles } }
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')
  console.log('  added @deepseek-ai/dsh-web-app to the profile bundles')
}
NODE
  # The plugin was added from a temporary tarball, which stops existing when this script exits. Point the dependency at a
  # copy kept inside the profile so a later `pnpm install` cannot fail on a missing file.
  cp "$SA_WORK/dsh-superagent.tgz" "$SA_DIR/dsh-superagent.tgz"
  node - "$SA_PKG" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
pkg.dependencies = { ...pkg.dependencies, 'dsh-superagent': 'file:./dsh-superagent.tgz' }
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')
NODE
  ok "profile bundles and dependency pinned"
fi

# ---------- 6. verify ----------
echo ""
echo "[6/6] Checking the install"

[ -f "$SA_DIR/node_modules/dsh-superagent/lib/index.js" ] \
  || die "The plugin is not present at $SA_DIR/node_modules/dsh-superagent. The install did not complete; nothing was started."
ok "plugin files present"

echo ""
echo "---------------------"
echo "Start it with:"
echo ""
echo "  dsh --profile $SA_PROFILE"
echo ""
echo "The terminal prints an address with a token; open it to reach the panel."
echo ""
