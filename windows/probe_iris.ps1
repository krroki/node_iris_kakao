param(
  [int]$Port = 5005,
  [string]$Device = "192.168.66.34:5555",
  [string]$AdbPath = "$env:USERPROFILE\scrcpy\scrcpy-win64-v3.1\adb.exe"
)

Write-Host "== Windows IRIS probe (port $Port) ==" -ForegroundColor Cyan

Write-Host "-- Portproxy table --" -ForegroundColor Yellow
netsh interface portproxy show v4tov4

Write-Host "-- Netstat --" -ForegroundColor Yellow
netstat -ano | findstr ":$Port"

if (Test-Path $AdbPath) {
  Write-Host "-- ADB forward --" -ForegroundColor Yellow
  & $AdbPath -s $Device forward --list
} else {
  Write-Host "adb not found: $AdbPath" -ForegroundColor DarkYellow
}

function Probe-Url([string]$u){
  try {
    $r=(Invoke-WebRequest -Uri $u -TimeoutSec 2); "OK $($r.StatusCode)";
  } catch { "ERR $($_.Exception.Message)" }
}

Write-Host "-- HTTP /config --" -ForegroundColor Yellow
"127.0.0.1:$Port => " + (Probe-Url "http://127.0.0.1:$Port/config")
"127.0.0.1:3000 => " + (Probe-Url "http://127.0.0.1:3000/config")

Write-Host "== Done ==" -ForegroundColor Green

