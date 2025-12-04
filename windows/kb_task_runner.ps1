param(
  [ValidateSet('collect','embed','manual')]
  [string]$Task,
  [string]$Venv = ".venv",
  [string]$EnvFile = ".env",
  [int]$Pages = 0
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath $root

Import-Module "$PSScriptRoot\load_env.ps1" -Force
& "$PSScriptRoot\load_env.ps1" -EnvFile $EnvFile

$logDir = Join-Path $root 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logPath = Join-Path $logDir ("kb_task_{0}_{1:yyyyMMdd_HHmmss}.log" -f $Task, (Get-Date))
Start-Transcript -Path $logPath -Append | Out-Null

function Py { param([string[]]$Args)
  $py = if (Test-Path ("{0}\Scripts\python.exe" -f $Venv)) { "{0}\Scripts\python.exe" -f $Venv } else { "python" }
  & $py @Args }

try {
  $pagesEff = if ($Pages -gt 0) { $Pages } else { 3 }
  switch ($Task) {
    'collect' { & "$PSScriptRoot\kb_collect.ps1" -Pages $pagesEff }
    'embed'   { & "$PSScriptRoot\kb_embed.ps1" }
    'manual'  { & "$PSScriptRoot\kb_manualize.ps1" }
  }
} finally {
  Stop-Transcript | Out-Null
}


