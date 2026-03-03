# Stop a specific node-iris-app process by PID (bot + workers) — 안전 버전
# Usage: .\stop_bot.ps1 -TargetPid 12345

param(
    [Parameter(Mandatory = $true)]
    [int]$TargetPid  # NOTE: $Pid는 PowerShell 내장 변수와 충돌하므로 $TargetPid 사용
)

$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$botDir = Join-Path $root 'node-iris-app'
$dataDir = Join-Path $botDir 'data'
$distDir = Join-Path $botDir 'dist'
$distWorkers = Join-Path $distDir 'workers'

$statusFiles = @(
    (Join-Path $dataDir 'status.json'),
    (Join-Path $dataDir 'welcome_worker_status.json'),
    (Join-Path $dataDir 'ai_worker_status.json'),
    (Join-Path $dataDir 'broadcast_worker_status.json')
)

function Read-StatusPid {
    param([string]$Path)
    try {
        if (-not (Test-Path $Path)) { return $null }
        $j = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($j.pid) { return [int]$j.pid }
    } catch {}
    return $null
}

$allowedPids = @()
foreach ($p in $statusFiles) {
    $statusPid = Read-StatusPid -Path $p
    if ($statusPid -and $statusPid -gt 0) { $allowedPids += $statusPid }
}
$allowedPids = @($allowedPids | Sort-Object -Unique)

# Get the process by PID
$proc = Get-CimInstance Win32_Process -Filter "ProcessId=$TargetPid" -ErrorAction SilentlyContinue
if (-not $proc) {
    Write-Error "Process with PID $TargetPid not found"
    exit 1
}

$cmd = [string]$proc.CommandLine

# Safety gate:
# - allow if PID is referenced by one of status jsons (SSOT)
# - or if commandline contains our repo's dist absolute script path (duplicate instances)
$isAllowed = $false
if ($allowedPids -contains $TargetPid) {
    $isAllowed = $true
} else {
    try {
        $absIndex = Join-Path $distDir 'index.js'
        $absWelcome = Join-Path $distWorkers 'welcome_worker.js'
        $absAi = Join-Path $distWorkers 'ai_worker.js'
        $absBroadcast = Join-Path $distWorkers 'broadcast_worker.js'
        $patterns = @(
            [Regex]::Escape($absIndex),
            [Regex]::Escape($absWelcome),
            [Regex]::Escape($absAi),
            [Regex]::Escape($absBroadcast)
        )
        foreach ($re in $patterns) {
            if ($cmd -match $re) { $isAllowed = $true; break }
        }
    } catch {}
}

if (-not $isAllowed) {
    Write-Error "PID $TargetPid is not a node-iris-app(bot/worker) process. CommandLine: $cmd"
    exit 2
}

try {
    Stop-Process -Id $TargetPid -Force -ErrorAction Stop
    Write-Output "Successfully stopped node-iris-app process PID $TargetPid"
    exit 0
} catch {
    Write-Error "Failed to stop process: $($_.Exception.Message)"
    exit 3
}
