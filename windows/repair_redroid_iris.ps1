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
$root = Split-Path $PSScriptRoot -Parent
$deviceCachePath = Join-Path $root 'data\redroid_device.json'

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

function Read-DeviceCache {
  param([string]$Path)
  try {
    if (-not (Test-Path $Path)) { return $null }
    $j = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    $dev = [string]$j.device
    if ($dev -and $dev.Trim()) { return $dev.Trim() }
  } catch {}
  return $null
}

function Write-DeviceCache {
  param([string]$Path, [string]$Device)
  try {
    $dir = Split-Path $Path -Parent
    if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $obj = [ordered]@{ device = $Device; updatedAt = (Get-Date).ToUniversalTime().ToString("o") }
    ($obj | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $Path -Encoding UTF8
  } catch {}
}

function Get-PortProxyMappingsForPort {
  param([int]$Port)
  $items = @()
  try {
    $out = (netsh interface portproxy show v4tov4) 2>$null
    foreach ($line in ($out -split "`n")) {
      $t = $line.Trim()
      if (-not $t) { continue }
      # <listenaddr> <listenport> <connectaddr> <connectport>
      if ($t -match '^([0-9\.]+)\s+(\d+)\s+([0-9\.]+)\s+(\d+)\s*$') {
        $lp = [int]$Matches[2]
        if ($lp -eq $Port) {
          $items += [pscustomobject]@{
            listenAddress  = [string]$Matches[1]
            listenPort     = $lp
            connectAddress = [string]$Matches[3]
            connectPort    = [int]$Matches[4]
          }
        }
      }
    }
  } catch {}
  return $items
}

function Remove-LoopbackPortProxyIfConflicts {
  param([int]$Port)
  $mappings = @(Get-PortProxyMappingsForPort -Port $Port)
  if ($mappings.Count -eq 0) { return }

  $removed = 0
  foreach ($m in $mappings) {
    $isLoopback = ($m.connectAddress -eq '127.0.0.1' -and $m.connectPort -eq $Port)
    if (-not $isLoopback) { continue }

    # PortProxy 0.0.0.0:$Port -> 127.0.0.1:$Port 형태는 iphlpsvc가 포트를 점유해
    # adb forward가 access denied(10013)로 실패할 수 있다. (레거시 잔재)
    Write-Warn ("Found PortProxy mapping occupying {0}:{1} -> {2}:{3}. This breaks ADB forward; removing it." -f $m.listenAddress, $m.listenPort, $m.connectAddress, $m.connectPort)
    try {
      netsh interface portproxy delete v4tov4 listenport=$Port listenaddress=$m.listenAddress 2>$null | Out-Null
      $removed++
    } catch {
      Write-Warn ("Failed to delete PortProxy mapping (admin may be required): {0}" -f $_.Exception.Message)
    }
  }

  if ($removed -gt 0) {
    Write-Info ("PortProxy cleanup done (removed {0} mapping(s) for port {1})." -f $removed, $Port)
  }
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
  $cached = Read-DeviceCache -Path $deviceCachePath
  if ($cached) {
    $Device = $cached
    Write-Info "Using cached ADB device: $Device ($deviceCachePath)"
  }
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
Write-DeviceCache -Path $deviceCachePath -Device $Device

# PortProxy 루프백 매핑(0.0.0.0:$IrisLocalPort -> 127.0.0.1:$IrisLocalPort)이 남아있으면
# adb forward가 로컬 포트를 바인딩하지 못한다.
Remove-LoopbackPortProxyIfConflicts -Port $IrisLocalPort

Write-Info "ADB forward: $IrisLocalPort -> device:$IrisRemotePort"
try { & $AdbPath -s $Device forward --remove "tcp:$IrisLocalPort" 2>$null | Out-Null } catch {}
try {
  & $AdbPath -s $Device forward "tcp:$IrisLocalPort" "tcp:$IrisRemotePort" | Out-Host
} catch {
  Write-Err "ADB forward failed. The local port $IrisLocalPort may be occupied (PortProxy/Firewall/etc)."
  throw
}

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
