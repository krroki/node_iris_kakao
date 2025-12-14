<#
.SYNOPSIS
  Windows Task Scheduler에 12.kakao 자동 기동(start_all.cmd) 작업을 등록/삭제한다.

.DESCRIPTION
  - 기본 트리거는 ONLOGON(사용자 로그인 시)이며, 필요하면 ONSTART(부팅 시)로 변경할 수 있다.
  - start_all.cmd는 내부적으로 start_all.ps1를 호출하며, watchdog까지 함께 기동된다.

.USAGE
  # 등록(권장: 로그인 시 + 30초 지연)
  powershell -ExecutionPolicy Bypass -File .\windows\register_start_all_task.ps1

  # 삭제
  powershell -ExecutionPolicy Bypass -File .\windows\register_start_all_task.ps1 -Delete
#>

param(
  [string]$RepoPath = $(Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)),
  [string]$Name = 'IRIS_12KAKAO_StartAll',
  [ValidateSet('ONLOGON','ONSTART')]
  [string]$Schedule = 'ONLOGON',
  [string]$User = $env:USERNAME,
  [int]$DelaySec = 30,
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

$entry = Join-Path $RepoPath 'windows\start_all.cmd'
if (-not (Test-Path $entry)) {
  throw "start_all.cmd not found: $entry"
}

# schtasks ONLOGON/ONSTART supports /DELAY HH:MM
$delayHH = [math]::Floor([math]::Max(0,$DelaySec) / 3600)
$delayMM = [math]::Floor(([math]::Max(0,$DelaySec) % 3600) / 60)
$delay = "{0:D2}:{1:D2}" -f $delayHH, $delayMM

$action = "cmd.exe /c `"`"$entry`"`""
$cmd = "schtasks /Create /TN `"$Name`" /TR `"$action`" /SC $Schedule /F /RL HIGHEST /RU `"$User`""
if ([math]::Max(0,$DelaySec) -ge 60) {
  $cmd += " /DELAY $delay"
}

Invoke-Schtasks -Cmd $cmd
Write-Host ("Created task: {0} (SC={1}, RU={2}, DelaySec={3})" -f $Name, $Schedule, $User, $DelaySec) -ForegroundColor Green

