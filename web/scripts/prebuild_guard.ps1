$ErrorActionPreference = 'Stop'

# 목적:
# - 운영(Web: next start)이 실행 중인 상태에서 `npm run build`(=next build)를 실행하면
#   distDir(.next-prod)가 덮어써져 `/_next/static/*` 404가 발생하며 UI가 깨질 수 있다.
# - 이 스크립트는 그런 실수를 "사전에" 막는다.
#
# 예외(고의로 실행):
# - `set ALLOW_WEB_BUILD_WITH_RUNNING_UI=1` 후 `npm run build:unsafe`

if ($env:ALLOW_WEB_BUILD_WITH_RUNNING_UI -eq '1') {
  Write-Host '[prebuild_guard] ALLOW_WEB_BUILD_WITH_RUNNING_UI=1 → guard skip' -ForegroundColor Yellow
  exit 0
}

$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$latest = Join-Path $repoRoot 'windows\logs\web.next.latest.json'

function Get-ProcCmd([int]$TargetPid) {
  try {
    $p = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $TargetPid) -ErrorAction SilentlyContinue
    if ($p -and $p.CommandLine) { return [string]$p.CommandLine }
  } catch {}
  return ''
}

function Is-NextStartCmd([string]$Cmd) {
  if (-not $Cmd) { return $false }
  $c = $Cmd.ToLowerInvariant()
  return ($c -match 'node_modules[\\/]+next[\\/]+dist[\\/]+bin[\\/]+next') -and ($c -match '\sstart(\s|$)')
}

function Block([string]$Reason) {
  Write-Host ''
  Write-Host '[prebuild_guard] 차단됨: next start(운영 UI)가 실행 중인 상태에서 build를 실행했습니다.' -ForegroundColor Red
  Write-Host ("- 사유: {0}" -f $Reason) -ForegroundColor Red
  Write-Host ''
  Write-Host '이 상태에서 build를 실행하면 `.next-prod`가 덮어써져 브라우저에서 `/_next/static/*` 404로 화면이 깨질 수 있습니다.' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '권장 복구/반영 방법:' -ForegroundColor Cyan
  Write-Host '  - PowerShell(관리자 아님):' -ForegroundColor Cyan
  Write-Host '    powershell -NoProfile -ExecutionPolicy Bypass -File ..\\windows\\start_web.ps1 -Mode prod -Port 3100 -ForceKillPort -CleanBuild' -ForegroundColor Cyan
  Write-Host ''
  Write-Host '정말로(의도적으로) UI 실행 중 build가 필요하면:' -ForegroundColor DarkYellow
  Write-Host '  - set ALLOW_WEB_BUILD_WITH_RUNNING_UI=1' -ForegroundColor DarkYellow
  Write-Host '  - npm run build:unsafe' -ForegroundColor DarkYellow
  exit 1
}

# 1) start_web.ps1가 남긴 최신 PID 기반(가장 정확)
try {
  if (Test-Path $latest) {
    $j = Get-Content -LiteralPath $latest -Raw -Encoding UTF8 | ConvertFrom-Json
    $latestPid = if ($j.pid) { [int]$j.pid } else { 0 }
    if ($latestPid -gt 0) {
      $cmd = Get-ProcCmd -TargetPid $latestPid
      if (Is-NextStartCmd -Cmd $cmd) {
        Block -Reason ("web.next.latest.json의 PID({0})가 next start로 실행 중" -f $latestPid)
      }
    }
  }
} catch {}

# 2) 포트 기반(3100/3110). latest.json이 없거나 수동 기동한 경우를 보완.
function Check-Port([int]$Port) {
  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $conn) { return }
    $listenPid = [int]$conn.OwningProcess
    if ($listenPid -le 0) { return }
    $cmd = Get-ProcCmd -TargetPid $listenPid
    if (Is-NextStartCmd -Cmd $cmd) {
      Block -Reason ("포트 :{0} 리스닝 PID({1})가 next start로 실행 중" -f $Port, $listenPid)
    }
  } catch {}
}

Check-Port -Port 3100
Check-Port -Port 3110

Write-Host '[prebuild_guard] ok (no running next start detected)' -ForegroundColor Green
exit 0
