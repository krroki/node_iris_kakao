# Requires: Admin PowerShell
param(
  [string]$Device = "192.168.66.34:5555",
  [int]$LocalPort = 3000,
  [int]$RemotePort = 3000,
  [string]$AdbPath = "$env:USERPROFILE\scrcpy\scrcpy-win64-v3.1\adb.exe"
)

if (-not (Test-Path $AdbPath)) {
  Write-Host "adb.exe 경로를 찾을 수 없습니다. -AdbPath 로 지정하세요" -ForegroundColor Red
  exit 1
}

& $AdbPath connect $Device | Out-Host
& $AdbPath -s $Device forward --remove-all | Out-Null
& $AdbPath -s $Device forward tcp:$LocalPort tcp:$RemotePort | Out-Host

Write-Host "ADB forward ${LocalPort} -> ${RemotePort} (device $Device)" -ForegroundColor Green
Write-Host "테스트: Invoke-WebRequest http://127.0.0.1:${LocalPort}/config" -ForegroundColor Cyan
try {
  $status = (Invoke-WebRequest -Uri "http://127.0.0.1:${LocalPort}/config" -TimeoutSec 2).StatusCode
  Write-Host "HTTP $status" -ForegroundColor Green
} catch {
  Write-Warning "접속 실패. 기기에서 Iris 앱이 실행 중인지 확인하세요."
}

