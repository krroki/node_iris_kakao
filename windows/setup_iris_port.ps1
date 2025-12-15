# Requires: Admin PowerShell
param(
  [int]$LocalPort = 5050,
  [int]$RemotePort = 3000,
  [string]$Device = "192.168.66.34:5555",
  # (선택) 외부/WSL에서 접근이 필요하면 PortProxy로 별도 포트를 노출한다.
  # - 주의: PortProxy를 $LocalPort에 직접 걸면 iphlpsvc가 포트를 점유해 ADB forward가 깨진다.
  # - 따라서 기본값은 "노출 안 함(0)"이며, 노출이 필요하면 ExposePort를 별도로 지정한다.
  [int]$ExposePort = 0,
  [string]$AdbPath = "$env:USERPROFILE\scrcpy\scrcpy-win64-v3.1\adb.exe"
)

Write-Host "Configure ADB forward: $LocalPort -> device:$RemotePort" -ForegroundColor Cyan
if ($ExposePort -gt 0) {
  Write-Host "Configure PortProxy: 0.0.0.0:$ExposePort -> 127.0.0.1:$LocalPort" -ForegroundColor Cyan
}

if (-not (Test-Path $AdbPath)) { Write-Error "adb.exe not found: $AdbPath"; exit 1 }

& $AdbPath connect $Device | Out-Host
& $AdbPath -s $Device forward --remove tcp:$LocalPort 2>$null | Out-Null
& $AdbPath -s $Device forward tcp:$LocalPort tcp:$RemotePort | Out-Host

if ($ExposePort -gt 0) {
  netsh interface portproxy delete v4tov4 listenport=$ExposePort listenaddress=0.0.0.0 | Out-Null
  netsh interface portproxy delete v4tov4 listenport=$ExposePort listenaddress=$env:CLIENTNAME 2>$null | Out-Null
  netsh interface portproxy add v4tov4 listenport=$ExposePort connectaddress=127.0.0.1 connectport=$LocalPort listenaddress=0.0.0.0 protocol=tcp | Out-Null
  try {
    $wslIp = (Get-NetIPConfiguration | Where-Object { $_.NetAdapter.InterfaceDescription -like '*WSL*' } | Select-Object -ExpandProperty IPv4Address).IPv4Address
    if ($wslIp) {
      netsh interface portproxy delete v4tov4 listenport=$ExposePort listenaddress=$wslIp 2>$null | Out-Null
      netsh interface portproxy add v4tov4 listenport=$ExposePort connectaddress=127.0.0.1 connectport=$LocalPort listenaddress=$wslIp protocol=tcp | Out-Null
    }
  } catch {}

  netsh advfirewall firewall delete rule name="IRIS_$ExposePort" | Out-Null
  netsh advfirewall firewall add rule name="IRIS_$ExposePort" dir=in action=allow protocol=TCP localport=$ExposePort profile=any | Out-Null
}

try {
  $status = (Invoke-WebRequest -Uri "http://127.0.0.1:$LocalPort/config" -TimeoutSec 2).StatusCode
  Write-Host "Probe http://127.0.0.1:$LocalPort/config -> HTTP $status" -ForegroundColor Green
} catch {
  Write-Warning "Probe failed: http://127.0.0.1:$LocalPort/config"
}

if ($ExposePort -gt 0) {
  Write-Host "Done. In WSL/external, use IRIS_LOCAL_PORT=$ExposePort (proxy -> 127.0.0.1:$LocalPort)" -ForegroundColor Green
} else {
  Write-Host "Done. (No PortProxy) Use IRIS_LOCAL_PORT=$LocalPort on Windows host only." -ForegroundColor Green
}
