param([Parameter(Mandatory = $true)][string]$DataDir)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$tokenFile = Join-Path $DataDir 'access-token.txt'
if (-not (Test-Path -LiteralPath $tokenFile)) {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $key = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    [System.IO.File]::WriteAllText($tokenFile, $key)
}
$key = (Get-Content -LiteralPath $tokenFile -Raw).Trim()
if ($key.Length -lt 32) { throw 'Stored access key must contain at least 32 random characters.' }
Write-Output $key
