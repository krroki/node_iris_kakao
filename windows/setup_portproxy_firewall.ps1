# Requires: Admin PowerShell
param(
  [string]$HostIP = "0.0.0.0",
  [int]$Port = 3000,
  [int]$RemotePort = 3000
)

Write-Host "Configuring portproxy + firewall for ${HostIP}:${Port} -> 127.0.0.1:${RemotePort}" -ForegroundColor Cyan

# Remove old rule if exists
netsh interface portproxy delete v4tov4 listenport=$Port listenaddress=$HostIP | Out-Null

# Add mapping: listen on HostIP:Port, connect to 127.0.0.1:RemotePort
netsh interface portproxy add v4tov4 listenport=$Port connectaddress=127.0.0.1 connectport=$RemotePort listenaddress=$HostIP protocol=tcp | Out-Null

# Open firewall
netsh advfirewall firewall delete rule name="IRIS_${Port}" | Out-Null
netsh advfirewall firewall add rule name="IRIS_${Port}" dir=in action=allow protocol=TCP localport=$Port | Out-Null

try {
  $status = (Invoke-WebRequest -Uri "http://${HostIP}:${Port}/config" -TimeoutSec 2).StatusCode
  Write-Host "Probe http://${HostIP}:${Port}/config -> HTTP $status" -ForegroundColor Green
} catch {
  Write-Warning "Probe failed: http://${HostIP}:${Port}/config"
}

Write-Host "Done" -ForegroundColor Green

