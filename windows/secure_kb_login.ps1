param(
  [string]$Id = ''
)
$ErrorActionPreference = 'Stop'

function Read-PlainPassword {
  $sec = Read-Host 'NAVER PW' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

if (-not $Id) { $Id = Read-Host 'NAVER ID' }
$Pw = Read-PlainPassword
try {
  $body = @{ id = $Id; pw = $Pw } | ConvertTo-Json -Compress
  $resp = Invoke-RestMethod -Method POST -Uri 'http://127.0.0.1:8610/creds' -ContentType 'application/json' -Body $body -TimeoutSec 10
  if (-not $resp.ok) { throw "creds_save_failed: $($resp | ConvertTo-Json -Compress)" }
  Write-Host '[kb] creds saved' -ForegroundColor Green
} finally { $Pw = $null }

try {
  $r2 = Invoke-RestMethod -Method POST -Uri 'http://127.0.0.1:8610/run_cookie' -TimeoutSec 10
  Write-Host "[kb] cookie collector started (pid=$($r2.pid))" -ForegroundColor Green
} catch { Write-Host "[kb] cookie collector start failed: $_" -ForegroundColor Yellow }

