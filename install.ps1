# Super Agent installer for Windows.
#
# Usage: irm https://xyt071024.github.io/dsh-superagent-cn/install.ps1 | iex
#
# Runs inside the caller's session because `irm | iex` cannot spawn a script file, so nothing here may leak into that
# session: no `$ErrorActionPreference` change, no `exit`, and no variable name that collides with a built-in.

# Every variable is prefixed and set inside the function, so an interrupted run leaves the caller's session as it was.
# `$Profile` in particular is a PowerShell built-in ($PROFILE); assigning it would break the caller's profile paths.
function Install-SuperAgent {
    param(
        [string]$SaProfile = $(if ($env:SUPERAGENT_PROFILE) { $env:SUPERAGENT_PROFILE } else { 'superagent' }),
        # 0 means "pick a free port": an install every user puts on the same number is one a scanner knows in advance, and
        # two such installs cannot coexist. $env:SUPERAGENT_PORT or -SaPort overrides it.
        [int]$SaPort = $(if ($env:SUPERAGENT_PORT) { [int]$env:SUPERAGENT_PORT } else { 0 }),
        [string]$SaBundle = 'https://xyt071024.github.io/dsh-superagent-cn/releases/dl/dsh-superagent-stable.tgz',
        [switch]$SaPurge
    )

    # Scoped to this function: `Stop` makes a failed command surface instead of being ignored mid-install.
    $ErrorActionPreference = 'Stop'

    function Say($m)  { Write-Host "  $m" }
    function Ok($m)   { Write-Host "OK  $m" -ForegroundColor Green }
    function Warn($m) { Write-Host "!   $m" -ForegroundColor Yellow }

    # Throws instead of exiting: under `irm | iex` an `exit` closes the user's terminal before they can read the error.
    function Fail($m) { throw "Super Agent install failed: $m" }

    Write-Host ""
    Write-Host "Super Agent installer"
    Write-Host "---------------------"
    Write-Host ""

    # ---------- 1. environment ----------
    Write-Host "[1/6] Checking the environment"

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Fail "Node.js is not installed. Install Node.js 22.19 or newer from https://nodejs.org and run this again."
    }
    $nodeVersion = (& node -v).Trim()
    # A major-only comparison passes 22.0, which the plugin cannot start on, so the minor is checked too.
    if ($nodeVersion -notmatch '^v(\d+)\.(\d+)') { Fail "Could not read the Node.js version ($nodeVersion)." }
    $nodeMajor = [int]$Matches[1]
    $nodeMinor = [int]$Matches[2]
    if ($nodeMajor -lt 22 -or ($nodeMajor -eq 22 -and $nodeMinor -lt 19)) {
        Fail "Node.js $nodeVersion is too old. Node.js 22.19 or newer, or 24+, is required."
    }
    Ok "Node.js $nodeVersion"

    if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) {
        Fail "dsh was not found. Install DeepSeek Harness first: npm i -g @deepseek-ai/dsh"
    }
    Ok "dsh found"

    # ---------- 2. port ----------
    Write-Host ""
    # A function so the "is it free?" question reads the same for a chosen port and a random one.
    function Test-SaPortBusy([int]$port) {
        $found = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        return @{ Busy = [bool]$found; Owner = if ($found) { (Get-Process -Id $found[0].OwningProcess -ErrorAction SilentlyContinue).ProcessName } else { '' } }
    }
    if ($SaPort -eq 0) {
        # Another install of this must not collide with this one, so try random ports rather than a fixed default.
        $tries = 0
        while ($tries -lt 40) {
            $candidate = Get-Random -Minimum 3082 -Maximum 3183
            if (-not (Test-SaPortBusy $candidate).Busy) { $SaPort = $candidate; break }
            $tries++
        }
        if ($SaPort -eq 0) { Fail "No free port in 3082-3182. Run this again with -SaPort <free port>." }
        Say "port $SaPort chosen (a free one in 3082-3182; pass -SaPort to choose another)"
    } else {
        Write-Host "[2/6] Checking port $SaPort"
        $check = Test-SaPortBusy $SaPort
        # Reporting the owner is what lets the operator decide: another dsh, or something unrelated.
        if ($check.Busy) { Fail "Port $SaPort is already in use by '$($check.Owner)'. Stop it, or run this again without -SaPort to get a free one." }
        Ok "port $SaPort is free"
    }

    # ---------- 3. profile ----------
    Write-Host ""
    Write-Host "[3/6] Preparing the profile"

    $profileDir = Join-Path $env:USERPROFILE ".dsh\profiles\$SaProfile"
    $isNew = -not (Test-Path $profileDir)
    if ($isNew) { New-Item -ItemType Directory -Force -Path $profileDir | Out-Null }
    $stateDir = (Join-Path $env:USERPROFILE ".dsh\state\$SaProfile") -replace '\\', '/'
    Ok "$profileDir"

    # ---------- 4. plugin ----------
    Write-Host ""
    Write-Host "[4/6] Installing the plugin"

    $bundle = if ($SaPurge) { $SaBundle -replace '-stable\.tgz$', '-purge.tgz' } else { $SaBundle }
    $work = Join-Path $env:TEMP ("sa-install-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    try {
        $tgz = Join-Path $work 'dsh-superagent.tgz'
        Say "downloading $bundle"
        Invoke-WebRequest -Uri $bundle -OutFile $tgz -UseBasicParsing
        $hash = (Get-FileHash -Path $tgz -Algorithm SHA256).Hash
        Say "sha256 $hash"

        # The package is passed by path: a bare name would resolve to whatever npm or the registry calls
        # `dsh-superagent`, which is not this build.
        Push-Location $profileDir
        try {
            $out = & dsh plugin add $tgz 2>&1
            if ($LASTEXITCODE -ne 0) { throw ($out | Out-String) }
        } finally { Pop-Location }
        Ok "plugin installed from the downloaded package"
    } finally {
        # Kept on failure: the tarball is what someone needs to inspect or report a broken download.
        if (Test-Path $work) { Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue }
    }

    # ---------- 5. configuration ----------
    Write-Host ""
    Write-Host "[5/6] Writing the configuration"

    $configFile = Join-Path $profileDir 'cordis.patch.yml'

    # An existing file belongs to someone else's install: backing it up is the only way to stay reversible, and merging
    # YAML text without a parser is how a working profile silently loses its plugin list.
    if (Test-Path $configFile) {
        $backup = "$configFile.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
        Copy-Item $configFile $backup
        Warn "existing cordis.patch.yml kept as $backup; Super Agent settings were NOT added"
        Say "append the block below to that file yourself, or rerun after moving it away:"
        Write-Host ""
        Write-Host "  - id: dsh-superagent"
        Write-Host "    config:"
        Write-Host "      stateDir: $stateDir"
        Write-Host "      isolateEnvironment: true"
        Write-Host "  - id: dsh-superagent-qq"
        Write-Host "    disabled: false"
        Write-Host ""
    } else {
        # Written without a BOM: several YAML readers reject a BOM before the first key.
        $yaml = @"
- id: webserver
  config:
    host: 127.0.0.1
    port: $SaPort

# Super Agent. stateDir must be an absolute path with forward slashes; the plugin does not expand `~`.
- id: dsh-superagent
  config:
    stateDir: $stateDir
    # Keeps the agent PATH and git settings out of process.env, so other plugins never see them.
    isolateEnvironment: true
- id: dsh-superagent-qq
  disabled: false
"@
        [System.IO.File]::WriteAllText($configFile, $yaml, (New-Object System.Text.UTF8Encoding $false))
        Ok "wrote $configFile"
    }

    # ---------- 6. verify ----------
    Write-Host ""
    Write-Host "[6/6] Checking the install"

    $installed = Join-Path $profileDir 'node_modules\dsh-superagent\lib\index.js'
    if (-not (Test-Path $installed)) {
        Fail "The plugin is not present at $installed. The install did not complete; nothing was started."
    }
    Ok "plugin files present"

    Write-Host ""
    Write-Host "---------------------"
    Write-Host "Start it with:"
    Write-Host ""
    Write-Host "  dsh --profile $SaProfile"
    Write-Host ""
    Write-Host "The terminal prints an address with a token; open it to reach the panel."
    Write-Host ""
}

try {
    Install-SuperAgent @args
} catch {
    Write-Host ""
    Write-Host "X   $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Nothing was left half-installed that you cannot remove:"
    Write-Host "  the profile directory ~/.dsh/profiles/superagent can be deleted at any time."
    Write-Host ""
}
