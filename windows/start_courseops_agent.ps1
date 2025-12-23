param(
  [int]$TimeoutSec = 25,
  [string]$LogDir = '',
  [switch]$Restart
)

try { chcp 65001 | Out-Null } catch {}
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root

if (-not $LogDir) { $LogDir = Join-Path $root 'windows\logs' }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$outLog = Join-Path $LogDir 'courseops_agent.out.log'
$errLog = Join-Path $LogDir 'courseops_agent.err.log'

$statusPath = Join-Path $root 'node-iris-app\data\courseops_agent_status.json'
$agentEntry = Join-Path $root 'courseops\agent\src\index.js'

function Get-AgentPidFromStatus {
  try {
    if (-not (Test-Path $statusPath)) { return $null }
    $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($j.pid) { return [int]$j.pid }
  } catch {}
  return $null
}

function Find-AgentProcs {
  try {
    $absRe = [Regex]::Escape($agentEntry)
    $relRe = 'courseops[/\\]agent[/\\]src[/\\]index\.js'
    return @(
      Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -and (($_.CommandLine -match $absRe) -or ($_.CommandLine -match $relRe)) } |
        Select-Object ProcessId,CommandLine
    )
  } catch { return @() }
}

$statusPid = Get-AgentPidFromStatus
$statusProc = $null
if ($statusPid) {
  try {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$statusPid" -ErrorAction SilentlyContinue
    if ($p -and ($p.Name -eq 'node.exe')) {
      $absRe = [Regex]::Escape($agentEntry)
      $relRe = 'courseops[/\\]agent[/\\]src[/\\]index\.js'
      if (($p.CommandLine -match $absRe) -or ($p.CommandLine -match $relRe)) {
        $statusProc = [pscustomobject]@{ ProcessId = [int]$p.ProcessId; CommandLine = [string]$p.CommandLine }
      }
    }
  } catch {}
}

$procs = Find-AgentProcs
$mainPid = $null
if ($statusProc) { $mainPid = $statusProc.ProcessId }
elseif ($procs.Count -gt 0) { $mainPid = [int]$procs[0].ProcessId }

if ($procs.Count -gt 1) {
  $pidsText = ($procs | ForEach-Object { $_.ProcessId } | Sort-Object) -join ','
  Write-Host ("[courseops-agent] WARN: multiple agent processes detected: {0}" -f $pidsText) -ForegroundColor Yellow
  foreach ($proc in $procs) {
    $procPid = [int]$proc.ProcessId
    if ($mainPid -and $procPid -eq $mainPid) { continue }
    try { Stop-Process -Id $procPid -Force -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Milliseconds 300
}

if ($mainPid) {
  if (-not $Restart) {
    Write-Host ("[courseops-agent] already running pid={0}; skip start (use -Restart to force)" -f $mainPid) -ForegroundColor Green
    return
  }
  Write-Host ("[courseops-agent] restart requested; stopping existing pid={0}" -f $mainPid) -ForegroundColor Yellow
  try { Stop-Process -Id $mainPid -Force -ErrorAction SilentlyContinue } catch {}
  Start-Sleep -Milliseconds 300
}

if (-not (Test-Path $agentEntry)) {
  Write-Host ("[courseops-agent] entry not found: {0}" -f $agentEntry) -ForegroundColor Red
  exit 1
}

Write-Host ("[courseops-agent] starting (timeout {0}s)" -f $TimeoutSec) -ForegroundColor Green
try { Remove-Item -Force -ErrorAction SilentlyContinue $outLog,$errLog | Out-Null } catch {}
$proc = Start-Process -FilePath node -ArgumentList @("`"$agentEntry`"") -WorkingDirectory $root -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru
$pid = $proc.Id

$deadline = (Get-Date).AddSeconds([math]::Max(5, $TimeoutSec))
$ready = $false
do {
  Start-Sleep -Seconds 1
  $alive = $null -ne (Get-Process -Id $pid -ErrorAction SilentlyContinue)
  if (-not $alive) { break }
  try {
    if (Test-Path $statusPath) {
      $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $spid = $null
      try { if ($j.pid) { $spid = [int]$j.pid } } catch {}
      if ($spid -and $spid -eq $pid) { $ready = $true; break }
    }
  } catch {}
} while ((Get-Date) -lt $deadline)

$alive = $null -ne (Get-Process -Id $pid -ErrorAction SilentlyContinue)
if ($ready) {
  Write-Host ("[courseops-agent] READY pid={0}" -f $pid) -ForegroundColor Green
} elseif ($alive) {
  Write-Host ("[courseops-agent] STARTED pid={0} (status not ready). See logs {1} / {2}" -f $pid, $outLog, $errLog) -ForegroundColor Yellow
} else {
  Write-Host ("[courseops-agent] FAILED (process exited). See logs {0} / {1}" -f $outLog, $errLog) -ForegroundColor Red
  exit 1
}

