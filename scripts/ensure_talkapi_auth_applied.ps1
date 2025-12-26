#requires -version 5.1
<#
  data/talkapi_auth.txt(또는 지정 파일)의 authHeader를 Realtime API(/runtime)의 talkApi.authHeader로 반영한다.

  목적
  - "캡처는 수동으로 하되", 갱신된 auth 파일이 있으면 런타임 반영은 자동/주기적으로 수행.
  - 서버/노드 재기동 시에도 runtime.json 드리프트를 줄이기 위함.

  보안/운영 원칙
  - 토큰/UUID를 콘솔에 그대로 출력하지 않는다(레드랙트만).
  - 적용 결과는 node-iris-app/data/talkapi_auth_apply_status.json에 저장한다(커밋 금지).
#>

param(
  [string]$RealtimeApiBase = "http://127.0.0.1:8650",
  [string]$AuthFile = "data/talkapi_auth.txt",
  # 동일 auth를 너무 자주 /runtime에 POST하지 않도록 최소 간격(초)
  [int]$MinIntervalSec = 300,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent

function Resolve-PathSafe([string]$p) {
  if (-not $p) { return "" }
  if ([System.IO.Path]::IsPathRooted($p)) { return $p }
  return (Join-Path $root $p)
}

function Read-AuthLine([string]$path) {
  if (-not (Test-Path $path)) { return "" }
  $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8
  $line = $raw -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -First 1
  return [string]$line
}

function Redact([string]$s) {
  $t = [string]$s
  $t = $t.Trim()
  if (-not $t) { return "" }
  if ($t.Length -le 8) { return "***" }
  return $t.Substring(0, 4) + "..." + $t.Substring($t.Length - 4, 4)
}

function Redact-AuthHeader([string]$authHeader) {
  $raw = [string]$authHeader
  $raw = $raw.Trim()
  $idx = $raw.LastIndexOf("-")
  if ($idx -lt 1 -or $idx -ge ($raw.Length - 1)) {
    return @{
      authorization = (Redact $raw)
      duuid = ""
      dashCount = ([regex]::Matches($raw, "-").Count)
      accessTokenHasDash = $false
    }
  }
  $authorization = $raw.Substring(0, $idx)
  $duuid = $raw.Substring($idx + 1)
  $dashCount = ([regex]::Matches($raw, "-").Count)
  return @{
    authorization = (Redact $authorization)
    duuid = (Redact $duuid)
    dashCount = $dashCount
    accessTokenHasDash = ($authorization -like "*-*")
  }
}

function Sha256Hex([string]$s) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($s)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash($bytes)
    return -join ($hash | ForEach-Object { $_.ToString("x2") })
  } finally {
    $sha.Dispose()
  }
}

function Load-JsonSafe([string]$path) {
  try {
    if (-not (Test-Path $path)) { return $null }
    $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8
    if (-not $raw) { return $null }
    return $raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Save-Json([string]$path, [object]$obj) {
  $dir = Split-Path -Parent $path
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $tmp = "$path.tmp-$PID-$(Get-Date -Format 'yyyyMMdd_HHmmss')"
  [System.IO.File]::WriteAllText($tmp, ($obj | ConvertTo-Json -Depth 8), $utf8NoBom)
  try {
    if (Test-Path $path) {
      try { Remove-Item -Force -ErrorAction SilentlyContinue "$path.bak" | Out-Null } catch {}
      try { Move-Item -Force -ErrorAction SilentlyContinue $path "$path.bak" | Out-Null } catch {}
    }
    Move-Item -Force $tmp $path
  } finally {
    try { Remove-Item -Force -ErrorAction SilentlyContinue $tmp | Out-Null } catch {}
  }
}

$authPath = Resolve-PathSafe $AuthFile
$statusPath = Join-Path $root "node-iris-app\\data\\talkapi_auth_apply_status.json"
$rt = ($RealtimeApiBase.Trim().TrimEnd("/"))

$line = Read-AuthLine $authPath
if (-not $line) {
  Write-Host "[talkapi-auth] 스킵: authHeader 파일이 비어있거나 없음: $AuthFile" -ForegroundColor Yellow
  exit 0
}

# 스냅샷은 best-effort (실패해도 적용은 계속 시도)
try {
  $snapScript = Join-Path $PSScriptRoot "snapshot_talkapi_auth.ps1"
  if (Test-Path $snapScript) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $snapScript -AuthFile $AuthFile | Out-Null
  }
} catch {}

$hash = Sha256Hex $line
$red = Redact-AuthHeader $line

$now = Get-Date
$prev = Load-JsonSafe $statusPath
$prevHash = $null
$prevAppliedAt = $null
try { if ($prev -and $prev.hash) { $prevHash = [string]$prev.hash } } catch {}
try { if ($prev -and $prev.appliedAt) { $prevAppliedAt = [datetime]$prev.appliedAt } } catch {}

if (-not $Force -and $prevHash -and $prevHash -eq $hash -and $prevAppliedAt) {
  $age = ($now - $prevAppliedAt).TotalSeconds
  if ($age -lt [math]::Max(5, $MinIntervalSec)) {
    Write-Host "[talkapi-auth] 스킵: 최근에 동일 auth를 적용함 (cooldown ${MinIntervalSec}s)" -ForegroundColor Green
    exit 0
  }
}

$body = @{ talkApi = @{ authHeader = $line } } | ConvertTo-Json -Depth 6 -Compress
$uri = "$rt/runtime"

try {
  # NOTE: /runtime 응답은 authHeader를 포함하므로 결과를 출력/로그에 남기지 않는다.
  Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body $body -TimeoutSec 10 | Out-Null

  $out = @{
    ok = $true
    appliedAt = (Get-Date).ToString("o")
    authFile = $AuthFile
    hash = $hash
    redacted = $red
    meta = @{
      dashCount = $red.dashCount
      accessTokenHasDash = $red.accessTokenHasDash
    }
    realtimeApiBase = $rt
  }
  Save-Json -path $statusPath -obj $out

  Write-Host ("[talkapi-auth] 적용 완료: /runtime talkApi.authHeader 업데이트 (Authorization={0}, Duuid={1})" -f $red.authorization, $red.duuid) -ForegroundColor Green
  exit 0
} catch {
  $err = $_.Exception.Message
  $out = @{
    ok = $false
    attemptedAt = (Get-Date).ToString("o")
    authFile = $AuthFile
    hash = $hash
    redacted = $red
    meta = @{
      dashCount = $red.dashCount
      accessTokenHasDash = $red.accessTokenHasDash
    }
    realtimeApiBase = $rt
    error = $err
  }
  Save-Json -path $statusPath -obj $out
  Write-Host ("[talkapi-auth] 적용 실패: {0}" -f $err) -ForegroundColor Yellow
  exit 0
}
