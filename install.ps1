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
        # Empty means "ask the release which file this run installs" (step 4). A value here is an explicit override
        # for a mirror or a package built by hand, and it is used as given.
        [string]$SaBundle = $(if ($env:SUPERAGENT_BUNDLE) { $env:SUPERAGENT_BUNDLE } else { '' }),
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

    $dshRoot = if ($env:DSH_HOME -and $env:DSH_HOME.Trim()) { $env:DSH_HOME.Trim() } else { Join-Path $env:USERPROFILE '.dsh' }
    $profileDir = Join-Path $dshRoot "profiles\$SaProfile"
    $isNew = -not (Test-Path $profileDir)
    if ($isNew) { New-Item -ItemType Directory -Force -Path $profileDir | Out-Null }
    $stateDir = (Join-Path $dshRoot "state\$SaProfile") -replace '\\', '/'
    Ok "$profileDir"

    # ---------- 4. plugin ----------
    Write-Host ""
    Write-Host "[4/6] Installing the plugin"

    # Releases name the package after its version: `Super-Agent-Plugin-v0.3.10.tgz`. An address that says only
    # `releases/latest/download/Super-Agent-Plugin.tgz` resolves to the newest tag and then asks that tag for a file it
    # does not contain, so every default install answered 404. The file name is read from the release instead.
    function Format-SaAssetName([string]$name, [bool]$purge) {
        if (-not $purge) { return $name }
        # Older releases separated the two builds with a segment: `-Stable-` becomes `-Purge-`, version intact.
        if ($name -like '*-Stable-*') { return ($name -replace '-Stable-', '-Purge-') }
        # From v0.3.6 the stable name carries no build segment, so the segment is inserted before the version:
        # `Super-Agent-Plugin-v1.2.3.tgz` -> `Super-Agent-Plugin-Purge-v1.2.3.tgz`. A name of neither shape returns
        # nothing, so the caller stops instead of downloading the stable build under a purge label.
        if ($name -match '^(Super-Agent-Plugin-)v([\d.]+)(\.tgz)$') { return "$($Matches[1])Purge-v$($Matches[2])$($Matches[3])" }
        return ''
    }

    # The pinned address is the fallback for a run that cannot reach the API at all (offline, proxy, rate limit). It
    # names one exact asset, so it moves together with the version and never guesses.
    $SaPinnedVersion = '0.3.12'
    $SaPinnedUrl = "https://github.com/xyt071024/dsh-superagent-cn/releases/download/v$SaPinnedVersion/Super-Agent-Plugin-v$SaPinnedVersion.tgz"

    function Resolve-SaBundle([string]$given, [bool]$purge) {
        # An address supplied by the operator is used as given; a purge run still renames its last segment.
        if ($given) {
            $leaf = Split-Path $given -Leaf
            $renamed = Format-SaAssetName $leaf $purge
            if (-not $renamed) { Fail "Cannot derive the purge package name from '$leaf'. Pass -SaBundle with the exact purge URL, or drop -SaPurge." }
            if ($renamed -ne $leaf) {
                return @{ Url = $given.Substring(0, $given.Length - $leaf.Length) + $renamed; Name = $renamed; Origin = 'given' }
            }
            return @{ Url = $given; Name = $leaf; Origin = 'given' }
        }

        $api = 'https://api.github.com/repos/xyt071024/dsh-superagent-cn/releases/latest'
        try {
            # `User-Agent` is required: the API answers 403 to a request without one, which then reads as a broken
            # installer rather than the rejected request it is.
            $release = Invoke-RestMethod -Uri $api -Headers @{
                'User-Agent' = 'Super-Agent-Installer'
                'Accept'     = 'application/vnd.github+json'
            } -TimeoutSec 20
        } catch {
            Warn "could not read the release list: $($_.Exception.Message)"
            $fallback = Format-SaAssetName (Split-Path $SaPinnedUrl -Leaf) $purge
            if (-not $fallback) { Fail "Cannot derive a purge package name for v$SaPinnedVersion." }
            return @{ Url = $SaPinnedUrl.Replace((Split-Path $SaPinnedUrl -Leaf), $fallback); Name = $fallback; Origin = "pinned v$SaPinnedVersion" }
        }

        # The stable name is exactly `Super-Agent-Plugin-v<version>.tgz`; the purge build carries `-Purge-` before the
        # version. Matching the whole name keeps the two apart without depending on the order GitHub lists them in.
        $pattern = if ($purge) { '^Super-Agent-Plugin-Purge-v[\d.]+\.tgz$' } else { '^Super-Agent-Plugin-v[\d.]+\.tgz$' }
        $found = @($release.assets | Where-Object { $_.name -match $pattern })
        if ($found.Count -eq 0) {
            $present = (@($release.assets | ForEach-Object { $_.name }) -join ', ')
            $want = if ($purge) { 'purge package' } else { 'plugin package' }
            Fail "release $($release.tag_name) has no $want (looked for $pattern). Assets present: $present"
        }
        # Highest version wins, so a release that still carries an older asset installs the newer one.
        $picked = $found | Sort-Object -Property { [version](($_.name -replace '^.*-v', '') -replace '\.tgz$', '') } -Descending | Select-Object -First 1
        return @{ Url = $picked.browser_download_url; Name = $picked.name; Origin = "release $($release.tag_name)" }
    }

    $SaResolved = Resolve-SaBundle $SaBundle ([bool]$SaPurge)
    $work = Join-Path $env:TEMP ("sa-install-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    try {
        $tgz = Join-Path $work 'dsh-superagent.tgz'
        Say "package $($SaResolved.Name) from $($SaResolved.Origin)"
        Say "downloading $($SaResolved.Url)"
        try {
            Invoke-WebRequest -Uri $SaResolved.Url -OutFile $tgz -UseBasicParsing
        } catch {
            # Named here rather than left as a bare 404: with -SaPurge the release may simply not publish a purge
            # build, and "file not found" alone does not say whether the address or the release is at fault.
            Fail "could not download $($SaResolved.Name) from $($SaResolved.Url): $($_.Exception.Message)"
        }

        # A 404 arrives as an HTML or JSON body carrying the status; saved to disk that body is a plausible file which
        # only fails later inside `dsh plugin add`. The gzip magic bytes are what a .tgz actually starts with.
        $magic = New-Object byte[] 2
        $stream = [System.IO.File]::OpenRead($tgz)
        try { $read = $stream.Read($magic, 0, 2) } finally { $stream.Dispose() }
        if ($read -lt 2 -or $magic[0] -ne 0x1f -or $magic[1] -ne 0x8b) {
            Fail "the downloaded file is not a gzip package, so $($SaResolved.Url) did not return one. Check the address or run this again."
        }
        $hash = (Get-FileHash -Path $tgz -Algorithm SHA256).Hash.ToLower()
        Ok "$($SaResolved.Name)  sha256 $hash"

        # The package is passed by path: a bare name would resolve to whatever npm or the registry calls
        # `dsh-superagent`, which is not this build.
        #
        # --profile is required, not inferred from the working directory: `dsh plugin` forwards its arguments to pnpm
        # inside the profile directory, and the profile comes from this option alone. Without it the command fails with
        # "required option '--profile <name>' not specified" and installs nothing.
        $out = & dsh plugin --profile $SaProfile add $tgz 2>&1
        if ($LASTEXITCODE -ne 0) { throw ($out | Out-String) }
        Ok "plugin installed from the downloaded package"
    } finally {
        # Removed on success and on failure both: a half-written tarball left behind is what a later run then installs
        # by accident. The address and hash are printed above, so the download can always be repeated.
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

    $pluginDir = Join-Path $profileDir 'node_modules/dsh-superagent'
    $installed = Join-Path $pluginDir 'lib\index.js'
    if (-not (Test-Path $installed)) {
        Fail "The plugin is not present at $installed. The install did not complete; nothing was started."
    }
    # The version is reported so the operator can see which build landed: `dsh plugin add` from a path succeeds whatever
    # version that path holds, so "files present" on its own does not say the downloaded version is the installed one.
    if (Test-Path (Join-Path $pluginDir 'package.json')) {
        $installedVersion = (Get-Content -Raw (Join-Path $pluginDir 'package.json') | ConvertFrom-Json).version
        Ok "plugin files present (version $installedVersion)"
    } else {
        Ok "plugin files present"
    }

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
