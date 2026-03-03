param(
  # 湲곕낯 IRIS URL??Windows ?ы듃?꾨줉?쒓? ?꾨땶 ?ㅼ젣 ?⑤쭚 IP濡?媛뺤젣
  [string]$IrisUrl = 'http://127.0.0.1:5050',
  [switch]$Prod,
  [int]$TimeoutSec = 60,
  [string]$LogDir = '',
  [switch]$SkipBuild,
  [int]$BuildTimeoutSec = 120,
  [switch]$Restart
)

# Force UTF-8 for logs/console to avoid mojibake in bot output
chcp 65001 | Out-Null
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$botDir = Join-Path $root 'node-iris-app'
$distIndexAbs = Join-Path $botDir 'dist\index.js'
Set-Location $botDir

if (-not $LogDir) { $LogDir = Join-Path $root 'windows\logs' }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$outLog = Join-Path $LogDir 'bot.out.log'
$errLog = Join-Path $LogDir 'bot.err.log'

# Single-instance guard: if status PID alive and not restarting, exit
$existingPid = $null
$existingStartedAt = $null
try {
  $status = Get-Content (Join-Path $botDir 'data\status.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($status.pid) { $existingPid = [int]$status.pid }
  if ($status.startedAt) { $existingStartedAt = [string]$status.startedAt }
} catch {}

$needStart = $true
if ($existingPid) {
  try {
    # node.exe의 실행 경로는 Program Files 아래이므로 Path로 판별하지 말고 CommandLine로 판별한다.
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$existingPid" -ErrorAction SilentlyContinue
    # status.json의 pid는 node-iris-app이 직접 기록한 값이므로,
    # 범용 패턴(dist\index.js)로 다른 프로젝트를 종료하는 대신 "해당 PID만" 안전하게 다룬다.
    if ($p -and ($p.Name -eq 'node.exe')) {
      if (-not $Restart) {
        Write-Host ("[bot] already running pid={0}; skip start (use -Restart to force)" -f $existingPid) -ForegroundColor Green
        $needStart = $false
      } else {
        Write-Host ("[bot] restart requested; stopping existing pid={0}" -f $existingPid) -ForegroundColor Yellow
        try { Stop-Process -Id $existingPid -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
  } catch {}
}

if (-not $needStart) { return }

# Ensure previous stray bot processes are stopped to release log handles
try {
  # ⚠️ 절대 금지: "dist\\index.js" 같은 범용 패턴으로 node 전체를 정리하면 다른 프로젝트까지 종료된다.
  # node-iris-app 봇은 절대경로 distIndexAbs로 기동하므로, 이 경로가 포함된 프로세스만 정리한다.
  $absRe = [Regex]::Escape($distIndexAbs)
  $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match $absRe }
  foreach ($p in $procs) {
    if ($existingPid -and $p.ProcessId -eq $existingPid) { continue }
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    try {
      if (Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue) {
        wmic process where "ProcessId=$($p.ProcessId)" call terminate | Out-Null
      }
    } catch {}
  }
} catch {}

# Clear stale bot.lock (left from crashed or killed process)
$lockFile = Join-Path $botDir 'data\bot.lock'
if (Test-Path $lockFile) {
  $lockPid = $null
  try { $lockPid = [int](Get-Content -LiteralPath $lockFile -Raw) } catch {}
  $procAlive = $false
  if ($lockPid) {
    try { $procAlive = (Get-Process -Id $lockPid -ErrorAction SilentlyContinue) -ne $null } catch {}
  }
  $ageSec = 0
  try {
    $stat = Get-Item $lockFile
    $ageSec = ([DateTime]::UtcNow - $stat.CreationTimeUtc).TotalSeconds
  } catch {}
  if (-not $procAlive -or $ageSec -gt 600) {
    try {
      Remove-Item -LiteralPath $lockFile -Force -ErrorAction Stop
      $pidText = if ($lockPid) { $lockPid } else { 'n/a' }
      Write-Host ("[bot] cleared stale bot.lock (pid={0}, age={1:n0}s)" -f $pidText, [math]::Round($ageSec,0)) -ForegroundColor Yellow
    } catch { Write-Warning "[bot] failed to remove stale lock: $_" }
  }
}

Write-Host '[bot] ensuring deps' -ForegroundColor Cyan
if (-not (Test-Path 'node_modules')) {
  $ciLog = Join-Path $LogDir ("bot.npm.ci." + (Get-Date -Format 'yyyyMMddHHmmss') + ".log")
  & cmd.exe /c "npm ci 1>> `"$ciLog`" 2>>&1"
}

# Preflight: IRIS_URL 연결 가능 여부(베스트 에포트)
try {
  $u = [uri]$IrisUrl
  $host = $u.Host
  $port = if ($u.Port -gt 0) { $u.Port } else { if ($u.Scheme -eq 'https') { 443 } else { 80 } }
  $tnc = Test-NetConnection -ComputerName $host -Port $port -WarningAction SilentlyContinue
  if (-not $tnc.TcpTestSucceeded) {
    Write-Host ("[bot] WARN: IRIS_URL not reachable ({0}:{1}). Redroid는 기본 포트가 3000이며, portproxy(5050->3000)가 필요할 수 있습니다." -f $host, $port) -ForegroundColor Yellow
  }
} catch {}

# Always set IRIS_URL explicitly to avoid WSL/5050 portproxy
$env:IRIS_URL = $IrisUrl
# Always enable chat logging for this bot instance to keep dashboard/RAG in sync.
# 테스트 환경에서만 SAVE_CHAT_LOGS=false 를 명시적으로 덮어쓰도록 한다.
if (-not $env:SAVE_CHAT_LOGS -or [string]::IsNullOrWhiteSpace($env:SAVE_CHAT_LOGS)) {
  $env:SAVE_CHAT_LOGS = 'true'
}
# MessageStore는 burst 상황에서 로그 파일을 동시에 열어 EMFILE(too many open files)에 빠질 수 있으므로,
# 운영 기본값은 보수적으로 둔다(필요 시 env로 조정).
if (-not $env:MESSAGE_STORE_PERSIST_CONCURRENCY -or [string]::IsNullOrWhiteSpace($env:MESSAGE_STORE_PERSIST_CONCURRENCY)) {
  $env:MESSAGE_STORE_PERSIST_CONCURRENCY = '2'
}
# SAFE_MODE 환경변수는 컨트롤러 등록에 사용하지 않고,
# node-iris-app/config/runtime.json.safeMode 값을 단일 소스로 사용한다.
# 기본값은 runtime.json에서 safeMode=true 이며, UI(기능별 관리)로만 토글한다.

# Allowed room 목록은 runtime.json의 allowedRoomIds를 사용한다.
# 여기서는 ALLOWED_ROOM_IDS를 강제로 덮어쓰지 않는다.
# Realtime API ?ы듃(uvicorn): 湲곕낯 8650?쇰줈 ?щ━誘濡??몃뱶?먯꽌 /send/talkapi/dispatch ?몄텧???ㅽ뙣?섏? ?딄쾶 ?ㅼ젙
if (-not $env:REALTIME_API_BASE -or [string]::IsNullOrWhiteSpace($env:REALTIME_API_BASE)) {
  $env:REALTIME_API_BASE = 'http://127.0.0.1:8650'
}

function Start-BuildIfNeeded {
  param([switch]$Force)
  $distIndex = Join-Path (Get-Location) 'dist\index.js'

  # 빌드 여부 결정: SkipBuild라도 dist가 없으면 강제 빌드
  $shouldBuild = $Force -or -not $SkipBuild -or -not (Test-Path $distIndex)
  if (-not $shouldBuild) {
    Write-Host '[bot] SkipBuild set; dist/index.js exists; skip build' -ForegroundColor Yellow
    return $true
  }

  $buildLog = Join-Path $LogDir ("bot.build." + (Get-Date -Format 'yyyyMMddHHmmss') + ".log")
  try { Remove-Item -Force -ErrorAction SilentlyContinue $buildLog } catch {}
  Write-Host ("[bot] building (timeout {0}s) -> {1}" -f $BuildTimeoutSec, $buildLog) -ForegroundColor Cyan

  # npm 경로 고정 (백그라운드 세션 PATH 누락 대응)
  $npmPath = $null
  try { $npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source } catch {
    Write-Error "[bot] npm not found in PATH"
    return $false
  }
  # 동기 실행 (cmd를 통해 리다이렉션 처리, timeout은 Start-Process + Wait)
  # cmd.exe /c `"C:\Program Files\nodejs\npm.cmd`" run --silent build >"log" 2>&1
  # 동기 빌드 실행 (node-iris-app 경로에서 PATH 상의 npm 호출)
  & $npmPath run --silent build *> $buildLog 2>&1
  $rc = $LASTEXITCODE

  if ($rc -ne 0) {
    Write-Error ("[bot] build failed (exit {0}) - see {1}" -f $rc, $buildLog)
    return $false
  }

  if (-not (Test-Path $distIndex)) {
    Write-Error ("[bot] build completed but dist/index.js missing (see {0})" -f $buildLog)
    return $false
  }

  return $true
}

$buildOk = Start-BuildIfNeeded
if (-not $buildOk) {
  Write-Host '[bot] aborting start due to build failure' -ForegroundColor Red
  exit 1
}

Write-Host "[bot] starting (timeout ${TimeoutSec}s)" -ForegroundColor Green
try { Remove-Item -Force -ErrorAction SilentlyContinue $outLog,$errLog } catch {}
$botProc = Start-Process -FilePath node -ArgumentList @("`"$distIndexAbs`"") -WorkingDirectory $botDir -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru
$spawnPid = $botProc.Id

# Readiness (best-effort):
# - Start-Process 자체로 pid를 확보하고,
# - status.json이 해당 pid로 갱신되면 READY 처리한다.
# - Timeout이 나더라도 프로세스가 살아 있으면 "STARTED"로 처리해 불필요한 스트레스를 줄인다.
$statusPath = Join-Path $botDir 'data\status.json'
$deadline = (Get-Date).AddSeconds([math]::Max(5,$TimeoutSec))
$ready = $false
do {
  Start-Sleep -Seconds 1
  $alive = $null -ne (Get-Process -Id $spawnPid -ErrorAction SilentlyContinue)
  if (-not $alive) { break }
  try {
    if (Test-Path $statusPath) {
      $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $statusPid = $null
      try { if ($j.pid) { $statusPid = [int]$j.pid } } catch {}
      if ($statusPid -and $statusPid -eq $spawnPid) {
        $ready = $true
        break
      }
    }
  } catch { }
} while ((Get-Date) -lt $deadline)

$alive = $null -ne (Get-Process -Id $spawnPid -ErrorAction SilentlyContinue)
if ($ready) {
  Write-Host ("[bot] READY pid={0}" -f $spawnPid) -ForegroundColor Green
} elseif ($alive) {
  Write-Host ("[bot] STARTED pid={0} (status.json not ready yet). See logs at {1} / {2}" -f $spawnPid, $outLog, $errLog) -ForegroundColor Yellow
} else {
  Write-Host ("[bot] FAILED (process exited). See logs at {0} / {1}" -f $outLog, $errLog) -ForegroundColor Red
  exit 1
}
