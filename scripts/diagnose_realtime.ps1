param(
  [string]$VmName,
  [int]$LocalPort,
  [int]$RemotePort,
  [string]$Device,
  [string]$Repo,
  [string]$QuickstartScript
)

$ErrorActionPreference = 'Stop'

if (-not $VmName) { $VmName = 'redroid' }
if (-not $LocalPort) { $LocalPort = 5050 }
if (-not $RemotePort) { $RemotePort = 3000 }
if (-not $Device) { $Device = 'localhost:5555' }
if (-not $Repo) { $Repo = '\\wsl$\\Ubuntu\\home\\glemfkcl\\dev\\12.kakao' }
if (-not $QuickstartScript) { $QuickstartScript = 'C:\\Users\\Public\\quickstart_windows_5050.ps1' }

$QuickstartTimeoutSec = if ($QuickstartTimeoutSec) { $QuickstartTimeoutSec } else { 25 }
$WslTimeoutSec = if ($WslTimeoutSec) { $WslTimeoutSec } else { 90 }

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot '..')
$logDir = Join-Path $repoRoot.Path 'logs'
if (-not (Test-Path $logDir)) {
  New-Item -Path $logDir -ItemType Directory | Out-Null
}
$logPath = Join-Path $logDir ("diagnose_realtime_{0:yyyyMMdd_HHmmss}.log" -f (Get-Date))
Start-Transcript -Path $logPath -Append | Out-Null

function Write-Step {
  param(
    [string]$Message,
    [ConsoleColor]$Color = [ConsoleColor]::Cyan
  )
  $old = $Host.UI.RawUI.ForegroundColor
  $Host.UI.RawUI.ForegroundColor = $Color
  Write-Host $Message
  $Host.UI.RawUI.ForegroundColor = $old
}

function Invoke-WslCommand {
  param([string]$Command)
  Write-Step "    WSL> $Command" DarkGray
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'wsl.exe'
  # merge stderr into stdout to avoid deadlocks and read a single stream
  $psi.ArgumentList = @('-d','Ubuntu','-e','bash','-lc',"$Command 2>&1")
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $false
  $psi.UseShellExecute = $false
  $proc = [System.Diagnostics.Process]::Start($psi)
  if (-not $proc.WaitForExit($WslTimeoutSec * 1000)) {
    try { $proc.Kill() } catch { }
    Write-Warning "WSL 명령이 ${WslTimeoutSec}초 내에 종료되지 않아 강제 종료했습니다."
    try { $out = $proc.StandardOutput.ReadToEnd() } catch { $out = '' }
    if ($out) { Write-Host $out.Trim() }
    return 124
  }
  $stdout = $proc.StandardOutput.ReadToEnd()
  if ($stdout) { Write-Host $stdout.Trim() }
  return $proc.ExitCode
}

Write-Step '=== IRIS 진단/재시작 ===' Green

try {
  $vm = Get-VM -Name $VmName -ErrorAction Stop
  if ($vm.State -ne 'Running') {
    Write-Step "[1/6] VM '$VmName' 현재 상태: $($vm.State). 기동 중..." Yellow
    Start-VM -Name $VmName | Out-Null
    Start-Sleep -Seconds 5
    $vm = Get-VM -Name $VmName
  } else {
    Write-Step "[1/6] VM '$VmName' 이미 실행 중." Green
  }
} catch {
  throw "Hyper-V VM '$VmName' 정보 조회 실패: $_"
}

try {
  $adapter = Get-VMNetworkAdapter -VMName $VmName
  $vmIp = $adapter.IPAddresses | Where-Object { $_ -and $_ -notmatch ':' } | Select-Object -First 1
  if (-not $vmIp) {
    $mac = $adapter.MacAddress
    $vmIp = (Get-NetNeighbor -AddressFamily IPv4 | Where-Object { $_.LinkLayerAddress -eq ($mac -replace '(.{2})','$1-').Trim('-') }).IPAddress | Select-Object -First 1
  }
  if ($vmIp) {
    Write-Step "[2/6] VM IP: $vmIp" Green
  } else {
    Write-Step "[2/6] VM IP를 찾지 못했습니다. VM 안에서 'ip addr'로 직접 확인하세요." Red
  }
} catch {
  Write-Warning "VM IP 확인 중 오류: $_"
}

if (Test-Path $QuickstartScript) {
  Write-Step "[3/6] Windows 포트/ADB 설정 갱신 ($QuickstartScript)" Yellow
  $connectAddr = if ($vmIp) { $vmIp } else { '127.0.0.1' }
  $deviceArg = $Device
  if ($vmIp) { $deviceArg = "$($vmIp):5555" }
  Write-Step "    > vmIp: $vmIp / Device 기본값: $Device / vmIp truthy: $([bool]$vmIp)" DarkGray
  Write-Step "    > Device 파라미터: $deviceArg" DarkGray
  # Prefer repo-local setup when VM IP is known (ADB first, then portproxy to avoid bind conflicts)
  $repoSetup = Join-Path $repoRoot.Path 'windows\setup_iris_port.ps1'
  if ($vmIp -and (Test-Path $repoSetup)) {
    Write-Step "    > repo-local windows\\setup_iris_port.ps1 사용 (ADB→portproxy 순서)" DarkGray
    $qsJob = Start-Job -ScriptBlock {
      param($s,$addr,$lp,$rp)
      & $s -ConnectAddress $addr -LocalPort $lp -RemotePort $rp -SkipProbe
    } -ArgumentList $repoSetup,$connectAddr,$LocalPort,$RemotePort
  } else {
    # Run external quickstart with a hard timeout to avoid hangs (e.g., stuck adb connect)
    $qsJob = Start-Job -ScriptBlock {
      param($qs,$dev,$lp,$rp,$addr)
      & $qs -Device $dev -LocalPort $lp -RemotePort $rp -ConnectAddress $addr
    } -ArgumentList $QuickstartScript,$deviceArg,$LocalPort,$RemotePort,$connectAddr
  }

  $completed = Wait-Job -Job $qsJob -Timeout $QuickstartTimeoutSec
  if (-not $completed) {
    Write-Warning "Quickstart가 ${QuickstartTimeoutSec}초 내에 끝나지 않아 건너뜁니다. 나중에 수동 실행 권장: $QuickstartScript"
    try { Stop-Job $qsJob -Force | Out-Null } catch { }
  } else {
    $out = Receive-Job -Job $qsJob -ErrorAction SilentlyContinue
    if ($out) { $out | ForEach-Object { Write-Host $_ } }
  }
  try { Remove-Job $qsJob -Force | Out-Null } catch { }
} else {
  Write-Warning "Quickstart 스크립트를 $QuickstartScript 에서 찾을 수 없습니다. 수동으로 실행해 주세요."
}

if (-not (Test-Path $Repo)) {
  throw "Repo path not found: $Repo"
}

Write-Step "[4/6] WSL에서 봇 재기동 (SAFE_MODE 유지)" Yellow
$wslExit = Invoke-WslCommand "cd /home/glemfkcl/dev/12.kakao && IRIS_LOCAL_PORT=$LocalPort ./scripts/start_bot_wsl.sh"
if ($wslExit -ne 0) {
  Write-Warning "WSL quickstart 스크립트가 비정상 종료되었습니다 (exit $wslExit)"
}

Write-Step "[5/6] http://127.0.0.1:$LocalPort/config 응답 확인" Yellow
try {
  $status = (Invoke-WebRequest -Uri "http://127.0.0.1:$LocalPort/config" -TimeoutSec 5).StatusCode
  Write-Step "    응답: HTTP $status" Green
} catch {
  Write-Warning "IRIS /config 응답 실패: $_"
}

Write-Step "[6/6] 최신 이벤트 타임스탬프 확인" Yellow
$statusPath = '/home/glemfkcl/dev/12.kakao/node-iris-app/data/status.json'
Invoke-WslCommand "test -f $statusPath && cat $statusPath || echo 'status.json not found'"

Write-Step "로그 저장 위치: $logPath" DarkGray
Write-Step '=== 진단 완료. 대시보드에서 상태와 로그 타임스탬프를 확인하세요. ===' Green

Stop-Transcript | Out-Null
