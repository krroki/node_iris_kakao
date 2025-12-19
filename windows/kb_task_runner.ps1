param(
  [ValidateSet('collect','embed','manual','backfill')]
  [string]$Task,
  [string]$Venv = ".venv",
  # KB 서비스와 동일하게 .env + .env.kb 오버레이를 기본으로 사용한다.
  # (명시적으로 다른 파일을 쓰려면 -EnvFile로 지정)
  [string]$EnvFile = ".env.kb",
  [int]$Pages = 0
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath $root

# Load env (base .env then overlay .env.kb) without Import-Module to avoid scope/variable conflicts.
if (Test-Path (Join-Path $PSScriptRoot "load_env.ps1")) {
  if (Test-Path (Join-Path $root ".env")) { . "$PSScriptRoot\load_env.ps1" -EnvFile ".env" }
  if ($EnvFile -and (Test-Path (Join-Path $root $EnvFile))) { . "$PSScriptRoot\load_env.ps1" -EnvFile $EnvFile }
}

# 기본 DATABASE_URL (없으면 kb_service.ps1와 동일 값)
if (-not $env:DATABASE_URL -or [string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
  # NOTE: SQLAlchemy 1.4 기본 환경 호환을 위해 psycopg2를 기본 드라이버로 사용한다.
  $env:DATABASE_URL = 'postgresql+psycopg2://iris:iris@127.0.0.1:5433/iris'
}
# 작업별 로그 파일을 분리(서비스/다른 작업과 rotate 충돌 방지)
$env:KB_LOG_FILE = ("kb_task_{0}.log" -f $Task)

$logDir = Join-Path $root 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logPath = Join-Path $logDir ("kb_task_{0}_{1:yyyyMMdd_HHmmss}.log" -f $Task, (Get-Date))

# Single-instance lock per task (scheduler 중복 실행 방지)
$lockPath = Join-Path $logDir ("kb_task_{0}.lock" -f $Task)
if (Test-Path $lockPath) {
  $lockPid = $null
  try { $lockPid = [int](Get-Content -LiteralPath $lockPath -Raw) } catch {}
  $procAlive = $false
  $ageSec = 0
  try {
    $stat = Get-Item $lockPath
    $ageSec = ([DateTime]::UtcNow - $stat.CreationTimeUtc).TotalSeconds
  } catch {}

  if ($lockPid) {
    try {
      $p = Get-CimInstance Win32_Process -Filter "ProcessId=$lockPid" -ErrorAction SilentlyContinue
      if ($p -and $p.CommandLine) {
        $cmd = [string]$p.CommandLine
        # pid 재사용/오탐 방지: kb_task_runner.ps1 + 동일 Task 실행인지 확인
        if ($cmd -match [Regex]::Escape("kb_task_runner.ps1") -and $cmd -match ("-Task\\s+" + [Regex]::Escape($Task))) {
          $procAlive = $true
        }
      }
    } catch {}
  }

  if ($procAlive) {
    Write-Host ("[kb_task_runner] task '{0}' already running pid={1} (age={2:n0}s); skip" -f $Task, $lockPid, [math]::Round($ageSec,0)) -ForegroundColor Yellow
    return
  }

  # 프로세스가 없으면 stale lock → 제거
  try { Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue } catch {}
}
try { Set-Content -LiteralPath $lockPath -Value $PID -Encoding ascii -Force } catch {}
Start-Transcript -Path $logPath -Append | Out-Null

function Resolve-PythonExe {
  param([string]$PreferredVenv)
  $venvPy = if ($PreferredVenv) { ("{0}\\Scripts\\python.exe" -f $PreferredVenv) } else { "" }
  if ($venvPy -and (Test-Path $venvPy)) { return $venvPy }
  return "python"
}

function Ensure-PyModule {
  param(
    [string]$PyExe,
    [string]$ModuleName,
    [string]$PackageName
  )

  $__oldEA = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $PyExe -c "import ${ModuleName}; print('ok')" 2>$null | Out-Null
    $rc = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $__oldEA
  }
  if ($rc -eq 0) { return }

  Write-Host ("[kb_task_runner] missing python module '{0}'; installing package '{1}' into {2}" -f $ModuleName, $PackageName, $PyExe) -ForegroundColor Yellow
  $__oldEA = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $PyExe -m pip install $PackageName | Out-Null
    $rc2 = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $__oldEA
  }
  if ($rc2 -ne 0) {
    throw ("pip install failed for {0} (exit={1})" -f $PackageName, $rc2)
  }
}

function Py { param([string[]]$PyArgs)
  $py = Resolve-PythonExe -PreferredVenv $Venv
  & $py @PyArgs
}

try {
  $pyExe = Resolve-PythonExe -PreferredVenv $Venv
  Ensure-PyModule -PyExe $pyExe -ModuleName "openai" -PackageName "openai"
  Ensure-PyModule -PyExe $pyExe -ModuleName "requests" -PackageName "requests"
  Ensure-PyModule -PyExe $pyExe -ModuleName "yaml" -PackageName "PyYAML"
  Ensure-PyModule -PyExe $pyExe -ModuleName "bs4" -PackageName "beautifulsoup4"
  Ensure-PyModule -PyExe $pyExe -ModuleName "sqlalchemy" -PackageName "sqlalchemy"
  Ensure-PyModule -PyExe $pyExe -ModuleName "pgvector" -PackageName "pgvector"
  Ensure-PyModule -PyExe $pyExe -ModuleName "psycopg2" -PackageName "psycopg2-binary"
  $pagesEff = if ($Pages -gt 0) { $Pages } else { 3 }
  switch ($Task) {
    'collect' { & "$PSScriptRoot\kb_collect.ps1" -Pages $pagesEff }
    'embed'   { & "$PSScriptRoot\kb_embed.ps1" }
    'manual'  { & "$PSScriptRoot\kb_manualize.ps1" }
    'backfill' { Py @('-m','kb.backfill') }
  }
} finally {
  Stop-Transcript | Out-Null
  try { if ($lockPath -and (Test-Path $lockPath)) { Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue } } catch {}
}
