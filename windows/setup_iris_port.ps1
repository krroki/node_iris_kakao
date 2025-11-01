# Requires: Admin PowerShell
param(
  [int]$LocalPort = 5050,
  [int]$RemotePort = 3000,
  [string]$Device = "192.168.66.34:5555",
  [string]$AdbPath = "$env:USERPROFILE\scrcpy\scrcpy-win64-v3.1\adb.exe"
)

Write-Host "Configure ADB forward: $LocalPort -> device:$RemotePort and PortProxy 0.0.0.0:$LocalPort -> 127.0.0.1:$LocalPort" -ForegroundColor Cyan

if (-not (Test-Path $AdbPath)) { Write-Error "adb.exe not found: $AdbPath"; exit 1 }

& $AdbPath connect $Device | Out-Host
& $AdbPath -s $Device forward --remove tcp:$LocalPort 2>$null | Out-Null
& $AdbPath -s $Device forward tcp:$LocalPort tcp:$RemotePort | Out-Host

netsh interface portproxy delete v4tov4 listenport=$LocalPort listenaddress=0.0.0.0 | Out-Null
netsh interface portproxy delete v4tov4 listenport=$LocalPort listenaddress=$env:CLIENTNAME 2>$null | Out-Null
netsh interface portproxy add v4tov4 listenport=$LocalPort connectaddress=127.0.0.1 connectport=$LocalPort listenaddress=0.0.0.0 protocol=tcp | Out-Null
try {
  $wslIp = (Get-NetIPConfiguration | Where-Object { $_.NetAdapter.InterfaceDescription -like '*WSL*' } | Select-Object -ExpandProperty IPv4Address).IPv4Address
  if ($wslIp) {
    netsh interface portproxy delete v4tov4 listenport=$LocalPort listenaddress=$wslIp 2>$null | Out-Null
    netsh interface portproxy add v4tov4 listenport=$LocalPort connectaddress=127.0.0.1 connectport=$LocalPort listenaddress=$wslIp protocol=tcp | Out-Null
  }
} catch {}

netsh advfirewall firewall delete rule name="IRIS_$LocalPort" | Out-Null
netsh advfirewall firewall add rule name="IRIS_$LocalPort" dir=in action=allow protocol=TCP localport=$LocalPort profile=any | Out-Null

try {
  $status = (Invoke-WebRequest -Uri "http://127.0.0.1:$LocalPort/config" -TimeoutSec 2).StatusCode
  Write-Host "Probe http://127.0.0.1:$LocalPort/config -> HTTP $status" -ForegroundColor Green
} catch {
  Write-Warning "Probe failed: http://127.0.0.1:$LocalPort/config"
}

Write-Host "Done. Use IRIS_LOCAL_PORT=$LocalPort in WSL" -ForegroundColor Green
