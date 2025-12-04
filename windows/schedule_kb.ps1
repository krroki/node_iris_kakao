param(
  [string]$RepoPath = $(Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)),
  [string]$User = $env:USERNAME
)

$ErrorActionPreference = 'Stop'

function New-Task {
  param(
    [string]$Name,
    [string]$Action,
    [string]$Schedule,
    [int]$Minutes = 15
  )
  $cmd = "schtasks /Create /TN `"$Name`" /TR `"$Action`" /SC $Schedule"
  if ($Schedule -eq 'MINUTE') { $cmd += " /MO $Minutes" }
  $cmd += " /F /RL HIGHEST /RU $User"
  Write-Host $cmd -ForegroundColor DarkGray
  cmd /c $cmd | Out-Host
}

$ps = (Get-Command powershell.exe).Source
$runner = Join-Path $RepoPath 'windows\kb_task_runner.ps1'

New-Task -Name 'IRIS_KB_Collect'   -Action "$ps -ExecutionPolicy Bypass -File `"$runner`" -Task collect" -Schedule 'MINUTE' -Minutes 15
New-Task -Name 'IRIS_KB_Embed'     -Action "$ps -ExecutionPolicy Bypass -File `"$runner`" -Task embed"   -Schedule 'MINUTE' -Minutes 30
New-Task -Name 'IRIS_KB_Manualize' -Action "$ps -ExecutionPolicy Bypass -File `"$runner`" -Task manual"  -Schedule 'HOURLY'

Write-Host 'Scheduled tasks created. You can review in Task Scheduler.' -ForegroundColor Green

