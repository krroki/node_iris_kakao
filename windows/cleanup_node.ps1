param(
  [int]$DaysOld = 1,
  [switch]$Kill,
  [switch]$Verbose
)

$ErrorActionPreference = 'Stop'
$cutoff = (Get-Date).AddDays(-$DaysOld).Date
$root = Split-Path $PSScriptRoot -Parent

# Whitelist: bot status PID, kb service, next dev/start processes
$keepPids = @()
try {
  $status = Get-Content (Join-Path $root 'node-iris-app/data/status.json') -Raw | ConvertFrom-Json
  if ($status.pid) { $keepPids += [int]$status.pid }
} catch {}

function Get-Tag {
  param($proc)
  $cmd = ($proc.CommandLine -replace '\s+',' ')
  if ($cmd -match 'uvicorn .*kb\.service:app') { return 'kb-service' }
  if ($cmd -match 'next\\dist\\bin\\next' -or $cmd -match 'next dev' -or $cmd -match 'start-server\.js') { return 'next-web' }
  if ($cmd -match 'node-iris-app.*dist\\index\.js') { return 'bot' }
  return 'other'
}

function Stop-Pid {
  param([int]$Pid)
  try { Stop-Process -Id $Pid -Force -ErrorAction SilentlyContinue } catch {}
  try {
    if (Get-Process -Id $Pid -ErrorAction SilentlyContinue) {
      wmic process where "ProcessId=$Pid" call terminate | Out-Null
    }
  } catch {}
}

try {
  $targets = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object {
      $_.CreationDate -and
      ([Management.ManagementDateTimeConverter]::ToDateTime($_.CreationDate) -lt $cutoff)
    } |
    ForEach-Object {
      $tag = Get-Tag $_
      [pscustomobject]@{
        Process = $_
        Tag = $tag
        Keep = ($keepPids -contains $_.ProcessId) -or ($tag -in @('bot','kb-service','next-web'))
        Started = [Management.ManagementDateTimeConverter]::ToDateTime($_.CreationDate)
        Cmd = ($_.CommandLine -replace '\s+',' ')
      }
    }
} catch {
  Write-Host "[cleanup] failed to enumerate node.exe (admin privileges may be required): $_" -ForegroundColor Yellow
  exit 1
}

if (-not $targets) {
  Write-Host '[cleanup] no node.exe older than cutoff'
  exit 0
}

$report = $targets | Select-Object @{n='PID';e={$_.Process.ProcessId}},Started,Tag,Keep,Cmd
if (-not $Kill) {
  Write-Host "[cleanup] report only (use -Kill to terminate). Cutoff=$($cutoff.ToShortDateString())"
  $report | Format-Table -AutoSize
  exit 0
}

$killed = @()
foreach ($item in $report) {
  if ($item.Keep) {
    if ($Verbose) {
      Write-Host ("[cleanup] keep PID {0} ({1})" -f $item.PID, $item.Tag) -ForegroundColor Cyan
    }
    continue
  }
  Write-Host ("[cleanup] killing PID {0} started {1:yyyy-MM-dd HH:mm:ss} tag={2} cmd={3}" -f $item.PID, $item.Started, $item.Tag, $item.Cmd)
  Stop-Pid -Pid $item.PID
  $killed += $item.PID
}

if ($killed.Count -eq 0) { Write-Host '[cleanup] nothing killed (all kept)' }
else { Write-Host ("[cleanup] killed {0}" -f ($killed -join ',')) }
