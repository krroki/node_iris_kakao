# Stop a specific node-iris-app bot process by PID
# Only kills if the process commandline matches node-iris-app pattern
# Usage: .\stop_bot.ps1 -Pid 12345

param(
    [Parameter(Mandatory=$true)]
    [int]$Pid
)

$ErrorActionPreference = "Stop"

# Get the process by PID
$proc = Get-CimInstance Win32_Process -Filter "ProcessId=$Pid"

if (-not $proc) {
    Write-Error "Process with PID $Pid not found"
    exit 1
}

# Verify it's a node-iris-app process
$cmd = $proc.CommandLine
if (-not ($cmd -like '*node-iris-app*' -or $cmd -like '*dist\index.js*' -or $cmd -like '*dist/index.js*')) {
    Write-Error "PID $Pid is not a node-iris-app process. CommandLine: $cmd"
    exit 2
}

# Kill the process
try {
    Stop-Process -Id $Pid -Force
    Write-Output "Successfully stopped node-iris-app process PID $Pid"
    exit 0
} catch {
    Write-Error "Failed to stop process: $_"
    exit 3
}
