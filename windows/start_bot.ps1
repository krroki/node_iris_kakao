param(
  # 湲곕낯 IRIS URL??Windows ?ы듃?꾨줉?쒓? ?꾨땶 ?ㅼ젣 ?⑤쭚 IP濡?媛뺤젣
  [string]$IrisUrl = 'http://127.0.0.1:5050',
  [switch]$Prod,
  [int]$TimeoutSec = 20,
  [string]$LogDir = '',
  [switch]$SkipBuild,
  [int]$BuildTimeoutSec = 120,
  [switch]$Restart
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$botDir = Join-Path $root 'node-iris-app'
Set-Location $botDir

if (-not $LogDir) { $LogDir = Join-Path $root 'windows\logs' }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$outLog = Join-Path $LogDir 'bot.out.log'
$errLog = Join-Path $LogDir 'bot.err.log'

# Single-instance guard: if status PID alive and not restarting, exit
$existingPid = $null
try {
  $status = Get-Content (Join-Path $botDir 'data\status.json') -Raw | ConvertFrom-Json
  if ($status.pid) { $existingPid = [int]$status.pid }
} catch {}

$needStart = $true
if ($existingPid) {
  try {
    $p = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    if ($p -and $p.Path -like "$botDir*") {
      if (-not $Restart) {
        Write-Host ("[bot] already running pid={0}; skip start (use -Restart to force)" -f $existingPid) -ForegroundColor Green
        $needStart = $false
      } else {
        Write-Host ("[bot] restart requested; stopping existing pid={0}" -f $existingPid) -ForegroundColor Yellow
        try { Stop-Process -Id $existingPid -Force -ErrorAction SilentlyContinue } catch {}
      }
    }
  } catch {}
}

if (-not $needStart) { return }

# Ensure previous stray bot processes are stopped to release log handles
try {
  # node-iris-app은 항상 'dist\index.js'를 실행하므로,
  # 해당 스크립트를 실행 중인 node.exe를 모두 정리한다.
  $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'dist[/\\]index\.js' }
  foreach ($p in $procs) {
    if ($existingPid -and $p.ProcessId -eq $existingPid) { continue }
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    try {
      if (Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue) {
        wmic process where "ProcessId=$($p.ProcessId)" call terminate | Out-Null
      }
    } catch {}
  }
} catch {}

# Clear stale bot.lock (left from crashed or killed process)
$lockFile = Join-Path $botDir 'data\bot.lock'
if (Test-Path $lockFile) {
  $lockPid = $null
  try { $lockPid = [int](Get-Content -LiteralPath $lockFile -Raw) } catch {}
  $procAlive = $false
  if ($lockPid) {
    try { $procAlive = (Get-Process -Id $lockPid -ErrorAction SilentlyContinue) -ne $null } catch {}
  }
  $ageSec = 0
  try {
    $stat = Get-Item $lockFile
    $ageSec = ([DateTime]::UtcNow - $stat.CreationTimeUtc).TotalSeconds
  } catch {}
  if (-not $procAlive -or $ageSec -gt 600) {
    try {
      Remove-Item -LiteralPath $lockFile -Force -ErrorAction Stop
      $pidText = if ($lockPid) { $lockPid } else { 'n/a' }
      Write-Host ("[bot] cleared stale bot.lock (pid={0}, age={1:n0}s)" -f $pidText, [math]::Round($ageSec,0)) -ForegroundColor Yellow
    } catch { Write-Warning "[bot] failed to remove stale lock: $_" }
  }
}

Write-Host '[bot] ensuring deps' -ForegroundColor Cyan
if (-not (Test-Path 'node_modules')) {
  $ciLog = Join-Path $LogDir ("bot.npm.ci." + (Get-Date -Format 'yyyyMMddHHmmss') + ".log")
  & cmd.exe /c "npm ci 1>> `"$ciLog`" 2>>&1"
}

# Always set IRIS_URL explicitly to avoid WSL/5050 portproxy
$env:IRIS_URL = $IrisUrl
$env:SAFE_MODE = 'false'
# Allowed room? ?뚯뒪???꾩슜 諛??섎굹(18462226881291012)濡?怨좎젙???ㅻ컻?≪쓣 李⑤떒?쒕떎.
$env:ALLOWED_ROOM_IDS = '18462226881291012'
# Realtime API ?ы듃(uvicorn): 湲곕낯 8650?쇰줈 ?щ━誘濡??몃뱶?먯꽌 /send/talkapi/dispatch ?몄텧???ㅽ뙣?섏? ?딄쾶 ?ㅼ젙
if (-not $env:REALTIME_API_BASE -or [string]::IsNullOrWhiteSpace($env:REALTIME_API_BASE)) {
  $env:REALTIME_API_BASE = 'http://127.0.0.1:8650'
}

function Start-BuildIfNeeded {
  param([switch]$Force)
  $distIndex = Join-Path (Get-Location) 'dist\index.js'
  if ($SkipBuild -and -not $Force) {
    Write-Host '[bot] SkipBuild set; skipping build' -ForegroundColor Yellow
    if (-not (Test-Path $distIndex)) {
      Write-Host '[bot] dist/index.js not found; forcing one build' -ForegroundColor Yellow
    } else { return }
  }
  $buildLog = Join-Path $LogDir ("bot.build." + (Get-Date -Format 'yyyyMMddHHmmss') + ".log")
  try { Remove-Item -Force -ErrorAction SilentlyContinue $buildLog } catch {}
  Write-Host ("[bot] building (timeout {0}s)" -f $BuildTimeoutSec) -ForegroundColor Cyan
  $job = Start-Job -ScriptBlock {
    param($log)
    & cmd.exe /c "npm run --silent build 1>> `"$log`" 2>>&1"
    return $LASTEXITCODE
  } -ArgumentList $buildLog
  $done = Wait-Job -Job $job -Timeout $BuildTimeoutSec
  if (-not $done) {
    Write-Host '[bot] build timeout; stopping build job' -ForegroundColor Yellow
    try { Stop-Job $job -Force | Out-Null } catch {}
  }
  $rc = 0
  try { $rc = Receive-Job -Job $job -ErrorAction SilentlyContinue } catch { $rc = 1 }
  try { Remove-Job $job -Force | Out-Null } catch {}
  if ($rc -ne 0) {
    Write-Host ("[bot] build returned code {0} (see build log)" -f $rc) -ForegroundColor Yellow
  }
}

Start-BuildIfNeeded

Write-Host "[bot] starting (timeout ${TimeoutSec}s)" -ForegroundColor Green
try { Remove-Item -Force -ErrorAction SilentlyContinue $outLog,$errLog } catch {}
Start-Process -FilePath node -ArgumentList 'dist\index.js' -WorkingDirectory $botDir -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden | Out-Null

# Readiness: status.json update within timeout
$status = Join-Path $botDir 'data\status.json'
$deadline = (Get-Date).AddSeconds([math]::Max(5,$TimeoutSec))
do {
  Start-Sleep -Seconds 1
  try {
    if (Test-Path $status) {
      $j = Get-Content -LiteralPath $status -Raw | ConvertFrom-Json
      if ($j.startedAt) { Write-Host '[bot] READY' -ForegroundColor Green; break }
    }
  } catch { }
} while ((Get-Date) -lt $deadline)

if ((Get-Date) -ge $deadline) {
  Write-Host "[bot] TIMEOUT waiting for status.json. See logs at $outLog / $errLog" -ForegroundColor Yellow
}

