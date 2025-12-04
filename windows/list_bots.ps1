# List node-iris-app bot processes
# Returns JSON array with pid, cmd, startTime

$procs = @(
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*node-iris-app*' -or $_.CommandLine -like '*dist\index.js*' -or $_.CommandLine -like '*dist/index.js*' } |
    ForEach-Object {
        [PSCustomObject]@{
            pid = $_.ProcessId
            cmd = if ($_.CommandLine.Length -gt 100) { $_.CommandLine.Substring(0, 100) + "..." } else { $_.CommandLine }
            startTime = $_.CreationDate.ToString("yyyy-MM-dd HH:mm:ss")
        }
    }
)

if ($procs.Count -eq 0) {
    "[]"
} elseif ($procs.Count -eq 1) {
    # Single item: manually wrap in array
    "[" + ($procs[0] | ConvertTo-Json -Compress) + "]"
} else {
    $procs | ConvertTo-Json -Compress
}
