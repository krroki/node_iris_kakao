param(
  [int]$Port = 8650,
  [int]$TimeoutSec = 30,
  [string]$LogDir = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

if (-not $LogDir) { $LogDir = Join-Path $root 'windows\logs' }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$outLog = Join-Path $LogDir 'api.out.log'
$errLog = Join-Path $LogDir 'api.err.log'

function Resolve-PythonApi {
  param([string]$PreferredVenv)
  $venvPy = Join-Path $PreferredVenv 'Scripts\python.exe'
  if (Test-Path $venvPy) {
    try {
      & $venvPy -c "import fastapi,uvicorn; print('ok')" 2>$null | Out-Null
      return $venvPy
    } catch {
      # WSL에서 만든 venv 등 Windows에서 깨진 경우가 있어, 재생성한다.
      Write-Host "[api] existing venv at $PreferredVenv is invalid; recreating" -ForegroundColor Yellow
      try { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $PreferredVenv } catch {}
    }
  }
  try {
    python -c "import fastapi,uvicorn; print('ok')" 2>$null | Out-Null
    return 'python'
  } catch {}
  if (-not (Test-Path $venvPy)) {
    Write-Host "[api] creating venv at $PreferredVenv" -ForegroundColor Cyan
    py -3 -m venv $PreferredVenv
  }
  Write-Host "[api] installing fastapi/uvicorn into $PreferredVenv" -ForegroundColor Cyan
  & $venvPy -m pip install --quiet fastapi uvicorn python-multipart | Out-Null
  return $venvPy
}

$venv = Join-Path $root 'dashboard\.venv_ui'
$py = Resolve-PythonApi -PreferredVenv $venv

$env:IRIS_LOGS_DIR = Join-Path $root 'node-iris-app\data\logs'
Write-Host "[api] starting uvicorn on :$Port (timeout ${TimeoutSec}s)" -ForegroundColor Green
try {
  Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -like '*uvicorn*server.app:app*' -or $_.CommandLine -like '* --port '+$Port+' *' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}
Remove-Item -Force -ErrorAction SilentlyContinue $outLog,$errLog | Out-Null
Start-Process -FilePath $py -ArgumentList @('-m','uvicorn','server.app:app','--host','0.0.0.0','--port',"$Port") -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden | Out-Null

$deadline = (Get-Date).AddSeconds([math]::Max(5,$TimeoutSec))
do {
  Start-Sleep -Seconds 1
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
    if ($resp.StatusCode -eq 200) { Write-Host '[api] READY' -ForegroundColor Green; break }
  } catch { }
} while ((Get-Date) -lt $deadline)

if ((Get-Date) -ge $deadline) {
  Write-Host "[api] TIMEOUT waiting for :$Port. See logs at $outLog / $errLog" -ForegroundColor Yellow
}
