param(
  [string]$BotIrisUrl = 'http://127.0.0.1:5050',
  [int]$ApiPort = 8650,
  [int]$ApiTimeoutSec = 40,
  [int]$BotTimeoutSec = 40,
  [int]$HealthTimeoutSec = 6,
  [int]$TailLines = 80
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function Write-Step {
  param([string]$Message, [ConsoleColor]$Color = [ConsoleColor]::Cyan)
  $old = $Host.UI.RawUI.ForegroundColor
  $Host.UI.RawUI.ForegroundColor = $Color
  Write-Host $Message
  $Host.UI.RawUI.ForegroundColor = $old
}

function Try-InvokeUrl {
  param([string]$Url, [int]$TimeoutSec = 5)
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec $TimeoutSec
    return @{ ok = $true; status = $r.StatusCode; content = $r.Content }
  } catch {
    return @{ ok = $false; error = ($_.Exception.Message) }
  }
}

function Show-FileTail {
  param([string]$Path, [int]$Lines = 60, [string]$Title = $null)
  if ($Title) { Write-Step $Title ([ConsoleColor]::DarkGray) }
  if (Test-Path $Path) {
    try { Get-Content -LiteralPath $Path -Tail $Lines | ForEach-Object { Write-Host $_ } }
    catch { Write-Warning ("failed to read {0}: {1}" -f $Path, $_) }
  } else {
    Write-Host "(no file) $Path" -ForegroundColor DarkGray
  }
}

Write-Step '=== Realtime Recovery (bridge-free) ===' Green

# 1) Start/ensure API
try {
  Write-Step "[1/4] Starting Realtime API :$ApiPort (timeout ${ApiTimeoutSec}s)" Yellow
  & "$root\windows\start_api.ps1" -Port $ApiPort -TimeoutSec $ApiTimeoutSec | Write-Host
} catch {
  Write-Warning "start_api.ps1 failed: $_"
}

# 2) Start bot with explicit IRIS_URL (does not fix bridge, only uses it if present)
try {
  Write-Step "[2/4] Starting Node-IRIS bot (IRIS_URL=$BotIrisUrl, timeout ${BotTimeoutSec}s)" Yellow
  & "$root\windows\start_bot.ps1" -IrisUrl $BotIrisUrl -TimeoutSec $BotTimeoutSec -SkipBuild -BuildTimeoutSec 90 | Write-Host
} catch {
  Write-Warning "start_bot.ps1 failed: $_"
}

# 3) Probe health endpoints with timeout
Write-Step "[3/4] Probing API /health and IRIS /config" Yellow
$api = Try-InvokeUrl -Url ("http://127.0.0.1:{0}/health" -f $ApiPort) -TimeoutSec $HealthTimeoutSec
if ($api.ok) { Write-Host ("  - API /health: HTTP {0}" -f $api.status) -ForegroundColor Green }
else { Write-Warning ("  - API /health failed: {0}" -f $api.error) }

$iris = Try-InvokeUrl -Url 'http://127.0.0.1:5050/config' -TimeoutSec 5
if ($iris.ok) { Write-Host ("  - IRIS /config: HTTP {0}" -f $iris.status) -ForegroundColor Green }
else { Write-Warning ("  - IRIS /config failed (bridge likely down): {0}" -f $iris.error) }

# 4) Log recency check
Write-Step "[4/4] Checking recent log files" Yellow
$logsBase = Join-Path $root 'node-iris-app\data\logs'
if (-not (Test-Path $logsBase)) {
  Write-Warning "logs base not found: $logsBase"
} else {
  $latest = Get-ChildItem -Path $logsBase -Recurse -Filter '*.log' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 5 FullName, LastWriteTime
  if ($latest) {
    $now = Get-Date
    Write-Host "Latest logs:" -ForegroundColor DarkGray
    foreach ($f in $latest) {
      $age = ($now - $f.LastWriteTime).TotalSeconds
      Write-Host ("  - {0}  (age: {1:N0}s)" -f $f.FullName, $age)
    }
  } else {
    Write-Host "  (no .log files under $logsBase)" -ForegroundColor DarkGray
  }
}

# Tail important logs for debugging
$winLogs = Join-Path $root 'windows\logs'
Show-FileTail -Path (Join-Path $winLogs 'api.out.log') -Lines $TailLines -Title '[api.out.log] tail'
Show-FileTail -Path (Join-Path $winLogs 'api.err.log') -Lines $TailLines -Title '[api.err.log] tail'
Show-FileTail -Path (Join-Path $winLogs 'bot.out.log') -Lines $TailLines -Title '[bot.out.log] tail'
Show-FileTail -Path (Join-Path $winLogs 'bot.err.log') -Lines $TailLines -Title '[bot.err.log] tail'

Write-Step '=== Recovery complete (see above for status) ===' Green
