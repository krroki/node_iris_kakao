param(
  [string]$IrisUrl = 'http://127.0.0.1:5050',
  [int]$ApiPort = 8650,
  [int]$WebPort = 3100,
  # 기본은 IPv6 dual-stack(::) 바인딩으로 `localhost`(::1) / `127.0.0.1` 모두에서 접근 가능하게 한다.
  # VM/다른 기기에서 접근이 필요하면 0.0.0.0(IPv4) 또는 ::(IPv6)로 지정.
  [string]$WebHostname = '::',
  [switch]$NoWatchdog,
  # watchdog에서 start_all을 호출해 파이프라인을 복구할 때는,
  # start_all이 watchdog 프로세스를 죽이면(현재 PowerShell) 자기 자신을 종료시키는 문제가 생긴다.
  # 이 옵션이 켜져 있으면 기존 watchdog를 종료하지 않는다(대신 start_all은 -NoWatchdog로 호출하는 것을 권장).
  [switch]$PreserveWatchdog
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

# NOTE: start_all은 "콜드 부팅/전체 복구" 용도이며, 운영 기본은 부분 재기동이다(agents.md 참조).
# 또한 node.exe를 "dist\\index.js" 같은 범용 패턴으로 정리하면 다른 프로젝트까지 종료될 수 있으므로 절대 금지한다.

# Pre-clean: stop leftover API/bot/web processes for this repo
function Stop-ProcsByPredicate {
  param([scriptblock]$Match)
  try {
    $procs = Get-CimInstance Win32_Process |
      Where-Object { $_.Name -in @('node.exe','python.exe') } |
      Where-Object $Match
    foreach ($p in $procs) {
      try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
      try {
        if (Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue) {
          wmic process where "ProcessId=$($p.ProcessId)" call terminate | Out-Null
        }
      } catch {}
    }
  } catch {}
}

function Stop-PidFromStatusJson {
  param([string]$StatusPath, [string]$Label)
  try {
    if (-not (Test-Path $StatusPath)) { return }
    $j = Get-Content -LiteralPath $StatusPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $pid = $null
    try { if ($j.pid) { $pid = [int]$j.pid } } catch { $pid = $null }
    if (-not $pid) { return }
    $p = Get-Process -Id $pid -ErrorAction SilentlyContinue
    if (-not $p) { return }
    Write-Host ("[all] stopping {0} pid={1} (from {2})" -f $Label, $pid, $StatusPath) -ForegroundColor Yellow
    try { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue } catch {}
    try { wmic process where "ProcessId=$pid" call terminate | Out-Null } catch {}
  } catch {}
}

$repoPath = [Regex]::Escape($root)
Write-Host '[all] pre-cleaning old processes'
if (-not $PreserveWatchdog) {
  # 기존 watchdog가 실행 중이면, 기동 도중 web/bot을 다시 올려 로그 핸들을 잡는 경쟁이 발생할 수 있으므로 먼저 종료한다.
  try {
    Get-CimInstance Win32_Process |
      Where-Object { $_.Name -in @('powershell.exe','pwsh.exe') } |
      Where-Object { $_.CommandLine -match 'watchdog\.ps1' -and $_.CommandLine -match $repoPath } |
      ForEach-Object {
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
        try { wmic process where "ProcessId=$($_.ProcessId)" call terminate | Out-Null } catch {}
      }
  } catch {}
}
Stop-ProcsByPredicate { $_.CommandLine -match 'uvicorn' -and $_.CommandLine -match 'server.app:app' }
Stop-ProcsByPredicate { $_.CommandLine -match 'node-iris-app' -and $_.CommandLine -match $repoPath }
# 상태 파일 PID 기반 정리(안전): node-iris-app 및 각 worker가 직접 기록한 PID만 종료한다.
Stop-PidFromStatusJson (Join-Path $root 'node-iris-app\data\status.json') 'bot'
Stop-PidFromStatusJson (Join-Path $root 'node-iris-app\data\welcome_worker_status.json') 'welcome-worker'
Stop-PidFromStatusJson (Join-Path $root 'node-iris-app\data\ai_worker_status.json') 'ai-worker'
Stop-PidFromStatusJson (Join-Path $root 'node-iris-app\data\broadcast_worker_status.json') 'broadcast-worker'
Stop-PidFromStatusJson (Join-Path $root 'node-iris-app\data\command_worker_status.json') 'command-worker'
Stop-PidFromStatusJson (Join-Path $root 'node-iris-app\data\roster_worker_status.json') 'roster-worker'
Stop-PidFromStatusJson (Join-Path $root 'node-iris-app\data\openchat_members_sheets_worker_status.json') 'openchat-members-sheets-worker'
Stop-ProcsByPredicate { $_.CommandLine -match 'web\\node_modules\\next' -and $_.CommandLine -match $repoPath }
Stop-ProcsByPredicate { $_.CommandLine -match 'web\\node_modules\\\.bin\\' -and $_.CommandLine -match 'next' -and $_.CommandLine -match $repoPath }
Stop-ProcsByPredicate { $_.CommandLine -match 'next\\dist\\server\\lib\\start-server.js' -and $_.CommandLine -match $repoPath }

# 공통 ENV: Realtime API / IRIS 브리지 / KB 스케줄러 (Windows 전용 스택)
$env:REALTIME_API_BASE = "http://127.0.0.1:$ApiPort"
$env:NEXT_PUBLIC_REALTIME_BASE = $env:REALTIME_API_BASE
$env:TEMPLATE_ASSETS_BASE = "$($env:REALTIME_API_BASE)/templates/"

# Welcome 분리(ADR-0027): 기본은 worker가 발신 담당. 레거시(bot)로 롤백이 필요하면 WELCOME_DISPATCHER=bot 설정.
if (-not $env:WELCOME_DISPATCHER -or [string]::IsNullOrWhiteSpace($env:WELCOME_DISPATCHER)) { $env:WELCOME_DISPATCHER = 'worker' }
# AI 분리(ADR-0028): 기본은 ai-worker가 `?디하클` 응답 담당. 레거시(bot)로 롤백이 필요하면 AI_DISPATCHER=bot 설정.
if (-not $env:AI_DISPATCHER -or [string]::IsNullOrWhiteSpace($env:AI_DISPATCHER)) { $env:AI_DISPATCHER = 'worker' }
# 공지/브로드캐스트 분리(ADR-0029): 기본은 broadcast-worker가 공지/브로드캐스트 발신 담당.
if (-not $env:ANNOUNCEMENT_DISPATCHER -or [string]::IsNullOrWhiteSpace($env:ANNOUNCEMENT_DISPATCHER)) { $env:ANNOUNCEMENT_DISPATCHER = 'worker' }
if (-not $env:BROADCAST_DISPATCHER -or [string]::IsNullOrWhiteSpace($env:BROADCAST_DISPATCHER)) { $env:BROADCAST_DISPATCHER = 'worker' }
# KB 자동화 스케줄 기본값(분) – collect: 30, embed: 30, manual: 60, backfill: 60
if (-not $env:KB_SCHED_COLLECT_MIN)  { $env:KB_SCHED_COLLECT_MIN  = '30' }
if (-not $env:KB_SCHED_EMBED_MIN)    { $env:KB_SCHED_EMBED_MIN    = '30' }
if (-not $env:KB_SCHED_MANUAL_MIN)   { $env:KB_SCHED_MANUAL_MIN   = '60' }
if (-not $env:KB_SCHED_BACKFILL_MIN) { $env:KB_SCHED_BACKFILL_MIN = '60' }
if ($IrisUrl) {
  $env:IRIS_URL = $IrisUrl
  $env:IRIS_BRIDGE_URL = $IrisUrl
}

Write-Host '[all] starting API'
& (Join-Path $PSScriptRoot 'start_api.ps1') -Port $ApiPort -TimeoutSec 45

Start-Sleep -Seconds 1

# Talk-API authHeader: data/talkapi_auth.txt → /runtime talkApi.authHeader (best-effort)
try {
  $ensure = Join-Path $root 'scripts\ensure_talkapi_auth_applied.ps1'
  if (Test-Path $ensure) {
    Write-Host '[all] ensuring Talk-API authHeader from file (best-effort)'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ensure -RealtimeApiBase $env:REALTIME_API_BASE -MinIntervalSec 60 | ForEach-Object { Write-Host "[all] $_" }
  }
} catch {
  Write-Host ("[all] Talk-API auth ensure skipped: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
}

# Start KB service (8610) with same ENV (KB_SCHED_*)
if ($env:KB_POSTGRES_ENSURE_DISABLE -ne '1') {
  $ensurePg = Join-Path $PSScriptRoot 'ensure_postgres.ps1'
  if (Test-Path $ensurePg) {
    Write-Host '[all] ensuring KB postgres (docker compose)'
    try {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ensurePg -TimeoutSec 180 2>&1 | ForEach-Object { Write-Host "[all] $_" }
    } catch {
      Write-Host ("[all] ensure_postgres 실패(계속 진행): {0}" -f $_.Exception.Message) -ForegroundColor Yellow
    }
  } else {
    Write-Host ("[all] ensure_postgres.ps1 없음: {0} (계속 진행)" -f $ensurePg) -ForegroundColor Yellow
  }
} else {
  Write-Host "[all] KB postgres ensure skipped (KB_POSTGRES_ENSURE_DISABLE=1)" -ForegroundColor Yellow
}

Write-Host '[all] starting KB service'
& (Join-Path $PSScriptRoot 'kb_service.ps1') -Port 8610 -TimeoutSec 45

Start-Sleep -Seconds 1

Write-Host '[all] starting bot'
$botDir = Join-Path $root 'node-iris-app'
$distIndex = Join-Path $botDir 'dist\index.js'
$skipBotBuild = $true
try {
  if (-not (Test-Path $distIndex)) {
    $skipBotBuild = $false
  } else {
    $distTime = (Get-Item -LiteralPath $distIndex).LastWriteTimeUtc
    $srcDir = Join-Path $botDir 'src'
    if (-not (Test-Path $srcDir)) {
      $skipBotBuild = $false
    } else {
      $newer = Get-ChildItem -LiteralPath $srcDir -Recurse -File -Filter *.ts |
        Where-Object { $_.LastWriteTimeUtc -gt $distTime } |
        Select-Object -First 1
      if ($newer) { $skipBotBuild = $false }
    }
  }
} catch {
  $skipBotBuild = $false
}
if ($skipBotBuild) {
  & (Join-Path $PSScriptRoot 'start_bot.ps1') -IrisUrl "$IrisUrl" -TimeoutSec 40 -SkipBuild
} else {
  & (Join-Path $PSScriptRoot 'start_bot.ps1') -IrisUrl "$IrisUrl" -TimeoutSec 40
}

Start-Sleep -Seconds 1

if (($env:WELCOME_DISPATCHER -as [string]).Trim().ToLower() -ne 'bot' -and $env:WELCOME_WORKER_DISABLE -ne '1') {
  Write-Host '[all] starting welcome-worker'
  & (Join-Path $PSScriptRoot 'start_welcome_worker.ps1') -TimeoutSec 40
  Start-Sleep -Seconds 1
} else {
  Write-Host ("[all] welcome-worker skipped (WELCOME_DISPATCHER={0}, WELCOME_WORKER_DISABLE={1})" -f $env:WELCOME_DISPATCHER, $env:WELCOME_WORKER_DISABLE) -ForegroundColor Yellow
}

if (($env:AI_DISPATCHER -as [string]).Trim().ToLower() -ne 'bot' -and $env:AI_WORKER_DISABLE -ne '1') {
  Write-Host '[all] starting ai-worker'
  & (Join-Path $PSScriptRoot 'start_ai_worker.ps1') -TimeoutSec 40
  Start-Sleep -Seconds 1
} else {
  Write-Host ("[all] ai-worker skipped (AI_DISPATCHER={0}, AI_WORKER_DISABLE={1})" -f $env:AI_DISPATCHER, $env:AI_WORKER_DISABLE) -ForegroundColor Yellow
}

if ((($env:ANNOUNCEMENT_DISPATCHER -as [string]).Trim().ToLower() -ne 'bot' -or ($env:BROADCAST_DISPATCHER -as [string]).Trim().ToLower() -ne 'bot') -and $env:BROADCAST_WORKER_DISABLE -ne '1') {
  Write-Host '[all] starting broadcast-worker'
  & (Join-Path $PSScriptRoot 'start_broadcast_worker.ps1') -TimeoutSec 40
  Start-Sleep -Seconds 1
} else {
  Write-Host ("[all] broadcast-worker skipped (ANNOUNCEMENT_DISPATCHER={0}, BROADCAST_DISPATCHER={1}, BROADCAST_WORKER_DISABLE={2})" -f $env:ANNOUNCEMENT_DISPATCHER, $env:BROADCAST_DISPATCHER, $env:BROADCAST_WORKER_DISABLE) -ForegroundColor Yellow
}

if ($env:COMMAND_WORKER_DISABLE -ne '1') {
  Write-Host '[all] starting command-worker'
  & (Join-Path $PSScriptRoot 'start_command_worker.ps1') -TimeoutSec 40
  Start-Sleep -Seconds 1
} else {
  Write-Host ("[all] command-worker skipped (COMMAND_WORKER_DISABLE={0})" -f $env:COMMAND_WORKER_DISABLE) -ForegroundColor Yellow
}

if ($env:ROSTER_WORKER_DISABLE -ne '1') {
  $rosterCfg = Join-Path $root 'data\course_roster_worker.json'
  if (-not (Test-Path $rosterCfg)) {
    Write-Host ("[all] roster-worker skipped (config missing: {0})" -f $rosterCfg) -ForegroundColor Yellow
  } else {
    Write-Host '[all] starting roster-worker'
    & (Join-Path $PSScriptRoot 'start_roster_worker.ps1') -TimeoutSec 40
    Start-Sleep -Seconds 1
  }
} else {
  Write-Host ("[all] roster-worker skipped (ROSTER_WORKER_DISABLE={0})" -f $env:ROSTER_WORKER_DISABLE) -ForegroundColor Yellow
}

if ($env:OPENCHAT_MEMBERS_SHEETS_WORKER_DISABLE -ne '1') {
  $cfgPath = Join-Path $root 'data\openchat_members_sheets.json'
  if (-not (Test-Path $cfgPath)) {
    Write-Host ("[all] openchat-members-sheets-worker skipped (config missing: {0})" -f $cfgPath) -ForegroundColor Yellow
  } else {
    $enabled = $false
    try {
      $j = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($j.worker -and $j.worker.enabled -eq $true) { $enabled = $true }
    } catch { $enabled = $false }
    if (-not $enabled) {
      Write-Host ("[all] openchat-members-sheets-worker skipped (worker.enabled=false in {0})" -f $cfgPath) -ForegroundColor Yellow
    } else {
      Write-Host '[all] starting openchat-members-sheets-worker'
      & (Join-Path $PSScriptRoot 'start_openchat_members_sheets_worker.ps1') -TimeoutSec 40
      Start-Sleep -Seconds 1
    }
  }
} else {
  Write-Host ("[all] openchat-members-sheets-worker skipped (OPENCHAT_MEMBERS_SHEETS_WORKER_DISABLE={0})" -f $env:OPENCHAT_MEMBERS_SHEETS_WORKER_DISABLE) -ForegroundColor Yellow
}

Write-Host '[all] starting web'
& (Join-Path $PSScriptRoot 'start_web.ps1') -Port $WebPort -TimeoutSec 180 -ForceKillPort -Mode prod -Hostname $WebHostname

Write-Host "[all] started. Web http://localhost:$WebPort  | API http://localhost:$ApiPort" -ForegroundColor Green

if (-not $NoWatchdog) {
  $watchdogScript = Join-Path $PSScriptRoot 'watchdog.ps1'
  if (Test-Path $watchdogScript) {
    Write-Host '[all] starting watchdog' -ForegroundColor Cyan
    $wdLogDir = Join-Path $root 'windows\logs'
    New-Item -ItemType Directory -Force -Path $wdLogDir | Out-Null
    $wdOut = Join-Path $wdLogDir 'watchdog.out.log'
    $wdErr = Join-Path $wdLogDir 'watchdog.err.log'
    try { Remove-Item -Force -ErrorAction SilentlyContinue $wdOut,$wdErr | Out-Null } catch {}
    Start-Process -FilePath powershell.exe -ArgumentList @(
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', $watchdogScript,
      '-ApiBase', "http://127.0.0.1:$ApiPort",
      '-WebPort', "$WebPort",
      '-IrisBase', $IrisUrl
    ) -RedirectStandardOutput $wdOut -RedirectStandardError $wdErr -WindowStyle Hidden | Out-Null
    Write-Host '[all] watchdog started (log: windows/watchdog.log)' -ForegroundColor Green
  } else {
    Write-Host "[all] watchdog.ps1 not found: $watchdogScript" -ForegroundColor Yellow
  }
}
