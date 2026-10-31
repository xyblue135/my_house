param(
    [ValidateSet('start', 'build', 'rebuild', 'dev', 'lan', 'worker', 'help')]
    [string]$Mode = 'start',
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$jarPath = Join-Path $repoRoot 'backend\target\myhouse.jar'
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
                Write-Host "[My House] Java: $candidate"
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

function Stop-RunningJarInstances {
    # Windows 会锁定正在运行的 JAR 文件；重建或重启前先停掉本仓库启动的 Java 实例，
    # 避免 clean 删除 jar 时报「另一个程序正在使用此文件」。只按 jar 名匹配，不动其它 Java 进程。
    # @() must wrap the whole pipeline: an empty result then yields an empty array, not @($null).
    $stale = @(Get-CimInstance Win32_Process -Filter "Name='java.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'myhouse-[0-9][0-9.]*\.jar|itemnest-[0-9][0-9.]*\.jar|myhouse\.jar' })
    foreach ($process in $stale) {
        if ($null -eq $process) { continue }
        Write-Host "[My House] Stopping running JAR instance (pid $($process.ProcessId)) before rebuild."
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    if ($stale.Count -gt 0) { Start-Sleep -Milliseconds 800 }
}

function Invoke-BackendBuild([switch]$SkipTests) {
    Stop-RunningJarInstances
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
    Write-Host "[My House] Build completed: $jarPath"
}

function Assert-FreePort([int]$Port) {
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $Port is already in use. Stop the existing service before starting My House."
    }
}

function Start-Child([string]$Name, [string]$File, [string]$Arguments, [string]$Directory) {
    $logDir = Join-Path $env:MYHOUSE_DATA_DIR 'logs'
    $null = New-Item -ItemType Directory -Force -Path $logDir
    $logBase = Join-Path $logDir ("$Name-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + "-$PID")
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -WorkingDirectory $Directory -WindowStyle Hidden -RedirectStandardOutput "$logBase.log" -RedirectStandardError "$logBase.error.log" -PassThru
    $script:children += $process
    Write-Host "[My House] $Name log: $logBase.log"
    Write-Host "[My House] $Name errors: $logBase.error.log"
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
        Write-Host '  start    Start the web app on the LAN (default); reuse or create an access key.'
        Write-Host '  build    Build frontend and backend, including backend tests.'
        Write-Host '  rebuild  Build, then start the web app on the LAN.'
        Write-Host '  dev      Build backend, then run backend + Vite with hot reload (loopback only).'
        Write-Host '  lan      Same as start: authenticated LAN web access.'
        Write-Host '  worker   Run the existing RabbitMQ event consumer, without a web server.'
        Write-Host '  -NoBrowser  Start without opening the browser.'
        exit 0
    }
    Use-Java
    if ($Mode -eq 'build') { Build-App; exit 0 }

    if (-not $env:MYHOUSE_DATA_DIR) { $env:MYHOUSE_DATA_DIR = Join-Path $repoRoot 'data' }
    if (-not [System.IO.Path]::IsPathRooted($env:MYHOUSE_DATA_DIR)) { $env:MYHOUSE_DATA_DIR = Join-Path $repoRoot $env:MYHOUSE_DATA_DIR }
    if (-not $env:SERVER_PORT) { $env:SERVER_PORT = '10100' }
    $port = 0
    if (-not [int]::TryParse($env:SERVER_PORT, [ref]$port) -or $port -lt 1 -or $port -gt 65535) { throw 'SERVER_PORT must be an integer between 1 and 65535.' }
    if (-not $env:MYHOUSE_BIND_ADDRESS) { $env:MYHOUSE_BIND_ADDRESS = '127.0.0.1' }
    if ($Mode -ne 'worker') {
        # 重复运行 start.bat 时把上一次的实例停掉，当作一次干净的重启，而不是端口冲突报错。
        Stop-RunningJarInstances
        Assert-FreePort $port
    }
    if ($Mode -eq 'dev') {
        if ($port -ne 10100 -or $env:MYHOUSE_BIND_ADDRESS -ne '127.0.0.1') { throw 'Dev mode requires SERVER_PORT=10100 and MYHOUSE_BIND_ADDRESS=127.0.0.1 to match the Vite proxy.' }
        Assert-FreePort 15473
        Use-Pnpm
        Invoke-Frontend @('install', '--frozen-lockfile')
        Invoke-BackendBuild -SkipTests
    } elseif ($Mode -eq 'rebuild' -or -not (Test-BuildCurrent)) {
        Write-Host '[My House] Building the current source before starting.'
        Build-App
    }

    # 默认启动即对局域网开放：绑定 0.0.0.0；连接认证统一走家庭账号密码（数据目录 account.json）。
    # dev 模式保持回环（Vite 代理固定 127.0.0.1），worker 不监听网络。
    $lanMode = $Mode -eq 'lan' -or $Mode -eq 'start' -or $Mode -eq 'rebuild'
    if ($lanMode) {
        $env:MYHOUSE_BIND_ADDRESS = '0.0.0.0'
        Write-Host '[My House] LAN mode. Clients log in with the family account on the connection page.'
        Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { Write-Host "[My House] LAN URL: http://$($_.IPAddress):$port" }
    }

    $javaArgs = '-jar "' + $jarPath + '"'
    if ($Mode -eq 'worker') {
        $env:MYHOUSE_RABBITMQ_ENABLED = 'true'
        $env:MYHOUSE_RABBITMQ_WORKER_ENABLED = 'true'
        $javaArgs += ' --spring.main.web-application-type=none'
    }
    $backend = Start-Child 'backend' $script:javaExe $javaArgs $repoRoot
    Write-Host "[My House] Data: $env:MYHOUSE_DATA_DIR"
    if ($Mode -ne 'worker') {
        $connectHost = $env:MYHOUSE_BIND_ADDRESS
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
        Write-Host "[My House] URL: $url"
        if (-not $NoBrowser) { Start-Process $url }
    }
    Write-Host '[My House] Press Ctrl+C to stop. Child services will be stopped together.'
    while ($true) {
        foreach ($child in $children) {
            if ($child.HasExited) { throw "Service exited with code $($child.ExitCode). Check its log files." }
        }
        Start-Sleep -Milliseconds 500
    }
} catch {
    Write-Host "[My House] $($_.Exception.Message)" -ForegroundColor Red
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
