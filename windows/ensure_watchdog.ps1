# watchdog가 꺼져있으면 자동으로 다시 기동한다(전역 node/python kill 금지).
param(
  [string]$RepoPath = $(Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)),
  [string]$ApiBase = 'http://127.0.0.1:8650',
  [string]$IrisBase = 'http://127.0.0.1:5050',
  [int]$WebPort = 3100,
  [switch]$Restart
)

$ErrorActionPreference = 'Stop'

try { chcp 65001 | Out-Null } catch {}
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()

$repoPathEsc = [Regex]::Escape((Resolve-Path $RepoPath).Path)
$windowsDir = Join-Path $RepoPath 'windows'
$watchdogScript = Join-Path $windowsDir 'watchdog.ps1'
if (-not (Test-Path $watchdogScript)) { throw "watchdog.ps1 not found: $watchdogScript" }

function Find-WatchdogProcs {
  try {
    return @(
      Get-CimInstance Win32_Process |
        Where-Object { $_.Name -in @('powershell.exe','pwsh.exe') } |
        Where-Object { $_.CommandLine -match 'watchdog\.ps1' -and $_.CommandLine -match $repoPathEsc }
    )
  } catch {
    return @()
  }
}

$procs = @(Find-WatchdogProcs)
if ($procs.Count -gt 0 -and -not $Restart) {
  Write-Host ("[ensure_watchdog] watchdog already running (count={0})" -f $procs.Count) -ForegroundColor Green
  exit 0
}

if ($Restart -and $procs.Count -gt 0) {
  Write-Host ("[ensure_watchdog] restarting watchdog (count={0})" -f $procs.Count) -ForegroundColor Yellow
  foreach ($p in $procs) {
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    try { wmic process where "ProcessId=$($p.ProcessId)" call terminate | Out-Null } catch {}
  }
  Start-Sleep -Milliseconds 300
}

$logDir = Join-Path $windowsDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$outLog = Join-Path $logDir 'watchdog.out.log'
$errLog = Join-Path $logDir 'watchdog.err.log'

Write-Host "[ensure_watchdog] starting watchdog" -ForegroundColor Cyan
Start-Process -FilePath powershell.exe -WorkingDirectory $windowsDir -ArgumentList @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', $watchdogScript,
  '-ApiBase', $ApiBase,
  '-WebPort', "$WebPort",
  '-IrisBase', $IrisBase
) -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden | Out-Null

Start-Sleep -Milliseconds 300
$procs2 = @(Find-WatchdogProcs)
if ($procs2.Count -eq 0) { throw "watchdog start failed (no process found)" }
Write-Host ("[ensure_watchdog] OK (pid={0})" -f $procs2[0].ProcessId) -ForegroundColor Green

