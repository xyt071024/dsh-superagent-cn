# Super Agent 一键安装（Windows）
# 用法：irm https://xyt071024.github.io/dsh-superagent-cn/install.ps1 | iex

$ErrorActionPreference = 'Stop'

$Profile = if ($env:SUPERAGENT_PROFILE) { $env:SUPERAGENT_PROFILE } else { 'superagent' }
$Port    = if ($env:SUPERAGENT_PORT)    { $env:SUPERAGENT_PORT }    else { '3082' }

function Info($m) { Write-Host "  $m" }
function Ok($m)   { Write-Host "OK  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "!   $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "X   $m" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "Super Agent 安装程序"
Write-Host "---------------------"
Write-Host ""

# ---------- 1. 检查环境 ----------
Write-Host "[1/5] 检查环境"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "没有找到 Node.js。请先安装 Node.js 22.19+ 或 24+：https://nodejs.org" }

$nodeVer = (& node -v).Trim()
$nodeMajor = [int]($nodeVer -replace '^v(\d+).*', '$1')
if ($nodeMajor -lt 22) { Fail "Node.js 版本太低（当前 $nodeVer），需要 22.19+ 或 24+" }
Ok "Node.js $nodeVer"

$dsh = Get-Command dsh -ErrorAction SilentlyContinue
if (-not $dsh) { Fail "没有找到 DSH。请先安装 DeepSeek Harness：https://github.com/deepseek-ai/deepseek-harness" }
$dshVer = (& dsh --version 2>$null | Select-Object -First 1)
Ok "DSH $dshVer"

# ---------- 2. 建 profile ----------
Write-Host ""
Write-Host "[2/5] 创建独立 profile"

$profileDir = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile"
if (Test-Path $profileDir) {
    Warn "profile '$Profile' 已存在，保留现有配置"
} else {
    & dsh $Profile --from-default-profile web --dump-config > $null 2>&1
    if ($LASTEXITCODE -ne 0) { Fail "创建 profile 失败" }
    Ok "已创建 $profileDir"
}

# ---------- 3. 装插件 ----------
Write-Host ""
Write-Host "[3/5] 安装插件"

& dsh plugin --profile $Profile add dsh-superagent > $null 2>&1
if ($LASTEXITCODE -eq 0) {
    Ok "插件已安装"
} else {
    Warn "插件安装可能失败，请稍后检查：dsh plugin --profile $Profile list"
}

# ---------- 4. 写配置 ----------
Write-Host ""
Write-Host "[4/5] 写入配置"

$stateDir = Join-Path $env:USERPROFILE ".dsh\state\$Profile"
if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }

# stateDir 必须用正斜杠: C:/Users/.../.dsh/state/superagent
$stateDirPosix = $stateDir -replace '\\', '/'

$configFile = Join-Path $profileDir 'cordis.patch.yml'
$config = @"
- id: webserver
  config:
    host: 127.0.0.1
    port: $Port

- id: superagent
  config:
    stateDir: $stateDirPosix
"@

Set-Content -Path $configFile -Value $config -Encoding UTF8 -NoNewline
Ok "配置已写入 $configFile"
Ok "数据目录 $stateDir"

# ---------- 5. 完成 ----------
Write-Host ""
Write-Host "[5/5] 安装完成"
Write-Host ""
Write-Host "---------------------------------------------"
Write-Host ""
Write-Host "  启动方式："
Write-Host ""
Write-Host "    dsh --profile $Profile"
Write-Host ""
Write-Host "  启动后终端会打印一个带 token 的地址，"
Write-Host "  复制到浏览器打开即可。"
Write-Host ""
Write-Host "---------------------------------------------"
Write-Host ""
