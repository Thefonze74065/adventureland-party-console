[CmdletBinding()]
param(
    [switch]$ResetSession,
    [switch]$CoordinatorOnly,
    [switch]$DevDashboard,
    [switch]$ProductionDashboard
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$caracalRoot = Join-Path $repoRoot ".caracal"
$configPath = Join-Path $caracalRoot "config.js"
$configTemplate = Join-Path $PSScriptRoot "caracal.config.js"
$sessionPath = Join-Path $caracalRoot "session.clixml"
$dashboardRoot = Join-Path $repoRoot "dashboard"
& node (Join-Path $repoRoot 'tools/hosting/install-caddy.mts')
if ($LASTEXITCODE -ne 0) { throw 'HTTPS service installation failed.' }

function Stop-ProcessTree {
    param([Parameter(Mandatory)][int]$RootProcessId)

    $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $childrenByParent = @{}
    foreach ($process in $processes) {
        $parentId = [int]$process.ParentProcessId
        if (-not $childrenByParent.ContainsKey($parentId)) {
            $childrenByParent[$parentId] = [System.Collections.Generic.List[int]]::new()
        }
        $childrenByParent[$parentId].Add([int]$process.ProcessId)
    }
    $ordered = [System.Collections.Generic.List[int]]::new()
    function Add-ProcessTreePostOrder([int]$ProcessId) {
        if ($childrenByParent.ContainsKey($ProcessId)) {
            foreach ($childId in $childrenByParent[$ProcessId]) {
                Add-ProcessTreePostOrder $childId
            }
        }
        $ordered.Add($ProcessId)
    }
    Add-ProcessTreePostOrder $RootProcessId
    foreach ($processId in $ordered) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
}

function Stop-StaleDashboardProcesses {
    $dashboardToken = [IO.Path]::GetFullPath($dashboardRoot).ToLowerInvariant()
    $supervisorToken = (Join-Path $repoRoot 'tools\dashboard\supervisor.mts').ToLowerInvariant()
    $stale = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessId -ne $PID -and
        $_.Name -in @("node.exe", "workerd.exe") -and
        -not [string]::IsNullOrWhiteSpace($_.CommandLine) -and
        ($_.CommandLine.ToLowerInvariant().Contains($dashboardToken) -or
         $_.CommandLine.ToLowerInvariant().Contains($supervisorToken))
    })
    foreach ($process in $stale) {
        Write-Host "Stopping stale dashboard process $($process.ProcessId) ($($process.Name)) before build."
        Stop-ProcessTree -RootProcessId ([int]$process.ProcessId)
    }
}

function Stop-ExistingCaracalSupervisor {
    $lockPath = Join-Path $caracalRoot ".caracal-supervisor.lock"
    if (-not (Test-Path -LiteralPath $lockPath)) { return }
    $ownerText = (Get-Content -LiteralPath $lockPath -Raw -ErrorAction SilentlyContinue).Trim()
    $ownerId = 0
    if (-not [int]::TryParse($ownerText, [ref]$ownerId) -or $ownerId -le 0) {
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
        return
    }
    $owner = Get-Process -Id $ownerId -ErrorAction SilentlyContinue
    if (-not $owner -or $owner.ProcessName -ne "node") {
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
        return
    }
    # The local service host respawns main.js. Retire its launcher too, otherwise
    # a new start races the old host for the supervisor lock and dashboard ports.
    $stopRoot = $ownerId
    $ownerInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerId"
    $parentInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$($ownerInfo.ParentProcessId)"
    $hostingPath = (Join-Path $repoRoot 'tools\hosting\local.mts').Replace('/', '\').ToLowerInvariant()
    if ($parentInfo.Name -eq 'node.exe' -and $parentInfo.CommandLine -and
        $parentInfo.CommandLine.Replace('/', '\').ToLowerInvariant().Contains($hostingPath)) {
        $stopRoot = [int]$parentInfo.ProcessId
        $starter = Get-CimInstance Win32_Process -Filter "ProcessId=$($parentInfo.ParentProcessId)"
        if ($starter.Name -in @('pwsh.exe', 'powershell.exe') -and
            $starter.CommandLine -match 'start-console\.ps1' -and $starter.ProcessId -ne $PID) {
            $stopRoot = [int]$starter.ProcessId
        }
    }
    Write-Host "Stopping the existing caracAL launcher $stopRoot (supervisor $ownerId) before taking ownership."
    Stop-ProcessTree -RootProcessId $stopRoot
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while ((Get-Process -Id $ownerId -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 100
    }
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path -LiteralPath (Join-Path $caracalRoot "main.js"))) {
    throw "caracAL is not installed. Run .\scripts\setup-console.ps1 first."
}

if (-not (Test-Path -LiteralPath $configPath)) {
    Copy-Item -LiteralPath $configTemplate -Destination $configPath
    Write-Host "Created private local configuration: $configPath"
}

if ($ResetSession -and (Test-Path -LiteralPath $sessionPath)) {
    Remove-Item -LiteralPath $sessionPath
}

if (Test-Path -LiteralPath $sessionPath) {
    $secureSession = Import-Clixml -LiteralPath $sessionPath
    $sessionPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSession)
    try {
        $session = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($sessionPointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($sessionPointer)
    }
} else {
    $session = (Read-Host "Adventure Land session (user_id-user_auth)").Trim()
}

# show_json normally renders a JSON string, so copying its output may include
# matching quotes. Current auth values may also contain URL-safe punctuation.
if ($session.Length -ge 2) {
    $first = $session[0]
    $last = $session[$session.Length - 1]
    if (($first -eq '"' -and $last -eq '"') -or
        ($first -eq "'" -and $last -eq "'")) {
        $session = $session.Substring(1, $session.Length - 2).Trim()
    }
}

if ([string]::IsNullOrWhiteSpace($session) -or
    $session -match '\s' -or
    $session.IndexOf('-') -lt 1 -or
    $session.EndsWith('-')) {
    throw "The copied session is incomplete. Copy only the displayed user_id-user_auth value, with or without its surrounding quotes."
}

if (-not (Test-Path -LiteralPath $sessionPath)) {
    ConvertTo-SecureString $session -AsPlainText -Force |
        Export-Clixml -LiteralPath $sessionPath
    Write-Host "Saved the session with Windows user-bound encryption."
}

$env:AL_SESSION = $session
$dashboardProcess = $null
$gameBuildProcess = $null
$ownsRuntime = $false
try {
    Push-Location $repoRoot
    try {
        npm run build:shared
        if ($LASTEXITCODE -ne 0) { throw "shared policy build failed; current game process retained." }
        npm run build:runtime
        if ($LASTEXITCODE -ne 0) { throw "runtime TypeScript build failed; current game process retained." }
        if (-not $CoordinatorOnly) {
            npm run build:characters
            if ($LASTEXITCODE -ne 0) { throw "class TypeScript build failed; current game process retained." }
        } else {
            $launcher = Join-Path $caracalRoot 'standalones/CharacterCoordinator.js'
            $template = Join-Path $repoRoot 'tools/caracal/CharacterCoordinator.cjs'
            if ((Get-FileHash -LiteralPath $launcher).Hash -ne (Get-FileHash -LiteralPath $template).Hash) {
                throw "Coordinator-only restart requires the current installed launcher; current process retained."
            }
        }
    } finally { Pop-Location }
    Stop-ExistingCaracalSupervisor
    $ownsRuntime = $true
    if (-not $CoordinatorOnly) {
        node (Join-Path $repoRoot 'tools/build-shared.mts') --publish
        if ($LASTEXITCODE -ne 0) { throw "shared policy publication failed." }
        & (Join-Path $PSScriptRoot 'update-routing-guard.ps1')
        node (Join-Path $repoRoot 'tools/caracal/install.mts')
        if ($LASTEXITCODE -ne 0) { throw "validated runtime upgrade failed." }
        node (Join-Path $repoRoot 'tools/game/build.mts') --publish
        if ($LASTEXITCODE -ne 0) { throw "class generation publication failed." }
        node (Join-Path $repoRoot 'tools/build-runtime.mts') --publish
        if ($LASTEXITCODE -ne 0) { throw "Steam bootstrap publication failed." }
    }
    Stop-StaleDashboardProcesses
    $localArgs = @()
    if ($CoordinatorOnly) { $localArgs += '--coordinator-only' }
    if ($DevDashboard) { $localArgs += '--development' }
    elseif ($ProductionDashboard) { $localArgs += '--production' }
    node (Join-Path $repoRoot 'tools/hosting/local.mts') @localArgs
    if ($LASTEXITCODE -ne 0) { throw "Party services exited with code $LASTEXITCODE." }
} finally {
    if ($gameBuildProcess) { Stop-ProcessTree -RootProcessId $gameBuildProcess.Id }
    if ($dashboardProcess) { Stop-ProcessTree -RootProcessId $dashboardProcess.Id }
    # Also catch a detached Wrangler/workerd child if its original Node parent
    # already exited and therefore no longer appears in the captured tree.
    if ($ownsRuntime) { Stop-StaleDashboardProcesses }
    Remove-Item Env:\AL_SESSION -ErrorAction SilentlyContinue
    $session = $null
}
