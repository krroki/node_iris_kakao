param(
  [string]$VmName = 'redroid',
  [string]$VmUser = 'kakao',
  [int]$AdbPort = 5555,
  [switch]$Fix
)

$ErrorActionPreference = 'Stop'

function Write-Info($msg)  { Write-Host "[repair] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "[repair] $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "[repair] $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "[repair] $msg" -ForegroundColor Red }

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

function Invoke-Vm {
  param(
    [string]$VmIp,
    [string]$VmUser,
    [string]$Command
  )
  Write-Info "ssh $VmUser@$VmIp $Command"
  & ssh -i "$env:USERPROFILE\.ssh\redroid" -o BatchMode=yes -o ConnectTimeout=3 "$VmUser@$VmIp" $Command
}

Write-Info "Checking Hyper-V VM state: $VmName"
$vm = Get-VM -Name $VmName -ErrorAction SilentlyContinue
if (-not $vm) {
  Write-Err "VM '$VmName' not found. Create/configure the VM in Hyper-V first."
  exit 1
}
if ($vm.State -ne 'Running') {
  Write-Warn "VM '$VmName' is not running. Run 'Start-VM $VmName' and try again."
  exit 1
}

$vmIp = Get-RedroidVmIp -Name $VmName
if (-not $vmIp) {
  Write-Err "IPv4 address for VM '$VmName' not found. Check Hyper-V network configuration."
  exit 1
}
Write-Ok "VM '$VmName' is running, IP=$vmIp"

# Step 1: adb devices inside VM
Write-Info "Checking adb devices inside VM"
try {
  $adbOutput = Invoke-Vm -VmIp $vmIp -VmUser $VmUser -Command "adb devices"
} catch {
  Write-Err "Failed to run 'adb devices' via ssh. Verify ssh $VmUser@$vmIp."
  exit 1
}

$lines = $adbOutput -split "`n"
$deviceLines = @()
foreach ($ln in $lines) {
  $t = $ln.Trim()
  if ($t -and -not $t.StartsWith('List of devices attached')) {
    $deviceLines += $t
  }
}

if ($deviceLines.Count -gt 0 -and ($deviceLines | Where-Object { $_ -like '*device' }).Count -gt 0) {
  Write-Ok "adb devices OK in VM: $($deviceLines -join ', ')"
} else {
  Write-Warn "No adb devices reported in VM."
  if (-not $Fix) {
    Write-Info "Dry mode: status only. Run with -Fix to attempt automatic adb recovery."
  } else {
    Write-Info "Restarting adb server and reconnecting 127.0.0.1:$AdbPort"
    Invoke-Vm -VmIp $vmIp -VmUser $VmUser -Command "adb kill-server; adb start-server; adb connect 127.0.0.1:$AdbPort; adb devices"
  }
}

# Step 2: IRIS /config health check inside VM
Write-Info "Checking IRIS /config inside VM"
try {
  $httpCode = Invoke-Vm -VmIp $vmIp -VmUser $VmUser -Command "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/config"
} catch {
  $httpCode = "000"
}

if ($httpCode -eq "200") {
  Write-Ok "IRIS /config 200 OK (inside VM)"
  Write-Ok "Done. Redroid/IRIS device looks healthy based on current logs."
  exit 0
}

Write-Warn "IRIS /config returned non-200 (code=$httpCode)."
if ($Fix) {
  Write-Info "Attempting iris_control restart"
  # Run start + status in VM regardless of start result
  Invoke-Vm -VmIp $vmIp -VmUser $VmUser -Command "cd ~/iris; ./iris_control start; ./iris_control status"

  Write-Info "Re-checking IRIS /config after restart"
  try {
    $httpCode = Invoke-Vm -VmIp $vmIp -VmUser $VmUser -Command "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/config"
  } catch {
    $httpCode = "000"
  }

  if ($httpCode -eq "200") {
    Write-Ok "IRIS /config 200 OK after restart"
    Write-Ok "Done. Redroid/IRIS device looks healthy after restart."
    exit 0
  } else {
    Write-Err "IRIS /config still non-200 after restart (code=$httpCode). Manual investigation required."
    exit 1
  }
} else {
  Write-Info "Fix mode is off. No restart was attempted. Run with -Fix to let iris_control restart IRIS."
  exit 1
}
