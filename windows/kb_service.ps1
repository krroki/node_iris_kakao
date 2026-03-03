param(
  [int]$Port = 8610,
  [int]$TimeoutSec = 45,
  [string]$Venv = ".venv",
  [string]$EnvFile = ".env.kb",
  [string]$LogDir = '',
  [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root

if (-not $LogDir) { $LogDir = Join-Path $root 'windows\logs' }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$outLog = Join-Path $LogDir 'kb.out.log'
$errLog = Join-Path $LogDir 'kb.err.log'

# Stop-only mode
if ($Stop) {
  $stopped = @()
  try {
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
      Where-Object {
        $_.CommandLine -match 'uvicorn' -and $_.CommandLine -match 'kb.service:app'
      } |
      ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        $stopped += $_.ProcessId
      }
  } catch {}
  if ($stopped.Count -gt 0) {
    Write-Host ("[kb] stopped pids: {0}" -f ($stopped -join ',')) -ForegroundColor Yellow
  } else {
    Write-Host "[kb] no kb.service process found" -ForegroundColor Yellow
  }
  return
}

# Load env (base .env then overlay .env.kb)
if (Test-Path "windows\load_env.ps1") {
  if (Test-Path ".env") { . "windows\load_env.ps1" -EnvFile ".env" }
  if (Test-Path $EnvFile) { . "windows\load_env.ps1" -EnvFile $EnvFile }
}
if (-not $env:DATABASE_URL -or [string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
  # NOTE: SQLAlchemy 1.4 기본 환경 호환을 위해 psycopg2를 기본 드라이버로 사용한다.
  $env:DATABASE_URL = 'postgresql+psycopg2://iris:iris@127.0.0.1:5433/iris'
}
if (-not $env:KB_LOG_STDOUT) { $env:KB_LOG_STDOUT = '1' }
# kb_service 전용 로그 파일(작업 스크립트와 분리; WinError 32 회피)
if (-not $env:KB_LOG_FILE) { $env:KB_LOG_FILE = 'kb_service.log' }
$env:PYTHONPATH = $root

# KB 자동화 스케줄 기본값(분) – collect: 30, embed: 30, manual: 60, backfill: 60
# NOTE: windows/start_all.ps1에서도 동일 값을 설정한다.
# KB_SCHED_*가 이미 설정되어 있으면 그대로 존중하고, 비어 있을 때만 기본값을 채운다.
if (-not $env:KB_SCHED_COLLECT_MIN)  { $env:KB_SCHED_COLLECT_MIN  = '30' }
if (-not $env:KB_SCHED_EMBED_MIN)    { $env:KB_SCHED_EMBED_MIN    = '30' }
if (-not $env:KB_SCHED_MANUAL_MIN)   { $env:KB_SCHED_MANUAL_MIN   = '60' }
if (-not $env:KB_SCHED_BACKFILL_MIN) { $env:KB_SCHED_BACKFILL_MIN = '60' }

function Resolve-Python {
  param([string]$PreferredVenv)
  # Prefer system python; venv 생성이 막힐 수 있어 단순화
  try {
    python -c "import fastapi,uvicorn,sqlalchemy,pgvector,psycopg2; print('ok')" | Out-Null
    return 'python'
  } catch {
    Write-Host "[kb] python deps missing; installing to user site (fastapi/uvicorn/sqlalchemy/pgvector/psycopg2-binary)" -ForegroundColor Yellow
    try { python -m pip install --user --quiet fastapi uvicorn sqlalchemy pgvector psycopg2-binary | Out-Null } catch {}
    # project-wide deps (RAG/IRIS etc)
    try { python -m pip install --user --quiet -r (Join-Path $root 'requirements.txt') | Out-Null } catch {}
    return 'python'
  }
}

$py = Resolve-Python -PreferredVenv (Join-Path $root $Venv)

Write-Host "[kb] starting uvicorn on :$Port (DB=$($env:DATABASE_URL))" -ForegroundColor Green
# Stop any existing uvicorn on this app/port
try {
  Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -like '*uvicorn*kb.service:app*' -or $_.CommandLine -like '* --port '+$Port+' *' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}

Remove-Item -Force -ErrorAction SilentlyContinue $outLog,$errLog | Out-Null
Start-Process -FilePath $py -ArgumentList @('-m','uvicorn','kb.service:app','--host','0.0.0.0','--port',"${Port}") -WorkingDirectory $root -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden | Out-Null

$deadline = (Get-Date).AddSeconds([math]::Max(5,$TimeoutSec))
do {
  Start-Sleep -Seconds 1
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
    if ($resp.StatusCode -eq 200) { Write-Host '[kb] READY' -ForegroundColor Green; break }
  } catch { }
} while ((Get-Date) -lt $deadline)

if ((Get-Date) -ge $deadline) {
  Write-Host "[kb] TIMEOUT waiting for :$Port. See $outLog / $errLog" -ForegroundColor Yellow
}
