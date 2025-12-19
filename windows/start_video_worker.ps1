param(
  [int]$TimeoutSec = 90,
  [string]$LogDir = '',
  [string]$IrisUrl = 'http://127.0.0.1:5050',
  [switch]$SkipBuild,
  [int]$BuildTimeoutSec = 240,
  [switch]$Restart
)

# Force UTF-8 for logs/console to avoid mojibake in worker output
try { chcp 65001 | Out-Null } catch {}
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$botDir = Join-Path $root 'node-iris-app'
Set-Location -LiteralPath $botDir

# Always set IRIS_URL explicitly so `.env`(legacy WSL/remote) 값에 의해 깨지지 않도록 한다.
if ($IrisUrl) {
  $env:IRIS_URL = $IrisUrl
  $env:IRIS_BRIDGE_URL = $IrisUrl
}

# Gemini 웹 자동화 기본값(운영 안전)
if (-not $env:GEMINI_WEB_CHANNEL) {
  $chromeCandidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { $_ -and (Test-Path $_) }
  if ($chromeCandidates.Count -gt 0) { $env:GEMINI_WEB_CHANNEL = 'chrome' }
}
if (-not $env:GEMINI_WEB_VIDEO_HEADLESS) { $env:GEMINI_WEB_VIDEO_HEADLESS = '0' }

# 동영상 워커 기본 동시 처리(슬롯) 수: 1~3
if (-not $env:VIDEO_WORKER_MAX_CONCURRENCY) { $env:VIDEO_WORKER_MAX_CONCURRENCY = '3' }

# 동영상 워커는 이미지 워커와 프로필을 분리한다(동시에 실행될 수 있으므로 profile lock 충돌 방지).
if (-not $env:GEMINI_WEB_VIDEO_USER_DATA_DIR) { $env:GEMINI_WEB_VIDEO_USER_DATA_DIR = (Join-Path $botDir 'data\gemini_web_video_profile') }

if (-not $LogDir) { $LogDir = Join-Path $root 'windows\logs' }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$outLog = Join-Path $LogDir 'video_worker.out.log'
$errLog = Join-Path $LogDir 'video_worker.err.log'

$statusPath = Join-Path $botDir 'data\video_worker_status.json'
$workerEntry = Join-Path $botDir 'dist\workers\video_worker.js'

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
    $relRe = 'dist[/\\]workers[/\\]video_worker\.js'
    return @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
      Where-Object { ($_.CommandLine -match $absRe) -or ($_.CommandLine -match $relRe) } |
      Select-Object ProcessId,CommandLine)
  } catch {
    return @()
  }
}

# Single-instance guard (+ 중복 프로세스 정리)
$statusPid = Get-WorkerPidFromStatus
$statusProc = $null
if ($statusPid) {
  try {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$statusPid" -ErrorAction SilentlyContinue
    if ($p -and ($p.Name -eq 'node.exe')) {
      $absRe = [Regex]::Escape($workerEntry)
      $relRe = 'dist[/\\]workers[/\\]video_worker\.js'
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
  Write-Host ("[video-worker] WARN: multiple worker processes detected: {0}" -f $pidsText) -ForegroundColor Yellow
  foreach ($proc in $workerProcs) {
    $procPid = [int]$proc.ProcessId
    if ($mainPid -and $procPid -eq $mainPid) { continue }
    try { Stop-Process -Id $procPid -Force -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Milliseconds 300
}

if ($mainPid) {
  if (-not $Restart) {
    Write-Host ("[video-worker] already running pid={0}; skip start (use -Restart to force)" -f $mainPid) -ForegroundColor Green
    return
  }
  Write-Host ("[video-worker] restart requested; stopping existing pid={0}" -f $mainPid) -ForegroundColor Yellow
  try { Stop-Process -Id $mainPid -Force -ErrorAction SilentlyContinue } catch {}
  Start-Sleep -Milliseconds 300
}

# 프로필 준비:
# - 동영상 워커는 GEMINI_WEB_VIDEO_USER_DATA_DIR(기본: data/gemini_web_video_profile)를 사용한다.
# - 최초 기동 시 이미지 워커의 로그인 세션 프로필을 복제해 동영상 워커도 즉시 사용 가능하게 만든다(재로그인 최소화).
try {
  $baseVideoProfile = $env:GEMINI_WEB_VIDEO_USER_DATA_DIR
  if (-not $baseVideoProfile) { $baseVideoProfile = (Join-Path $botDir 'data\gemini_web_video_profile') }

  if (-not (Test-Path $baseVideoProfile)) {
    $baseImageProfile = $env:GEMINI_WEB_USER_DATA_DIR
    if (-not $baseImageProfile) { $baseImageProfile = (Join-Path $botDir 'data\gemini_web_profile') }
    if (Test-Path $baseImageProfile) {
      Write-Host ("[video-worker] cloning gemini image profile -> {0}" -f $baseVideoProfile) -ForegroundColor Cyan
      Copy-Item -LiteralPath $baseImageProfile -Destination $baseVideoProfile -Recurse -Force -ErrorAction SilentlyContinue | Out-Null
    } else {
      Write-Host ("[video-worker] WARN: gemini base profile not found: {0}" -f $baseImageProfile) -ForegroundColor Yellow
      Write-Host "[video-worker]      먼저 로그인 세션을 만들어주세요: node dist\\workers\\video_worker.js --init-gemini-session" -ForegroundColor Yellow
    }
  }

  $c = [int]$env:VIDEO_WORKER_MAX_CONCURRENCY
  if ($c -gt 1 -and (Test-Path $baseVideoProfile)) {
    for ($i = 2; $i -le $c; $i += 1) {
      $target = "${baseVideoProfile}_$i"
      if (-not (Test-Path $target)) {
        Write-Host ("[video-worker] cloning gemini video profile -> {0}" -f $target) -ForegroundColor Cyan
        Copy-Item -LiteralPath $baseVideoProfile -Destination $target -Recurse -Force -ErrorAction SilentlyContinue | Out-Null
      }
    }
  }
} catch {}

Write-Host '[video-worker] ensuring deps' -ForegroundColor Cyan
if (-not (Test-Path 'node_modules')) {
  $ciLog = Join-Path $LogDir ("video_worker.npm.ci." + (Get-Date -Format 'yyyyMMddHHmmss') + ".log")
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
    Write-Host '[video-worker] dist up-to-date; skip build' -ForegroundColor Yellow
    return $true
  }

  $buildLog = Join-Path $LogDir ("video_worker.build." + (Get-Date -Format 'yyyyMMddHHmmss') + ".log")
  try { Remove-Item -Force -ErrorAction SilentlyContinue $buildLog } catch {}
  Write-Host ("[video-worker] building -> {0}" -f $buildLog) -ForegroundColor Cyan

  $npmPath = $null
  try { $npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source } catch {
    Write-Error "[video-worker] npm not found in PATH"
    return $false
  }

  & $npmPath run --silent build *> $buildLog 2>&1
  $rc = $LASTEXITCODE
  if ($rc -ne 0) {
    Write-Error ("[video-worker] build failed (exit {0}) - see {1}" -f $rc, $buildLog)
    return $false
  }
  if (-not (Test-Path $workerEntry)) {
    Write-Error ("[video-worker] build completed but dist entry missing: {0}" -f $workerEntry)
    return $false
  }
  return $true
}

$buildOk = Build-IfNeeded
if (-not $buildOk) {
  Write-Host '[video-worker] aborting start due to build failure' -ForegroundColor Red
  exit 1
}

Write-Host "[video-worker] starting (timeout ${TimeoutSec}s)" -ForegroundColor Green
function Rotate-LogFile {
  param([string]$Path)
  if (-not $Path) { return }
  if (-not (Test-Path -LiteralPath $Path)) { return }
  try {
    $ts = Get-Date -Format 'yyyyMMdd_HHmmss'
    $dir = Split-Path -Parent $Path
    $base = [IO.Path]::GetFileNameWithoutExtension($Path)
    $ext = [IO.Path]::GetExtension($Path)
    $dst = Join-Path $dir ("{0}.{1}{2}" -f $base, $ts, $ext)
    Move-Item -LiteralPath $Path -Destination $dst -Force -ErrorAction SilentlyContinue | Out-Null
  } catch {}
}

Rotate-LogFile -Path $outLog
Rotate-LogFile -Path $errLog
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
  Write-Host ("[video-worker] READY pid={0}" -f $workerPid) -ForegroundColor Green
} elseif ($alive) {
  Write-Host ("[video-worker] STARTED pid={0} (status not ready). See logs {1} / {2}" -f $workerPid, $outLog, $errLog) -ForegroundColor Yellow
} else {
  Write-Host ("[video-worker] FAILED (process exited). See logs {0} / {1}" -f $outLog, $errLog) -ForegroundColor Red
  exit 1
}

