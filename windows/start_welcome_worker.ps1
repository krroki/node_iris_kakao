param(
  [int]$TimeoutSec = 45,
  [string]$LogDir = '',
  [switch]$SkipBuild,
  [int]$BuildTimeoutSec = 120,
  [switch]$Restart
)

# Force UTF-8 for logs/console to avoid mojibake in worker output
try { chcp 65001 | Out-Null } catch {}
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$botDir = Join-Path $root 'node-iris-app'
Set-Location -LiteralPath $botDir

if (-not $LogDir) { $LogDir = Join-Path $root 'windows\logs' }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$outLog = Join-Path $LogDir 'welcome_worker.out.log'
$errLog = Join-Path $LogDir 'welcome_worker.err.log'

$statusPath = Join-Path $botDir 'data\welcome_worker_status.json'
$workerEntry = Join-Path $botDir 'dist\workers\welcome_worker.js'

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
    $absRe = [Regex]::Escape($workerEntry)
    $relRe = 'dist[/\\]workers[/\\]welcome_worker\.js'
    return @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
      Where-Object { ($_.CommandLine -match $absRe) -or ($_.CommandLine -match $relRe) } |
      Select-Object ProcessId,CommandLine)
  } catch {
    return @()
  }
}

# Single-instance guard
$statusPid = Get-WorkerPidFromStatus
$statusProc = $null
if ($statusPid) {
  try {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$statusPid" -ErrorAction SilentlyContinue
    if ($p -and ($p.Name -eq 'node.exe')) {
      $absRe = [Regex]::Escape($workerEntry)
      $relRe = 'dist[/\\]workers[/\\]welcome_worker\.js'
      if (($p.CommandLine -match $absRe) -or ($p.CommandLine -match $relRe)) {
        $statusProc = [pscustomobject]@{ ProcessId = [int]$p.ProcessId; CommandLine = [string]$p.CommandLine }
      }
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
  Write-Host ("[welcome-worker] WARN: multiple worker processes detected: {0}" -f $pidsText) -ForegroundColor Yellow
  foreach ($proc in $workerProcs) {
    $procPid = [int]$proc.ProcessId
    if ($mainPid -and $procPid -eq $mainPid) { continue }
    try { Stop-Process -Id $procPid -Force -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Milliseconds 300
}

if ($mainPid) {
  if (-not $Restart) {
    Write-Host ("[welcome-worker] already running pid={0}; skip start (use -Restart to force)" -f $mainPid) -ForegroundColor Green
    return
  }
  Write-Host ("[welcome-worker] restart requested; stopping existing pid={0}" -f $mainPid) -ForegroundColor Yellow
  try { Stop-Process -Id $mainPid -Force -ErrorAction SilentlyContinue } catch {}
  Start-Sleep -Milliseconds 300
}

Write-Host '[welcome-worker] ensuring deps' -ForegroundColor Cyan
if (-not (Test-Path 'node_modules')) {
  $ciLog = Join-Path $LogDir ("welcome_worker.npm.ci." + (Get-Date -Format 'yyyyMMddHHmmss') + ".log")
  & cmd.exe /c "npm ci 1>> `"$ciLog`" 2>>&1"
}

function Build-IfNeeded {
  $needBuild = $false
  if (-not (Test-Path $workerEntry)) { $needBuild = $true }
  if (-not $SkipBuild -and -not $needBuild) {
    # 소스가 더 최신이면 빌드
    try {
      $distTime = (Get-Item -LiteralPath $workerEntry).LastWriteTimeUtc
      $srcDir = Join-Path $botDir 'src'
      $newer = Get-ChildItem -LiteralPath $srcDir -Recurse -File -Filter *.ts |
        Where-Object { $_.LastWriteTimeUtc -gt $distTime } |
        Select-Object -First 1
      if ($newer) { $needBuild = $true }
    } catch { $needBuild = $true }
  }

  if (-not $needBuild) {
    Write-Host '[welcome-worker] dist up-to-date; skip build' -ForegroundColor Yellow
    return $true
  }

  $buildLog = Join-Path $LogDir ("welcome_worker.build." + (Get-Date -Format 'yyyyMMddHHmmss') + ".log")
  try { Remove-Item -Force -ErrorAction SilentlyContinue $buildLog } catch {}
  Write-Host ("[welcome-worker] building -> {0}" -f $buildLog) -ForegroundColor Cyan

  $npmPath = $null
  try { $npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source } catch {
    Write-Error "[welcome-worker] npm not found in PATH"
    return $false
  }
  & $npmPath run --silent build *> $buildLog 2>&1
  $rc = $LASTEXITCODE
  if ($rc -ne 0) {
    Write-Error ("[welcome-worker] build failed (exit {0}) - see {1}" -f $rc, $buildLog)
    return $false
  }
  if (-not (Test-Path $workerEntry)) {
    Write-Error ("[welcome-worker] build completed but dist entry missing: {0}" -f $workerEntry)
    return $false
  }
  return $true
}

$buildOk = Build-IfNeeded
if (-not $buildOk) {
  Write-Host '[welcome-worker] aborting start due to build failure' -ForegroundColor Red
  exit 1
}

Write-Host "[welcome-worker] starting (timeout ${TimeoutSec}s)" -ForegroundColor Green
try { Remove-Item -Force -ErrorAction SilentlyContinue $outLog,$errLog | Out-Null } catch {}
$proc = Start-Process -FilePath node -ArgumentList @("`"$workerEntry`"") -WorkingDirectory $botDir -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru
$workerPid = $proc.Id

$deadline = (Get-Date).AddSeconds([math]::Max(5,$TimeoutSec))
$ready = $false
do {
  Start-Sleep -Seconds 1
  $alive = $null -ne (Get-Process -Id $workerPid -ErrorAction SilentlyContinue)
  if (-not $alive) { break }
  try {
    if (Test-Path $statusPath) {
      $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $spid = $null
      try { if ($j.pid) { $spid = [int]$j.pid } } catch {}
      if ($spid -and $spid -eq $workerPid) { $ready = $true; break }
    }
  } catch {}
} while ((Get-Date) -lt $deadline)

$alive = $null -ne (Get-Process -Id $workerPid -ErrorAction SilentlyContinue)
if ($ready) {
  Write-Host ("[welcome-worker] READY pid={0}" -f $workerPid) -ForegroundColor Green
} elseif ($alive) {
  Write-Host ("[welcome-worker] STARTED pid={0} (status not ready). See logs {1} / {2}" -f $workerPid, $outLog, $errLog) -ForegroundColor Yellow
} else {
  Write-Host ("[welcome-worker] FAILED (process exited). See logs {0} / {1}" -f $outLog, $errLog) -ForegroundColor Red
  exit 1
}
