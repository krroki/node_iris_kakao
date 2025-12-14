param(
  [int]$TimeoutSec = 45,
  [string]$LogDir = '',
  [switch]$Restart
)

# Force UTF-8 for logs/console to avoid mojibake in worker output
try { chcp 65001 | Out-Null } catch {}
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root

if (-not $LogDir) { $LogDir = Join-Path $root 'windows\logs' }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$outLog = Join-Path $LogDir 'roster_worker.out.log'
$errLog = Join-Path $LogDir 'roster_worker.err.log'

$statusPath = Join-Path $root 'node-iris-app\data\roster_worker_status.json'
$scriptPath = Join-Path $root 'scripts\course_roster_worker.py'

function Get-WorkerPidFromStatus {
  try {
    if (-not (Test-Path $statusPath)) { return $null }
    $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($j.pid) { return [int]$j.pid }
  } catch {}
  return $null
}

function Find-WorkerProcs {
  try {
    return @(Get-CimInstance Win32_Process -Filter "Name='python.exe' or Name='pythonw.exe'" |
      Where-Object { $_.CommandLine -match 'scripts[/\\\\]course_roster_worker\\.py' } |
      Select-Object ProcessId,CommandLine)
  } catch {
    return @()
  }
}

$statusPid = Get-WorkerPidFromStatus
$statusProc = $null
if ($statusPid) {
  try {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$statusPid" -ErrorAction SilentlyContinue
    if ($p -and ($p.CommandLine -match 'scripts[/\\\\]course_roster_worker\\.py')) {
      $statusProc = [pscustomobject]@{ ProcessId = [int]$p.ProcessId; CommandLine = [string]$p.CommandLine }
    }
  } catch {}
}

$workerProcs = Find-WorkerProcs
$mainPid = $null
if ($statusProc) {
  $mainPid = $statusProc.ProcessId
} elseif ($workerProcs.Count -gt 0) {
  $mainPid = [int]$workerProcs[0].ProcessId
}

if ($workerProcs.Count -gt 1) {
  $pidsText = ($workerProcs | ForEach-Object { $_.ProcessId } | Sort-Object) -join ','
  Write-Host ("[roster-worker] WARN: multiple worker processes detected: {0}" -f $pidsText) -ForegroundColor Yellow
  foreach ($proc in $workerProcs) {
    $procPid = [int]$proc.ProcessId
    if ($mainPid -and $procPid -eq $mainPid) { continue }
    try { Stop-Process -Id $procPid -Force -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Milliseconds 300
}

if ($mainPid) {
  if (-not $Restart) {
    Write-Host ("[roster-worker] already running pid={0}; skip start (use -Restart to force)" -f $mainPid) -ForegroundColor Green
    return
  }
  Write-Host ("[roster-worker] restart requested; stopping existing pid={0}" -f $mainPid) -ForegroundColor Yellow
  try { Stop-Process -Id $mainPid -Force -ErrorAction SilentlyContinue } catch {}
  Start-Sleep -Milliseconds 300
}

if (-not (Test-Path $scriptPath)) {
  Write-Host ("[roster-worker] script missing: {0}" -f $scriptPath) -ForegroundColor Red
  exit 1
}

$py = $null
try { $py = (Get-Command python.exe -ErrorAction Stop).Source } catch {}
if (-not $py) {
  Write-Host "[roster-worker] python.exe not found in PATH" -ForegroundColor Red
  exit 1
}

Write-Host ("[roster-worker] starting (timeout {0}s)" -f $TimeoutSec) -ForegroundColor Green
try { Remove-Item -Force -ErrorAction SilentlyContinue $outLog,$errLog | Out-Null } catch {}
$proc = Start-Process -FilePath $py -ArgumentList @('scripts\course_roster_worker.py') -WorkingDirectory $root -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru
$pid = $proc.Id

$deadline = (Get-Date).AddSeconds([math]::Max(5,$TimeoutSec))
$ready = $false
do {
  Start-Sleep -Seconds 1
  $alive = $null -ne (Get-Process -Id $pid -ErrorAction SilentlyContinue)
  if (-not $alive) { break }
  try {
    if (Test-Path $statusPath) {
      $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $spid = $null
      try { if ($j.pid) { $spid = [int]$j.pid } } catch {}
      if ($spid -and $spid -eq $pid) { $ready = $true; break }
    }
  } catch {}
} while ((Get-Date) -lt $deadline)

$alive = $null -ne (Get-Process -Id $pid -ErrorAction SilentlyContinue)
if ($ready) {
  Write-Host ("[roster-worker] READY pid={0}" -f $pid) -ForegroundColor Green
} elseif ($alive) {
  Write-Host ("[roster-worker] STARTED pid={0} (status not ready). See logs {1} / {2}" -f $pid, $outLog, $errLog) -ForegroundColor Yellow
} else {
  Write-Host ("[roster-worker] FAILED (process exited). See logs {0} / {1}" -f $outLog, $errLog) -ForegroundColor Red
  exit 1
}

