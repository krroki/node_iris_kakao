#!/usr/bin/env pwsh
<#
  오픈채팅방의 "카카오 기본 닉네임" 후보를 DB 기준으로 리포트합니다.

  가드레일(중요)
  - 메시지 로그(senderName) 기준 판별 금지: 반드시 IRIS DB(db2.open_chat_member) 기준으로만 판단.
  - 리포트 생성 전, Redroid에서 "참여자 목록" 스크롤 로딩을 선행해 DB가 최대한 채워진 상태여야 함.
  - 조용한 fallback 금지: UI Participants count(카카오 UI 기준 총원) 검출에 실패하면 리포트를 진행하지 않음.
  - "닉네임은 중복"이므로, 리포트(JSON)에는 닉네임별 userIdsSample(최대 50개)를 포함함.

  사용 예시(Windows PowerShell)
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\report_default_nickname_candidates.ps1 -RoomId 18426993080683374
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\report_default_nickname_candidates.ps1 -RoomId 18426993080683374 -Serial 172.19.204.123:5555 -Scrolls 650
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$RoomId,

  [string]$IrisQueryBase = "http://127.0.0.1:5050",

  # 기본값: 리포트 생성 전에 멤버 로딩을 반드시 수행(권장/기본).
  # 디버깅 등 특수 케이스에서만 -SkipMemberLoad 사용.
  [switch]$SkipMemberLoad,

  # 과거 purge는 DB=0 사고를 유발해 비활성화했습니다.
  [switch]$PurgeBeforeLoad,

  [int]$WaitSec = 120,

  [int]$Scrolls = 0,

  [string]$Serial = ""
)

$ErrorActionPreference = "Stop"

try { chcp 65001 | Out-Null } catch {}
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()

function Write-Log([string]$msg, [string]$level = "INFO") {
  $ts = Get-Date -Format "HH:mm:ss"
  Write-Host "[$ts][$level] $msg"
}

function Invoke-IrisQuery([string]$query, [object[]]$bind) {
  $body = @{ query = $query; bind = $bind } | ConvertTo-Json -Depth 4 -Compress
  return Invoke-RestMethod -Method Post -Uri ($IrisQueryBase.TrimEnd('/') + "/query") -ContentType "application/json" -Body $body
}

function Get-Counts([string]$rid) {
  $r0 = Invoke-IrisQuery -query "select active_members_count as cnt from chat_rooms where id=?" -bind @($rid)
  $active = $null
  try {
    $v = [int]$r0.data[0].cnt
    if ($v -ge 0) { $active = $v }
  } catch { $active = $null }

  $r1 = Invoke-IrisQuery -query "select count(distinct user_id) as cnt from db2.open_chat_member where involved_chat_id=?" -bind @($rid)
  $loaded = 0
  try { $loaded = [int]$r1.data[0].cnt } catch { $loaded = 0 }

  return [pscustomobject]@{ active = $active; loaded = $loaded }
}

function Resolve-SerialFromCache() {
  $root = Split-Path $PSScriptRoot -Parent
  $p = Join-Path $root "data\\redroid_device.json"
  if (-not (Test-Path $p)) { return "" }
  try {
    $j = Get-Content -LiteralPath $p -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($j.device) { return [string]$j.device }
  } catch {}
  return ""
}

if (-not $Serial) { $Serial = Resolve-SerialFromCache }

$c0 = Get-Counts -rid $RoomId
if ($null -eq $c0.active -or $c0.active -le 0) {
  Write-Log "chat_rooms.active_members_count를 가져오지 못했습니다(또는 0). 멤버 완전성 검증이 불가능합니다. RoomId=$RoomId" "ERROR"
  exit 1
}

Write-Log "counts(before): active=$($c0.active) loaded=$($c0.loaded)"

$uiParticipantsCount = $null
$loadedDistinctFromUi = $null

if (-not $SkipMemberLoad) {
  $root = Split-Path $PSScriptRoot -Parent
  $loadScript = Join-Path $root "scripts\\openchat_load_members.ps1"
  if (-not (Test-Path $loadScript)) {
    Write-Log "openchat_load_members.ps1를 찾지 못했습니다: $loadScript" "ERROR"
    exit 1
  }

  if ($Scrolls -le 0) {
    # 대형 방(수천명)은 더 많이 스크롤해야 DB가 채워질 수 있다.
    $Scrolls = [math]::Min(800, [math]::Max(200, [int][math]::Ceiling($c0.active / 6)))
  }

  if (-not $Serial) {
    Write-Log "ADB Serial을 찾지 못했습니다. UI(3100)에서 ADB 대상 저장 또는 -Serial로 지정하세요." "ERROR"
    exit 1
  }

  if ($PurgeBeforeLoad) {
    Write-Log "PurgeBeforeLoad는 안전을 위해 비활성화되어 있습니다(DB=0 사고 방지). 사용하지 마세요." "ERROR"
    exit 6
  }

  $logDir = Join-Path $root "logs\\default_nickname_candidates"
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $ts = Get-Date -Format 'yyyyMMdd_HHmmss'
  $outLog = Join-Path $logDir ("openchat_load_members.$RoomId.$ts.out.log")
  $errLog = Join-Path $logDir ("openchat_load_members.$RoomId.$ts.err.log")

  Write-Log "member load -> openchat_load_members.ps1 (serial=$Serial scrolls=$Scrolls)"
  Write-Log "member load logs: $outLog / $errLog"

  $args = @(
    "-NoProfile","-ExecutionPolicy","Bypass",
    "-File",$loadScript,
    "-RoomId",$RoomId,
    "-Serial",$Serial,
    "-Scrolls",$Scrolls
  )

  try {
    $proc = Start-Process -FilePath "powershell.exe" -ArgumentList $args -WorkingDirectory $root -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru

    $timeoutMs = 30 * 60 * 1000
    $ok = $proc.WaitForExit($timeoutMs)
    if (-not $ok -or -not $proc.HasExited) {
      try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
      Write-Log "openchat_load_members.ps1가 $([int]($timeoutMs/1000))s 내에 종료되지 않아 중단했습니다. 로그 확인: $outLog / $errLog" "ERROR"
      exit 3
    }

    try { $proc.Refresh() } catch {}
    $exitCode = $null
    try { $exitCode = [int]$proc.ExitCode } catch { $exitCode = $null }
    if ($exitCode -ne 0) {
      Write-Log "openchat_load_members.ps1 실패(exit=$exitCode). 로그 확인: $outLog / $errLog" "ERROR"
      exit 4
    }
  } catch {
    Write-Log "openchat_load_members.ps1 실행 실패: $($_.Exception.Message). 로그 확인: $outLog / $errLog" "ERROR"
    exit 4
  }

  Write-Log "waiting ${WaitSec}s to let IRIS DB settle..."
  Start-Sleep -Seconds ([math]::Max(10, $WaitSec))

  # OPENCHAT_LOAD_MEMBERS_RESULT roomId=... loadedDistinct=... activeMembersCount=... uiParticipantsCount=...
  try {
    $raw = Get-Content -LiteralPath $outLog -Raw -Encoding UTF8 -ErrorAction Stop
    if ($raw -match 'OPENCHAT_LOAD_MEMBERS_RESULT\s+roomId=\d+\s+loadedDistinct=(\d+)\s+activeMembersCount=\S+\s+uiParticipantsCount=(\S+)') {
      $ld = [string]$Matches[1]
      $v = [string]$Matches[2]
      $n = 0
      if ([int]::TryParse($v, [ref]$n) -and $n -gt 0) { $uiParticipantsCount = $n }
      $m = 0
      if ([int]::TryParse($ld, [ref]$m) -and $m -ge 0) { $loadedDistinctFromUi = $m }
    }
  } catch {
    $uiParticipantsCount = $null
    $loadedDistinctFromUi = $null
  }

  if (-not $uiParticipantsCount -or $uiParticipantsCount -le 0) {
    Write-Log "UI Participants count 검출에 실패했습니다. 조용한 fallback 없이 중단합니다. (로그: $outLog)" "ERROR"
    exit 2
  }
} else {
  Write-Log "SkipMemberLoad=ON: UI Participants count 검증을 수행하지 않습니다(권장하지 않음)." "WARN"
  exit 2
}

$c1 = Get-Counts -rid $RoomId
Write-Log "counts(after): active=$($c1.active) loaded=$($c1.loaded)"

$expected = $uiParticipantsCount
Write-Log "expectedMembersCount=$expected (UI Participants count 기준)"

if ($c1.loaded -lt $expected) {
  Write-Log "멤버 목록이 아직 완전히 로딩되지 않았습니다(loaded < expected). DB 기반 판별을 진행하지 않습니다." "ERROR"
  exit 2
}

if ($loadedDistinctFromUi -ne $null -and $loadedDistinctFromUi -gt 0 -and $loadedDistinctFromUi -ne $c1.loaded) {
  Write-Log "검증 실패: openchat_load_members.loadedDistinct($loadedDistinctFromUi) != DB distinctUsers($($c1.loaded))." "ERROR"
  exit 2
}

if ($c1.loaded -gt 3000 -or $c1.loaded -gt ($expected + 30)) {
  Write-Log "DB loadedMembersCount가 비정상적으로 큽니다(loaded=$($c1.loaded), expected=$expected, active=$($c1.active))." "ERROR"
  Write-Log "open_chat_member에 과거 데이터가 섞였을 가능성이 있어 이번 결과는 신뢰할 수 없습니다." "ERROR"
  exit 5
}

$botDir = Join-Path (Split-Path $PSScriptRoot -Parent) "node-iris-app"
$nodeScript = Join-Path $botDir "scripts\\report_default_nickname_candidates.js"
if (-not (Test-Path $nodeScript)) {
  Write-Log "node report 스크립트를 찾지 못했습니다: $nodeScript" "ERROR"
  exit 1
}

Set-Location -LiteralPath $botDir
Write-Log "running node report..."
$env:ROOM_ID = $RoomId
$env:UI_PARTICIPANTS_COUNT = [string]$uiParticipantsCount
$env:LOADED_DISTINCT = [string]$c1.loaded

$outText = (& node $nodeScript) | ForEach-Object { [string]($_) }
$outLines = @($outText | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$outFile = ($outLines | Where-Object { $_ -match '\.json$' } | Select-Object -Last 1)
if (-not $outFile) {
  Write-Log "node report 출력 경로를 받지 못했습니다." "ERROR"
  exit 1
}
Write-Log "report: $outFile" "INFO"

try {
  $j = Get-Content -LiteralPath $outFile -Raw -Encoding UTF8 | ConvertFrom-Json
  Write-Output ""
  Write-Output ("[요약] defaultUsers={0} uniqueNicknames={1}" -f $j.totalDefaultUsers, $j.uniqueDefaultNicknames)
  Write-Output ("[증명] UI Participants={0} / DB distinctUsers={1} / chat_rooms.active_members_count={2}" -f $uiParticipantsCount, $c1.loaded, $c1.active)
  Write-Output ""
  if ($j.uniqueDefaultNicknames -gt 0) {
    Write-Output "[기본닉 후보 목록(중복 제거)]"
    foreach ($it in $j.nicknames) {
      Write-Output ("- {0} (count={1})" -f $it.nickname, $it.count)
    }
  } else {
    Write-Output "[기본닉 후보 목록(중복 제거)] 없음"
  }
} catch {
  Write-Log "report 요약 출력 실패: $($_.Exception.Message)" "WARN"
}
