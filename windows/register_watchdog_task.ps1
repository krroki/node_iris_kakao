<#
.SYNOPSIS
  Windows Task Scheduler에 watchdog 보장(ensure_watchdog.ps1) 작업을 등록/삭제한다.

.DESCRIPTION
  - watchdog는 자동 복구의 "심장"이므로, 실수로 꺼져도 자동으로 다시 올라오게 해야 한다.
  - 이 작업은 1분마다 실행되며, watchdog가 이미 실행 중이면 아무 것도 하지 않는다.

.USAGE
  # 등록(권장)
  powershell -ExecutionPolicy Bypass -File .\windows\register_watchdog_task.ps1

  # 삭제
  powershell -ExecutionPolicy Bypass -File .\windows\register_watchdog_task.ps1 -Delete
#>

param(
  [string]$RepoPath = $(Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)),
  [string]$Name = 'IRIS_12KAKAO_EnsureWatchdog',
  [string]$User = $env:USERNAME,
  [int]$EveryMinutes = 1,
  [switch]$Delete
)

$ErrorActionPreference = 'Stop'

function Invoke-Schtasks {
  param([string]$Cmd)
  Write-Host $Cmd -ForegroundColor DarkGray
  cmd.exe /c $Cmd | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "schtasks failed (exit $LASTEXITCODE)"
  }
}

if ($Delete) {
  Invoke-Schtasks -Cmd ("schtasks /Delete /TN `"$Name`" /F")
  Write-Host "Deleted task: $Name" -ForegroundColor Green
  exit 0
}

$entry = Join-Path $RepoPath 'windows\ensure_watchdog.ps1'
if (-not (Test-Path $entry)) {
  throw "ensure_watchdog.ps1 not found: $entry"
}

$mins = [math]::Max(1, [int]$EveryMinutes)
$action = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$entry`""
$cmd = "schtasks /Create /TN `"$Name`" /TR `"$action`" /SC MINUTE /MO $mins /F /RL HIGHEST /RU `"$User`""
Invoke-Schtasks -Cmd $cmd
Write-Host ("Created task: {0} (every {1} minute(s), RU={2})" -f $Name, $mins, $User) -ForegroundColor Green

