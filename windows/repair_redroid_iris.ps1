param(
  [string]$VmName = 'redroid',
  [int]$IrisLocalPort = 5050,
  [int]$IrisRemotePort = 3000,
  [switch]$Fix,
  # ADB 대상(예: 172.30.x.x:5555). 미지정 시 `adb devices` 또는 Hyper-V MAC/ARP로 자동 추정.
  [string]$Device = '',
  [string]$AdbPath = "$env:USERPROFILE\scrcpy\scrcpy-win64-v3.1\adb.exe"
)

$ErrorActionPreference = 'Stop'

function Write-Info($msg)  { Write-Host "[repair] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "[repair] $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "[repair] $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "[repair] $msg" -ForegroundColor Red }

function Test-IrisConfig {
  param([int]$Port)
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/config" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Select-IPv4 {
  param([string[]]$Candidates)
  foreach ($candidate in $Candidates) {
    if ($candidate -match '^\d+\.\d+\.\d+\.\d+$' -and
        -not $candidate.StartsWith('169.') -and
        $candidate -ne '0.0.0.0') {
      return $candidate
    }
  }
  return $null
}

function Format-Mac {
  param([string]$Raw)
  if (-not $Raw) { return $null }
  ($Raw.ToUpper() -replace '(.{2})', '$1-').TrimEnd('-')
}

function Get-RedroidVmIp {
  param([string]$Name)
  try {
    $adapter = Get-VMNetworkAdapter -VMName $Name -ErrorAction SilentlyContinue
    if ($adapter) {
      # 1) Hyper-V가 직접 보고하는 IP 우선
      if ($adapter.IPAddresses) {
        $ip = Select-IPv4 $adapter.IPAddresses
        if ($ip) { return $ip }
      }
      # 2) 없으면 MAC 기반 ARP 조회 (setup_iris_port.ps1와 동일 패턴)
      if ($adapter.MacAddress) {
        $mac = Format-Mac $adapter.MacAddress
        if ($mac) {
          $neighbor = Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.LinkLayerAddress -and ($_.LinkLayerAddress.ToUpper() -eq $mac) } |
            Select-Object -First 1
          if ($neighbor -and $neighbor.IPAddress) {
            return $neighbor.IPAddress
          }
        }
      }
    }
  } catch {}
  return $null
}

if (Test-IrisConfig -Port $IrisLocalPort) {
  Write-Ok "IRIS /config OK (http://127.0.0.1:$IrisLocalPort/config)"
  exit 0
}

if (-not $Fix) {
  Write-Warn "IRIS /config 접속 실패(포트 $IrisLocalPort). -Fix로 자동 복구를 시도할 수 있습니다."
  exit 1
}

# --- Fix path (ADB 기반) ---
if (-not (Test-Path $AdbPath)) {
  Write-Err "adb.exe not found: $AdbPath (scrcpy 설치/경로를 확인하세요)"
  exit 1
}

function Get-FirstAdbDeviceId {
  param([string]$AdbPath)
  try {
    $out = & $AdbPath devices 2>$null
    if (-not $out) { return $null }
    $lines = $out -split "`n"
    foreach ($ln in $lines) {
      $t = $ln.Trim()
      if (-not $t -or $t -like 'List of devices*') { continue }
      if ($t -match '^([^\s]+)\s+device$') { return $Matches[1] }
    }
  } catch {}
  return $null
}

Write-Info "Checking Hyper-V VM state: $VmName"
$vm = Get-VM -Name $VmName -ErrorAction SilentlyContinue
if (-not $vm) {
  Write-Err "VM '$VmName' not found. Create/configure the VM in Hyper-V first."
  exit 1
}
if ($vm.State -ne 'Running') {
  Write-Err "VM '$VmName' is not running. Run 'Start-VM $VmName' and try again."
  exit 1
}

if (-not $Device) {
  $Device = Get-FirstAdbDeviceId -AdbPath $AdbPath
}
if (-not $Device) {
  $vmIp = Get-RedroidVmIp -Name $VmName
  if ($vmIp) { $Device = "$vmIp:5555" }
}
if (-not $Device) {
  Write-Err "ADB device를 자동 감지하지 못했습니다. -Device '<ip>:5555' 로 지정하세요."
  exit 1
}

Write-Info "ADB connect: $Device"
try { & $AdbPath connect $Device | Out-Host } catch {}

Write-Info "ADB forward: $IrisLocalPort -> device:$IrisRemotePort"
try { & $AdbPath -s $Device forward --remove "tcp:$IrisLocalPort" 2>$null | Out-Null } catch {}
& $AdbPath -s $Device forward "tcp:$IrisLocalPort" "tcp:$IrisRemotePort" | Out-Host

Write-Info "Starting IRIS on device (party.qwer.iris.Main)"
$startCmd = "nohup sh -c 'CLASSPATH=/data/local/tmp/Iris.apk app_process / party.qwer.iris.Main' >/dev/null 2>&1 &"
try {
  & $AdbPath -s $Device shell su root sh -c $startCmd | Out-Null
} catch {
  Write-Warn "IRIS start command failed via adb: $($_.Exception.Message)"
}

$deadline = (Get-Date).AddSeconds(20)
do {
  Start-Sleep -Milliseconds 800
  if (Test-IrisConfig -Port $IrisLocalPort) {
    Write-Ok "IRIS /config OK after recovery (http://127.0.0.1:$IrisLocalPort/config)"
    exit 0
  }
} while ((Get-Date) -lt $deadline)

Write-Err "IRIS /config still not responding after ADB recovery. Manual investigation required."
exit 1
