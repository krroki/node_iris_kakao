#!/usr/bin/env pwsh
<#
  KakaoTalk 오픈채팅 방 멤버 목록 강제 로딩 스크립트 (송신 없음)

  동작 개요
  - IRIS `/query`(5050)에서 target 방의 `link_id`와 open_link URL을 찾는다.
  - ADB로 해당 오픈채팅 URL을 열어 방으로 진입한다.
  - 화면 해상도를 기준으로 상단 방 헤더를 탭하여 방 정보/멤버 화면을 열도록 시도한다.
  - 이후 멤버 목록을 아래→위로 여러 번 스크롤하여 단말 DB(db2.open_chat_member)를 최대한 채운다.
  - 스크롤 중 주기적으로 `/query`로 현재 open_chat_member 카운트를 출력한다.

  전제 조건
  - adb 가 PATH에 있고, 대상 단말이 `adb devices` 에서 device 상태여야 한다.
  - IRIS 포트프록시가 5050 포트에 열려 있고 `/query`가 동작해야 한다.
  - 채팅방에 메시지는 절대 송신하지 않으며, 화면 탭/스크롤만 수행한다.

  사용 예시
    pwsh scripts/openchat_load_members.ps1 -RoomId 18426993080683374
    pwsh scripts/openchat_load_members.ps1 -RoomId 18426993080683374 -Serial 192.168.127.63:5555 -Scrolls 300

#>
param(
    [Parameter(Mandatory = $true)]
    [string]$RoomId,

    [string]$Serial,

    [string]$IrisQueryBase = "http://127.0.0.1:5050",

    [int]$Scrolls = 200,

    [int]$ScrollPauseMs = 400
)

$ErrorActionPreference = "Stop"

function Write-Log([string]$msg, [string]$level = "INFO") {
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "[$ts][$level] $msg"
}

function Invoke-IrisQuery([string]$query, [object[]]$bind) {
    $body = @{ query = $query; bind = $bind } | ConvertTo-Json -Depth 4 -Compress
    $resp = Invoke-RestMethod -Method Post -Uri ($IrisQueryBase.TrimEnd('/') + "/query") -ContentType "application/json" -Body $body
    return $resp
}

if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    Write-Log "adb 명령을 찾을 수 없습니다. ANDROID SDK / platform-tools 가 PATH 에 있는지 확인하세요." "ERROR"
    exit 1
}

if (-not $Serial) {
    # NOTE: PowerShell은 단일 결과를 스칼라(string)로 반환할 수 있어 `$lines[0]`가 "첫 글자"로 해석되는 버그가 날 수 있다.
    # 반드시 @()로 배열 고정 + Trim()으로 CR 제거 후 파싱한다.
    $lines = @(
        (& adb devices) |
        ForEach-Object { [string]($_) } |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -and ($_ -match "\s+device$") -and -not ($_ -like "*List of devices*") }
    )
    if (-not $lines -or $lines.Count -eq 0) {
        Write-Log "연결된 adb 디바이스가 없습니다." "ERROR"
        exit 1
    }
    $Serial = ($lines[0] -split "\s+")[0]
    Write-Log "Serial 미지정 → 첫 번째 디바이스 사용: $Serial"
}

Write-Log "RoomId=$RoomId, Serial=$Serial, IrisQueryBase=$IrisQueryBase"

# 1) link_id 및 open_link URL 조회
try {
    # 우선 chat_rooms에서 link_id를 조회한다(멤버 DB가 0건이어도 가능).
    $q0 = "select link_id from chat_rooms where id=?"
    $r0 = Invoke-IrisQuery -query $q0 -bind @($RoomId)
    if ($r0.data -and $r0.data.Count -gt 0 -and $r0.data[0].link_id) {
        $linkId = $r0.data[0].link_id
        Write-Log "resolved link_id from chat_rooms: $linkId"
    } else {
        # fallback: open_chat_member에서 추론(이미 일부 로딩된 방)
        $q1 = "select distinct link_id from db2.open_chat_member where involved_chat_id=?"
        $r1 = Invoke-IrisQuery -query $q1 -bind @($RoomId)
        if (-not $r1.data -or $r1.data.Count -eq 0) {
            Write-Log "RoomId=$RoomId 의 link_id를 찾지 못했습니다. (chat_rooms / open_chat_member 모두 비어있음)" "ERROR"
            exit 1
        }
        $linkId = $r1.data[0].link_id
        Write-Log "resolved link_id from open_chat_member: $linkId"
    }

    $q2 = "select url,name from db2.open_link where id=?"
    $r2 = Invoke-IrisQuery -query $q2 -bind @($linkId)
    if (-not $r2.data -or $r2.data.Count -eq 0) {
        Write-Log "open_link 에 id=$linkId 가 없습니다." "ERROR"
        exit 1
    }
    $openUrl = $r2.data[0].url
    $roomName = $r2.data[0].name
    Write-Log "open_link url=$openUrl, name=$roomName"
} catch {
    Write-Log "IRIS /query 호출 실패: $($_.Exception.Message)" "ERROR"
    exit 1
}

# 2) 오픈채팅 URL 로 방 열기
Write-Log "adb -s $Serial shell am start -a android.intent.action.VIEW -d '$openUrl'"
& adb -s $Serial shell am start -a android.intent.action.VIEW -d "$openUrl" | Out-Null
Start-Sleep -Seconds 5

# 3) 화면 해상도 조회
$sizeOut = (& adb -s $Serial shell wm size) 2>$null
if (-not $sizeOut) {
    Write-Log "wm size 결과를 가져오지 못했습니다. 기본 좌표로 진행합니다." "WARN"
    $width = 1080
    $height = 2400
} else {
    # 예: Physical size: 1080x2400
    if ($sizeOut -match "Physical size:\s*(\d+)x(\d+)") {
        $width = [int]$Matches[1]
        $height = [int]$Matches[2]
    } else {
        $width = 1080
        $height = 2400
    }
}
Write-Log "screen size: ${width}x${height}"

# 상단 방 헤더 탭(방 이름 영역) → 방 정보/멤버 화면으로 진입 시도
$headerX = [int]($width * 0.5)
$headerY = [int]($height * 0.08)
Write-Log "tap room header at ($headerX,$headerY)"
& adb -s $Serial shell input tap $headerX $headerY | Out-Null
Start-Sleep -Seconds 3

# 4) 멤버 목록 스크롤
$startY  = [int]($height * 0.8)
$endY    = [int]($height * 0.2)

Write-Log "scroll area: x=$headerX, y=$startY -> y=$endY, count=$Scrolls"

# baseline count
try {
    $qCnt = "select count(*) as cnt from db2.open_chat_member where involved_chat_id=?"
    $cntResp = Invoke-IrisQuery -query $qCnt -bind @($RoomId)
    $lastCnt = [int]$cntResp.data[0].cnt
    Write-Log "초기 open_chat_member count=$lastCnt"
} catch {
    Write-Log "초기 open_chat_member count 쿼리 실패: $($_.Exception.Message)" "WARN"
    $lastCnt = -1
}

for ($i = 1; $i -le $Scrolls; $i++) {
    & adb -s $Serial shell input swipe $headerX $startY $headerX $endY 500 | Out-Null
    Start-Sleep -Milliseconds $ScrollPauseMs

    if ($i % 10 -eq 0) {
        try {
            $cntResp = Invoke-IrisQuery -query $qCnt -bind @($RoomId)
            $cnt = [int]$cntResp.data[0].cnt
            if ($lastCnt -ge 0) {
                Write-Log "스크롤 $i / $Scrolls → count=$cnt (Δ=$($cnt - $lastCnt))"
            } else {
                Write-Log "스크롤 $i / $Scrolls → count=$cnt"
            }
            if ($cnt -gt $lastCnt) {
                $lastCnt = $cnt
            }
        } catch {
            Write-Log "count 쿼리 실패(스크롤 $i): $($_.Exception.Message)" "WARN"
        }
    }
}

Write-Log "스크롤 완료. 최종 open_chat_member count를 다시 확인하세요: RoomId=$RoomId"
