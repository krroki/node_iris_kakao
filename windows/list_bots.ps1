# List node-iris-app processes (bot + workers) — 안전 버전
# Returns JSON array with pid, kind, cmd, startTime
#
# ⚠️ 절대 금지: "dist\\index.js" 같은 범용 패턴으로 node 전체를 스캔/종료하면 다른 프로젝트까지 영향이 갈 수 있다.
# - status.json류 PID(SSOT) + repo 내 dist 절대경로 매칭(복수 인스턴스 감지)만 사용한다.

$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$botDir = Join-Path $root 'node-iris-app'

$dataDir = Join-Path $botDir 'data'
$distDir = Join-Path $botDir 'dist'
$distWorkers = Join-Path $distDir 'workers'

$specs = @(
    @{ kind = 'bot';              status = (Join-Path $dataDir 'status.json');                 absScript = (Join-Path $distDir 'index.js') },
    @{ kind = 'welcome-worker';   status = (Join-Path $dataDir 'welcome_worker_status.json');  absScript = (Join-Path $distWorkers 'welcome_worker.js') },
    @{ kind = 'ai-worker';        status = (Join-Path $dataDir 'ai_worker_status.json');      absScript = (Join-Path $distWorkers 'ai_worker.js') },
    @{ kind = 'broadcast-worker'; status = (Join-Path $dataDir 'broadcast_worker_status.json'); absScript = (Join-Path $distWorkers 'broadcast_worker.js') },
    @{ kind = 'command-worker';   status = (Join-Path $dataDir 'command_worker_status.json');  absScript = (Join-Path $distWorkers 'command_worker.js') }
)

function Shorten-Cmd {
    param([string]$Cmd)
    if (-not $Cmd) { return '' }
    if ($Cmd.Length -gt 140) { return $Cmd.Substring(0, 140) + '...' }
    return $Cmd
}

# pid -> kind (first wins)
$pidKind = @{}

foreach ($spec in $specs) {
    $kind = [string]$spec.kind
    $statusPath = [string]$spec.status
    $absScript = [string]$spec.absScript

    # 1) status.json PID(SSOT)
    try {
        if (Test-Path $statusPath) {
            $j = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($j.pid) {
                $statusPid = [int]$j.pid
                if ($statusPid -gt 0 -and -not $pidKind.ContainsKey($statusPid)) { $pidKind[$statusPid] = $kind }
            }
        }
    } catch {}

    # 2) repo 내 dist 절대경로 매칭(중복 인스턴스 감지용)
    try {
        $absRe = [Regex]::Escape($absScript)
        $extra = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -match $absRe } |
            Select-Object -ExpandProperty ProcessId)
        foreach ($extraPid in ($extra | Where-Object { $_ -and $_ -gt 0 })) {
            $pid2 = [int]$extraPid
            if ($pid2 -gt 0 -and -not $pidKind.ContainsKey($pid2)) { $pidKind[$pid2] = $kind }
        }
    } catch {}
}

$procIds = @($pidKind.Keys | Sort-Object)
$procs = @()
foreach ($procId in $procIds) {
    try {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
        if (-not $p) { continue }
        $cmd = [string]$p.CommandLine
        $kind = [string]$pidKind[$procId]
        $procs += [PSCustomObject]@{
            pid       = [int]$p.ProcessId
            kind      = $kind
            cmd       = (Shorten-Cmd -Cmd $cmd)
            startTime = $p.CreationDate.ToString("yyyy-MM-dd HH:mm:ss")
        }
    } catch {}
}

if ($procs.Count -eq 0) {
    '[]'
} elseif ($procs.Count -eq 1) {
    '[' + ($procs[0] | ConvertTo-Json -Compress) + ']'
} else {
    $procs | ConvertTo-Json -Compress
}
