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
  $env:DATABASE_URL = 'postgresql+psycopg://iris:iris@127.0.0.1:5433/iris'
}
if (-not $env:KB_LOG_STDOUT) { $env:KB_LOG_STDOUT = '1' }
$env:PYTHONPATH = $root

function Resolve-Python {
  param([string]$PreferredVenv)
  # Prefer system python; venv 생성이 막힐 수 있어 단순화
  try {
    python -c "import fastapi,uvicorn,sqlalchemy,pgvector; print('ok')" | Out-Null
    return 'python'
  } catch {
    Write-Host "[kb] python deps missing; trying to install to user site" -ForegroundColor Yellow
    try { python -m pip install --user -r (Join-Path $root 'requirements.txt') | Out-Null } catch {}
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



