param(
    [ValidateSet('start', 'build', 'rebuild', 'dev', 'lan', 'worker', 'help')]
    [string]$Mode = 'start',
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$jarPath = Join-Path $repoRoot 'backend\target\itemnest-1.0.0.jar'
$buildStampPath = Join-Path $repoRoot 'backend\target\source-hash.txt'
$children = @()

function Use-Java {
    $candidates = @()
    if ($env:JAVA_HOME) { $candidates += Join-Path $env:JAVA_HOME 'bin\java.exe' }
    $onPath = Get-Command java.exe -ErrorAction SilentlyContinue
    if ($onPath) { $candidates += $onPath.Source }
    # Compatibility with the JDK used by the original launchers on this computer.
    $candidates += 'D:\4environment\Java\jdk-21.0.7\bin\java.exe'
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        $probe = New-Object System.Diagnostics.Process
        try {
            $probe.StartInfo.FileName = $candidate
            $probe.StartInfo.Arguments = '-XshowSettings:properties -version'
            $probe.StartInfo.UseShellExecute = $false
            $probe.StartInfo.CreateNoWindow = $true
            $probe.StartInfo.RedirectStandardError = $true
            $null = $probe.Start()
            $version = $probe.StandardError.ReadToEnd()
            $probe.WaitForExit()
            if ($probe.ExitCode -eq 0 -and $version -match 'java.specification.version\s*=\s*(\d+)' -and [int]$Matches[1] -ge 21) {
                $env:JAVA_HOME = Split-Path -Parent (Split-Path -Parent $candidate)
                $env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
                $script:javaExe = $candidate
                Write-Host "[ItemNest] Java: $candidate"
                return
            }
        } finally { $probe.Dispose() }
    }
    throw 'JDK 21 or newer is required. Set JAVA_HOME to your JDK directory.'
}

function Use-Pnpm {
    if (Get-Command pnpm.cmd -ErrorAction SilentlyContinue) { $script:pnpmCommand = 'pnpm.cmd'; $script:pnpmPrefix = @() }
    elseif (Get-Command corepack.cmd -ErrorAction SilentlyContinue) { $script:pnpmCommand = 'corepack.cmd'; $script:pnpmPrefix = @('pnpm') }
    else { throw 'pnpm/corepack was not found. Install Node.js and pnpm first.' }
}

function Invoke-Frontend([string[]]$CommandArgs) {
    Push-Location (Join-Path $repoRoot 'frontend')
    try {
        & $script:pnpmCommand @script:pnpmPrefix @CommandArgs
        if ($LASTEXITCODE -ne 0) { throw "Frontend command failed with exit code $LASTEXITCODE." }
    } finally { Pop-Location }
}

function Invoke-BackendBuild([switch]$SkipTests) {
    Push-Location (Join-Path $repoRoot 'backend')
    try {
        $mavenArgs = @('clean', 'package')
        if ($SkipTests) { $mavenArgs += '-DskipTests' }
        & '.\mvnw.cmd' @mavenArgs
        if ($LASTEXITCODE -ne 0) { throw "Backend build failed with exit code $LASTEXITCODE. Stop running JAR instances before rebuilding." }
    } finally { Pop-Location }
}

function Get-SourceHash {
    $files = @(
        foreach ($directory in @('frontend\src', 'frontend\public', 'backend\src', 'backend\.mvn')) {
            $path = Join-Path $repoRoot $directory
            if (Test-Path -LiteralPath $path) { Get-ChildItem -LiteralPath $path -File -Recurse -Force }
        }
        Get-ChildItem -LiteralPath (Join-Path $repoRoot 'frontend') -File -Force |
            Where-Object { $_.Extension -in @('.json', '.yaml', '.yml', '.ts', '.html', '.js', '.mjs', '.cjs') -or $_.Name -like '.env*' }
        Get-Item -LiteralPath (Join-Path $repoRoot 'backend\pom.xml')
    )
    # Include relative paths as well as contents, so deletions and renames also invalidate the build.
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $manifest = ($files | Sort-Object FullName | ForEach-Object {
            $stream = [System.IO.File]::OpenRead($_.FullName)
            try { $_.FullName.Substring($repoRoot.Length) + ':' + [BitConverter]::ToString($sha.ComputeHash($stream)) }
            finally { $stream.Dispose() }
        }) -join "`n"
        return [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($manifest)))
    }
    finally { $sha.Dispose() }
}

function Test-BuildCurrent {
    if (-not (Test-Path -LiteralPath $jarPath) -or -not (Test-Path -LiteralPath $buildStampPath)) { return $false }
    return (Get-Content -LiteralPath $buildStampPath -Raw).Trim() -eq (Get-SourceHash)
}

function Build-App {
    $sourceHash = Get-SourceHash
    Use-Pnpm
    Invoke-Frontend @('install', '--frozen-lockfile')
    Invoke-Frontend @('build')
    Invoke-BackendBuild
    Set-Content -LiteralPath $buildStampPath -Value $sourceHash -Encoding UTF8
    Write-Host "[ItemNest] Build completed: $jarPath"
}

function Assert-FreePort([int]$Port) {
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $Port is already in use. Stop the existing service before starting ItemNest."
    }
}

function Start-Child([string]$Name, [string]$File, [string]$Arguments, [string]$Directory) {
    $logDir = Join-Path $env:ITEMNEST_DATA_DIR 'logs'
    $null = New-Item -ItemType Directory -Force -Path $logDir
    $logBase = Join-Path $logDir ("$Name-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + "-$PID")
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -WorkingDirectory $Directory -WindowStyle Hidden -RedirectStandardOutput "$logBase.log" -RedirectStandardError "$logBase.error.log" -PassThru
    $script:children += $process
    Write-Host "[ItemNest] $Name log: $logBase.log"
    Write-Host "[ItemNest] $Name errors: $logBase.error.log"
    return $process
}

function Wait-Port([int]$Port, [System.Diagnostics.Process]$Process, [string]$ConnectHost) {
    $deadline = (Get-Date).AddMinutes(3)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) { throw "Service exited before port $Port became ready. Check its log files." }
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $connect = $client.ConnectAsync($ConnectHost, $Port)
            if ($connect.Wait(200) -and $client.Connected) { return }
        } catch {
            # Local readiness check only; no API writes are retried.
        } finally { $client.Dispose() }
        Start-Sleep -Milliseconds 300
    }
    throw "Service did not become ready on port $Port within 3 minutes. Check its log files."
}

Push-Location $repoRoot
try {
    if ($Mode -eq 'help') {
        Write-Host 'Usage: start.bat [start|build|rebuild|dev|lan|worker|help] [-NoBrowser]'
        Write-Host '  start    Start local web app (default); rebuild if missing or sources changed.'
        Write-Host '  build    Build frontend and backend, including backend tests.'
        Write-Host '  rebuild  Build, then start local web app.'
        Write-Host '  dev      Build backend, then run backend + Vite with hot reload.'
        Write-Host '  lan      Start authenticated LAN web access; reuse or create an access key.'
        Write-Host '  worker   Run the existing RabbitMQ event consumer, without a web server.'
        Write-Host '  -NoBrowser  Start without opening the browser.'
        exit 0
    }
    Use-Java
    if ($Mode -eq 'build') { Build-App; exit 0 }

    if (-not $env:ITEMNEST_DATA_DIR) { $env:ITEMNEST_DATA_DIR = Join-Path $repoRoot 'data' }
    if (-not [System.IO.Path]::IsPathRooted($env:ITEMNEST_DATA_DIR)) { $env:ITEMNEST_DATA_DIR = Join-Path $repoRoot $env:ITEMNEST_DATA_DIR }
    if (-not $env:SERVER_PORT) { $env:SERVER_PORT = '8765' }
    $port = 0
    if (-not [int]::TryParse($env:SERVER_PORT, [ref]$port) -or $port -lt 1 -or $port -gt 65535) { throw 'SERVER_PORT must be an integer between 1 and 65535.' }
    if (-not $env:ITEMNEST_BIND_ADDRESS) { $env:ITEMNEST_BIND_ADDRESS = '127.0.0.1' }
    if ($Mode -ne 'worker') { Assert-FreePort $port }
    if ($Mode -eq 'dev') {
        if ($port -ne 8765 -or $env:ITEMNEST_BIND_ADDRESS -ne '127.0.0.1') { throw 'Dev mode requires SERVER_PORT=8765 and ITEMNEST_BIND_ADDRESS=127.0.0.1 to match the Vite proxy.' }
        Assert-FreePort 15473
        Use-Pnpm
        Invoke-Frontend @('install', '--frozen-lockfile')
        Invoke-BackendBuild -SkipTests
    } elseif ($Mode -eq 'rebuild' -or -not (Test-BuildCurrent)) {
        Write-Host '[ItemNest] Building the current source before starting.'
        Build-App
    }

    if ($Mode -eq 'lan') {
        $env:ITEMNEST_BIND_ADDRESS = '0.0.0.0'
        if (-not $env:ITEMNEST_ACCESS_TOKEN) { $env:ITEMNEST_ACCESS_TOKEN = $env:ITEMNEST_LAN_TOKEN }
        if (-not $env:ITEMNEST_ACCESS_TOKEN) {
            $env:ITEMNEST_ACCESS_TOKEN = & (Join-Path $PSScriptRoot 'get-access-token.ps1') -DataDir $env:ITEMNEST_DATA_DIR
            Write-Host ('[ItemNest] Access key file: ' + (Join-Path $env:ITEMNEST_DATA_DIR 'access-token.txt'))
        } else { Write-Host '[ItemNest] Using the access key configured in the environment.' }
        $env:ITEMNEST_REQUIRE_AUTH = 'true'
        Write-Host '[ItemNest] LAN mode requires an access key, including on this computer. Use HTTPS for public access.'
        Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { Write-Host "[ItemNest] LAN URL: http://$($_.IPAddress):$port" }
    }

    $javaArgs = '-jar "' + $jarPath + '"'
    if ($Mode -eq 'worker') {
        $env:ITEMNEST_RABBITMQ_ENABLED = 'true'
        $env:ITEMNEST_RABBITMQ_WORKER_ENABLED = 'true'
        $javaArgs += ' --spring.main.web-application-type=none'
    }
    $backend = Start-Child 'backend' $script:javaExe $javaArgs $repoRoot
    Write-Host "[ItemNest] Data: $env:ITEMNEST_DATA_DIR"
    if ($Mode -ne 'worker') {
        $connectHost = $env:ITEMNEST_BIND_ADDRESS
        if ($connectHost -eq '0.0.0.0') { $connectHost = '127.0.0.1' }
        if ($connectHost -eq '::') { $connectHost = '::1' }
        Wait-Port $port $backend $connectHost
        $urlHost = $connectHost
        if ($urlHost.Contains(':')) { $urlHost = "[$urlHost]" }
        $url = "http://${urlHost}:$port"
        if ($Mode -eq 'dev') {
            # Only fixed commands are passed to cmd; paths and credentials stay out of command text.
            $devCommand = '/d /s /c "pnpm.cmd dev"'
            if ($script:pnpmPrefix.Count) { $devCommand = '/d /s /c "corepack.cmd pnpm dev"' }
            $frontend = Start-Child 'frontend' $env:ComSpec $devCommand (Join-Path $repoRoot 'frontend')
            Wait-Port 15473 $frontend '127.0.0.1'
            $url = 'http://127.0.0.1:15473'
        }
        Write-Host "[ItemNest] URL: $url"
        if (-not $NoBrowser) { Start-Process $url }
    }
    Write-Host '[ItemNest] Press Ctrl+C to stop. Child services will be stopped together.'
    while ($true) {
        foreach ($child in $children) {
            if ($child.HasExited) { throw "Service exited with code $($child.ExitCode). Check its log files." }
        }
        Start-Sleep -Milliseconds 500
    }
} catch {
    Write-Host "[ItemNest] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    foreach ($child in $children) {
        try {
            if (-not $child.HasExited) {
                # Terminate only processes started by this launcher, including the Vite command's children.
                & taskkill.exe /PID $child.Id /T /F 2>$null | Out-Null
            }
        } catch {
            if (-not $child.HasExited) { Write-Warning "Could not stop child process $($child.Id)." }
        } finally { $child.Dispose() }
    }
    Pop-Location
}
