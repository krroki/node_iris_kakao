<#
.SYNOPSIS
  로컬 IRIS/Realtime/Bot 자동 감지 및 자가복구(Watchdog)

.DESCRIPTION
  - FastAPI `/status`(기본 :8650)를 기준으로 bot/logStore 상태를 감지한다.
  - bot 장애(프로세스 종료/EMFILE/상태 파일 파손) 또는 "이벤트는 오는데 로그가 안 쌓임"을 감지하면 봇을 재시작한다.
  - API 자체가 죽었으면 start_all.ps1로 파이프라인을 재가동한다.
  - IRIS(127.0.0.1:5050/config) 연결 불가가 일정 횟수 이상 지속되면 repair_redroid_iris.ps1 -Fix를 시도한다.

  폴백(조용한 무시) 금지 원칙:
  - 실패는 숨기지 않고 `windows/watchdog.log`에 원인/조치/결과를 남긴다.
  - 재시작 폭주를 막기 위해 cooldown을 두되, "안 한다"가 아니라 "왜 지금은 안 하는지"를 로그로 남긴다.

.USAGE
  관리자 PowerShell:
    cd C:\dev\12.kakao\windows
    powershell -ExecutionPolicy Bypass -File .\watchdog.ps1
#>

param(
  [int]$IntervalSec = 15,
  [string]$ApiBase = "http://127.0.0.1:8650",
  [string]$IrisBase = "http://127.0.0.1:5050",
  [int]$WebPort = 3100,
  [string]$LogPath = "",
  [int]$MaxIterations = 0,
  [int]$BotRestartCooldownSec = 120,
  [int]$PipelineRestartCooldownSec = 300,
  [int]$WebRestartCooldownSec = 120,
  # UI는 사람이 직접 보고 쓰는 경로라 "깨짐" 체감이 크다.
  # 정적 자산 404(빈 화면) 같은 케이스는 1~2회 체크만 실패해도 실사용에 문제가 되므로 기본 임계치를 낮춘다.
  [int]$WebFailThreshold = 2,
  # Web UI의 "봇/워커 프로세스" 카드가 실패하는 상태(= /api/bot/processes 장애)를 감지해 web만 자동 복구한다.
  [int]$BotProcessesApiCheckIntervalSec = 30,
  [int]$BotProcessesApiFailThreshold = 2,
  [int]$BotProcessesApiTimeoutSec = 6,
  [int]$KbRestartCooldownSec = 180,
  [int]$KbPostgresEnsureCooldownSec = 60,
  [int]$WelcomeWorkerRestartCooldownSec = 120,
  [int]$AiWorkerRestartCooldownSec = 120,
  [int]$BroadcastWorkerRestartCooldownSec = 120,
  [int]$CommandWorkerRestartCooldownSec = 120,
  [int]$NicknameReminderWorkerRestartCooldownSec = 120,
  [int]$ImageWorkerRestartCooldownSec = 120,
  [int]$AutoFaqWorkerRestartCooldownSec = 120,
  [int]$RosterWorkerRestartCooldownSec = 120,
  [int]$OpenchatMembersSheetsWorkerRestartCooldownSec = 120,
  [int]$CourseMembershipAuditWorkerRestartCooldownSec = 120,
  [int]$CourseOpsAgentRestartCooldownSec = 120,
  # Talk-API authHeader 재적용(파일 → /runtime) 주기: 캡처는 수동, 반영은 자동으로 드리프트를 줄인다.
  [int]$TalkApiAuthSyncIntervalSec = 1800,
  [int]$IrisRepairCooldownSec = 300,
  [int]$IrisFailThreshold = 3
)

# Force UTF-8 for logs/console to avoid mojibake in dashboard (/api/watchdog reads UTF-8)
try { chcp 65001 | Out-Null } catch {}
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

if (-not $LogPath) { $LogPath = Join-Path $root "windows\watchdog.log" }
New-Item -ItemType Directory -Force -Path (Split-Path $LogPath -Parent) | Out-Null
if (-not (Test-Path $LogPath)) { New-Item -ItemType File -Force -Path $LogPath | Out-Null }

$startAllScript = Join-Path $root "windows\start_all.ps1"
$startBotScript = Join-Path $root "windows\start_bot.ps1"
$startWebScript = Join-Path $root "windows\start_web.ps1"
$startWelcomeWorkerScript = Join-Path $root "windows\start_welcome_worker.ps1"
  $startAiWorkerScript = Join-Path $root "windows\start_ai_worker.ps1"
  $startBroadcastWorkerScript = Join-Path $root "windows\start_broadcast_worker.ps1"
  $startCommandWorkerScript = Join-Path $root "windows\start_command_worker.ps1"
  $startNicknameReminderWorkerScript = Join-Path $root "windows\start_nickname_reminder_worker.ps1"
  $startImageWorkerScript = Join-Path $root "windows\start_image_worker.ps1"
  $startAutoFaqWorkerScript = Join-Path $root "windows\start_auto_faq_worker.ps1"
$startRosterWorkerScript = Join-Path $root "windows\start_roster_worker.ps1"
$startOpenchatMembersSheetsWorkerScript = Join-Path $root "windows\start_openchat_members_sheets_worker.ps1"
$startCourseMembershipAuditWorkerScript = Join-Path $root "windows\start_course_membership_audit_worker.ps1"
$startCourseOpsAgentScript = Join-Path $root "windows\start_courseops_agent.ps1"
$smartRestartScript = Join-Path $root "windows\smart_restart_bot.ps1"
$repairScript = Join-Path $root "windows\repair_redroid_iris.ps1"
$kbServiceScript = Join-Path $root "windows\kb_service.ps1"
$ensurePostgresScript = Join-Path $root "windows\ensure_postgres.ps1"
$ensureTalkApiAuthScript = Join-Path $root "scripts\ensure_talkapi_auth_applied.ps1"

$script:lastBotRestartAt = Get-Date '2000-01-01T00:00:00Z'
$script:lastPipelineRestartAt = Get-Date '2000-01-01T00:00:00Z'
$script:lastWebRestartAt = Get-Date '2000-01-01T00:00:00Z'
$script:lastKbRestartAt = Get-Date '2000-01-01T00:00:00Z'
$script:lastKbPostgresEnsureAt = Get-Date '2000-01-01T00:00:00Z'
$script:lastWelcomeWorkerRestartAt = Get-Date '2000-01-01T00:00:00Z'
$script:lastAiWorkerRestartAt = Get-Date '2000-01-01T00:00:00Z'
  $script:lastBroadcastWorkerRestartAt = Get-Date '2000-01-01T00:00:00Z'
  $script:lastCommandWorkerRestartAt = Get-Date '2000-01-01T00:00:00Z'
  $script:lastNicknameReminderWorkerRestartAt = Get-Date '2000-01-01T00:00:00Z'
  $script:lastImageWorkerRestartAt = Get-Date '2000-01-01T00:00:00Z'
  $script:lastAutoFaqWorkerRestartAt = Get-Date '2000-01-01T00:00:00Z'
$script:lastRosterWorkerRestartAt = Get-Date '2000-01-01T00:00:00Z'
$script:lastOpenchatMembersSheetsWorkerRestartAt = Get-Date '2000-01-01T00:00:00Z'
$script:lastCourseMembershipAuditWorkerRestartAt = Get-Date '2000-01-01T00:00:00Z'
$script:lastCourseOpsAgentRestartAt = Get-Date '2000-01-01T00:00:00Z'
$script:lastTalkApiAuthSyncAt = Get-Date '2000-01-01T00:00:00Z'
$script:lastIrisRepairAt = Get-Date '2000-01-01T00:00:00Z'
$script:webFailCount = 0
$script:webRestartAttemptsSinceOk = 0
$script:webBotProcessesFailCount = 0
$script:lastBotProcessesApiCheckAt = Get-Date '2000-01-01T00:00:00Z'
$script:irisFailCount = 0
$script:apiStatusFailCount = 0
$script:lastSummaryAt = Get-Date '2000-01-01T00:00:00Z'
$script:lastSummary = ""

# Single-instance guard (same login session)
$mutexName = "Local\12kakao_watchdog"
$created = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$created)
if (-not $created) {
  $line = "[{0}] [INFO] watchdog already running; exit" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
  return
}

function Write-Log {
  param(
    [ValidateSet('INFO','WARN','ERROR','ACTION')]
    [string]$Level,
    [string]$Message
  )
  $line = "[{0}] [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
  try { Add-Content -Path $LogPath -Value $line -Encoding UTF8 } catch {}
  try { Write-Host $line } catch {}
}

function Invoke-HttpJson {
  param(
    [string]$Url,
    [int]$TimeoutSec = 4
  )
  $params = @{
    Uri         = $Url
    TimeoutSec  = $TimeoutSec
    Method      = 'GET'
    ErrorAction = 'Stop'
  }
  if ($PSVersionTable.PSVersion.Major -lt 6) { $params['UseBasicParsing'] = $true }
  $resp = Invoke-WebRequest @params
  if ($resp.StatusCode -ne 200) { throw "HTTP $($resp.StatusCode)" }
  return ($resp.Content | ConvertFrom-Json)
}

function Test-Http200 {
  param(
    [string]$Url,
    [int]$TimeoutSec = 3
  )
  $params = @{
    Uri         = $Url
    TimeoutSec  = $TimeoutSec
    Method      = 'GET'
    ErrorAction = 'Stop'
  }
  if ($PSVersionTable.PSVersion.Major -lt 6) { $params['UseBasicParsing'] = $true }
  $resp = Invoke-WebRequest @params
  return ($resp.StatusCode -eq 200)
}

function Test-WebUiOk {
  param(
    [int]$Port,
    [int]$TimeoutSec = 2
  )
  # NOTE:
  # - /api/ping(200)만으로는 UI가 "남색 배경만" 뜨는 상태를 잡아내지 못한다.
  #   (Next는 살아있지만 /_next/static 자산이 404이면 브라우저에서 JS/CSS가 로드되지 않아 빈 화면이 된다)
  # - 따라서 "/" HTML에서 참조하는 /_next/static 자산 1개가 실제 200인지까지 확인한다.
  $base = "http://127.0.0.1:$Port"
  $out = @{ ok = $false; detail = "" }

  try {
    $pingOk = $false
    try { $pingOk = Test-Http200 -Url ("{0}/api/ping" -f $base) -TimeoutSec $TimeoutSec } catch { $pingOk = $false }
    if (-not $pingOk) {
      $out.detail = "/api/ping not 200"
      return $out
    }
  } catch {
    $out.detail = "/api/ping error: $($_.Exception.Message)"
    return $out
  }

  $html = ""
  try {
    $params = @{
      Uri         = ("{0}/" -f $base)
      TimeoutSec  = $TimeoutSec
      Method      = 'GET'
      ErrorAction = 'Stop'
    }
    if ($PSVersionTable.PSVersion.Major -lt 6) { $params['UseBasicParsing'] = $true }
    $resp = Invoke-WebRequest @params
    if ($resp.StatusCode -ne 200) {
      $out.detail = "/ not 200 (HTTP $($resp.StatusCode))"
      return $out
    }
    $html = [string]$resp.Content
  } catch {
    $out.detail = "/ fetch error: $($_.Exception.Message)"
    return $out
  }

  if (-not $html -or $html.Length -lt 2000) {
    $out.detail = "/ html too small"
    return $out
  }

  $assetPath = $null
  try {
    # href="/_next/static/css/<hash>.css" or src="/_next/static/chunks/<hash>.js"
    $m = [regex]::Match($html, '/_next/static/[^\s"<>]+\.(?:css|js)')
    if ($m.Success) { $assetPath = [string]$m.Value }
  } catch {
    $assetPath = $null
  }

  if (-not $assetPath) {
    $out.detail = "no /_next/static asset in HTML"
    return $out
  }

  try {
    $assetOk = $false
    try { $assetOk = Test-Http200 -Url ("{0}{1}" -f $base, $assetPath) -TimeoutSec $TimeoutSec } catch { $assetOk = $false }
    if (-not $assetOk) {
      $out.detail = "static asset not 200: $assetPath"
      return $out
    }
  } catch {
    $out.detail = "static asset check error: $($_.Exception.Message)"
    return $out
  }

  $out.ok = $true
  $out.detail = "ok"
  return $out
}

function Test-WebBotProcessesApiOk {
  param(
    [int]$Port,
    [int]$TimeoutSec = 6
  )
  $base = "http://127.0.0.1:$Port"
  $out = @{ ok = $false; detail = "" }

  try {
    $j = Invoke-HttpJson -Url ("{0}/api/bot/processes" -f $base) -TimeoutSec $TimeoutSec
    if ($j -and ($j.ok -eq $true)) {
      $out.ok = $true
      $out.detail = "ok"
      return $out
    }
    $out.detail = "ok=false"
    return $out
  } catch {
    $out.detail = "/api/bot/processes error: $($_.Exception.Message)"
    return $out
  }
}

function Get-ApiPort {
  try { return ([uri]$ApiBase).Port } catch { return 8650 }
}

function Restart-Pipeline {
  param([string]$Reason)
  if (-not (Test-Path $startAllScript)) {
    Write-Log -Level 'ERROR' -Message "start_all.ps1 없음: $startAllScript (파이프라인 재기동 불가)"
    return
  }

  function Find-StartAllProcs {
    try {
      $startAllEsc = [Regex]::Escape((Resolve-Path $startAllScript).Path)
      return @(
        Get-CimInstance Win32_Process |
          Where-Object { $_.Name -in @('powershell.exe','pwsh.exe') } |
          Where-Object { $_.CommandLine -match $startAllEsc }
      )
    } catch {
      return @()
    }
  }

  $runningStartAll = @(Find-StartAllProcs)
  if ($runningStartAll.Count -gt 0) {
    $pids = ($runningStartAll | ForEach-Object { $_.ProcessId } | Sort-Object) -join ','
    Write-Log -Level 'WARN' -Message "start_all.ps1 already running (pids=$pids). 파이프라인 재기동 스킵. 사유: $Reason"
    return
  }

  $now = Get-Date
  $cooldownUntil = $script:lastPipelineRestartAt.AddSeconds($PipelineRestartCooldownSec)
  if ($now -lt $cooldownUntil) {
    $remain = [math]::Max(0, [int]($cooldownUntil - $now).TotalSeconds)
    Write-Log -Level 'WARN' -Message "파이프라인 재기동 스킵(cooldown ${remain}s 남음). 사유: $Reason"
    return
  }
  $script:lastPipelineRestartAt = $now
  # start_all.ps1가 web도 함께 재기동하므로, watchdog의 web 재시작 폭주를 막기 위해
  # web 실패 카운트/시도 카운트를 초기화하고 cooldown 기준을 현재로 맞춘다.
  $script:lastWebRestartAt = $now
  $script:webFailCount = 0
  $script:webRestartAttemptsSinceOk = 0
  $script:webBotProcessesFailCount = 0
  $apiPort = Get-ApiPort
  Write-Log -Level 'ACTION' -Message "파이프라인 재기동(start_all.ps1) 실행. 사유: $Reason"
  try {
    # 중요:
    # - watchdog가 start_all을 "&"로 직접 호출하면(동일 프로세스/런스페이스), start_all이 장시간 블록될 때
    #   watchdog 루프 자체가 멈춰 "자가복구 로직이 중단"될 수 있다.
    # - 따라서 start_all은 별도 프로세스로 기동하고, watchdog는 즉시 루프를 계속 돈다.

    $logDir = Join-Path $root 'windows\logs'
    try { New-Item -ItemType Directory -Force -Path $logDir | Out-Null } catch {}

    $ts = Get-Date -Format 'yyyyMMddHHmmss'
    $outLog = Join-Path $logDir "start_all.from_watchdog.$ts.out.log"
    $errLog = Join-Path $logDir "start_all.from_watchdog.$ts.err.log"

    $args = @(
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', $startAllScript,
      '-IrisUrl', $IrisBase,
      '-ApiPort', "$apiPort",
      '-WebPort', "$WebPort",
      '-NoWatchdog',
      '-PreserveWatchdog'
    )

    $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $args -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    Write-Log -Level 'INFO' -Message ("start_all.ps1 spawned (pid={0}) logs: {1} / {2}" -f $proc.Id, $outLog, $errLog)
  } catch {
    Write-Log -Level 'ERROR' -Message "파이프라인 재기동 실패: $($_.Exception.Message)"
  }
}

function Restart-Bot {
  param([string]$Reason)
  $now = Get-Date
  $cooldownUntil = $script:lastBotRestartAt.AddSeconds($BotRestartCooldownSec)
  if ($now -lt $cooldownUntil) {
    $remain = [math]::Max(0, [int]($cooldownUntil - $now).TotalSeconds)
    Write-Log -Level 'WARN' -Message "봇 재시작 스킵(cooldown ${remain}s 남음). 사유: $Reason"
    return
  }
  $script:lastBotRestartAt = $now

  $irisConfig = "$IrisBase/config"
  $irisOk = $false
  try { $irisOk = Test-Http200 -Url $irisConfig -TimeoutSec 3 } catch { $irisOk = $false }

  if (-not $irisOk -and (Test-Path $smartRestartScript)) {
    Write-Log -Level 'ACTION' -Message "IRIS 연결 불가로 smart_restart_bot.ps1 실행(포트프록시/봇 재시작). 사유: $Reason"
    try {
      & $smartRestartScript 2>&1 | ForEach-Object { Write-Log -Level 'INFO' -Message "[smart_restart] $_" }
      return
    } catch {
      Write-Log -Level 'ERROR' -Message "smart_restart_bot.ps1 실패: $($_.Exception.Message)"
      # continue -> try direct start_bot
    }
  }

  if (-not (Test-Path $startBotScript)) {
    Write-Log -Level 'ERROR' -Message "start_bot.ps1 없음: $startBotScript (봇 재시작 불가)"
    return
  }
  Write-Log -Level 'ACTION' -Message "봇 재시작(start_bot.ps1 -Restart -SkipBuild) 실행. 사유: $Reason"
  try {
    & $startBotScript -IrisUrl $IrisBase -Restart -SkipBuild 2>&1 | ForEach-Object { Write-Log -Level 'INFO' -Message "[start_bot] $_" }
    Write-Log -Level 'INFO' -Message "봇 재시작 호출 완료"
  } catch {
    Write-Log -Level 'ERROR' -Message "봇 재시작 실패: $($_.Exception.Message)"
  }
}

function Restart-KB {
  param([string]$Reason)
  $now = Get-Date
  $cooldownUntil = $script:lastKbRestartAt.AddSeconds($KbRestartCooldownSec)
  if ($now -lt $cooldownUntil) {
    $remain = [math]::Max(0, [int]($cooldownUntil - $now).TotalSeconds)
    Write-Log -Level 'WARN' -Message "KB 재시작 스킵(cooldown ${remain}s 남음). 사유: $Reason"
    return
  }
  $script:lastKbRestartAt = $now

  # KB는 Postgres(pgvector)에 의존한다. 재시작 전에 DB를 먼저 보장한다.
  try {
    if ($env:KB_POSTGRES_ENSURE_DISABLE -ne '1') {
      Ensure-KbPostgres -Reason ("KB 재시작 전 DB ensure: {0}" -f $Reason) | Out-Null
    } else {
      Write-Log -Level 'WARN' -Message "KB postgres ensure skipped (KB_POSTGRES_ENSURE_DISABLE=1)"
    }
  } catch {
    Write-Log -Level 'WARN' -Message "KB 재시작 전 Postgres ensure 실패(계속 진행): $($_.Exception.Message)"
  }

  if (Test-Path $kbServiceScript) {
    Write-Log -Level 'ACTION' -Message "KB 재시작(kb_service.ps1) 실행. 사유: $Reason"
    try {
      & $kbServiceScript -Port 8610 -TimeoutSec 45 2>&1 | ForEach-Object { Write-Log -Level 'INFO' -Message "[kb_service] $_" }
      Write-Log -Level 'INFO' -Message "KB 재시작(kb_service.ps1) 호출 완료"
      return
    } catch {
      Write-Log -Level 'ERROR' -Message "KB 재시작 실패: $($_.Exception.Message)"
      # continue -> fall back to full pipeline restart
    }
  } else {
    Write-Log -Level 'WARN' -Message "kb_service.ps1 없음: $kbServiceScript (KB 단독 재시작 불가)"
  }

  Restart-Pipeline -Reason ("KB 재시작 실패/불가 -> 전체 재기동: {0}" -f $Reason)
}

function Ensure-KbPostgres {
  param([string]$Reason)
  $now = Get-Date
  $cooldownUntil = $script:lastKbPostgresEnsureAt.AddSeconds($KbPostgresEnsureCooldownSec)
  if ($now -lt $cooldownUntil) {
    $remain = [math]::Max(0, [int]($cooldownUntil - $now).TotalSeconds)
    Write-Log -Level 'WARN' -Message "KB Postgres ensure 스킵(cooldown ${remain}s 남음). 사유: $Reason"
    return $false
  }
  $script:lastKbPostgresEnsureAt = $now

  if (-not (Test-Path $ensurePostgresScript)) {
    Write-Log -Level 'WARN' -Message "ensure_postgres.ps1 없음: $ensurePostgresScript (Postgres 자동 복구 불가)"
    return $false
  }

  Write-Log -Level 'ACTION' -Message "KB Postgres ensure(ensure_postgres.ps1) 실행. 사유: $Reason"
  try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ensurePostgresScript -TimeoutSec 180 2>&1 | ForEach-Object {
      Write-Log -Level 'INFO' -Message "[ensure_postgres] $_"
    }
    Write-Log -Level 'INFO' -Message "KB Postgres ensure 완료"
    return $true
  } catch {
    Write-Log -Level 'ERROR' -Message "KB Postgres ensure 실패: $($_.Exception.Message)"
    return $false
  }
}

function Restart-Web {
  param(
    [string]$Reason,
    [switch]$CleanBuild
  )

  if (-not (Test-Path $startWebScript)) {
    Write-Log -Level 'ERROR' -Message "start_web.ps1 없음: $startWebScript (web 재시작 불가)"
    return $false
  }

  $now = Get-Date
  $cooldownUntil = $script:lastWebRestartAt.AddSeconds($WebRestartCooldownSec)
  if ($now -lt $cooldownUntil) {
    $remain = [math]::Max(0, [int]($cooldownUntil - $now).TotalSeconds)
    Write-Log -Level 'WARN' -Message "web 재시작 스킵(cooldown ${remain}s 남음). 사유: $Reason"
    return $false
  }

  $script:lastWebRestartAt = $now
  $script:webFailCount = 0
  $script:webBotProcessesFailCount = 0
  $script:webRestartAttemptsSinceOk++

  $logDir = Join-Path $root 'windows\logs'
  $cleanLabel = if ($CleanBuild) { ' (CleanBuild)' } else { '' }
  Write-Log -Level 'ACTION' -Message ("web 재시작(start_web.ps1{0}) 실행. 사유: {1}" -f $cleanLabel, $Reason)
  try {
    # NOTE:
    # - 문자열 배열에 "-Port", "3100" 형태로 넣으면 "파라미터"가 아니라 "문자열 인자"로 전달되어
    #   start_web.ps1의 Port([int])가 "-Port" 문자열을 받는 바인딩 오류가 발생한다.
    # - 동적 인자는 해시테이블 splat 또는 명시적 파라미터로 전달해야 한다.
    & $startWebScript -Port $WebPort -TimeoutSec 180 -ForceKillPort -Mode 'prod' -LogDir $logDir -CleanBuild:$CleanBuild 2>&1 |
      ForEach-Object { Write-Log -Level 'INFO' -Message "[start_web] $_" }
    Write-Log -Level 'INFO' -Message "web 재시작 호출 완료"
    return $true
  } catch {
    Write-Log -Level 'ERROR' -Message "web 재시작 실패: $($_.Exception.Message)"
    return $false
  }
}

function Test-WelcomeWorkerOk {
  try {
    # WELCOME_DISPATCHER=bot이면 worker는 "의도적으로" 꺼진 것으로 본다.
    $disp = ""
    try { $disp = [string]$env:WELCOME_DISPATCHER } catch { $disp = "" }
    if ($disp -and $disp.Trim().ToLower() -eq 'bot') { return $true }
    if ($env:WELCOME_WORKER_DISABLE -eq '1') { return $true }

    $statusPath = Join-Path $root "node-iris-app\data\welcome_worker_status.json"
    $workerPid = $null
    $hbTs = $null
    if (Test-Path $statusPath) {
      try {
        $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($j.pid) { $workerPid = [int]$j.pid }
        if ($j.heartbeatTs) { $hbTs = [string]$j.heartbeatTs }
      } catch {}
    }

    if ($hbTs) {
      try {
        $dt = [datetime]::Parse($hbTs).ToUniversalTime()
        $age = ([datetime]::UtcNow - $dt).TotalSeconds
        if ($age -gt 300) { return $false }
        return $true
      } catch {}
    }

    if ($workerPid) {
      try {
        $p = Get-Process -Id $workerPid -ErrorAction SilentlyContinue
        return $null -ne $p
      } catch { return $false }
    }

    return $false
  } catch {
    return $false
  }
}

function Restart-WelcomeWorker {
  param([string]$Reason)

  # WELCOME_DISPATCHER=bot이면 worker는 관리 대상에서 제외한다.
  $disp = ""
  try { $disp = [string]$env:WELCOME_DISPATCHER } catch { $disp = "" }
  if ($disp -and $disp.Trim().ToLower() -eq 'bot') { return }
  if ($env:WELCOME_WORKER_DISABLE -eq '1') { return }

  if (-not (Test-Path $startWelcomeWorkerScript)) {
    Write-Log -Level 'WARN' -Message "start_welcome_worker.ps1 없음: $startWelcomeWorkerScript (welcome-worker 재시작 불가)"
    return
  }

  $now = Get-Date
  $cooldownUntil = $script:lastWelcomeWorkerRestartAt.AddSeconds($WelcomeWorkerRestartCooldownSec)
  if ($now -lt $cooldownUntil) {
    $remain = [math]::Max(0, [int]($cooldownUntil - $now).TotalSeconds)
    Write-Log -Level 'WARN' -Message "welcome-worker 재시작 스킵(cooldown ${remain}s 남음). 사유: $Reason"
    return
  }
  $script:lastWelcomeWorkerRestartAt = $now

  Write-Log -Level 'ACTION' -Message "welcome-worker 재시작(start_welcome_worker.ps1 -Restart) 실행. 사유: $Reason"
  try {
    & $startWelcomeWorkerScript -Restart -TimeoutSec 45 2>&1 | ForEach-Object { Write-Log -Level 'INFO' -Message "[welcome_worker] $_" }
    Write-Log -Level 'INFO' -Message "welcome-worker 재시작 호출 완료"
  } catch {
    Write-Log -Level 'ERROR' -Message "welcome-worker 재시작 실패: $($_.Exception.Message)"
  }
}

function Test-AiWorkerOk {
  try {
    # AI_DISPATCHER=bot이면 worker는 "의도적으로" 꺼진 것으로 본다.
    $disp = ""
    try { $disp = [string]$env:AI_DISPATCHER } catch { $disp = "" }
    if ($disp -and $disp.Trim().ToLower() -eq 'bot') { return $true }
    if ($env:AI_WORKER_DISABLE -eq '1') { return $true }

    $statusPath = Join-Path $root "node-iris-app\data\ai_worker_status.json"
    $workerPid = $null
    $hbTs = $null
    if (Test-Path $statusPath) {
      try {
        $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($j.pid) { $workerPid = [int]$j.pid }
        if ($j.heartbeatTs) { $hbTs = [string]$j.heartbeatTs }
      } catch {}
    }

    if ($hbTs) {
      try {
        $dt = [datetime]::Parse($hbTs).ToUniversalTime()
        $age = ([datetime]::UtcNow - $dt).TotalSeconds
        if ($age -gt 300) { return $false }
        return $true
      } catch {}
    }

    if ($workerPid) {
      try {
        $p = Get-Process -Id $workerPid -ErrorAction SilentlyContinue
        return $null -ne $p
      } catch { return $false }
    }

    return $false
  } catch {
    return $false
  }
}

function Restart-AiWorker {
  param([string]$Reason)

  # AI_DISPATCHER=bot이면 worker는 관리 대상에서 제외한다.
  $disp = ""
  try { $disp = [string]$env:AI_DISPATCHER } catch { $disp = "" }
  if ($disp -and $disp.Trim().ToLower() -eq 'bot') { return }
  if ($env:AI_WORKER_DISABLE -eq '1') { return }

  if (-not (Test-Path $startAiWorkerScript)) {
    Write-Log -Level 'WARN' -Message "start_ai_worker.ps1 없음: $startAiWorkerScript (ai-worker 재시작 불가)"
    return
  }

  $now = Get-Date
  $cooldownUntil = $script:lastAiWorkerRestartAt.AddSeconds($AiWorkerRestartCooldownSec)
  if ($now -lt $cooldownUntil) {
    $remain = [math]::Max(0, [int]($cooldownUntil - $now).TotalSeconds)
    Write-Log -Level 'WARN' -Message "ai-worker 재시작 스킵(cooldown ${remain}s 남음). 사유: $Reason"
    return
  }
  $script:lastAiWorkerRestartAt = $now

  Write-Log -Level 'ACTION' -Message "ai-worker 재시작(start_ai_worker.ps1 -Restart) 실행. 사유: $Reason"
  try {
    & $startAiWorkerScript -Restart -TimeoutSec 45 2>&1 | ForEach-Object { Write-Log -Level 'INFO' -Message "[ai_worker] $_" }
    Write-Log -Level 'INFO' -Message "ai-worker 재시작 호출 완료"
  } catch {
    Write-Log -Level 'ERROR' -Message "ai-worker 재시작 실패: $($_.Exception.Message)"
  }
}

function Test-BroadcastWorkerOk {
  try {
    # ANNOUNCEMENT_DISPATCHER=bot && BROADCAST_DISPATCHER=bot 이면 worker는 "의도적으로" 꺼진 것으로 본다.
    $ann = ""
    $bcast = ""
    try { $ann = [string]$env:ANNOUNCEMENT_DISPATCHER } catch { $ann = "" }
    try { $bcast = [string]$env:BROADCAST_DISPATCHER } catch { $bcast = "" }
    $ann = $ann.Trim().ToLower()
    $bcast = $bcast.Trim().ToLower()
    if ($ann -eq 'bot' -and $bcast -eq 'bot') { return $true }
    if ($env:BROADCAST_WORKER_DISABLE -eq '1') { return $true }

    # 중복 실행 감지: 같은 공지가 여러 번 전송되는 최빈 원인.
    # - 여러 프로세스가 동시에 stream을 구독하면 동일 이벤트를 각각 처리할 수 있다.
    # - 해결은 "가장 최신 1개만 유지" + 필요 시 -Restart로 정리.
    try {
      $workerEntry = Join-Path $root "node-iris-app\dist\workers\broadcast_worker.js"
      $absRe = [Regex]::Escape($workerEntry)
      $relRe = 'dist[/\\]workers[/\\]broadcast_worker\.js'
      $procs = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { ($_.CommandLine -match $absRe) -or ($_.CommandLine -match $relRe) } |
        Select-Object ProcessId,CreationDate)
      if ($procs.Count -gt 1) {
        $sorted = @($procs | Sort-Object -Property CreationDate -Descending)
        $keepPid = [int]$sorted[0].ProcessId
        $killPids = @($sorted | Select-Object -Skip 1 | ForEach-Object { [int]$_.ProcessId } | Sort-Object)
        Write-Log -Level 'WARN' -Message ("broadcast-worker 중복 실행 감지(count={0}). keep(pid={1}) kill({2}). 재기동으로 정리 예정" -f $procs.Count, $keepPid, ($killPids -join ','))
        return $false
      }
    } catch {}

    $statusPath = Join-Path $root "node-iris-app\data\broadcast_worker_status.json"
    $workerPid = $null
    $hbTs = $null
    if (Test-Path $statusPath) {
      try {
        $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($j.pid) { $workerPid = [int]$j.pid }
        if ($j.heartbeatTs) { $hbTs = [string]$j.heartbeatTs }
      } catch {}
    }

    if ($hbTs) {
      try {
        $dt = [datetime]::Parse($hbTs).ToUniversalTime()
        $age = ([datetime]::UtcNow - $dt).TotalSeconds
        if ($age -gt 300) { return $false }
        return $true
      } catch {}
    }

    if ($workerPid) {
      try {
        $p = Get-Process -Id $workerPid -ErrorAction SilentlyContinue
        return $null -ne $p
      } catch { return $false }
    }

    return $false
  } catch {
    return $false
  }
}

function Restart-BroadcastWorker {
  param([string]$Reason)

  $ann = ""
  $bcast = ""
  try { $ann = [string]$env:ANNOUNCEMENT_DISPATCHER } catch { $ann = "" }
  try { $bcast = [string]$env:BROADCAST_DISPATCHER } catch { $bcast = "" }
  $ann = $ann.Trim().ToLower()
  $bcast = $bcast.Trim().ToLower()
  if ($ann -eq 'bot' -and $bcast -eq 'bot') { return }
  if ($env:BROADCAST_WORKER_DISABLE -eq '1') { return }

  if (-not (Test-Path $startBroadcastWorkerScript)) {
    Write-Log -Level 'WARN' -Message "start_broadcast_worker.ps1 없음: $startBroadcastWorkerScript (broadcast-worker 재시작 불가)"
    return
  }

  $now = Get-Date
  $cooldownUntil = $script:lastBroadcastWorkerRestartAt.AddSeconds($BroadcastWorkerRestartCooldownSec)
  if ($now -lt $cooldownUntil) {
    $remain = [math]::Max(0, [int]($cooldownUntil - $now).TotalSeconds)
    Write-Log -Level 'WARN' -Message "broadcast-worker 재시작 스킵(cooldown ${remain}s 남음). 사유: $Reason"
    return
  }
  $script:lastBroadcastWorkerRestartAt = $now

  Write-Log -Level 'ACTION' -Message "broadcast-worker 재시작(start_broadcast_worker.ps1 -Restart) 실행. 사유: $Reason"
  try {
    & $startBroadcastWorkerScript -Restart -TimeoutSec 45 2>&1 | ForEach-Object { Write-Log -Level 'INFO' -Message "[broadcast_worker] $_" }
    Write-Log -Level 'INFO' -Message "broadcast-worker 재시작 호출 완료"
  } catch {
    Write-Log -Level 'ERROR' -Message "broadcast-worker 재시작 실패: $($_.Exception.Message)"
  }
}

function Test-CommandWorkerOk {
  try {
    if ($env:COMMAND_WORKER_DISABLE -eq '1') { return $true }

    $statusPath = Join-Path $root "node-iris-app\data\command_worker_status.json"
    $workerPid = $null
    $hbTs = $null
    if (Test-Path $statusPath) {
      try {
        $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($j.pid) { $workerPid = [int]$j.pid }
        if ($j.heartbeatTs) { $hbTs = [string]$j.heartbeatTs }
      } catch {}
    }

    if ($hbTs) {
      try {
        $dt = [datetime]::Parse($hbTs).ToUniversalTime()
        $age = ([datetime]::UtcNow - $dt).TotalSeconds
        if ($age -gt 300) { return $false }
        return $true
      } catch {}
    }

    if ($workerPid) {
      try {
        $p = Get-Process -Id $workerPid -ErrorAction SilentlyContinue
        return $null -ne $p
      } catch { return $false }
    }

    return $false
  } catch {
    return $false
  }
}

function Restart-CommandWorker {
  param([string]$Reason)

  if ($env:COMMAND_WORKER_DISABLE -eq '1') { return }

  if (-not (Test-Path $startCommandWorkerScript)) {
    Write-Log -Level 'WARN' -Message "start_command_worker.ps1 없음: $startCommandWorkerScript (command-worker 재시작 불가)"
    return
  }

  $now = Get-Date
  $cooldownUntil = $script:lastCommandWorkerRestartAt.AddSeconds($CommandWorkerRestartCooldownSec)
  if ($now -lt $cooldownUntil) {
    $remain = [math]::Max(0, [int]($cooldownUntil - $now).TotalSeconds)
    Write-Log -Level 'WARN' -Message "command-worker 재시작 스킵(cooldown ${remain}s 남음). 사유: $Reason"
    return
  }
  $script:lastCommandWorkerRestartAt = $now

  Write-Log -Level 'ACTION' -Message "command-worker 재시작(start_command_worker.ps1 -Restart) 실행. 사유: $Reason"
  try {
    & $startCommandWorkerScript -Restart -TimeoutSec 45 2>&1 | ForEach-Object { Write-Log -Level 'INFO' -Message "[command_worker] $_" }
    Write-Log -Level 'INFO' -Message "command-worker 재시작 호출 완료"
  } catch {
    Write-Log -Level 'ERROR' -Message "command-worker 재시작 실패: $($_.Exception.Message)"
  }
}

function Test-NicknameReminderWorkerOk {
  try {
    if ($env:NICKNAME_REMINDER_WORKER_DISABLE -eq '1') { return $true }

    $statusPath = Join-Path $root "node-iris-app\data\nickname_reminder_worker_status.json"
    $workerPid = $null
    $hbTs = $null
    if (Test-Path $statusPath) {
      try {
        $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($j.pid) { $workerPid = [int]$j.pid }
        if ($j.heartbeatAt) { $hbTs = [string]$j.heartbeatAt }
        if (-not $hbTs -and $j.heartbeatTs) { $hbTs = [string]$j.heartbeatTs }
      } catch {}
    }

    if ($hbTs) {
      try {
        $dt = [datetime]::Parse($hbTs).ToUniversalTime()
        $age = ([datetime]::UtcNow - $dt).TotalSeconds
        if ($age -gt 300) { return $false }
        return $true
      } catch {}
    }

    if ($workerPid) {
      try {
        $p = Get-Process -Id $workerPid -ErrorAction SilentlyContinue
        return $null -ne $p
      } catch { return $false }
    }

    return $false
  } catch {
    return $false
  }
}

function Restart-NicknameReminderWorker {
  param([string]$Reason)

  if ($env:NICKNAME_REMINDER_WORKER_DISABLE -eq '1') { return }

  if (-not (Test-Path $startNicknameReminderWorkerScript)) {
    Write-Log -Level 'WARN' -Message "start_nickname_reminder_worker.ps1 없음: $startNicknameReminderWorkerScript (nickname-reminder-worker 재시작 불가)"
    return
  }

  $now = Get-Date
  $cooldownUntil = $script:lastNicknameReminderWorkerRestartAt.AddSeconds($NicknameReminderWorkerRestartCooldownSec)
  if ($now -lt $cooldownUntil) {
    $remain = [math]::Max(0, [int]($cooldownUntil - $now).TotalSeconds)
    Write-Log -Level 'WARN' -Message "nickname-reminder-worker 재시작 스킵(cooldown ${remain}s 남음). 사유: $Reason"
    return
  }
  $script:lastNicknameReminderWorkerRestartAt = $now

  Write-Log -Level 'ACTION' -Message "nickname-reminder-worker 재시작(start_nickname_reminder_worker.ps1 -Restart) 실행. 사유: $Reason"
  try {
    & $startNicknameReminderWorkerScript -Restart -TimeoutSec 45 2>&1 | ForEach-Object { Write-Log -Level 'INFO' -Message "[nickname_reminder_worker] $_" }
    Write-Log -Level 'INFO' -Message "nickname-reminder-worker 재시작 호출 완료"
  } catch {
    Write-Log -Level 'ERROR' -Message "nickname-reminder-worker 재시작 실패: $($_.Exception.Message)"
  }
}

function Test-ImageWorkerOk {
  try {
    if ($env:IMAGE_WORKER_DISABLE -eq '1') { return $true }

    $statusPath = Join-Path $root "node-iris-app\data\image_worker_status.json"
    $workerPid = $null
    $hbTs = $null
    if (Test-Path $statusPath) {
      try {
        $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($j.pid) { $workerPid = [int]$j.pid }
        if ($j.heartbeatAt) { $hbTs = [string]$j.heartbeatAt }
        if (-not $hbTs -and $j.heartbeatTs) { $hbTs = [string]$j.heartbeatTs }
      } catch {}
    }

    if ($hbTs) {
      try {
        $dt = [datetime]::Parse($hbTs).ToUniversalTime()
        $age = ([datetime]::UtcNow - $dt).TotalSeconds
        if ($age -gt 300) { return $false }
        return $true
      } catch {}
    }

    if ($workerPid) {
      try {
        $p = Get-Process -Id $workerPid -ErrorAction SilentlyContinue
        return $null -ne $p
      } catch { return $false }
    }

    return $false
  } catch {
    return $false
  }
}

function Restart-ImageWorker {
  param([string]$Reason)

  if ($env:IMAGE_WORKER_DISABLE -eq '1') { return }

  if (-not (Test-Path $startImageWorkerScript)) {
    Write-Log -Level 'WARN' -Message "start_image_worker.ps1 없음: $startImageWorkerScript (image-worker 재시작 불가)"
    return
  }

  $now = Get-Date
  $cooldownUntil = $script:lastImageWorkerRestartAt.AddSeconds($ImageWorkerRestartCooldownSec)
  if ($now -lt $cooldownUntil) {
    $remain = [math]::Max(0, [int]($cooldownUntil - $now).TotalSeconds)
    Write-Log -Level 'WARN' -Message "image-worker 재시작 스킵(cooldown ${remain}s 남음). 사유: $Reason"
    return
  }
  $script:lastImageWorkerRestartAt = $now

  Write-Log -Level 'ACTION' -Message "image-worker 재시작(start_image_worker.ps1 -Restart) 실행. 사유: $Reason"
  try {
    & $startImageWorkerScript -Restart -TimeoutSec 60 2>&1 | ForEach-Object { Write-Log -Level 'INFO' -Message "[image_worker] $_" }
    Write-Log -Level 'INFO' -Message "image-worker 재시작 호출 완료"
  } catch {
    Write-Log -Level 'ERROR' -Message "image-worker 재시작 실패: $($_.Exception.Message)"
  }
}

function Test-AutoFaqWorkerOk {
  try {
    if ($env:AUTO_FAQ_WORKER_DISABLE -eq '1') { return $true }

    $statusPath = Join-Path $root "node-iris-app\data\auto_faq_worker_status.json"
    $workerPid = $null
    $hbTs = $null
    if (Test-Path $statusPath) {
      try {
        $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($j.pid) { $workerPid = [int]$j.pid }
        if ($j.heartbeatTs) { $hbTs = [string]$j.heartbeatTs }
      } catch {}
    }

    if ($hbTs) {
      try {
        $dt = [datetime]::Parse($hbTs).ToUniversalTime()
        $age = ([datetime]::UtcNow - $dt).TotalSeconds
        if ($age -gt 300) { return $false }
        return $true
      } catch {}
    }

    if ($workerPid) {
      try {
        $p = Get-Process -Id $workerPid -ErrorAction SilentlyContinue
        return $null -ne $p
      } catch { return $false }
    }

    return $false
  } catch {
    return $false
  }
}

function Restart-AutoFaqWorker {
  param([string]$Reason)

  if ($env:AUTO_FAQ_WORKER_DISABLE -eq '1') { return }

  if (-not (Test-Path $startAutoFaqWorkerScript)) {
    Write-Log -Level 'WARN' -Message "start_auto_faq_worker.ps1 없음: $startAutoFaqWorkerScript (auto-faq-worker 재시작 불가)"
    return
  }

  $now = Get-Date
  $cooldownUntil = $script:lastAutoFaqWorkerRestartAt.AddSeconds($AutoFaqWorkerRestartCooldownSec)
  if ($now -lt $cooldownUntil) {
    $remain = [math]::Max(0, [int]($cooldownUntil - $now).TotalSeconds)
    Write-Log -Level 'WARN' -Message "auto-faq-worker 재시작 스킵(cooldown ${remain}s 남음). 사유: $Reason"
    return
  }
  $script:lastAutoFaqWorkerRestartAt = $now

  Write-Log -Level 'ACTION' -Message "auto-faq-worker 재시작(start_auto_faq_worker.ps1 -Restart) 실행. 사유: $Reason"
  try {
    & $startAutoFaqWorkerScript -Restart -TimeoutSec 45 2>&1 | ForEach-Object { Write-Log -Level 'INFO' -Message "[auto_faq_worker] $_" }
    Write-Log -Level 'INFO' -Message "auto-faq-worker 재시작 호출 완료"
  } catch {
    Write-Log -Level 'ERROR' -Message "auto-faq-worker 재시작 실패: $($_.Exception.Message)"
  }
}

function Test-RosterWorkerOk {
  try {
    if ($env:ROSTER_WORKER_DISABLE -eq '1') { return $true }
    # roster worker는 운영에서 선택 기능이다. 설정 파일이 없으면(미사용) watchdog도 스킵한다.
    $cfgPath = Join-Path $root "data\course_roster_worker.json"
    if (-not (Test-Path $cfgPath)) { return $true }

    $statusPath = Join-Path $root "node-iris-app\data\roster_worker_status.json"
    $workerPid = $null
    $hbTs = $null
    if (Test-Path $statusPath) {
      try {
        $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($j.pid) { $workerPid = [int]$j.pid }
        if ($j.heartbeatTs) { $hbTs = [string]$j.heartbeatTs }
      } catch {}
    }

    if ($hbTs) {
      try {
        $dt = [datetime]::Parse($hbTs).ToUniversalTime()
        $age = ([datetime]::UtcNow - $dt).TotalSeconds
        if ($age -gt 300) { return $false }
        return $true
      } catch {}
    }

    if ($workerPid) {
      try {
        $p = Get-Process -Id $workerPid -ErrorAction SilentlyContinue
        return $null -ne $p
      } catch { return $false }
    }

    return $false
  } catch {
    return $false
  }
}

function Restart-RosterWorker {
  param([string]$Reason)

  if ($env:ROSTER_WORKER_DISABLE -eq '1') { return }
  $cfgPath = Join-Path $root "data\course_roster_worker.json"
  if (-not (Test-Path $cfgPath)) { return }

  if (-not (Test-Path $startRosterWorkerScript)) {
    Write-Log -Level 'WARN' -Message "start_roster_worker.ps1 없음: $startRosterWorkerScript (roster-worker 재시작 불가)"
    return
  }

  $now = Get-Date
  $cooldownUntil = $script:lastRosterWorkerRestartAt.AddSeconds($RosterWorkerRestartCooldownSec)
  if ($now -lt $cooldownUntil) {
    $remain = [math]::Max(0, [int]($cooldownUntil - $now).TotalSeconds)
    Write-Log -Level 'WARN' -Message "roster-worker 재시작 스킵(cooldown ${remain}s 남음). 사유: $Reason"
    return
  }
  $script:lastRosterWorkerRestartAt = $now

  Write-Log -Level 'ACTION' -Message "roster-worker 재시작(start_roster_worker.ps1 -Restart) 실행. 사유: $Reason"
  try {
    & $startRosterWorkerScript -Restart -TimeoutSec 45 2>&1 | ForEach-Object { Write-Log -Level 'INFO' -Message "[roster_worker] $_" }
    Write-Log -Level 'INFO' -Message "roster-worker 재시작 호출 완료"
  } catch {
    Write-Log -Level 'ERROR' -Message "roster-worker 재시작 실패: $($_.Exception.Message)"
  }
}

function Test-OpenchatMembersSheetsWorkerOk {
  try {
    if ($env:OPENCHAT_MEMBERS_SHEETS_WORKER_DISABLE -eq '1') { return $true }
    $cfgPath = Join-Path $root "data\openchat_members_sheets.json"
    if (-not (Test-Path $cfgPath)) { return $true }

    $cfgEnabled = $false
    try {
      $j = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($j.worker -and $j.worker.enabled -eq $true) { $cfgEnabled = $true }
    } catch { $cfgEnabled = $false }
    if (-not $cfgEnabled) { return $true }

    $statusPath = Join-Path $root "node-iris-app\data\openchat_members_sheets_worker_status.json"
    $workerPid = $null
    $hbTs = $null
    if (Test-Path $statusPath) {
      try {
        $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($j.pid) { $workerPid = [int]$j.pid }
        if ($j.heartbeatTs) { $hbTs = [string]$j.heartbeatTs }
      } catch {}
    }

    if ($hbTs) {
      try {
        $dt = [datetime]::Parse($hbTs).ToUniversalTime()
        $age = ([datetime]::UtcNow - $dt).TotalSeconds
        if ($age -gt 300) { return $false }
        return $true
      } catch {}
    }

    if ($workerPid) {
      try {
        $p = Get-Process -Id $workerPid -ErrorAction SilentlyContinue
        return $null -ne $p
      } catch { return $false }
    }

    return $false
  } catch {
    return $false
  }
}

function Restart-OpenchatMembersSheetsWorker {
  param([string]$Reason)

  if ($env:OPENCHAT_MEMBERS_SHEETS_WORKER_DISABLE -eq '1') { return }
  $cfgPath = Join-Path $root "data\openchat_members_sheets.json"
  if (-not (Test-Path $cfgPath)) { return }

  $cfgEnabled = $false
  try {
    $j = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($j.worker -and $j.worker.enabled -eq $true) { $cfgEnabled = $true }
  } catch { $cfgEnabled = $false }
  if (-not $cfgEnabled) { return }

  if (-not (Test-Path $startOpenchatMembersSheetsWorkerScript)) {
    Write-Log -Level 'WARN' -Message "start_openchat_members_sheets_worker.ps1 없음: $startOpenchatMembersSheetsWorkerScript (openchat-members-sheets-worker 재시작 불가)"
    return
  }

  $now = Get-Date
  $cooldownUntil = $script:lastOpenchatMembersSheetsWorkerRestartAt.AddSeconds($OpenchatMembersSheetsWorkerRestartCooldownSec)
  if ($now -lt $cooldownUntil) {
    $remain = [math]::Max(0, [int]($cooldownUntil - $now).TotalSeconds)
    Write-Log -Level 'WARN' -Message "openchat-members-sheets-worker 재시작 스킵(cooldown ${remain}s 남음). 사유: $Reason"
    return
  }
  $script:lastOpenchatMembersSheetsWorkerRestartAt = $now

  Write-Log -Level 'ACTION' -Message "openchat-members-sheets-worker 재시작(start_openchat_members_sheets_worker.ps1 -Restart) 실행. 사유: $Reason"
  try {
    & $startOpenchatMembersSheetsWorkerScript -Restart -TimeoutSec 45 2>&1 | ForEach-Object { Write-Log -Level 'INFO' -Message "[openchat_members_sheets_worker] $_" }
    Write-Log -Level 'INFO' -Message "openchat-members-sheets-worker 재시작 호출 완료"
  } catch {
    Write-Log -Level 'ERROR' -Message "openchat-members-sheets-worker 재시작 실패: $($_.Exception.Message)"
  }
}

function Test-CourseMembershipAuditWorkerOk {
  try {
    if ($env:COURSE_MEMBERSHIP_AUDIT_WORKER_DISABLE -eq '1') { return $true }
    # course-membership-audit-worker는 운영에서 선택 기능이다. 설정 파일이 없으면(미사용) watchdog도 스킵한다.
    $cfgPath = Join-Path $root "data\course_membership_audit.json"
    if (-not (Test-Path $cfgPath)) { return $true }

    $cfgEnabled = $false
    try {
      $j = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($j.worker -and $j.worker.enabled -eq $true) { $cfgEnabled = $true }
    } catch { $cfgEnabled = $false }
    if (-not $cfgEnabled) { return $true }

    # 중복 실행 감지: 동일 워커 프로세스가 2개 이상이면 비정상으로 간주해 자동 복구(재기동)한다.
    try {
      $procs = @(
        Get-CimInstance Win32_Process -Filter "Name='python.exe' or Name='pythonw.exe'" |
          Where-Object { $_.CommandLine -and ($_.CommandLine -match 'scripts[/\\\\]course_membership_audit_worker\\.py') } |
          Select-Object ProcessId
      )
      if ($procs.Count -gt 1) { return $false }
    } catch {}

    $statusPath = Join-Path $root "node-iris-app\data\course_membership_audit_worker_status.json"
    $workerPid = $null
    $hbTs = $null
    if (Test-Path $statusPath) {
      try {
        $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($j.pid) { $workerPid = [int]$j.pid }
        if ($j.heartbeatTs) { $hbTs = [string]$j.heartbeatTs }
      } catch {}
    }

    if ($hbTs) {
      try {
        $dt = [datetime]::Parse($hbTs).ToUniversalTime()
        $age = ([datetime]::UtcNow - $dt).TotalSeconds
        if ($age -gt 300) { return $false }
        return $true
      } catch {}
    }

    if ($workerPid) {
      try {
        $p = Get-Process -Id $workerPid -ErrorAction SilentlyContinue
        return $null -ne $p
      } catch { return $false }
    }

    return $false
  } catch {
    return $false
  }
}

function Restart-CourseMembershipAuditWorker {
  param([string]$Reason)

  if ($env:COURSE_MEMBERSHIP_AUDIT_WORKER_DISABLE -eq '1') { return }
  $cfgPath = Join-Path $root "data\course_membership_audit.json"
  if (-not (Test-Path $cfgPath)) { return }

  $cfgEnabled = $false
  try {
    $j = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($j.worker -and $j.worker.enabled -eq $true) { $cfgEnabled = $true }
  } catch { $cfgEnabled = $false }
  if (-not $cfgEnabled) { return }

  if (-not (Test-Path $startCourseMembershipAuditWorkerScript)) {
    Write-Log -Level 'WARN' -Message "start_course_membership_audit_worker.ps1 없음: $startCourseMembershipAuditWorkerScript (course-membership-audit-worker 재시작 불가)"
    return
  }

  $now = Get-Date
  $cooldownUntil = $script:lastCourseMembershipAuditWorkerRestartAt.AddSeconds($CourseMembershipAuditWorkerRestartCooldownSec)
  if ($now -lt $cooldownUntil) {
    $remain = [math]::Max(0, [int]($cooldownUntil - $now).TotalSeconds)
    Write-Log -Level 'WARN' -Message "course-membership-audit-worker 재시작 스킵(cooldown ${remain}s 남음). 사유: $Reason"
    return
  }
  $script:lastCourseMembershipAuditWorkerRestartAt = $now

  Write-Log -Level 'ACTION' -Message "course-membership-audit-worker 재시작(start_course_membership_audit_worker.ps1 -Restart) 실행. 사유: $Reason"
  try {
    & $startCourseMembershipAuditWorkerScript -Restart -TimeoutSec 60 2>&1 | ForEach-Object { Write-Log -Level 'INFO' -Message "[course_membership_audit_worker] $_" }
    Write-Log -Level 'INFO' -Message "course-membership-audit-worker 재시작 호출 완료"
  } catch {
    Write-Log -Level 'ERROR' -Message "course-membership-audit-worker 재시작 실패: $($_.Exception.Message)"
  }
}

function Test-CourseOpsAgentOk {
  try {
    if ($env:COURSEOPS_AGENT_DISABLE -eq '1') { return $true }
    if (-not $env:COURSEOPS_CONSOLE_BASE_URL) { return $true }
    if (-not $env:COURSEOPS_AGENT_TOKEN) { return $true }

    # 중복 실행 감지: 동일 에이전트 프로세스가 2개 이상이면 비정상으로 간주해 자동 복구(재기동)한다.
    try {
      $procs = @(
        Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
          Where-Object { $_.CommandLine -and ($_.CommandLine -match 'courseops[/\\\\]agent[/\\\\]src[/\\\\]index\\.js') } |
          Select-Object ProcessId
      )
      if ($procs.Count -gt 1) { return $false }
    } catch {}

    $statusPath = Join-Path $root "node-iris-app\data\courseops_agent_status.json"
    $pid = $null
    $hbTs = $null
    if (Test-Path $statusPath) {
      try {
        $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($j.pid) { $pid = [int]$j.pid }
        if ($j.heartbeatTs) { $hbTs = [string]$j.heartbeatTs }
      } catch {}
    }

    if ($hbTs) {
      try {
        $dt = [datetime]::Parse($hbTs).ToUniversalTime()
        $age = ([datetime]::UtcNow - $dt).TotalSeconds
        if ($age -gt 90) { return $false }
        return $true
      } catch {}
    }

    if ($pid) {
      try {
        $p = Get-Process -Id $pid -ErrorAction SilentlyContinue
        return $null -ne $p
      } catch { return $false }
    }

    return $false
  } catch {
    return $false
  }
}

function Restart-CourseOpsAgent {
  param([string]$Reason)

  if ($env:COURSEOPS_AGENT_DISABLE -eq '1') { return }
  if (-not $env:COURSEOPS_CONSOLE_BASE_URL) { return }
  if (-not $env:COURSEOPS_AGENT_TOKEN) { return }

  if (-not (Test-Path $startCourseOpsAgentScript)) {
    Write-Log -Level 'WARN' -Message "start_courseops_agent.ps1 없음: $startCourseOpsAgentScript (courseops-agent 재시작 불가)"
    return
  }

  $now = Get-Date
  $cooldownUntil = $script:lastCourseOpsAgentRestartAt.AddSeconds($CourseOpsAgentRestartCooldownSec)
  if ($now -lt $cooldownUntil) {
    $remain = [math]::Max(0, [int]($cooldownUntil - $now).TotalSeconds)
    Write-Log -Level 'WARN' -Message "courseops-agent 재시작 스킵(cooldown ${remain}s 남음). 사유: $Reason"
    return
  }
  $script:lastCourseOpsAgentRestartAt = $now

  Write-Log -Level 'ACTION' -Message "courseops-agent 재시작(start_courseops_agent.ps1 -Restart) 실행. 사유: $Reason"
  try {
    & $startCourseOpsAgentScript -Restart -TimeoutSec 25 2>&1 | ForEach-Object { Write-Log -Level 'INFO' -Message "[courseops_agent] $_" }
    Write-Log -Level 'INFO' -Message "courseops-agent 재시작 호출 완료"
  } catch {
    Write-Log -Level 'ERROR' -Message "courseops-agent 재시작 실패: $($_.Exception.Message)"
  }
}

function Maybe-Repair-Iris {
  param([string]$Reason)
  if (-not (Test-Path $repairScript)) {
    Write-Log -Level 'WARN' -Message "repair_redroid_iris.ps1 없음: $repairScript (IRIS 자동복구 스킵). 사유: $Reason"
    return
  }
  $now = Get-Date
  $cooldownUntil = $script:lastIrisRepairAt.AddSeconds($IrisRepairCooldownSec)
  if ($now -lt $cooldownUntil) {
    $remain = [math]::Max(0, [int]($cooldownUntil - $now).TotalSeconds)
    Write-Log -Level 'WARN' -Message "IRIS 복구 스킵(cooldown ${remain}s 남음). 사유: $Reason"
    return
  }
  $script:lastIrisRepairAt = $now
  Write-Log -Level 'ACTION' -Message "IRIS 복구 시도(repair_redroid_iris.ps1 -Fix). 사유: $Reason"
  try {
    & $repairScript -Fix 2>&1 | ForEach-Object { Write-Log -Level 'INFO' -Message "[repair] $_" }
    $exitCode = $LASTEXITCODE
    $irisOk = $false
    try { $irisOk = Test-Http200 -Url ("$IrisBase/config") -TimeoutSec 3 } catch { $irisOk = $false }
    if ($exitCode -ne 0 -or -not $irisOk) {
      Write-Log -Level 'ERROR' -Message ("IRIS 복구 실패(exitCode={0}, irisOk={1}). 추가 점검 필요." -f $exitCode, $irisOk)
    } else {
      Write-Log -Level 'INFO' -Message "IRIS 복구 성공(IRIS /config 200 OK)"
    }
  } catch {
    Write-Log -Level 'ERROR' -Message "IRIS 복구 실패: $($_.Exception.Message)"
  }
}

function Should-RestartBotByLogLag {
  param($LogStage)
  try {
    if (-not $LogStage) { return $false }
    if ($LogStage.ok -eq $true) { return $false }
    $extra = $LogStage.extra
    if (-not $extra) { return $false }

    # 이벤트는 최근인데 로그가 뒤처지는 케이스(/status logStore에서 lastEventAgeSec를 포함해 내려준다)
    $lastEventAgeSec = $null
    try { if ($extra.lastEventAgeSec -ne $null) { $lastEventAgeSec = [int]$extra.lastEventAgeSec } } catch {}
    $logAgeSec = $null
    try { if ($extra.logAgeSec -ne $null) { $logAgeSec = [int]$extra.logAgeSec } } catch {}

    if ($lastEventAgeSec -ne $null -and $logAgeSec -ne $null) {
      if ($lastEventAgeSec -le 180 -and $logAgeSec -ge 90) { return $true }
    }

    # 문자열 timestamp로도 한 번 더 확인 (보수적으로)
    $lastEventTs = $null
    $latestLogTs = $null
    try { $lastEventTs = [string]$extra.lastEventTs } catch {}
    try { $latestLogTs = [string]$extra.latestLogTs } catch {}
    if ($lastEventTs -and $latestLogTs) {
      $a = [datetime]::Parse($lastEventTs).ToUniversalTime()
      $b = [datetime]::Parse($latestLogTs).ToUniversalTime()
      $diff = ($a - $b).TotalSeconds
      if ($diff -gt 60) { return $true }
    }
  } catch {}
  return $false
}

Write-Log -Level 'INFO' -Message ("watchdog start (interval={0}s, api={1}, webPort={2}, iris={3}, log={4})" -f $IntervalSec, $ApiBase, $WebPort, $IrisBase, $LogPath)

$iter = 0
$fatal = $null
try
{
  while ($true)
  {
    $iter++
    if ($MaxIterations -gt 0 -and $iter -gt $MaxIterations) { break }

    $apiStatus = $null
    try
    {
      # /status는 내부적으로 IRIS/로그/KB 등을 점검하므로, 순간적으로 4초를 초과할 수 있다.
      # 단발성 타임아웃에 곧바로 start_all(전체 재기동)로 이어지면, 워커 재시작 → 최근 로그 재처리로
      # "테스트방에 이전 메시지가 반복 발송"되는 체감 문제가 생긴다.
      # 따라서:
      # - 타임아웃을 넉넉히(10s) 주고
      # - 연속 실패 3회 이상일 때만 파이프라인을 재기동한다.
      $apiStatus = Invoke-HttpJson -Url ("$ApiBase/status") -TimeoutSec 10
      $script:apiStatusFailCount = 0
    }
    catch
    {
      $script:apiStatusFailCount = [int]($script:apiStatusFailCount + 1)
      Write-Log -Level 'WARN' -Message "API /status 연결 실패(${script:apiStatusFailCount}회): $($_.Exception.Message)"
      if ($script:apiStatusFailCount -ge 3) {
        Restart-Pipeline -Reason "API /status 연결 실패(연속 ${script:apiStatusFailCount}회)"
        $script:apiStatusFailCount = 0
      } else {
        Write-Log -Level 'WARN' -Message "API /status 실패는 일시적일 수 있어 파이프라인 재기동을 보류합니다(연속 3회부터)."
      }
      Start-Sleep -Seconds $IntervalSec
      continue
    }

    $stages = $apiStatus.stages
    $botStage = $stages.bot
    $logStage = $stages.logStore
    $kbStage = $stages.kb
    $kbPgStage = $stages.kbPostgres

    # KB Postgres(pgvector)가 죽으면 KB가 "겉보기로는 살아있어도" 질의/임베딩이 실패할 수 있다.
    # /status에 kbPostgres(TCP) stage를 추가해, watchdog가 DB 다운을 먼저 복구한다.
    try {
      if ($kbPgStage -and ($kbPgStage.ok -ne $true)) {
        $detail = ""
        try { $detail = [string]$kbPgStage.detail } catch { $detail = "" }
        $ok = $false
        if ($env:KB_POSTGRES_ENSURE_DISABLE -ne '1') {
          $ok = Ensure-KbPostgres -Reason ("kbPostgres stage not ok. {0}" -f $detail)
        } else {
          Write-Log -Level 'WARN' -Message "KB postgres ensure skipped (KB_POSTGRES_ENSURE_DISABLE=1)"
        }
        if ($ok) {
          Restart-KB -Reason ("Postgres 복구 후 KB 재시작. {0}" -f $detail)
        }
      }
    } catch {}

    # KB 서비스가 꺼져 있으면 우선 KB만 재기동 (AI 질의/수집/임베딩 정상화를 위해)
    try {
      if ($kbStage -and ($kbStage.ok -ne $true)) {
        $detail = ""
        try { $detail = [string]$kbStage.detail } catch { $detail = "" }
        Restart-KB -Reason ("KB stage not ok. {0}" -f $detail)
      }
    } catch {}

    # Talk-API authHeader sync (best-effort): data/talkapi_auth.txt → /runtime talkApi.authHeader
    try {
      if (Test-Path $ensureTalkApiAuthScript) {
        $now2 = Get-Date
        $cooldownUntil = $script:lastTalkApiAuthSyncAt.AddSeconds([math]::Max(60, $TalkApiAuthSyncIntervalSec))
        if ($now2 -ge $cooldownUntil) {
          $script:lastTalkApiAuthSyncAt = $now2
          & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ensureTalkApiAuthScript -RealtimeApiBase $ApiBase -MinIntervalSec $TalkApiAuthSyncIntervalSec 2>&1 | ForEach-Object {
            Write-Log -Level 'INFO' -Message "[talkapi_auth] $_"
          }
        }
      }
    } catch {
      Write-Log -Level 'WARN' -Message "Talk-API auth sync 실패: $($_.Exception.Message)"
    }
    $deviceStage = $stages.device

    $summary = "device={0} bot={1} logStore={2} realtime={3}" -f $deviceStage.ok, $botStage.ok, $logStage.ok, $stages.realtime.ok
    $now = Get-Date
    $shouldEmitSummary = $false
    if ($summary -ne $script:lastSummary) { $shouldEmitSummary = $true }
    if (($now - $script:lastSummaryAt).TotalSeconds -ge 300) { $shouldEmitSummary = $true }
    if ($shouldEmitSummary) {
      $script:lastSummaryAt = $now
      $script:lastSummary = $summary
      Write-Log -Level 'INFO' -Message ("상태 요약: {0}" -f $summary)
    }

    # Web health check: API가 살아있는데 web만 죽는 케이스(next dev/build 충돌, 산출물 파손 등)를 감지해 web만 우선 복구한다.
    # - /api/ping(200)만으로는 정적 자산 404로 인한 "빈 화면"을 놓칠 수 있어, /_next/static까지 확인한다.
    $webCheck = $null
    try { $webCheck = Test-WebUiOk -Port $WebPort -TimeoutSec 2 } catch { $webCheck = @{ ok = $false; detail = "Test-WebUiOk threw: $($_.Exception.Message)" } }
    $webOk = $false
    $webDetail = ""
    try { $webOk = ($webCheck.ok -eq $true) } catch { $webOk = $false }
    try { $webDetail = [string]$webCheck.detail } catch { $webDetail = "" }
    if ($webOk) {
      if ($script:webFailCount -gt 0 -or $script:webRestartAttemptsSinceOk -gt 0) {
        Write-Log -Level 'INFO' -Message ("WEB 정상 복귀(연속 실패 {0}회, 재시작 시도 {1}회 -> 0)" -f $script:webFailCount, $script:webRestartAttemptsSinceOk)
      }
      $script:webFailCount = 0
      $script:webRestartAttemptsSinceOk = 0
    } else {
      $script:webFailCount++
      $detail2 = if ($webDetail) { " detail=$webDetail" } else { "" }
      Write-Log -Level 'WARN' -Message ("WEB UI 체크 실패(연속 {0}회).{1}" -f $script:webFailCount, $detail2)

      $isStaticAssetFail = $false
      try {
        $isStaticAssetFail = ($webDetail -match '/_next/static') -or ($webDetail -match 'static asset')
      } catch { $isStaticAssetFail = $false }

      # 정적 자산 404/누락은 "UI 빈 화면"으로 이어지므로 더 빠르게 복구한다.
      $threshold = if ($isStaticAssetFail) { 2 } else { $WebFailThreshold }

      if ($script:webFailCount -ge $threshold) {
        # 반복 실패 또는 정적 자산 실패는 CleanBuild로 산출물 파손까지 복구 시도
        $useClean = $isStaticAssetFail -or ($script:webRestartAttemptsSinceOk -ge 1)
        $detail = ""
        try { $detail = [string]$apiStatus.detail } catch { $detail = "" }
        Restart-Web -Reason ("WEB UI 체크 연속 실패($($script:webFailCount)회). $webDetail $detail") -CleanBuild:$useClean | Out-Null
      }
    }

    # Web bot/worker processes API health (dashboard "봇/워커 프로세스" 카드)
    # - /api/ping + static 자산은 정상인데, /api/bot/processes만 계속 실패하면 UI가 "미실행(0/4)"로 보일 수 있다.
    # - 일정 횟수 이상 연속 실패 시 web만 재시작한다.
    if ($webOk) {
      try {
        $now3 = Get-Date
        $interval = [math]::Max(15, $BotProcessesApiCheckIntervalSec)
        if (($now3 - $script:lastBotProcessesApiCheckAt).TotalSeconds -ge $interval) {
          $script:lastBotProcessesApiCheckAt = $now3

          $procApiCheck = $null
          try { $procApiCheck = Test-WebBotProcessesApiOk -Port $WebPort -TimeoutSec $BotProcessesApiTimeoutSec } catch { $procApiCheck = @{ ok = $false; detail = "Test-WebBotProcessesApiOk threw: $($_.Exception.Message)" } }
          $procOk = $false
          $procDetail = ""
          try { $procOk = ($procApiCheck.ok -eq $true) } catch { $procOk = $false }
          try { $procDetail = [string]$procApiCheck.detail } catch { $procDetail = "" }

          if ($procOk) {
            if ($script:webBotProcessesFailCount -gt 0) {
              Write-Log -Level 'INFO' -Message ("WEB /api/bot/processes 정상 복귀(연속 실패 {0}회 -> 0)" -f $script:webBotProcessesFailCount)
            }
            $script:webBotProcessesFailCount = 0
          } else {
            $script:webBotProcessesFailCount++
            $detail2 = if ($procDetail) { " detail=$procDetail" } else { "" }
            Write-Log -Level 'WARN' -Message ("WEB /api/bot/processes 체크 실패(연속 {0}회).{1}" -f $script:webBotProcessesFailCount, $detail2)

            if ($script:webBotProcessesFailCount -ge $BotProcessesApiFailThreshold) {
              $did = $false
              try { $did = (Restart-Web -Reason ("WEB /api/bot/processes 체크 연속 실패($($script:webBotProcessesFailCount)회). $procDetail")) } catch { $did = $false }
              if ($did) { $script:webBotProcessesFailCount = 0 }
            }
          }
        }
      } catch {}
    }

    # IRIS health check (연속 실패 시에만 수리 시도)
    $irisOk = $false
    try { $irisOk = Test-Http200 -Url ("$IrisBase/config") -TimeoutSec 3 } catch { $irisOk = $false }
    if ($irisOk) {
      if ($script:irisFailCount -gt 0) { Write-Log -Level 'INFO' -Message "IRIS 정상 복귀(연속 실패 $($script:irisFailCount)회 -> 0회)" }
      $script:irisFailCount = 0
    } else {
      $script:irisFailCount++
      Write-Log -Level 'WARN' -Message ("IRIS /config 실패(연속 {0}회)" -f $script:irisFailCount)
      if ($script:irisFailCount -ge $IrisFailThreshold) {
        Maybe-Repair-Iris -Reason "IRIS /config 연속 실패($($script:irisFailCount)회)"
      }
    }

    # Bot stage
    if ($botStage.ok -ne $true) {
      $detail = ""
      try { $detail = [string]$botStage.detail } catch {}
      Restart-Bot -Reason ("bot.ok=false ($detail)")
      Start-Sleep -Seconds $IntervalSec
      continue
    }

    # welcome-worker stage (feature worker) - 코어(bot)는 정상인데 worker만 죽는 케이스를 자동 복구한다.
    try {
      $ok = Test-WelcomeWorkerOk
      if (-not $ok) {
        Restart-WelcomeWorker -Reason "welcome-worker not running/heartbeat stale"
      }
    } catch {}

    # ai-worker stage (feature worker) - 코어는 정상인데 ai-worker만 죽는 케이스를 자동 복구한다.
    try {
      $ok = Test-AiWorkerOk
      if (-not $ok) {
        Restart-AiWorker -Reason "ai-worker not running/heartbeat stale"
      }
    } catch {}

    # broadcast-worker stage (feature worker) - 공지/브로드캐스트 워커가 죽는 케이스를 자동 복구한다.
    try {
      $ok = Test-BroadcastWorkerOk
      if (-not $ok) {
        Restart-BroadcastWorker -Reason "broadcast-worker not running/heartbeat stale"
      }
    } catch {}

    # command-worker stage (feature worker) - 방별 명령어/FAQ 워커 자동 복구
    try {
      $ok = Test-CommandWorkerOk
      if (-not $ok) {
        Restart-CommandWorker -Reason "command-worker not running/heartbeat stale"
      }
    } catch {}

    # nickname-reminder-worker stage (feature worker) - 카카오 기본 닉네임 변경 안내(멘션) 워커 자동 복구
    try {
      $ok = Test-NicknameReminderWorkerOk
      if (-not $ok) {
        Restart-NicknameReminderWorker -Reason "nickname-reminder-worker not running/heartbeat stale"
      }
    } catch {}

    # image-worker stage (feature worker) - 이미지 생성/수정 워커 자동 복구
    try {
      $ok = Test-ImageWorkerOk
      if (-not $ok) {
        Restart-ImageWorker -Reason "image-worker not running/heartbeat stale"
      }
    } catch {}

    # auto-faq-worker stage (feature worker) - 무명령어 자동 FAQ 워커 자동 복구
    try {
      $ok = Test-AutoFaqWorkerOk
      if (-not $ok) {
        Restart-AutoFaqWorker -Reason "auto-faq-worker not running/heartbeat stale"
      }
    } catch {}

    # roster-worker stage (feature worker) - 강의 운영(카페/닉네임 검증) 워커 자동 복구
    try {
      $ok = Test-RosterWorkerOk
      if (-not $ok) {
        Restart-RosterWorker -Reason "roster-worker not running/heartbeat stale"
      }
    } catch {}

    # openchat-members-sheets-worker stage (feature worker) - 오픈채팅 전체 멤버 Sheets 동기화 워커 자동 복구
    try {
      $ok = Test-OpenchatMembersSheetsWorkerOk
      if (-not $ok) {
        Restart-OpenchatMembersSheetsWorker -Reason "openchat-members-sheets-worker not running/heartbeat stale"
      }
    } catch {}

    # course-membership-audit-worker stage (feature worker) - 강의 운영 v2(등급 기반 참여 점검) 워커 자동 복구
    try {
      $ok = Test-CourseMembershipAuditWorkerOk
      if (-not $ok) {
        Restart-CourseMembershipAuditWorker -Reason "course-membership-audit-worker not running/heartbeat stale"
      }
    } catch {}

    # courseops-agent stage - go.yoorang.kr 로컬 에이전트 자동 복구
    try {
      $ok = Test-CourseOpsAgentOk
      if (-not $ok) {
        Restart-CourseOpsAgent -Reason "courseops-agent not running/heartbeat stale"
      }
    } catch {}

    # logStore stage: 이벤트는 들어오는데 로그가 안 쌓이면 재시작
    if (Should-RestartBotByLogLag -LogStage $logStage) {
      $detail = ""
      try { $detail = [string]$logStage.detail } catch {}
      Restart-Bot -Reason ("logStore 지연 감지 ($detail)")
      Start-Sleep -Seconds $IntervalSec
      continue
    }

    Start-Sleep -Seconds $IntervalSec
  }
}
catch
{
  $fatal = $_
  Write-Log -Level 'ERROR' -Message "watchdog fatal: $($_.Exception.Message)"
}

try
{
  $mutex.ReleaseMutex() | Out-Null
  $mutex.Dispose()
}
catch {}
Write-Log -Level 'INFO' -Message "watchdog exit"
if ($fatal) { throw $fatal }

