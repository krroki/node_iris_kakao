param(
  [int]$Port = 3100,
  [int]$TimeoutSec = 45,
  [string]$LogDir = '',
  [switch]$ForceKillPort
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$web = Join-Path $root 'web'
Set-Location $web

# Expose KB service URL to Next dev (used by /kb page proxy)
if (-not $env:NEXT_PUBLIC_KB_URL -or [string]::IsNullOrWhiteSpace($env:NEXT_PUBLIC_KB_URL)) {
  $env:NEXT_PUBLIC_KB_URL = 'http://127.0.0.1:8610'
}

if (-not $LogDir) { $LogDir = Join-Path $root 'windows\logs' }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$outLog = Join-Path $LogDir 'web.out.log'
$errLog = Join-Path $LogDir 'web.err.log'

function Start-LoggedProcess {
  param([string]$Exe,[string[]]$ArgList,[string]$Out,[string]$Err)
  $argLine = $ArgList -join ' '
  Start-Process -FilePath $Exe -ArgumentList $argLine -WorkingDirectory $web `
    -RedirectStandardOutput $Out -RedirectStandardError $Err -WindowStyle Hidden | Out-Null
}

Write-Host '[web] ensuring dependencies' -ForegroundColor Cyan
$npmExe = 'npm.cmd'
try {
  if (-not (Test-Path 'node_modules')) { & $npmExe ci *>> $outLog 2>> $errLog }
  else { & $npmExe install *>> $outLog 2>> $errLog }
} catch { Write-Host "[web] npm failed: $_" -ForegroundColor Red }

Write-Host "[web] starting Next.js dev on :$Port (timeout ${TimeoutSec}s)" -ForegroundColor Green
Remove-Item -Force -ErrorAction SilentlyContinue $outLog,$errLog | Out-Null

# Kill any previous Next processes for this repo (dev or start) and optionally any process bound to the port
try {
  # Target typical next dev/start invocations under this repo
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*\\web\\node_modules\\next*' -or $_.CommandLine -like '*web*next*dev*' -or $_.CommandLine -like '*next\\dist\\server\\lib\\start-server.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}

# Optionally free the port if another process is listening (EADDRINUSE guard)
if ($ForceKillPort) {
  try {
    $pidLine = (netstat -ano | Select-String -Pattern (":$Port\s+LISTENING\s+\d+") | Select-Object -First 1).Line
    if ($pidLine -and ($pidLine -match "LISTENING\s+(\d+)$")) {
      $pid = [int]$Matches[1]
      try {
        $p = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($p) {
          Write-Host ("[web] killing PID {0} listening on :{1} ({2})" -f $pid, $Port, ($p.Path)) -ForegroundColor Yellow
          Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
      } catch {}
    }
  } catch {}
}

# Clear dev cache to avoid stale overlay issues
if (Test-Path (Join-Path $web '.next')) { try { Remove-Item -Recurse -Force (Join-Path $web '.next') } catch {} }

# Prefer binding to loopback explicitly to dodge service collisions
Start-LoggedProcess node @('node_modules/next/dist/bin/next','dev','-p',"$Port",'--hostname','127.0.0.1') $outLog $errLog

$deadline = (Get-Date).AddSeconds([math]::Max(5,$TimeoutSec))
do {
  Start-Sleep -Seconds 1
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port" -TimeoutSec 2
    if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
      Write-Host "[web] READY on :$Port" -ForegroundColor Green
      break
    }
  } catch { }
} while ((Get-Date) -lt $deadline)

if ((Get-Date) -ge $deadline) {
  Write-Host "[web] TIMEOUT waiting for :$Port. See logs at $outLog / $errLog" -ForegroundColor Yellow
}
