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
$outLog = Join-Path $LogDir 'course_membership_audit_worker.out.log'
$errLog = Join-Path $LogDir 'course_membership_audit_worker.err.log'

$statusPath = Join-Path $root 'node-iris-app\data\course_membership_audit_worker_status.json'
$lockPath = Join-Path $root 'node-iris-app\data\locks\course_membership_audit_worker.lock'
$scriptPath = Join-Path $root 'scripts\course_membership_audit_worker.py'

function Get-WorkerPidFromStatus {
  try {
    if (-not (Test-Path $statusPath)) { return $null }
    $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($j.pid) { return [int]$j.pid }
  } catch {}
  return $null
}

function Get-WorkerPidFromLock {
  try {
    if (-not (Test-Path $lockPath)) { return $null }
    $s = (Get-Content -LiteralPath $lockPath -Encoding UTF8 | Select-Object -First 1)
    $s2 = [string]$s
    $s2 = $s2.Trim()
    if ($s2 -match '^[0-9]+$') { return [int]$s2 }
  } catch {}
  return $null
}

function Test-PidAlive {
  param([int]$ProcessId)
  try {
    return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
  } catch {
    return $false
  }
}

function Find-WorkerProcs {
  try {
    return @(
      Get-CimInstance Win32_Process -Filter "Name='python.exe' or Name='pythonw.exe'" |
        Where-Object { $_.CommandLine -and ($_.CommandLine -match 'scripts[/\\\\]course_membership_audit_worker\\.py') } |
        Select-Object ProcessId,CommandLine,CreationDate
    )
  } catch {
    return @()
  }
}

$workerProcs = Find-WorkerProcs
$statusPid = Get-WorkerPidFromStatus
$lockPid = Get-WorkerPidFromLock

# mainPid는 "status에 기록된 pid"를 우선으로 선택한다(실제 동작/heartbeat 기준).
$mainPid = $null
if ($statusPid -and (Test-PidAlive -ProcessId ([int]$statusPid))) {
  $mainPid = [int]$statusPid
} elseif ($lockPid -and (Test-PidAlive -ProcessId ([int]$lockPid))) {
  $mainPid = [int]$lockPid
} elseif ($workerProcs.Count -gt 0) {
  # statusPid가 없거나 불일치하면, 가장 최근 생성된 프로세스를 main으로 본다.
  $mainPid = [int](($workerProcs | Sort-Object CreationDate -Descending | Select-Object -First 1).ProcessId)
}

if ($workerProcs.Count -gt 1) {
  $pidsText = ($workerProcs | ForEach-Object { $_.ProcessId } | Sort-Object) -join ','
  Write-Host ("[course-membership-audit-worker] WARN: multiple worker processes detected: {0}" -f $pidsText) -ForegroundColor Yellow
  foreach ($proc in $workerProcs) {
    $procPid = [int]$proc.ProcessId
    if ($mainPid -and $procPid -eq $mainPid) { continue }
    try { Stop-Process -Id $procPid -Force -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Milliseconds 300
}

if ($mainPid) {
  if (-not $Restart) {
    Write-Host ("[course-membership-audit-worker] already running pid={0}; skip start (use -Restart to force)" -f $mainPid) -ForegroundColor Green
    return
  }

  Write-Host ("[course-membership-audit-worker] restart requested; stopping existing pid={0}" -f $mainPid) -ForegroundColor Yellow
  # Restart 모드에서는 mainPid를 최우선으로 종료하고, 추가로 탐지된 워커도 정리한다.
  try { Stop-Process -Id ([int]$mainPid) -Force -ErrorAction SilentlyContinue } catch {}
  foreach ($proc in (Find-WorkerProcs)) {
    $procPid = [int]$proc.ProcessId
    if ($procPid -eq [int]$mainPid) { continue }
    try { Stop-Process -Id $procPid -Force -ErrorAction SilentlyContinue } catch {}
  }

  $stopDeadline = (Get-Date).AddSeconds(6)
  do {
    Start-Sleep -Milliseconds 250
    $still = Get-Process -Id ([int]$mainPid) -ErrorAction SilentlyContinue
  } while ($still -and (Get-Date) -lt $stopDeadline)

  if ($null -ne (Get-Process -Id ([int]$mainPid) -ErrorAction SilentlyContinue)) {
    Write-Host ("[course-membership-audit-worker] FAILED: old worker still running after stop pid={0}" -f $mainPid) -ForegroundColor Red
    exit 1
  }
}

if (-not (Test-Path $scriptPath)) {
  Write-Host ("[course-membership-audit-worker] script missing: {0}" -f $scriptPath) -ForegroundColor Red
  exit 1
}

$py = $null
try { $py = (Get-Command python.exe -ErrorAction Stop).Source } catch {}
if (-not $py) {
  Write-Host "[course-membership-audit-worker] python.exe not found in PATH" -ForegroundColor Red
  exit 1
}

Write-Host ("[course-membership-audit-worker] starting (timeout {0}s)" -f $TimeoutSec) -ForegroundColor Green
# 기존 로그는 장애 분석에 쓰일 수 있으므로, 재기동이 아닌 일반 start에서는 삭제하지 않는다.
if ($Restart) {
  try { Remove-Item -Force -ErrorAction SilentlyContinue $outLog,$errLog | Out-Null } catch {}
}
$proc = Start-Process -FilePath $py -ArgumentList @('scripts\course_membership_audit_worker.py') -WorkingDirectory $root -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru
$procId = $proc.Id

$deadline = (Get-Date).AddSeconds([math]::Max(5,$TimeoutSec))
$ready = $false
do {
  Start-Sleep -Seconds 1
  $alive = $null -ne (Get-Process -Id $procId -ErrorAction SilentlyContinue)
  if (-not $alive) { break }
  try {
    if (Test-Path $statusPath) {
      $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $spid = $null
      try { if ($j.pid) { $spid = [int]$j.pid } } catch {}
      if ($spid -and $spid -eq $procId) { $ready = $true; break }
    }
  } catch {}
} while ((Get-Date) -lt $deadline)

$alive = $null -ne (Get-Process -Id $procId -ErrorAction SilentlyContinue)
if ($ready) {
  Write-Host ("[course-membership-audit-worker] READY pid={0}" -f $procId) -ForegroundColor Green
} elseif ($alive) {
  Write-Host ("[course-membership-audit-worker] STARTED pid={0} (status not ready). See logs {1} / {2}" -f $procId, $outLog, $errLog) -ForegroundColor Yellow
} else {
  Write-Host ("[course-membership-audit-worker] FAILED (process exited). See logs {0} / {1}" -f $outLog, $errLog) -ForegroundColor Red
  exit 1
}
