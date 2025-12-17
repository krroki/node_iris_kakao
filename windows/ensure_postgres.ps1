<#
.SYNOPSIS
  KB(Postgres/pgvector) 컨테이너를 "항상 살아있게" 보장하는 유틸리티

.DESCRIPTION
  - Docker Desktop 서비스/프로세스가 꺼져 있으면 기동을 시도한다.
  - docker compose로 postgres(컨테이너명 iris_pg)를 up -d 한다.
  - iris_pg가 healthy가 될 때까지 대기한다(타임아웃).

  폴백(조용한 무시) 금지:
  - 실패 시 원인을 출력하고 종료한다(상위 watchdog/start_all에서 로그로 기록).

.USAGE
  powershell -ExecutionPolicy Bypass -File .\windows\ensure_postgres.ps1
#>

param(
  [int]$TimeoutSec = 180,
  [string]$ServiceName = "com.docker.service",
  [string]$DockerDesktopExe = "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe",
  [string]$ComposeService = "postgres",
  [string]$ContainerName = "iris_pg"
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root

function Say {
  param([string]$Message)
  Write-Output ("[pg] {0}" -f $Message)
}

function Test-DockerEngineReady {
  try {
    $out = & docker version --format "{{.Server.Version}}" 2>$null
    if ($LASTEXITCODE -eq 0 -and $out -and (-not [string]::IsNullOrWhiteSpace([string]$out))) { return $true }
  } catch {}
  return $false
}

function Get-ContainerHealth {
  param([string]$Name)
  try {
    $h = & docker inspect -f "{{.State.Health.Status}}" $Name 2>$null
    if ($LASTEXITCODE -eq 0 -and $h) { return ([string]$h).Trim() }
  } catch {}
  return $null
}

function Get-ContainerRunning {
  param([string]$Name)
  try {
    $r = & docker inspect -f "{{.State.Running}}" $Name 2>$null
    if ($LASTEXITCODE -eq 0 -and $r) { return ([string]$r).Trim().ToLower() -eq "true" }
  } catch {}
  return $false
}

function Ensure-DockerService {
  param([string]$Name)
  try {
    $svc = Get-Service -Name $Name -ErrorAction Stop
    if ($svc.Status -ne "Running") {
      Say ("Docker 서비스 시작: {0} (현재={1})" -f $Name, $svc.Status)
      Start-Service -Name $Name -ErrorAction Stop
    }
  } catch {
    # 서비스가 없는 환경(WSL-only 등)도 있을 수 있다. 이 경우 Docker Engine ready 체크로 이어간다.
    Say ("Docker 서비스 확인 불가(무시 아님, 다음 단계로 진행): {0}" -f $_.Exception.Message)
  }
}

function Ensure-DockerDesktopProcess {
  param([string]$ExePath)
  try {
    $p = Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue
    if ($p) { return }
  } catch {}

  if (-not (Test-Path -LiteralPath $ExePath)) {
    Say ("Docker Desktop 실행 파일을 찾지 못했습니다: {0}" -f $ExePath)
    return
  }
  Say "Docker Desktop 실행 시도"
  try {
    Start-Process -FilePath $ExePath -WindowStyle Minimized | Out-Null
  } catch {
    Say ("Docker Desktop 실행 실패: {0}" -f $_.Exception.Message)
  }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "docker 명령을 찾지 못했습니다. Docker Desktop 설치/PATH를 확인하세요."
}
if (-not (Test-Path -LiteralPath (Join-Path $root "docker-compose.yml"))) {
  throw "docker-compose.yml을 찾지 못했습니다. repo root에서 실행하세요."
}

$deadline = (Get-Date).AddSeconds([math]::Max(10, $TimeoutSec))

# 이미 healthy면 빠르게 종료
$health0 = Get-ContainerHealth -Name $ContainerName
if ($health0 -eq "healthy") {
  Say ("{0} 이미 healthy 상태입니다." -f $ContainerName)
  return
}

Ensure-DockerService -Name $ServiceName
Ensure-DockerDesktopProcess -ExePath $DockerDesktopExe

Say "Docker Engine 준비 대기"
while ((Get-Date) -lt $deadline) {
  if (Test-DockerEngineReady) { break }
  Start-Sleep -Seconds 2
}
if (-not (Test-DockerEngineReady)) {
  throw "Docker Engine 준비 실패(타임아웃). Docker Desktop이 꺼져 있거나 엔진이 시작되지 않았습니다."
}

Say ("docker compose up -d {0}" -f $ComposeService)
$composeOk = $false
try {
  $oldPref = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $out = & docker compose up -d $ComposeService 2>&1
  $exit = $LASTEXITCODE
  $ErrorActionPreference = $oldPref
  @($out) | ForEach-Object { Say ([string]$_) }
  if ($exit -eq 0) { $composeOk = $true }
} catch { $composeOk = $false }

if (-not $composeOk) {
  # 구버전 환경 대비 (명시적으로 로그 남김)
  Say "docker compose 실패 -> docker-compose로 재시도"
  if (-not (Get-Command docker-compose -ErrorAction SilentlyContinue)) {
    throw "docker compose 실패 + docker-compose 명령도 없음. Docker CLI 구성을 확인하세요."
  }
  $oldPref2 = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $out2 = & docker-compose up -d $ComposeService 2>&1
  $exit2 = $LASTEXITCODE
  $ErrorActionPreference = $oldPref2
  @($out2) | ForEach-Object { Say ([string]$_) }
  if ($exit2 -ne 0) { throw "docker-compose up 실패(ExitCode=$exit2)" }
}

Say ("{0} healthy 대기" -f $ContainerName)
$lastState = ""
$lastEmitAt = Get-Date "2000-01-01T00:00:00Z"
while ((Get-Date) -lt $deadline) {
  $h = Get-ContainerHealth -Name $ContainerName
  if ($h -eq "healthy") {
    Say ("READY ({0}=healthy)" -f $ContainerName)
    return
  }
  # health가 아직 없거나 starting/unhealthy이면 잠깐 대기
  $running = Get-ContainerRunning -Name $ContainerName
  $h2 = if ($h) { $h } else { "(health 없음)" }
  $r2 = if ($running) { "running" } else { "not-running" }
  $state = ("{0}|{1}" -f $r2, $h2)
  $now2 = Get-Date
  if ($state -ne $lastState -or (($now2 - $lastEmitAt).TotalSeconds -ge 10)) {
    $lastState = $state
    $lastEmitAt = $now2
    Say ("대기 중... {0} {1}" -f $r2, $h2)
  }
  Start-Sleep -Seconds 2
}

throw ("{0} healthy 대기 타임아웃(TimeoutSec={1}). 현재 상태: running={2}, health={3}" -f $ContainerName, $TimeoutSec, (Get-ContainerRunning -Name $ContainerName), (Get-ContainerHealth -Name $ContainerName))
