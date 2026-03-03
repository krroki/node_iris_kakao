#requires -version 5.1
<#
  data/talkapi_auth.txt(또는 지정 파일)의 authHeader를 스냅샷으로 보관한다.

  - 스냅샷은 data/ 하위에만 저장한다(커밋 금지).
  - 콘솔에는 토큰/UUID를 그대로 출력하지 않는다(레드랙트만).
  - 최신 스냅샷 메타는 data/talkapi_auth_snapshots/latest.json에 기록한다.

  사용 예시
    pwsh scripts/snapshot_talkapi_auth.ps1
    powershell -ExecutionPolicy Bypass -File scripts/snapshot_talkapi_auth.ps1 -AuthFile data/talkapi_auth.txt
#>

param(
  [string]$AuthFile = "data/talkapi_auth.txt",
  [string]$SnapshotDir = "data/talkapi_auth_snapshots"
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
  $parts = $raw.Split("-", 2)
  $authorization = if ($parts.Length -ge 1) { $parts[0] } else { "" }
  $duuid = if ($parts.Length -ge 2) { $parts[1] } else { "" }
  return @{ authorization = (Redact $authorization); duuid = (Redact $duuid) }
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

$authPath = Resolve-PathSafe $AuthFile
$snapDir = Resolve-PathSafe $SnapshotDir
$latestPath = Join-Path $snapDir "latest.json"

$line = Read-AuthLine $authPath
if (-not $line) {
  Write-Host "[talkapi-auth] 스냅샷 스킵: authHeader 파일이 비어있거나 없음: $AuthFile" -ForegroundColor Yellow
  exit 0
}

New-Item -ItemType Directory -Force -Path $snapDir | Out-Null

$hash = Sha256Hex $line
$prevHash = $null
try {
  if (Test-Path $latestPath) {
    $j = Get-Content -LiteralPath $latestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($j -and $j.hash) { $prevHash = [string]$j.hash }
  }
} catch {}

if ($prevHash -and $prevHash -eq $hash) {
  Write-Host "[talkapi-auth] 스냅샷 스킵: 변경 없음 (hash 동일)" -ForegroundColor Green
  exit 0
}

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$snapFileName = "talkapi_auth.$ts.txt"
$snapPath = Join-Path $snapDir $snapFileName

# UTF-8(no BOM)로 저장
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($snapPath, ($line + "`n"), $utf8NoBom)

$meta = @{
  updatedAt   = (Get-Date).ToString("o")
  sourceFile  = $AuthFile
  snapshot    = (Resolve-PathSafe $snapPath)
  hash        = $hash
  redacted    = (Redact-AuthHeader $line)
}

[System.IO.File]::WriteAllText($latestPath, ($meta | ConvertTo-Json -Depth 5), $utf8NoBom)

Write-Host "[talkapi-auth] 스냅샷 저장 완료: $snapFileName" -ForegroundColor Green
Write-Host ("[talkapi-auth] redacted Authorization={0}, Duuid={1}" -f $meta.redacted.authorization, $meta.redacted.duuid) -ForegroundColor DarkGray
