# List node-iris-app processes (bot + workers)
# Returns JSON array with pid, kind, cmd, startTime
#
# Safety:
# - Avoid broad substring matching like "dist\\index.js" to prevent touching other projects.
# - Use exact absolute dist script path matching only.
#
# Performance:
# - Query Win32_Process for node.exe once (WMI can be slow if repeated).

$ErrorActionPreference = 'Stop'

# Ensure UTF-8 JSON output (Node.js reads stdout as utf8 by default)
try { chcp 65001 | Out-Null } catch {}
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()

$root = Split-Path $PSScriptRoot -Parent
$botDir = Join-Path $root 'node-iris-app'

$dataDir = Join-Path $botDir 'data'
$distDir = Join-Path $botDir 'dist'
$distWorkers = Join-Path $distDir 'workers'

$specs = @(
    @{ kind = 'bot';                    status = (Join-Path $dataDir 'status.json');                 absScript = (Join-Path $distDir 'index.js') },
    @{ kind = 'welcome-worker';         status = (Join-Path $dataDir 'welcome_worker_status.json');  absScript = (Join-Path $distWorkers 'welcome_worker.js') },
    @{ kind = 'ai-worker';              status = (Join-Path $dataDir 'ai_worker_status.json');       absScript = (Join-Path $distWorkers 'ai_worker.js') },
    @{ kind = 'broadcast-worker';       status = (Join-Path $dataDir 'broadcast_worker_status.json'); absScript = (Join-Path $distWorkers 'broadcast_worker.js') },
    @{ kind = 'command-worker';         status = (Join-Path $dataDir 'command_worker_status.json');  absScript = (Join-Path $distWorkers 'command_worker.js') },
    @{ kind = 'nickname-reminder-worker'; status = (Join-Path $dataDir 'nickname_reminder_worker_status.json'); absScript = (Join-Path $distWorkers 'nickname_reminder_worker.js') },
    @{ kind = 'image-worker';           status = (Join-Path $dataDir 'image_worker_status.json');    absScript = (Join-Path $distWorkers 'image_worker.js') },
    @{ kind = 'video-worker';           status = (Join-Path $dataDir 'video_worker_status.json');    absScript = (Join-Path $distWorkers 'video_worker.js') },
    @{ kind = 'auto-faq-worker';        status = (Join-Path $dataDir 'auto_faq_worker_status.json'); absScript = (Join-Path $distWorkers 'auto_faq_worker.js') }
)

function Shorten-Cmd {
    param([string]$Cmd)
    if (-not $Cmd) { return '' }
    $s = ($Cmd -replace '\s+', ' ').Trim()
    if ($s.Length -gt 140) { return $s.Substring(0, 140) + '...' }
    return $s
}

function Resolve-IfExists {
    param([string]$Path)
    try {
        if ($Path -and (Test-Path -LiteralPath $Path)) {
            return (Resolve-Path -LiteralPath $Path).Path
        }
    } catch {}
    return $Path
}

function Cmd-MatchesScript {
    param([string]$Cmd, [string]$AbsScript)
    if (-not $Cmd -or -not $AbsScript) { return $false }
    try {
        return ($Cmd.IndexOf($AbsScript, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
    } catch {
        return $false
    }
}

# Pre-resolve paths as they appear in process CommandLine
foreach ($spec in $specs) {
    try { $spec.absScriptResolved = (Resolve-IfExists -Path ([string]$spec.absScript)) } catch { $spec.absScriptResolved = [string]$spec.absScript }
    try { $spec.statusResolved = (Resolve-IfExists -Path ([string]$spec.status)) } catch { $spec.statusResolved = [string]$spec.status }
}

# Query node.exe processes once (WMI/CIM can be slow if repeated)
$nodeProcs = @()
try {
    $nodeProcs = @(
        Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
            Select-Object ProcessId, CommandLine, CreationDate
    )
} catch {
    $nodeProcs = @()
}

$nodeByPid = @{}
foreach ($p in $nodeProcs) {
    try {
        $pid0 = [int]$p.ProcessId
        if ($pid0 -gt 0 -and -not $nodeByPid.ContainsKey($pid0)) { $nodeByPid[$pid0] = $p }
    } catch {}
}

# pid -> kind (first wins)
$pidKind = @{}

# 1) Discover by exact dist script path match (detect duplicates even if status is stale)
foreach ($p in $nodeProcs) {
    $procPid = $null
    try { $procPid = [int]$p.ProcessId } catch { $procPid = $null }
    if (-not $procPid -or $procPid -le 0) { continue }

    $cmd = ""
    try { $cmd = [string]$p.CommandLine } catch { $cmd = "" }
    if (-not $cmd) { continue }

    foreach ($spec in $specs) {
        $kind = [string]$spec.kind
        $absScriptResolved = [string]$spec.absScriptResolved
        if (Cmd-MatchesScript -Cmd $cmd -AbsScript $absScriptResolved) {
            if (-not $pidKind.ContainsKey($procPid)) { $pidKind[$procPid] = $kind }
            break
        }
    }
}

# 2) Add status PIDs (SSOT) ONLY if the PID is still our process (avoid PID reuse mismatch)
foreach ($spec in $specs) {
    $kind = [string]$spec.kind
    $statusPath = [string]$spec.statusResolved
    $absScriptResolved = [string]$spec.absScriptResolved

    $statusPid = $null
    try {
        if ($statusPath -and (Test-Path -LiteralPath $statusPath)) {
            $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($j.pid) { $statusPid = [int]$j.pid }
        }
    } catch { $statusPid = $null }

    if (-not $statusPid -or $statusPid -le 0) { continue }
    if ($pidKind.ContainsKey($statusPid)) { continue }

    $p = $null
    try { $p = $nodeByPid[$statusPid] } catch { $p = $null }
    if (-not $p) { continue }

    $cmd = ""
    try { $cmd = [string]$p.CommandLine } catch { $cmd = "" }
    if (-not (Cmd-MatchesScript -Cmd $cmd -AbsScript $absScriptResolved)) { continue }

    $pidKind[$statusPid] = $kind
}

$procs = @()
foreach ($procId in @($pidKind.Keys | Sort-Object)) {
    $p = $null
    try { $p = $nodeByPid[[int]$procId] } catch { $p = $null }
    if (-not $p) { continue }

    $cmd = ""
    try { $cmd = [string]$p.CommandLine } catch { $cmd = "" }

    $kind = ""
    try { $kind = [string]$pidKind[[int]$procId] } catch { $kind = "" }

    $start = ""
    try {
        $dt = $p.CreationDate
        if ($dt) { $start = $dt.ToString("yyyy-MM-dd HH:mm:ss") }
    } catch { $start = "" }

    $procs += [PSCustomObject]@{
        pid       = [int]$procId
        kind      = $kind
        cmd       = (Shorten-Cmd -Cmd $cmd)
        startTime = $start
    }
}

if ($procs.Count -eq 0) {
    '[]'
} elseif ($procs.Count -eq 1) {
    '[' + ($procs[0] | ConvertTo-Json -Compress) + ']'
} else {
    $procs | ConvertTo-Json -Compress
}
