param(
  [string]$IrisUrl = '',
  [int]$ApiPort = 8650,
  [int]$WebPort = 3100
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

# Pre-clean: stop leftover API/bot/web processes for this repo
function Stop-ProcsByPredicate {
  param([scriptblock]$Match)
  try {
    $procs = Get-CimInstance Win32_Process |
      Where-Object { $_.Name -in @('node.exe','python.exe') } |
      Where-Object $Match
    foreach ($p in $procs) {
      try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
      try {
        if (Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue) {
          wmic process where "ProcessId=$($p.ProcessId)" call terminate | Out-Null
        }
      } catch {}
    }
  } catch {}
}

$repoPath = [Regex]::Escape($root)
Write-Host '[all] pre-cleaning old processes'
Stop-ProcsByPredicate { $_.CommandLine -match 'uvicorn' -and $_.CommandLine -match 'server.app:app' }
Stop-ProcsByPredicate { $_.CommandLine -match 'node-iris-app' -and $_.CommandLine -match $repoPath }
Stop-ProcsByPredicate { $_.CommandLine -match 'web\\node_modules\\next' -and $_.CommandLine -match $repoPath }
Stop-ProcsByPredicate { $_.CommandLine -match 'next\\dist\\server\\lib\\start-server.js' -and $_.CommandLine -match $repoPath }

# 공통 ENV: Realtime API / IRIS 브리지 / KB 스케줄러 (Windows 전용 스택)
$env:REALTIME_API_BASE = "http://127.0.0.1:$ApiPort"
$env:NEXT_PUBLIC_REALTIME_BASE = $env:REALTIME_API_BASE
$env:TEMPLATE_ASSETS_BASE = "$($env:REALTIME_API_BASE)/templates/"
# KB 자동화 스케줄 기본값(분) – collect: 30, embed: 30, manual: 60, backfill: 60
if (-not $env:KB_SCHED_COLLECT_MIN)  { $env:KB_SCHED_COLLECT_MIN  = '30' }
if (-not $env:KB_SCHED_EMBED_MIN)    { $env:KB_SCHED_EMBED_MIN    = '30' }
if (-not $env:KB_SCHED_MANUAL_MIN)   { $env:KB_SCHED_MANUAL_MIN   = '60' }
if (-not $env:KB_SCHED_BACKFILL_MIN) { $env:KB_SCHED_BACKFILL_MIN = '60' }
if ($IrisUrl) {
  $env:IRIS_URL = $IrisUrl
  $env:IRIS_BRIDGE_URL = $IrisUrl
}

Write-Host '[all] starting API'
Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'start_api.ps1'),'-Port',"$ApiPort" -WorkingDirectory $root

Start-Sleep -Seconds 1

# Start KB service (8610) with same ENV (KB_SCHED_*)
Write-Host '[all] starting KB service'
Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'kb_service.ps1'),'-Port','8610' -WorkingDirectory $root

Start-Sleep -Seconds 1

Write-Host '[all] starting bot'
Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'start_bot.ps1'),'-IrisUrl',"$IrisUrl" -WorkingDirectory $root

Start-Sleep -Seconds 1

Write-Host '[all] starting web'
Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'start_web.ps1'),'-Port',"$WebPort" -WorkingDirectory $root

Write-Host "[all] started. Web http://localhost:$WebPort  | API http://localhost:$ApiPort" -ForegroundColor Green

