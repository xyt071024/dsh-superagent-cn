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
SA_BUNDLE="https://xyt071024.github.io/dsh-superagent-cn/releases/dl/dsh-superagent-stable.tgz"
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

SA_DIR="$HOME/.dsh/profiles/$SA_PROFILE"
SA_STATE="$HOME/.dsh/state/$SA_PROFILE"
mkdir -p "$SA_DIR"
ok "$SA_DIR"

# ---------- 4. plugin ----------
echo ""
echo "[4/6] Installing the plugin"

if [ "$SA_PURGE" -eq 1 ]; then
  SA_BUNDLE="${SA_BUNDLE%-stable.tgz}-purge.tgz"
fi

SA_WORK="$(mktemp -d)"
# The trap is what makes an interrupted run reversible: nothing survives except the profile.
trap 'rm -rf "$SA_WORK"' EXIT

info "downloading $SA_BUNDLE"
curl -fsSL --retry 3 --max-time 300 -o "$SA_WORK/dsh-superagent.tgz" "$SA_BUNDLE" \
  || die "download failed: $SA_BUNDLE"
info "sha256 $( { shasum -a 256 "$SA_WORK/dsh-superagent.tgz" 2>/dev/null || sha256sum "$SA_WORK/dsh-superagent.tgz"; } | cut -d' ' -f1)"

# The package is passed by path: a bare name resolves to whatever the registry calls `dsh-superagent`, which is not this build.
( cd "$SA_DIR" && dsh plugin add "$SA_WORK/dsh-superagent.tgz" ) \
  || die "dsh plugin add failed; the package is still at $SA_WORK/dsh-superagent.tgz for inspection."
ok "plugin installed from the downloaded package"

# ---------- 5. configuration ----------
echo ""
echo "[5/6] Writing the configuration"

SA_CONFIG="$SA_DIR/cordis.patch.yml"
if [ -f "$SA_CONFIG" ]; then
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
