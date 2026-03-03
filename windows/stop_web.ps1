param([switch]$Verbose)
$ErrorActionPreference='Stop'
$root = Split-Path $PSScriptRoot -Parent
Write-Host '[stop_web] stopping Next (repo only)' -ForegroundColor Yellow
try {
  $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*\\12.kakao\\web\\node_modules\\next*' -or $_.CommandLine -like '*\\12.kakao\\web*next*dev*' -or $_.CommandLine -like '*\\12.kakao\\web*start-server.js*' }
  foreach($p in $procs){
    if ($Verbose) { Write-Host ("- PID {0} :: {1}" -f $p.ProcessId, ($p.CommandLine -replace '\s+',' ')) }
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Milliseconds 500
  $list = netstat -ano | Select-String -Pattern ':3000\s+LISTENING\s+\d+$' | ForEach-Object { $_.Line }
  foreach($ln in $list){ if($ln -match 'LISTENING\s+(\d+)$'){ $pid=[int]$Matches[1]; try { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue } catch {} } }
} catch {}
Write-Host '[stop_web] done' -ForegroundColor Green
