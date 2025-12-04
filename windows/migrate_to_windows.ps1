param(
  [string]$Source = 'Z:\home\glemfkcl\dev\12.kakao',
  [string]$Destination = 'C:\dev\12.kakao',
  [int]$TimeoutSec = 300,
  [string]$IrisUrl = ''
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$logRoot = Join-Path $Destination 'windows\logs'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$copyLog = Join-Path $logRoot 'migrate.copy.log'

Write-Host "[migrate] copying from $Source -> $Destination (timeout ${TimeoutSec}s)" -ForegroundColor Green

# Prefer robocopy for speed; fallback to Copy-Item
if (Get-Command robocopy -ErrorAction SilentlyContinue) {
  $job = Start-Job -ScriptBlock {
    param($s,$d,$log)
    robocopy $s $d /MIR /XD node_modules .next dist dashboard\.venv_ui web\node_modules node-iris-app\node_modules .venv /XF *.log /R:1 /W:1 *>> $log
    return $LASTEXITCODE
  } -ArgumentList $Source,$Destination,$copyLog
  if (-not (Wait-Job $job -Timeout $TimeoutSec)) { Stop-Job $job -Force; throw '[migrate] copy TIMEOUT' }
  Receive-Job $job | Out-Null
} else {
  $start = Get-Date
  Copy-Item -Path (Join-Path $Source '*') -Destination $Destination -Recurse -Force -ErrorAction Continue
  if (((Get-Date) - $start).TotalSeconds -gt $TimeoutSec) { throw '[migrate] copy TIMEOUT (fallback)' }
}

if ($IrisUrl) {
  $envPath = Join-Path $Destination 'node-iris-app\.env'
  if (Test-Path $envPath) {
    (Get-Content -LiteralPath $envPath) `
      -replace '^IRIS_URL=.*$',"IRIS_URL=$IrisUrl" `
      -replace '^SAFE_MODE=.*$', 'SAFE_MODE=false' | Set-Content -LiteralPath $envPath -Encoding UTF8
    Write-Host "[migrate] .env updated (IRIS_URL=$IrisUrl, SAFE_MODE=false)" -ForegroundColor Cyan
  }
}

Write-Host "[migrate] DONE. To start:"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$Destination\windows\start_all.ps1`" -IrisUrl '$IrisUrl'" -ForegroundColor Yellow
