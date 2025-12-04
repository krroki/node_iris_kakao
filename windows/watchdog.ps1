<#
.SYNOPSIS
  Lightweight watchdog for local IRIS 파이프라인.
.DESCRIPTION
  - /health(127.0.0.1:8600)와 /config(192.168.127.63:3000)를 주기적으로 체크
  - API/Bot/Web 중단 시 기존 start_all 파이프라인으로 재기동
  - IRIS 단말쪽(/config)까지 죽어 있으면 재기동 안 하고 로그만 남김(단말 이슈 분리)
.USAGE
  관리자 PowerShell:
    cd C:\dev\12.kakao\windows
    powershell -ExecutionPolicy Bypass -File .\watchdog.ps1
#>

param(
  [int]$IntervalSec = 30,
  [string]$ApiHealth = "http://127.0.0.1:8600/health",
  [string]$IrisConfig = "http://192.168.127.63:3000/config",
  [string]$LogPath = "C:\dev\12.kakao\windows\watchdog.log"
)

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path $PSScriptRoot -Parent
$botLock = Join-Path $root "node-iris-app\data\bot.lock"
$repairScript = Join-Path $root "windows\repair_redroid_iris.ps1"
$lastRepairAt = Get-Date '2000-01-01T00:00:00Z'

function Write-Log {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -Path $LogPath -Value $line
}

function Kill-BotProcesses {
  try {
    $nodeProcs = Get-CimInstance Win32_Process |
      Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*node-iris-app*' }
    foreach ($p in $nodeProcs) {
      try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
  } catch {}
  try {
    $pwProcs = Get-CimInstance Win32_Process |
      Where-Object { $_.Name -eq 'playwright.exe' -and $_.CommandLine -like '*node-iris-app*' }
    foreach ($p in $pwProcs) {
      try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
  } catch {}
  if (Test-Path $botLock) { Remove-Item $botLock -Force -ErrorAction SilentlyContinue }
}

function Start-All {
  Write-Log "restart -> start_all.ps1"
  try { & "$root\windows\start_all.ps1" -IrisUrl "http://192.168.127.63:3000" } catch { Write-Log "start_all error: $_" }
}

function Invoke-Repair {
  if (-not (Test-Path $repairScript)) {
    Write-Log "[repair] script not found: $repairScript"
    return
  }
  $now = Get-Date
  if ($now -lt $lastRepairAt.AddMinutes(2)) {
    Write-Log "[repair] skip (cooldown < 2min)"
    return
  }
  $script:lastRepairAt = $now
  Write-Log "[repair] running repair_redroid_iris.ps1 -Fix"
  try {
    & $repairScript -Fix 2>&1 | ForEach-Object { Write-Log "[repair] $_" }
  } catch {
    Write-Log "[repair] ERROR: $_"
  }
}

while ($true) {
  $okApi = $false
  $okIris = $false

  try {
    $resp = Invoke-WebRequest -Uri $ApiHealth -TimeoutSec 3
    if ($resp.StatusCode -eq 200) { $okApi = $true }
  } catch {}

  try {
    $resp2 = Invoke-WebRequest -Uri $IrisConfig -TimeoutSec 3
    if ($resp2.StatusCode -eq 200) { $okIris = $true }
  } catch {}

  if (-not $okIris) {
    Write-Log "[IRIS] health FAIL (단말/컨테이너 확인 필요)"
    Invoke-Repair
  }

  if (-not $okApi -and $okIris) {
    Write-Log "[API/Bot] health FAIL -> restart pipeline"
    Kill-BotProcesses
    Start-All
  }

  Start-Sleep -Seconds $IntervalSec
}
