#requires -version 5.1
<#
  Talk-API Authorization 헤더(accessToken-deviceUUID) 추출 보조 스크립트.

  배경
  - Realtime API(`/send/talkapi/dispatch`)로 “실제 멘션”을 보내려면 runtime.json.talkApi.authHeader가 필요하다.
  - Talk-API 문서(OpenAPI): https://talk-api.naijun.dev/swagger/documentation.yaml
    - Authorization: accessToken-deviceUUID

  보안/운영 원칙
  - 토큰/UUID는 Git에 커밋하지 않는다.
  - 본 스크립트는 기본적으로 **콘솔에 토큰을 그대로 출력하지 않고** `data/` 하위 파일에 저장한다.
  - 자동 추출이 불가한 경우(암호화/난독화/저장 위치 변경 등), 조용히 넘어가지 말고 명시적으로 실패한다.

  사용 예시
    pwsh scripts/extract_talkapi_auth.ps1
    pwsh scripts/extract_talkapi_auth.ps1 -Serial 172.30.29.157:5555
    pwsh scripts/extract_talkapi_auth.ps1 -AccessToken "<token>" -DeviceUUID "<uuid>" -ApplyRuntime
#>

param(
    [string]$Serial,

    [string]$OutFile = "data/talkapi_auth.txt",

    [string]$AccessToken,
    [string]$DeviceUUID,

    # Realtime API(runtime.json)로 authHeader를 반영할지 여부(선택)
    [switch]$ApplyRuntime,
    [string]$RealtimeApiBase = "http://127.0.0.1:8650"
)

$ErrorActionPreference = "Stop"

function Write-Log([string]$msg, [string]$level = "INFO") {
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "[$ts][$level] $msg"
}

function Require-Command([string]$name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "필수 명령을 찾을 수 없습니다: $name (PATH를 확인하세요)"
    }
}

function Resolve-Serial() {
    param([string]$Preferred)
    if ($Preferred -and $Preferred.Trim()) { return $Preferred.Trim() }
    $lines = @((& adb devices) | Where-Object { $_ -match '^[^\s]+\s+device\s*$' })
    if (-not $lines -or $lines.Count -eq 0) {
        throw "adb devices 에 연결된 디바이스가 없습니다."
    }
    return ($lines[0] -replace '\s+device\s*$', '').Trim()
}

function Adb-Text([string]$serial, [string[]]$cmdArgs) {
    # PowerShell 5.1 stdout 처리는 텍스트 기반이므로, 바이너리는 여기로 받지 않는다.
    return & adb -s $serial @cmdArgs
}

function Ensure-Root([string]$serial) {
    $uid = (Adb-Text $serial @("shell", "su", "0", "id", "-u") | Select-Object -First 1).ToString().Trim()
    if ($uid -ne "0") {
        throw "su(0) root 권한 확보 실패: id -u=$uid"
    }
}

function Redact([string]$s) {
    $t = $s
    if ($null -eq $t) { $t = "" }
    $t = $t.Trim()
    if ($t.Length -le 8) { return "***" }
    return $t.Substring(0, 4) + "…" + $t.Substring($t.Length - 4, 4)
}

function Ensure-ParentDir([string]$path) {
    $dir = Split-Path -Parent $path
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Force $dir | Out-Null
    }
}

function Save-Secret([string]$path, [string]$content) {
    Ensure-ParentDir $path
    # data/ 하위(기본 .gitignore)로 저장. UTF-8(no BOM)으로 기록.
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function Escape-RemotePath([string]$p) {
    if (-not $p) { return "" }
    # adb shell 명령 인자로 넘길 때, 공백은 백슬래시로 이스케이프한다.
    return ($p -replace " ", "\\ ")
}

function Pull-RootFile([string]$serial, [string]$remotePath, [string]$localPath) {
    # /data/data 등 root-only 경로의 파일을 안전하게 pull하기 위해:
    # 1) su 0 cp -> /sdcard/Download/tmp_...
    # 2) adb pull
    # 3) tmp 삭제
    Ensure-ParentDir $localPath
    $tmpName = ("talkapi_tmp_" + [Guid]::NewGuid().ToString("N"))
    $remoteTmp = "/sdcard/Download/$tmpName"
    $src = Escape-RemotePath $remotePath
    & adb -s $serial shell su 0 cp $src $remoteTmp | Out-Null
    & adb -s $serial shell su 0 chmod 666 $remoteTmp | Out-Null
    & adb -s $serial pull $remoteTmp $localPath | Out-Null
    & adb -s $serial shell su 0 rm -f $remoteTmp | Out-Null
}

function Try-Get-AndroidId([string]$serial) {
    try {
        $v = (Adb-Text $serial @("shell", "settings", "get", "secure", "android_id") | Select-Object -First 1).ToString().Trim()
        if ($v -and $v -notmatch "null") { return $v }
    } catch {}
    return ""
}

function Try-Scan-TextFilesForCandidates([string]$serial) {
    # NOTE: 카카오톡은 토큰을 평문으로 저장하지 않는 경우가 많아, 이 스캔은 “될 수도 있고 안 될 수도 있음”.
    $deviceUuidCandidates = New-Object System.Collections.Generic.List[string]
    $accessTokenCandidates = New-Object System.Collections.Generic.List[string]

    $uuid36 = [regex]'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
    $jwt = [regex]'eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}'
    $kvAccess = [regex]'(?i)(access[_-]?token|accessToken)\s*["=:]\s*([0-9A-Za-z._-]{16,})'
    $kvUuid = [regex]'(?i)(device[_-]?uuid|deviceUuid|uuid)\s*["=:]\s*([0-9A-Za-z._-]{8,})'

    $paths = @(
        "/data/data/com.kakao.talk/shared_prefs",
        "/data/data/com.kakao.talk/files",
        "/data/data/com.kakao.talk/cache/sentry"
    )

    foreach ($base in $paths) {
        try {
            $items = (Adb-Text $serial @("shell", "su", "0", "ls", "-1", $base) -split "`r?`n") | Where-Object { $_ -and $_.Trim() }
        } catch {
            continue
        }

        foreach ($it in $items) {
            $full = "$base/$it"
            # 대략적인 텍스트 파일만(확장자 기반). 바이너리/DB는 여기서 다루지 않는다.
            if ($it -notmatch '\.(xml|json|txt|log)$') { continue }
            try {
                $txt = (Adb-Text $serial @("shell", "su", "0", "cat", $full)) -join "`n"
            } catch {
                continue
            }
            if (-not $txt) { continue }

            foreach ($m in $uuid36.Matches($txt)) {
                $v = $m.Value
                if ($v -and -not $deviceUuidCandidates.Contains($v)) { $deviceUuidCandidates.Add($v) }
            }
            foreach ($m in $jwt.Matches($txt)) {
                $v = $m.Value
                if ($v -and -not $accessTokenCandidates.Contains($v)) { $accessTokenCandidates.Add($v) }
            }
            foreach ($m in $kvAccess.Matches($txt)) {
                $v = $m.Groups[2].Value
                if ($v -and -not $accessTokenCandidates.Contains($v)) { $accessTokenCandidates.Add($v) }
            }
            foreach ($m in $kvUuid.Matches($txt)) {
                $v = $m.Groups[2].Value
                if ($v -and -not $deviceUuidCandidates.Contains($v)) { $deviceUuidCandidates.Add($v) }
            }
        }
    }

    return @{
        deviceUUIDs  = @($deviceUuidCandidates)
        accessTokens = @($accessTokenCandidates)
    }
}

function Apply-Runtime([string]$base, [string]$authHeader) {
    $u = $base.TrimEnd("/") + "/runtime"
    $body = @{ talkApi = @{ authHeader = $authHeader } } | ConvertTo-Json -Depth 5 -Compress
    Invoke-RestMethod -Method Post -Uri $u -ContentType "application/json" -Body $body | Out-Null
}

# 1) 명시 인자 우선(ADB 불필요)
if ($AccessToken -and $DeviceUUID) {
    $auth = ($AccessToken.Trim() + "-" + $DeviceUUID.Trim())
    Save-Secret -path $OutFile -content ($auth + "`n")
    Write-Log "authHeader 저장 완료: $OutFile (값은 미출력)"
    Write-Log ("accessToken=" + (Redact $AccessToken) + ", deviceUUID=" + (Redact $DeviceUUID))
    # Snapshot (best-effort, do not fail capture flow)
    try {
        $snap = Join-Path $PSScriptRoot "snapshot_talkapi_auth.ps1"
        if (Test-Path $snap) { & $snap -AuthFile $OutFile | Out-Null }
    } catch {}
    if ($ApplyRuntime) {
        Apply-Runtime -base $RealtimeApiBase -authHeader $auth
        Write-Log "Realtime API runtime.json 반영 완료: talkApi.authHeader 업데이트"
    }
    exit 0
}

Require-Command "adb"

$serial = Resolve-Serial -Preferred $Serial
Write-Log "ADB 디바이스: $serial"

Ensure-Root -serial $serial
Write-Log "루트 권한 OK(su 0)"

# 2) 자동 추출 시도 (KakaoTalk 로컬 파일 기반)
Write-Log "자동 추출 시도(DataStore + 로컬 파일)..." "WARN"

# 2-1) accessToken 후보: LocalUser_DataStore의 encrypted_auth_token_v2/ encrypted_auth_token
$localUserPb = "data/talkapi_sources/LocalUser_DataStore.pref.preferences_pb"
try {
    Pull-RootFile -serial $serial -remotePath "/data/data/com.kakao.talk/files/datastore/LocalUser_DataStore.pref.preferences_pb" -localPath $localUserPb
} catch {
    Write-Log "LocalUser_DataStore pull 실패: $($_.Exception.Message)" "ERROR"
    exit 1
}

try {
    $json = (& python scripts/parse_datastore_prefs.py --in $localUserPb --keys "encrypted_auth_token_v2,encrypted_auth_token") | Out-String
    $prefs = $json | ConvertFrom-Json
} catch {
    Write-Log "DataStore 파싱 실패: $($_.Exception.Message)" "ERROR"
    exit 1
}

$access = ""
if ($prefs.encrypted_auth_token_v2) { $access = [string]$prefs.encrypted_auth_token_v2 }
elseif ($prefs.encrypted_auth_token) { $access = [string]$prefs.encrypted_auth_token }

if (-not $access) {
    Write-Log "accessToken 후보를 찾지 못했습니다(LocalUser_DataStore.encrypted_auth_token_v2/_token)." "ERROR"
    Write-Log "참고: 과거에 잡히던 JWT는 Firebase 토큰일 가능성이 높아 Talk-API 인증에 맞지 않을 수 있습니다." "INFO"
    exit 1
}

# 2-2) deviceUUID 후보: android_id + INSTALLATION(앱 설치 UUID) 등
$deviceCandidates = New-Object System.Collections.Generic.List[object]

$androidId = Try-Get-AndroidId -serial $serial
if ($androidId) {
    $deviceCandidates.Add(@{ source = "android_id"; value = $androidId })
    Write-Log "device 후보: android_id = $(Redact $androidId)"
} else {
    Write-Log "android_id 조회 실패" "WARN"
}

$installLocal = "data/talkapi_sources/INSTALLATION"
try {
    Pull-RootFile -serial $serial -remotePath "/data/data/com.kakao.talk/files/INSTALLATION" -localPath $installLocal
    $installation = (Get-Content $installLocal -TotalCount 1 -ErrorAction Stop).ToString().Trim()
    if ($installation) {
        $deviceCandidates.Add(@{ source = "INSTALLATION"; value = $installation })
        Write-Log "device 후보: INSTALLATION = $(Redact $installation)"
    }
} catch {
    Write-Log "INSTALLATION pull 실패(없을 수도 있음): $($_.Exception.Message)" "WARN"
}

# 후보 정리(중복 제거)
$uniq = @{}
foreach ($c in $deviceCandidates) {
    $v = [string]$c.value
    if (-not $v) { continue }
    if (-not $uniq.ContainsKey($v)) { $uniq[$v] = [string]$c.source }
}
$deviceValues = @($uniq.Keys)

Write-Log "후보 탐색 결과: accessToken=1개, deviceUUID 후보=$($deviceValues.Count)개"
Write-Log ("accessToken=" + (Redact $access) + " (source=LocalUser_DataStore)") "INFO"
if ($deviceValues.Count -gt 0) {
    Write-Log "deviceUUID 후보(레드랙트):" "INFO"
    $deviceValues | ForEach-Object { Write-Host ("  - " + (Redact $_) + " (source=" + $uniq[$_] + ")") }
}

if ($deviceValues.Count -ne 1) {
    Write-Log "deviceUUID를 단일 값으로 확정할 수 없습니다. (폴백 금지 원칙에 따라 종료)" "ERROR"
    Write-Log "다음 단계(권장): 테스트용 방(chatId/roomId)에서 1회 전송으로 후보를 검증하세요." "INFO"
    Write-Log "  - python scripts/verify_talkapi_auth_candidates.py --chat-id <ROOM_ID> --confirm-send --apply-runtime" "INFO"
    Write-Log "대안: KakaoTalk 앱에서 실제 Authorization/Duuid 헤더를 캡처하세요(Frida 필요)." "INFO"
    Write-Log "  - python scripts/capture_talkapi_auth_frida.py --apply-runtime" "INFO"
    exit 1
}

$device = [string]$deviceValues[0]
$auth = ($access.Trim() + "-" + $device.Trim())
Save-Secret -path $OutFile -content ($auth + "`n")
Write-Log "authHeader 저장 완료: $OutFile (값은 미출력)"
Write-Log ("accessToken=" + (Redact $access) + ", deviceUUID=" + (Redact $device))

# Snapshot (best-effort, do not fail capture flow)
try {
    $snap = Join-Path $PSScriptRoot "snapshot_talkapi_auth.ps1"
    if (Test-Path $snap) { & $snap -AuthFile $OutFile | Out-Null }
} catch {}
if ($ApplyRuntime) {
    Apply-Runtime -base $RealtimeApiBase -authHeader $auth
    Write-Log "Realtime API runtime.json 반영 완료: talkApi.authHeader 업데이트"
}
exit 0
