param()
$ErrorActionPreference = 'Stop'
function Drop-Proxy($addr){
  try {
    $out = & netsh interface portproxy delete v4tov4 listenport=3000 listenaddress=$addr 2>&1
    Write-Host "[$addr:3000] $out" -ForegroundColor Yellow
  } catch { Write-Warning $_ }
}
Write-Host 'Freeing portproxy rules on 3000 (requires Admin)...' -ForegroundColor Cyan
Drop-Proxy '0.0.0.0'
Drop-Proxy '10.255.255.254'
Write-Host 'Current rules:' -ForegroundColor Cyan
& netsh interface portproxy show v4tov4

