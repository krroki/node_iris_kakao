param([int]$DurationSec=120)
$ErrorActionPreference='Stop'

Write-Host "[guard] registering WMI watcher for next dev/start on :3000 ($DurationSec s)" -ForegroundColor Yellow
$q = "SELECT * FROM __InstanceCreationEvent WITHIN 1 WHERE TargetInstance ISA 'Win32_Process'"
$evt = Register-WmiEvent -Query $q -SourceIdentifier 'next3000watch' -Action {
  try {
    $pi = $Event.SourceEventArgs.NewEvent.TargetInstance
    $cmd = [string]$pi.CommandLine
    if ($cmd -match 'next.*dev\s*-p\s*3000' -or $cmd -match 'next.*start' -or $cmd -match 'start-server.js') {
      $pid = [int]$pi.ProcessId
      Write-Host ("[guard] kill spawn PID {0} :: {1}" -f $pid, ($cmd -replace '\s+',' ')) -ForegroundColor Yellow
      try { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue } catch {}
      try {
        $pp = (Get-CimInstance Win32_Process -Filter ("ProcessId="+$pid) -ErrorAction SilentlyContinue).ParentProcessId
        if ($pp) { Stop-Process -Id $pp -Force -ErrorAction SilentlyContinue }
      } catch {}
    }
  } catch {}
}

try { Start-Sleep -Seconds $DurationSec } finally {
  try { Unregister-Event -SourceIdentifier 'next3000watch' -Force | Out-Null } catch {}
  Write-Host '[guard] watcher removed' -ForegroundColor Green
}

