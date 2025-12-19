param(
  [int]$TimeoutSec = 60,
  [string]$LogDir = '',
  [string]$IrisUrl = 'http://127.0.0.1:5050',
  [switch]$SkipBuild,
  [int]$BuildTimeoutSec = 180,
  [switch]$Restart
)

# Force UTF-8 for logs/console to avoid mojibake in worker output
try { chcp 65001 | Out-Null } catch {}
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$botDir = Join-Path $root 'node-iris-app'
Set-Location -LiteralPath $botDir

# Always set IRIS_URL explicitly so `.env`(legacy WSL/remote) 값에 덮이지 않도록 한다.
if ($IrisUrl) {
  $env:IRIS_URL = $IrisUrl
  $env:IRIS_BRIDGE_URL = $IrisUrl
}

# Gemini 웹 자동화 기본값(운영 편의)
# - Google이 Playwright 기본 Chromium 로그인을 "안전하지 않음"으로 차단하는 케이스가 있어,
#   기본 채널을 설치된 Chrome으로 맞춘다(환경변수로 언제든 오버라이드 가능).
if (-not $env:GEMINI_WEB_CHANNEL) {
  $chromeCandidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { $_ -and (Test-Path $_) }
  if ($chromeCandidates.Count -gt 0) { $env:GEMINI_WEB_CHANNEL = 'chrome' }
}
if (-not $env:GEMINI_WEB_HEADLESS) { $env:GEMINI_WEB_HEADLESS = '0' }

# 이미지 워커 기본 동시 처리(슬롯) 수
# - Gemini 웹 자동화는 세션(프로필) 단위로 병렬화가 가능하므로 기본값을 3으로 둔다.
# - 필요 시 환경변수로 오버라이드: IMAGE_WORKER_MAX_CONCURRENCY=1|2|3
if (-not $env:IMAGE_WORKER_MAX_CONCURRENCY) { $env:IMAGE_WORKER_MAX_CONCURRENCY = '3' }

if (-not $LogDir) { $LogDir = Join-Path $root 'windows\logs' }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$outLog = Join-Path $LogDir 'image_worker.out.log'
$errLog = Join-Path $LogDir 'image_worker.err.log'

$statusPath = Join-Path $botDir 'data\image_worker_status.json'
$workerEntry = Join-Path $botDir 'dist\workers\image_worker.js'

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
    $relRe = 'dist[/\\]workers[/\\]image_worker\.js'
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
      $relRe = 'dist[/\\]workers[/\\]image_worker\.js'
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
  Write-Host ("[image-worker] WARN: multiple worker processes detected: {0}" -f $pidsText) -ForegroundColor Yellow
  foreach ($proc in $workerProcs) {
    $procPid = [int]$proc.ProcessId
    if ($mainPid -and $procPid -eq $mainPid) { continue }
    try { Stop-Process -Id $procPid -Force -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Milliseconds 300
}

if ($mainPid) {
  if (-not $Restart) {
    Write-Host ("[image-worker] already running pid={0}; skip start (use -Restart to force)" -f $mainPid) -ForegroundColor Green
    return
  }
  Write-Host ("[image-worker] restart requested; stopping existing pid={0}" -f $mainPid) -ForegroundColor Yellow
  try { Stop-Process -Id $mainPid -Force -ErrorAction SilentlyContinue } catch {}
  Start-Sleep -Milliseconds 300
}

# 멀티 슬롯 사용 시(2~3) Gemini 웹 프로필 디렉터리를 준비한다.
# - 이미 로그인된 1번 프로필을 복제해 두면, 추가 로그인 없이 병렬 처리가 가능하다.
# - 단, Google 정책/세션 만료에 따라 재로그인이 필요할 수 있다.
# - 실행 중인 브라우저/프로필 파일과 충돌을 피하기 위해, (재시작 시) 기존 워커 종료 후에 수행한다.
try {
  $c = [int]$env:IMAGE_WORKER_MAX_CONCURRENCY
  if ($c -gt 1) {
    $baseProfile = $env:GEMINI_WEB_USER_DATA_DIR
    if (-not $baseProfile) { $baseProfile = (Join-Path $botDir 'data\gemini_web_profile') }
    if (Test-Path $baseProfile) {
      for ($i = 2; $i -le $c; $i += 1) {
        $target = "${baseProfile}_$i"
        if (-not (Test-Path $target)) {
          Write-Host ("[image-worker] cloning gemini profile -> {0}" -f $target) -ForegroundColor Cyan
          Copy-Item -LiteralPath $baseProfile -Destination $target -Recurse -Force -ErrorAction SilentlyContinue | Out-Null
        }
      }
    } else {
      Write-Host ("[image-worker] WARN: gemini profile not found: {0}" -f $baseProfile) -ForegroundColor Yellow
      Write-Host "[image-worker]      먼저 세션 초기화(로그인)를 한 번 수행하세요: node dist\\workers\\image_worker.js --init-gemini-session" -ForegroundColor Yellow
    }
  }
} catch {}

Write-Host '[image-worker] ensuring deps' -ForegroundColor Cyan
if (-not (Test-Path 'node_modules')) {
  $ciLog = Join-Path $LogDir ("image_worker.npm.ci." + (Get-Date -Format 'yyyyMMddHHmmss') + ".log")
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
    Write-Host '[image-worker] dist up-to-date; skip build' -ForegroundColor Yellow
    return $true
  }

  $buildLog = Join-Path $LogDir ("image_worker.build." + (Get-Date -Format 'yyyyMMddHHmmss') + ".log")
  try { Remove-Item -Force -ErrorAction SilentlyContinue $buildLog } catch {}
  Write-Host ("[image-worker] building -> {0}" -f $buildLog) -ForegroundColor Cyan

  $npmPath = $null
  try { $npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source } catch {
    Write-Error "[image-worker] npm not found in PATH"
    return $false
  }
  & $npmPath run --silent build *> $buildLog 2>&1
  $rc = $LASTEXITCODE
  if ($rc -ne 0) {
    Write-Error ("[image-worker] build failed (exit {0}) - see {1}" -f $rc, $buildLog)
    return $false
  }
  if (-not (Test-Path $workerEntry)) {
    Write-Error ("[image-worker] build completed but dist entry missing: {0}" -f $workerEntry)
    return $false
  }
  return $true
}

$buildOk = Build-IfNeeded
if (-not $buildOk) {
  Write-Host '[image-worker] aborting start due to build failure' -ForegroundColor Red
  exit 1
}

Write-Host "[image-worker] starting (timeout ${TimeoutSec}s)" -ForegroundColor Green
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
  Write-Host ("[image-worker] READY pid={0}" -f $workerPid) -ForegroundColor Green
} elseif ($alive) {
  Write-Host ("[image-worker] STARTED pid={0} (status not ready). See logs {1} / {2}" -f $workerPid, $outLog, $errLog) -ForegroundColor Yellow
} else {
  Write-Host ("[image-worker] FAILED (process exited). See logs {0} / {1}" -f $outLog, $errLog) -ForegroundColor Red
  exit 1
}
