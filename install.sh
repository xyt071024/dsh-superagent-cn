#!/usr/bin/env bash
# Super Agent 一键安装（macOS / Linux）
# 用法：curl -fsSL https://xyt071024.github.io/dsh-superagent-cn/install.sh | bash

set -euo pipefail

PROFILE="${SUPERAGENT_PROFILE:-superagent}"
PORT="${SUPERAGENT_PORT:-3082}"
STATE_SUFFIX=".dsh/state/${PROFILE}"

info()  { printf '  %s\n' "$*"; }
ok()    { printf '✓ %s\n' "$*"; }
warn()  { printf '! %s\n' "$*" >&2; }
fail()  { printf '✗ %s\n' "$*" >&2; exit 1; }

echo ""
echo "Super Agent 安装程序"
echo "─────────────────────"
echo ""

# ---------- 1. 检查环境 ----------
echo "[1/5] 检查环境"

command -v node >/dev/null 2>&1 || fail "没有找到 Node.js。请先安装 Node.js 22.19+ 或 24+：https://nodejs.org"
NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 22 ]; then
  fail "Node.js 版本太低（当前 $(node -v)），需要 22.19+ 或 24+"
fi
ok "Node.js $(node -v)"

command -v dsh >/dev/null 2>&1 || fail "没有找到 DSH。请先安装 DeepSeek Harness：https://github.com/deepseek-ai/deepseek-harness"
ok "DSH $(dsh --version 2>/dev/null | head -1)"

# ---------- 2. 建 profile ----------
echo ""
echo "[2/5] 创建独立 profile"

PROFILE_DIR="$HOME/.dsh/profiles/$PROFILE"
if [ -d "$PROFILE_DIR" ]; then
  warn "profile '$PROFILE' 已存在，保留现有配置"
else
  dsh "$PROFILE" --from-default-profile web --dump-config > /dev/null 2>&1 || fail "创建 profile 失败"
  ok "已创建 $PROFILE_DIR"
fi

# ---------- 3. 装插件 ----------
echo ""
echo "[3/5] 安装插件"

if dsh plugin --profile "$PROFILE" add dsh-superagent > /dev/null 2>&1; then
  ok "插件已安装"
else
  warn "插件安装可能失败，请稍后检查：dsh plugin --profile $PROFILE list"
fi

# ---------- 4. 写配置 ----------
echo ""
echo "[4/5] 写入配置"

STATE_DIR="$HOME/$STATE_SUFFIX"
mkdir -p "$STATE_DIR"

CONFIG_FILE="$PROFILE_DIR/cordis.patch.yml"
cat > "$CONFIG_FILE" <<EOF
- id: webserver
  config:
    host: 127.0.0.1
    port: $PORT

- id: superagent
  config:
    stateDir: $STATE_DIR
EOF

ok "配置已写入 $CONFIG_FILE"
ok "数据目录 $STATE_DIR"

# ---------- 5. 完成 ----------
echo ""
echo "[5/5] 安装完成"
echo ""
echo "─────────────────────────────────────────────"
echo ""
echo "  启动方式："
echo ""
echo "    dsh --profile $PROFILE"
echo ""
echo "  启动后终端会打印一个带 token 的地址，"
echo "  复制到浏览器打开即可。"
echo ""
echo "─────────────────────────────────────────────"
echo ""
