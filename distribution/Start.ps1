[CmdletBinding()]
param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$installRoot = $PSScriptRoot
$nodeVersion = '26.12.1'
$runtimeRoot = Join-Path $installRoot "runtime\node-v$nodeVersion-win-x64"
$nodeExe = Join-Path $runtimeRoot 'node.exe'
if (-not (Test-Path -LiteralPath $nodeExe)) {
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows x64 is required.' }
    $runtimeDirectory = Join-Path $installRoot 'runtime'
    New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
    $archiveName = "node-v$nodeVersion-win-x64.zip"
    $archive = Join-Path $runtimeDirectory $archiveName
    $base = "https://nodejs.org/dist/v$nodeVersion"
    Write-Host 'Preparing the private Node runtime...'
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$archiveName" -OutFile $archive
    $checksums = (Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt").Content
    $line = ($checksums -split "`n" | Where-Object { $_.Trim().EndsWith("  $archiveName") })
    if (-not $line) { throw 'Runtime checksum was not found.' }
    $expected = ($line.Trim() -split '\s+')[0]
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Runtime checksum verification failed.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $runtimeDirectory -Force
}
$env:PATH = "$runtimeRoot;$env:PATH"
$env:AL_INSTALL_HOME = $installRoot
$env:AL_DATA_DIR = Join-Path $installRoot 'data'
if ($PrepareOnly) { return }
$appRoot = Join-Path $installRoot 'app'
Write-Host 'Starting Adventureland Party Console. Open http://localhost:3010 once ready.'
& $nodeExe (Join-Path $appRoot 'tools\update\agent.mts')
if ($LASTEXITCODE -ne 0) { throw "Console exited with code $LASTEXITCODE" }
