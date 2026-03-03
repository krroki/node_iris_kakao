param(
  [string]$Venv = ".venv",
  [int]$Pages = 3
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $MyInvocation.MyCommand.Path) | Out-Null
Set-Location -LiteralPath (Join-Path (Get-Location).Path "..")

function Py {
  param([string[]]$A)
  $py = if (Test-Path ("{0}\\Scripts\\python.exe" -f $Venv)) { "{0}\\Scripts\\python.exe" -f $Venv } else { "python" }
  Write-Host ("[kb_collect] exec: {0} {1}" -f $py, ($A -join ' '))
  # stdout/stderr를 실시간으로 스트리밍한다 (진행 중 무응답 체감 완화).
  & $py @A 2>&1 | ForEach-Object { Write-Host $_ }
  $rc = $LASTEXITCODE
  if ($rc -ne 0) { throw ("python exited with {0}" -f $rc) }
}

Write-Host "[kb_collect] ingest menus (pages=$Pages)" -ForegroundColor Cyan
$env:KB_PAGES = "$Pages"
if (-not $env:KB_LOG_FILE) { $env:KB_LOG_FILE = 'kb_collect.log' }
# 외부 프로세스 stderr로 인한 NativeCommandError를 피하기 위해 일시적으로 Continue
$__oldEA = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
try {
  # 모듈 형태 실행 (경로 이슈 방지)
  Py -A @('-m','kb.ingest')
} finally { $ErrorActionPreference = $__oldEA }
