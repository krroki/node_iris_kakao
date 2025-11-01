# Requires: Admin PowerShell
param(
  [string]$Device = "192.168.66.34:5555",
  [string]$AdbPath = "$env:USERPROFILE\scrcpy\scrcpy-win64-v3.1\adb.exe"
)

$LocalPort = 5005
$RemotePort = 3000

Write-Host "Configure ADB forward: $LocalPort -> device:$RemotePort and open PortProxy 0.0.0.0:$LocalPort" -ForegroundColor Cyan

if (-not (Test-Path $AdbPath)) { Write-Error "adb.exe not found: $AdbPath"; exit 1 }

& $AdbPath connect $Device | Out-Host
& $AdbPath -s $Device forward --remove-all | Out-Null
& $AdbPath -s $Device forward tcp:$LocalPort tcp:$RemotePort | Out-Host

netsh interface portproxy delete v4tov4 listenport=$LocalPort listenaddress=0.0.0.0 | Out-Null
netsh interface portproxy add v4tov4 listenport=$LocalPort connectaddress=127.0.0.1 connectport=$LocalPort listenaddress=0.0.0.0 protocol=tcp | Out-Null

netsh advfirewall firewall delete rule name="IRIS_$LocalPort" | Out-Null
netsh advfirewall firewall add rule name="IRIS_$LocalPort" dir=in action=allow protocol=TCP localport=$LocalPort | Out-Null

try {
  $status = (Invoke-WebRequest -Uri "http://127.0.0.1:$LocalPort/config" -TimeoutSec 2).StatusCode
  Write-Host "Probe http://127.0.0.1:$LocalPort/config -> HTTP $status" -ForegroundColor Green
} catch {
  Write-Warning "Probe failed: http://127.0.0.1:$LocalPort/config"
}

Write-Host "Done. In WSL, set IRIS_URL=<windows_gateway>:$LocalPort" -ForegroundColor Green

