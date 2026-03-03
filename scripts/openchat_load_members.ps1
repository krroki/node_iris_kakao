#!/usr/bin/env pwsh
<#
  openchat_load_members.ps1

  Purpose
  - Force-load OpenChat members by scrolling the KakaoTalk "Participants" list on Redroid via ADB.
  - This is a NO-SEND script (it never sends a chat message).
  - Verification is DB-only: it checks IRIS DB `db2.open_chat_member` growth for the target room.

  Guardrails
  - No silent fallback: if we cannot enter the Participants list or DB count doesn't grow, we fail fast.
  - Destructive purge (DELETE from open_chat_member) is intentionally disabled to avoid leaving DB=0.

  Usage
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\openchat_load_members.ps1 -RoomId 18426993080683374
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\openchat_load_members.ps1 -RoomId 18426993080683374 -Serial 172.19.204.123:5555 -Scrolls 650
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$RoomId,

  [string]$Serial,

  [string]$IrisQueryBase = "http://127.0.0.1:5050",

  # Legacy flag. Kept for backward compatibility, but blocked for safety.
  [switch]$PurgeRoomBeforeLoad,

  [int]$Scrolls = 200,

  [int]$ScrollPauseMs = 400,

  # Scan-only mode: do NOT rely on IRIS db2.open_chat_member growth.
  # Instead, dump UI on the Participants list and collect visible nicknames while scrolling.
  [switch]$ScanOnly,

  # Output json path for ScanOnly result (optional).
  # When omitted, a default under logs/openchat_scan_members/ will be used.
  [string]$ScanOutJsonPath = "",

  # Early-stop when we see no new nicknames for N scrolls.
  [int]$ScanMaxNoNew = 25
)

$ErrorActionPreference = "Stop"

try { chcp 65001 | Out-Null } catch {}
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()

function Write-Log([string]$msg, [string]$level = "INFO") {
  $ts = Get-Date -Format "HH:mm:ss"
  Write-Host "[$ts][$level] $msg"
}

function Invoke-IrisQuery([string]$query, [object[]]$bind) {
  $body = @{ query = $query; bind = $bind } | ConvertTo-Json -Depth 6 -Compress
  return Invoke-RestMethod -Method Post -Uri ($IrisQueryBase.TrimEnd("/") + "/query") -ContentType "application/json" -Body $body
}

if ($PurgeRoomBeforeLoad) {
  Write-Log "PurgeRoomBeforeLoad is DISABLED for safety. (would risk leaving open_chat_member empty)" "ERROR"
  exit 90
}

if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
  Write-Log "adb not found in PATH (Android SDK platform-tools required)." "ERROR"
  exit 1
}

if (-not $Serial) {
  $lines = @(
    (& adb devices) |
      ForEach-Object { [string]($_) } |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ -and ($_ -match "\s+device$") -and -not ($_ -like "*List of devices*") }
  )
  if (-not $lines -or $lines.Count -eq 0) {
    Write-Log "No adb device connected." "ERROR"
    exit 1
  }
  $Serial = ($lines[0] -split "\s+")[0]
  Write-Log "Serial auto-selected: $Serial"
}

Write-Log "RoomId=$RoomId Serial=$Serial IrisQueryBase=$IrisQueryBase"

# 1) Resolve open_link URL
$openUrl = $null
try {
  $r0 = Invoke-IrisQuery -query "select link_id from chat_rooms where id=?" -bind @($RoomId)
  if (-not $r0.data -or $r0.data.Count -eq 0 -or -not $r0.data[0].link_id) {
    Write-Log "Cannot resolve chat_rooms.link_id for RoomId=$RoomId" "ERROR"
    exit 2
  }
  $linkId = $r0.data[0].link_id
  $r1 = Invoke-IrisQuery -query "select url,name from db2.open_link where id=?" -bind @($linkId)
  if (-not $r1.data -or $r1.data.Count -eq 0 -or -not $r1.data[0].url) {
    Write-Log "Cannot resolve db2.open_link.url for link_id=$linkId" "ERROR"
    exit 2
  }
  $openUrl = [string]$r1.data[0].url
  $roomName = [string]$r1.data[0].name
  Write-Log "open_link url=$openUrl name=$roomName"
} catch {
  Write-Log "IRIS /query failed: $($_.Exception.Message)" "ERROR"
  exit 2
}

function Resolve-JoinSchemeFromOpenKakao([string]$url) {
  if (-not $url) { return $null }
  try {
    # Use curl.exe for more predictable behavior on Windows PowerShell (TLS/encoding quirks).
    $htmlLines = (& curl.exe -s -L --max-time 20 "$url") 2>$null
    $html = ($htmlLines -join "`n")
    if (-not $html) {
      Write-Log "join-scheme fetch returned empty html (curl)" "WARN"
      return $null
    }
    if ($html -and ($html -match 'data-join-scheme="([^"]+)"')) {
      return [string]$Matches[1]
    }
    Write-Log "join-scheme attribute not found in open.kakao.com html" "WARN"
  } catch {
    return $null
  }
  return $null
}

function Get-ResumedPackage() {
  try {
    $out = (& adb -s $Serial shell dumpsys activity activities) 2>$null
    if (-not $out) { return $null }
    $m = ($out | Select-String -Pattern "mResumedActivity:" | Select-Object -First 1)
    if (-not $m) { return $null }
    $line = [string]$m.Line
    if ($line -match 'mResumedActivity:\s+ActivityRecord\{[^}]+\s+u\d+\s+([^/]+)/') {
      return [string]$Matches[1]
    }
  } catch {
    return $null
  }
  return $null
}

function Get-ResumedActivityName() {
  try {
    $out = (& adb -s $Serial shell dumpsys activity activities) 2>$null
    if (-not $out) { return $null }
    $m = ($out | Select-String -Pattern "mResumedActivity:" | Select-Object -First 1)
    if (-not $m) { return $null }
    $line = [string]$m.Line
    if ($line -match 'mResumedActivity:\s+ActivityRecord\{[^}]+\s+u\d+\s+[^/]+/([^\s}]+)') {
      return [string]$Matches[1]
    }
  } catch {
    return $null
  }
  return $null
}

# 2) Launch OpenChat via kakaoopen://join scheme (reliable on Redroid w/o browser)
$joinScheme = Resolve-JoinSchemeFromOpenKakao $openUrl
if (-not $joinScheme) {
  Write-Log "Cannot resolve kakaoopen join scheme from open.kakao.com page. Abort (no safe fallback)." "ERROR"
  exit 2
}

Write-Log "launch join scheme: $joinScheme"
# NOTE: adb shell is executed via Android /system/bin/sh, so unescaped '&' breaks the URI
# (treated as background operator). Escape it to keep the join scheme intact.
$joinSchemeForShell = $joinScheme.Replace("&", "\&")
if ($joinSchemeForShell -ne $joinScheme) {
  Write-Log "join scheme contains '&' -> escape for adb shell: $joinSchemeForShell" "WARN"
}
& adb -s $Serial shell am start -a android.intent.action.VIEW -d "$joinSchemeForShell" | Out-Null
Start-Sleep -Seconds 6

$pkg = Get-ResumedPackage
Write-Log "resumed package=$pkg"
if ($pkg -and $pkg -ne "com.kakao.talk") {
  Write-Log "Foreground is not com.kakao.talk (pkg=$pkg). Try to bring KakaoTalk to foreground, then abort." "WARN"
  try { & adb -s $Serial shell am start -p com.kakao.talk | Out-Null } catch {}
  exit 2
}

# 3) Screen size
$width = 1080
$height = 2400
$sizeOut = (& adb -s $Serial shell wm size) 2>$null
if ($sizeOut -match "Physical size:\s*(\d+)x(\d+)") {
  $width = [int]$Matches[1]
  $height = [int]$Matches[2]
}
Write-Log "screen ${width}x${height}"

$tapX = [int]($width * 0.5)
$menuX = [int]($width * 0.92)
$menuY = [int]($height * 0.08)
$startY = [int]($height * 0.82)
$endY = [int]($height * 0.28)

function Try-UiDump([string]$path = "/sdcard/uidump_members.xml", [int]$retries = 8) {
  $n = [math]::Max(1, $retries)
  for ($t = 1; $t -le $n; $t++) {
    try {
      # uiautomator dump can intermittently fail with:
      # - "could not get idle state"
      # - "null root node returned by UiTestAutomationBridge"
      # so we retry with a longer settle delay.
      & adb -s $Serial shell uiautomator dump $path 2>$null | Out-Null
      Start-Sleep -Milliseconds 450
      $xml = (& adb -s $Serial shell cat $path) 2>$null
      if ($xml -and ($xml -match "<hierarchy")) { return [string]$xml }
    } catch {
      # ignore and retry
    }
    Start-Sleep -Milliseconds (350 * $t)
  }
  return $null
}

function Load-UiDoc([string]$xml) {
  if (-not $xml) { return $null }
  try {
    $tmp = Join-Path $env:TEMP ("uidump_" + [Guid]::NewGuid().ToString("N") + ".xml")
    Set-Content -LiteralPath $tmp -Encoding UTF8 -Value $xml
    [xml]$doc = Get-Content -LiteralPath $tmp -Raw -Encoding UTF8
    Remove-Item -Force -ErrorAction SilentlyContinue $tmp | Out-Null
    return $doc
  } catch {
    return $null
  }
}

function Parse-Bounds([string]$bounds) {
  if (-not $bounds) { return $null }
  if ($bounds -notmatch "\[(\d+),(\d+)\]\[(\d+),(\d+)\]") { return $null }
  return [pscustomobject]@{ x1 = [int]$Matches[1]; y1 = [int]$Matches[2]; x2 = [int]$Matches[3]; y2 = [int]$Matches[4] }
}

function Bounds-Contains($outer, $inner) {
  if (-not $outer -or -not $inner) { return $false }
  return ($outer.x1 -le $inner.x1 -and $outer.y1 -le $inner.y1 -and $outer.x2 -ge $inner.x2 -and $outer.y2 -ge $inner.y2)
}

function Bounds-Area($b) {
  if (-not $b) { return 0 }
  return [int]([math]::Abs(($b.x2 - $b.x1) * ($b.y2 - $b.y1)))
}

function Tap-BoundsCenter($b, [int]$xBias = 0) {
  if (-not $b) { return }
  $x = [int](($b.x1 + $b.x2) / 2) + $xBias
  $y = [int](($b.y1 + $b.y2) / 2)
  & adb -s $Serial shell input tap $x $y | Out-Null
}

function Str-JoinChars([int[]]$codes) {
  $s = ""
  foreach ($c in $codes) { $s += [char]$c }
  return $s
}

function Is-RoomInfoScreen([xml]$doc) {
  if (-not $doc) { return $false }
  $texts = @("View Cover", "Photos/Videos", "Files", "Links", "Announcements", "Events")
  foreach ($t in $texts) {
    if ($doc.SelectSingleNode("//node[@text='$t']")) { return $true }
  }
  return $false
}

function Is-ParticipantsListScreen([xml]$doc) {
  if (-not $doc) { return $false }
  try {
    # Chat screen false-positive guard: chat bubbles/messages present -> NOT a participants list.
    $b1 = $doc.SelectNodes("//node[@resource-id='com.kakao.talk:id/bubble']")
    if ($b1 -and $b1.Count -ge 1) { return $false }
    $b2 = $doc.SelectNodes("//node[@resource-id='com.kakao.talk:id/message']")
    if ($b2 -and $b2.Count -ge 1) { return $false }
  } catch {}

  # Heuristic: Participants list contains many member rows with profile_layout/profile nodes.
  try {
    $p1 = $doc.SelectNodes("//node[@resource-id='com.kakao.talk:id/profile_layout']")
    if ($p1 -and $p1.Count -ge 3) { return $true }
    $p2 = $doc.SelectNodes("//node[@resource-id='com.kakao.talk:id/profile']")
    if ($p2 -and $p2.Count -ge 3) { return $true }
  } catch {}
  return $false
}

function Get-ParticipantsListBounds([xml]$doc) {
  if (-not $doc) { return $null }
  $all = $doc.SelectNodes("//node")
  if (-not $all) { return $null }
  $best = $null
  $bestArea = 0
  foreach ($n in $all) {
    if ([string]$n.GetAttribute("scrollable") -ne "true") { continue }
    $b = Parse-Bounds ([string]$n.GetAttribute("bounds"))
    if (-not $b) { continue }
    $area = Bounds-Area $b
    if ($best -eq $null -or $area -gt $bestArea) { $best = $b; $bestArea = $area }
  }
  return $best
}

function Get-VisibleNicknamesFromParticipantsList([xml]$doc) {
  $out = New-Object System.Collections.Generic.List[string]
  if (-not $doc) { return $out }
  $all = $doc.SelectNodes("//node")
  if (-not $all) { return $out }

  # Cache bounds for efficiency.
  $cache = @()
  foreach ($n in $all) {
    $b = Parse-Bounds ([string]$n.GetAttribute("bounds"))
    if (-not $b) { continue }
    $cache += ,@($n, $b)
  }

  foreach ($pair in $cache) {
    $n = $pair[0]
    $b = $pair[1]

    $rid = [string]$n.GetAttribute("resource-id")
    if ($rid -ne "com.kakao.talk:id/profile_layout" -and $rid -ne "com.kakao.talk:id/profile") { continue }

    # Find nearest clickable row that contains this profile bounds.
    $rowB = $null
    $rowArea = 0
    foreach ($p2 in $cache) {
      $n2 = $p2[0]
      if ([string]$n2.GetAttribute("clickable") -ne "true") { continue }
      $b2 = $p2[1]
      if (-not (Bounds-Contains $b2 $b)) { continue }
      $area2 = Bounds-Area $b2
      if ($rowB -eq $null -or $area2 -lt $rowArea) { $rowB = $b2; $rowArea = $area2 }
    }
    if (-not $rowB) { continue }

    # Pick the best text within the row bounds (usually 1 TextView = nickname).
    $bestText = ""
    $bestLen = 0
    foreach ($p3 in $cache) {
      $n3 = $p3[0]
      if ([string]$n3.GetAttribute("class") -ne "android.widget.TextView") { continue }
      $b3 = $p3[1]
      if (-not (Bounds-Contains $rowB $b3)) { continue }
      $t = [string]$n3.GetAttribute("text")
      if (-not $t) { continue }
      $tt = $t.Trim()
      if (-not $tt) { continue }
      if ($tt -in @("Block", "Report", "Settings", "Share", "Favorited", "Others")) { continue }
      if ($tt -match "^\\d{1,5}$") { continue }
      if ($tt.Length -gt $bestLen) { $bestText = $tt; $bestLen = $tt.Length }
    }

    if ($bestText) { $out.Add($bestText) }
  }

  # unique (preserve order)
  $seen = @{}
  $uniq = New-Object System.Collections.Generic.List[string]
  foreach ($t in $out) {
    if ($seen.ContainsKey($t)) { continue }
    $seen[$t] = $true
    $uniq.Add($t)
  }
  return $uniq
}

function Find-ParticipantsRow([xml]$doc) {
  if (-not $doc) { return $null }

  $kParticipate = Str-JoinChars @(0xCC38, 0xC5EC, 0xC790) # "참여자"
  $kJoiner = Str-JoinChars @(0xCC38, 0xAC00, 0xC790)      # "참가자"

  $targets = @("Participants", $kParticipate, $kJoiner)
  $all = $doc.SelectNodes("//node")
  if (-not $all) { return $null }

  $label = $null
  foreach ($n in $all) {
    $t = [string]$n.GetAttribute("text")
    if (-not $t) { continue }
    foreach ($want in $targets) {
      if ($t -eq $want) { $label = $n; break }
    }
    if ($label) { break }
  }
  if (-not $label) { return $null }

  $labelBounds = Parse-Bounds ([string]$label.GetAttribute("bounds"))
  if (-not $labelBounds) { return $null }

  # Find nearest clickable container bounds that contains the label bounds.
  $best = $null
  $bestArea = 0
  foreach ($n in $all) {
    if ([string]$n.GetAttribute("clickable") -ne "true") { continue }
    $b = Parse-Bounds ([string]$n.GetAttribute("bounds"))
    if (-not $b) { continue }
    if (-not (Bounds-Contains $b $labelBounds)) { continue }
    $area = Bounds-Area $b
    if ($best -eq $null -or $area -lt $bestArea) { $best = $b; $bestArea = $area }
  }
  if (-not $best) { $best = $labelBounds }

  # Estimate "participants count" number on the same row (optional)
  $uiCount = $null
  foreach ($n in $all) {
    $t = [string]$n.GetAttribute("text")
    if (-not $t -or $t -notmatch "^\d{1,5}$") { continue }
    $b = Parse-Bounds ([string]$n.GetAttribute("bounds"))
    if (-not $b) { continue }
    $lineOk = ($b.y1 -ge ($labelBounds.y1 - 12) -and $b.y2 -le ($labelBounds.y2 + 12))
    if (-not $lineOk) { continue }
    $uiCount = [int]$t
    break
  }

  return [pscustomobject]@{ rowBounds = $best; uiCount = $uiCount }
}

function Ensure-RoomInfoScreen() {
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    Write-Log "tap room menu/info at ($menuX,$menuY) attempt=$attempt"
    & adb -s $Serial shell input tap $menuX $menuY | Out-Null
    Start-Sleep -Milliseconds 900
    $doc = Load-UiDoc (Try-UiDump)
    if (Is-RoomInfoScreen $doc) { return $true }
    # Locale/UI 변동으로 RoomInfo 판정이 흔들릴 수 있어, Participants row 존재로도 RoomInfo 진입을 인정한다.
    try {
      $row = Find-ParticipantsRow $doc
      if ($row) { return $true }
    } catch {}
    Start-Sleep -Milliseconds (600 * $attempt)
  }
  return $false
}

function Ensure-ChatSideParticipantsList() {
  # Goal: end up on ChatRoomSideActivity (participants list is visible & scrollable).
  for ($attempt = 1; $attempt -le 8; $attempt++) {
    $act = Get-ResumedActivityName
    if ($act -and ($act -match "ChatRoomSideActivity")) { return $true }

    if ($act -and ($act -match "ChatRoomHolderActivity|ChatRoomActivity")) {
      Write-Log "tap menu to open chat side panel attempt=$attempt"
      & adb -s $Serial shell input tap $menuX $menuY | Out-Null
      Start-Sleep -Milliseconds 900
      $doc = Load-UiDoc (Try-UiDump)
      if (Is-ParticipantsListScreen $doc) { return $true }
      Start-Sleep -Milliseconds 400
      continue
    }

    # Unknown screen (profile/info/settings) -> go back and retry.
    Write-Log "press BACK to reach chat screen (activity=$act) attempt=$attempt" "WARN"
    & adb -s $Serial shell input keyevent 4 | Out-Null
    Start-Sleep -Milliseconds 700
  }
  return $false
}

function Enter-ParticipantsList([ref]$uiCountOut) {
  $uiCountOut.Value = $null

  # Already on Participants list (e.g., ChatRoomSideActivity)
  try {
    $doc0 = Load-UiDoc (Try-UiDump)
    if (Is-ParticipantsListScreen $doc0) { return $true }
  } catch {}

  if (-not (Ensure-RoomInfoScreen)) {
    # Fallback: some locales/builds open the chat side panel instead of RoomInfo.
    if (Ensure-ChatSideParticipantsList) { return $true }
    return $false
  }

  for ($k = 1; $k -le 14; $k++) {
    $doc = Load-UiDoc (Try-UiDump)
    $row = Find-ParticipantsRow $doc
    if ($row) {
      if ($row.uiCount) {
        $uiCountOut.Value = $row.uiCount
        Write-Log "UI participants count detected: $($row.uiCount)"
      }

      $biases = @(
        0,
        [int]($width * 0.18),
        [int]($width * 0.28),
        [int]($width * 0.38),
        [int](-1 * $width * 0.28),
        [int](-1 * $width * 0.18)
      )

      foreach ($bias in $biases) {
        Tap-BoundsCenter $row.rowBounds $bias
        Start-Sleep -Milliseconds 1200

        # Verify we actually navigated to Participants list (best-effort).
        $doc2 = Load-UiDoc (Try-UiDump)
        if (Is-ParticipantsListScreen $doc2) { return $true }
        $stillRoomInfo = $false
        try {
          if (Is-RoomInfoScreen $doc2) { $stillRoomInfo = $true }
        } catch { $stillRoomInfo = $false }

        if (-not $stillRoomInfo) {
          return $true
        }
      }
    }
    & adb -s $Serial shell input swipe $tapX $startY $tapX $endY 500 | Out-Null
    Start-Sleep -Milliseconds 650
  }
  return $false
}

function Get-LoadedDistinctUsers() {
  if ($linkId) {
    # NOTE: 일부 환경에서 open_chat_member.involved_chat_id가 0으로 들어오는 멤버가 많아,
    # roomId 기준으로만 세면 loaded가 과소 집계된다. linkId 기준으로 count한다.
    $r = Invoke-IrisQuery -query "select count(distinct user_id) as cnt from db2.open_chat_member where link_id=?" -bind @($linkId)
  } else {
    $r = Invoke-IrisQuery -query "select count(distinct user_id) as cnt from db2.open_chat_member where involved_chat_id=?" -bind @($RoomId)
  }
  try { return [int]$r.data[0].cnt } catch { return 0 }
}

function Get-ActiveMembersCount() {
  $r = Invoke-IrisQuery -query "select active_members_count as cnt from chat_rooms where id=?" -bind @($RoomId)
  try { return [int]$r.data[0].cnt } catch { return $null }
}

# 4) Enter participants list (must succeed)
$uiCount = $null
$entered = Enter-ParticipantsList ([ref]$uiCount)
if (-not $entered) {
  Write-Log "Failed to find/enter Participants list." "ERROR"
  exit 3
}

if ($ScanOnly) {
  $outDir = Join-Path $PSScriptRoot "..\\logs\\openchat_scan_members"
  try { New-Item -ItemType Directory -Force -Path $outDir | Out-Null } catch {}

  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $outPath = $ScanOutJsonPath
  if (-not $outPath) {
    $outPath = Join-Path $outDir ("scan." + $RoomId + "." + $ts + ".json")
  }

  Write-Log "ScanOnly=ON. Collecting nicknames from Participants list..."

  $doc0 = Load-UiDoc (Try-UiDump)
  $listBounds = Get-ParticipantsListBounds $doc0
  if (-not $listBounds) {
    Write-Log "ScanOnly failed: cannot detect scrollable list bounds." "ERROR"
    exit 31
  }

  $startX = [int](($listBounds.x1 + $listBounds.x2) / 2)
  $startY2 = [int]($listBounds.y2 - 120)
  $endY2 = [int]($listBounds.y1 + 180)
  if ($endY2 -ge $startY2) { $endY2 = [int]($listBounds.y1 + 60) }

  $maxNoNew = [int]$ScanMaxNoNew
  if ($maxNoNew -lt 5) { $maxNoNew = 5 }

  $seen = @{}
  $total = 0
  $noNew = 0
  $used = 0

  for ($i = 1; $i -le $Scrolls; $i++) {
    $used = $i
    $doc = Load-UiDoc (Try-UiDump)
    $nicks = Get-VisibleNicknamesFromParticipantsList $doc
    $visible = 0
    try { $visible = [int]$nicks.Count } catch { $visible = 0 }

    $added = 0
    foreach ($n in $nicks) {
      if (-not $seen.ContainsKey($n)) {
        $seen[$n] = $true
        $total += 1
        $added += 1
      }
    }

    if ($i % 10 -eq 0) {
      Write-Log ("scan {0}/{1}: visible={2} uniqueNicknames={3} (+{4})" -f $i, $Scrolls, $visible, $total, $added)
    }

    # Treat very small/unstable dumps as "unknown" rather than "no new".
    if ($visible -ge 3 -and $added -eq 0) { $noNew += 1 } else { $noNew = 0 }
    if ($noNew -ge $maxNoNew) {
      Write-Log "early stop: no new nicknames observed"
      break
    }

    & adb -s $Serial shell input swipe $startX $startY2 $startX $endY2 500 | Out-Null
    Start-Sleep -Milliseconds $ScrollPauseMs
  }

  $nickList = @()
  foreach ($k in $seen.Keys) { $nickList += $k }
  $nickList = $nickList | Sort-Object

  $result = [ordered]@{
    ok = $true
    roomId = $RoomId
    uiParticipantsCount = $uiCount
    uniqueNicknames = $nickList.Count
    scrollsUsed = $used
    scrollPauseMs = $ScrollPauseMs
    maxNoNew = $maxNoNew
    nicknames = $nickList
  }

  try {
    ($result | ConvertTo-Json -Depth 6) | Out-File -FilePath $outPath -Encoding utf8
  } catch {
    Write-Log "ScanOnly failed to write json: $($_.Exception.Message)" "ERROR"
    exit 32
  }

  Write-Host ("OPENCHAT_SCAN_MEMBERS_RESULT roomId={0} uniqueNicknames={1} uiParticipantsCount={2} outJson={3}" -f $RoomId, $nickList.Count, ($uiCount -as [string]), $outPath)
  Write-Log "OK (ScanOnly)"
  exit 0
}

Write-Log "scroll area x=$tapX y=$startY->$endY scrolls=$Scrolls pauseMs=$ScrollPauseMs"
$active = Get-ActiveMembersCount
Write-Log "active_members_count(chat_rooms)=$active"

$lastDistinct = Get-LoadedDistinctUsers
Write-Log "baseline loaded(distinct user_id)=$lastDistinct"

$expectedForEarlyExit = $null
if ($uiCount -and $uiCount -gt 0) { $expectedForEarlyExit = $uiCount }
elseif ($active -and $active -gt 0) { $expectedForEarlyExit = $active }
$noGrowthChecks = 0

$growthChecked = $false
$reEnterChecked = $false
for ($i = 1; $i -le $Scrolls; $i++) {
  & adb -s $Serial shell input swipe $tapX $startY $tapX $endY 500 | Out-Null
  Start-Sleep -Milliseconds $ScrollPauseMs

  if ($i % 10 -eq 0) {
    $cur = Get-LoadedDistinctUsers
    $delta = $cur - $lastDistinct
    Write-Log ("scroll {0}/{1}: loaded(distinct)={2} (delta={3})" -f $i, $Scrolls, $cur, $delta)
    if ($cur -gt $lastDistinct) { $lastDistinct = $cur }

    if ($expectedForEarlyExit -and $cur -ge $expectedForEarlyExit -and $delta -eq 0) {
      $noGrowthChecks += 1
      if ($noGrowthChecks -ge 3) {
        Write-Log "early stop: loaded(distinct) reached expected and no growth observed"
        break
      }
    } else {
      $noGrowthChecks = 0
    }

    if (-not $growthChecked -and $i -ge 30) {
      $growthChecked = $true
      if ($cur -le 5) {
        Write-Log "DB growth not observed (loaded<=5 after 30 scrolls). Retrying enter Participants list..." "WARN"
        & adb -s $Serial shell input keyevent 4 | Out-Null # BACK
        Start-Sleep -Milliseconds 700
        $uiCount2 = $null
        if (-not (Enter-ParticipantsList ([ref]$uiCount2))) {
          Write-Log "Retry failed: cannot enter Participants list." "ERROR"
          exit 4
        }
      }
    }

    # If we have a large room (expected exists), but DB never grows and stays below expected,
    # we are likely not scrolling the actual participants list. Re-enter once.
    if (-not $reEnterChecked -and $i -ge 80 -and $expectedForEarlyExit -and $cur -lt $expectedForEarlyExit -and $delta -eq 0) {
      $reEnterChecked = $true
      Write-Log "DB 증가가 관측되지 않습니다(loaded < expected, delta=0). 참여자 화면 재진입을 1회 시도합니다." "WARN"
      & adb -s $Serial shell input keyevent 4 | Out-Null # BACK
      Start-Sleep -Milliseconds 700
      $uiCount3 = $null
      if (-not (Enter-ParticipantsList ([ref]$uiCount3))) {
        Write-Log "Retry failed: cannot enter Participants list." "ERROR"
        exit 4
      }
    }
  }
}

$finalLoaded = Get-LoadedDistinctUsers
$finalActive = Get-ActiveMembersCount
Write-Log "done: loaded(distinct user_id)=$finalLoaded active_members_count=$finalActive ui_participants_count=$uiCount"

if ($finalLoaded -le 0) {
  Write-Log "open_chat_member still empty (loaded=0). Load failed." "ERROR"
  exit 5
}

$expected = $null
if ($uiCount -and $uiCount -gt 0) { $expected = $uiCount }
elseif ($finalActive -and $finalActive -gt 0) { $expected = $finalActive }

if ($expected -and $finalLoaded -lt $expected) {
  Write-Log "Incomplete load suspected: loaded=$finalLoaded expected=$expected. Retry with larger -Scrolls." "ERROR"
  exit 6
}

if ($finalLoaded -gt 3000) {
  Write-Log "loaded(distinct) exceeds 3000: loaded=$finalLoaded (possible stale/ghost data)." "ERROR"
  exit 7
}

Write-Host ("OPENCHAT_LOAD_MEMBERS_RESULT roomId={0} loadedDistinct={1} activeMembersCount={2} uiParticipantsCount={3}" -f $RoomId, $finalLoaded, ($finalActive -as [string]), ($uiCount -as [string]))
Write-Log "OK"
