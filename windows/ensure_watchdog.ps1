# watchdog가 꺼져있으면 자동으로 다시 기동한다(전역 node/python kill 금지).
param(
  [string]$RepoPath = $(Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)),
  [string]$ApiBase = 'http://127.0.0.1:8650',
  [string]$IrisBase = 'http://127.0.0.1:5050',
  [int]$WebPort = 3100,
  # watchdog는 정상이라면 주기적으로 windows/watchdog.log를 갱신한다.
  # 프로세스는 살아있지만 로그가 오래 멈춰있으면 "hung"으로 보고 재기동한다.
  [int]$MaxLogAgeSec = 900,
  [switch]$Restart
)

$ErrorActionPreference = 'Stop'

try { chcp 65001 | Out-Null } catch {}
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()

$repoPathEsc = [Regex]::Escape((Resolve-Path $RepoPath).Path)
$windowsDir = Join-Path $RepoPath 'windows'
$watchdogScript = Join-Path $windowsDir 'watchdog.ps1'
if (-not (Test-Path $watchdogScript)) { throw "watchdog.ps1 not found: $watchdogScript" }
$watchdogScriptEsc = [Regex]::Escape((Resolve-Path $watchdogScript).Path)
$watchdogLog = Join-Path $windowsDir 'watchdog.log'

function Find-WatchdogProcs {
  try {
    return @(
      Get-CimInstance Win32_Process |
        Where-Object { $_.Name -in @('powershell.exe','pwsh.exe') } |
        # NOTE: ensure_watchdog.ps1 / register_watchdog_task.ps1도 "watchdog.ps1" 서브스트링을 포함하므로
        # 단순 'watchdog\.ps1' 매칭을 하면 오탐이 발생한다. 전체 경로 기준으로만 매칭한다.
        Where-Object { $_.CommandLine -match $watchdogScriptEsc -and $_.CommandLine -match $repoPathEsc }
    )
  } catch {
    return @()
  }
}

$procs = @(Find-WatchdogProcs)
if ($procs.Count -gt 0 -and -not $Restart) {
  $stale = $false
  if ($MaxLogAgeSec -gt 0 -and (Test-Path $watchdogLog)) {
    try {
      $ageSec = [int]([datetime]::Now - (Get-Item -LiteralPath $watchdogLog).LastWriteTime).TotalSeconds
      if ($ageSec -ge $MaxLogAgeSec) { $stale = $true }
    } catch {
      $stale = $false
    }
  }

  if (-not $stale) {
    Write-Host ("[ensure_watchdog] watchdog already running (count={0})" -f $procs.Count) -ForegroundColor Green
    exit 0
  }

  Write-Host ("[ensure_watchdog] watchdog process is running but log is stale (>= {0}s); restarting" -f $MaxLogAgeSec) -ForegroundColor Yellow
  $Restart = $true
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

