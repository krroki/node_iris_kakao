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
$outLog = Join-Path $LogDir 'broadcast_worker.out.log'
$errLog = Join-Path $LogDir 'broadcast_worker.err.log'

$statusPath = Join-Path $botDir 'data\broadcast_worker_status.json'
$workerEntry = Join-Path $botDir 'dist\workers\broadcast_worker.js'

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
    $relRe = 'dist[/\\]workers[/\\]broadcast_worker\.js'
    return @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { ($_.CommandLine -match $absRe) -or ($_.CommandLine -match $relRe) } |
      Select-Object ProcessId,CommandLine,CreationDate)
  } catch {
    return @()
  }
}

# Single-instance guard (+ 중복 프로세스 정리)
$workerProcs = Find-WorkerProcs
$sorted = @($workerProcs | Sort-Object -Property CreationDate -Descending)

if ($sorted.Count -gt 0) {
  $keepPid = [int]$sorted[0].ProcessId
  $allPids = @($sorted | ForEach-Object { [int]$_.ProcessId } | Sort-Object)
  $killPids = @($sorted | Select-Object -Skip 1 | ForEach-Object { [int]$_.ProcessId } | Sort-Object)

  if ($Restart) {
    Write-Host ("[broadcast-worker] restart requested; stopping existing worker(s): {0}" -f ($allPids -join ',')) -ForegroundColor Yellow
    foreach ($procId in $allPids) {
      try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch {}
    }
    Start-Sleep -Milliseconds 400
  } else {
    if ($killPids.Count -gt 0) {
      Write-Host ("[broadcast-worker] WARN: multiple workers detected; keeping newest pid={0}, killing {1}" -f $keepPid, ($killPids -join ',')) -ForegroundColor Yellow
      foreach ($procId in $killPids) {
        try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch {}
      }
      Start-Sleep -Milliseconds 300
    }
    Write-Host ("[broadcast-worker] already running pid={0}; skip start (use -Restart to force)" -f $keepPid) -ForegroundColor Green
    return
  }
}

Write-Host '[broadcast-worker] ensuring deps' -ForegroundColor Cyan
if (-not (Test-Path 'node_modules')) {
  $ciLog = Join-Path $LogDir ("broadcast_worker.npm.ci." + (Get-Date -Format 'yyyyMMddHHmmss') + ".log")
  & cmd.exe /c "npm ci 1>> `"$ciLog`" 2>>&1"
}

function Build-IfNeeded {
  $needBuild = $false
  if (-not (Test-Path $workerEntry)) { $needBuild = $true }
  if (-not $SkipBuild -and -not $needBuild) {
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
    Write-Host '[broadcast-worker] dist up-to-date; skip build' -ForegroundColor Yellow
    return $true
  }

  $buildLog = Join-Path $LogDir ("broadcast_worker.build." + (Get-Date -Format 'yyyyMMddHHmmss') + ".log")
  try { Remove-Item -Force -ErrorAction SilentlyContinue $buildLog } catch {}
  Write-Host ("[broadcast-worker] building -> {0}" -f $buildLog) -ForegroundColor Cyan

  $npmPath = $null
  try { $npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source } catch {
    Write-Error "[broadcast-worker] npm not found in PATH"
    return $false
  }
  & $npmPath run --silent build *> $buildLog 2>&1
  $rc = $LASTEXITCODE
  if ($rc -ne 0) {
    Write-Error ("[broadcast-worker] build failed (exit {0}) - see {1}" -f $rc, $buildLog)
    return $false
  }
  if (-not (Test-Path $workerEntry)) {
    Write-Error ("[broadcast-worker] build completed but dist entry missing: {0}" -f $workerEntry)
    return $false
  }
  return $true
}

$buildOk = Build-IfNeeded
if (-not $buildOk) {
  Write-Host '[broadcast-worker] aborting start due to build failure' -ForegroundColor Red
  exit 1
}

Write-Host "[broadcast-worker] starting (timeout ${TimeoutSec}s)" -ForegroundColor Green
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
  Write-Host ("[broadcast-worker] READY pid={0}" -f $workerPid) -ForegroundColor Green
} elseif ($alive) {
  Write-Host ("[broadcast-worker] STARTED pid={0} (status not ready). See logs {1} / {2}" -f $workerPid, $outLog, $errLog) -ForegroundColor Yellow
} else {
  Write-Host ("[broadcast-worker] FAILED (process exited). See logs {0} / {1}" -f $outLog, $errLog) -ForegroundColor Red
  exit 1
}
