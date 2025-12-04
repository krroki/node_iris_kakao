param(
  [string]$Venv = ".venv",
  [int]$Pages = 3
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $MyInvocation.MyCommand.Path) | Out-Null
Set-Location -LiteralPath (Join-Path (Get-Location).Path "..")

function Py {
  param([string[]]$A)
  $py = if (Test-Path ("{0}\Scripts\python.exe" -f $Venv)) { "{0}\Scripts\python.exe" -f $Venv } else { "python" }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $py
  $psi.Arguments = ($A -join ' ')
  $psi.WorkingDirectory = (Get-Location).Path
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  Write-Host ("[kb_collect] exec: {0} {1}" -f $psi.FileName, $psi.Arguments)
  $p = [System.Diagnostics.Process]::Start($psi)
  $p.WaitForExit()
  $out = $p.StandardOutput.ReadToEnd()
  $err = $p.StandardError.ReadToEnd()
  if ($out) { Write-Host $out }
  if ($err) { Write-Host $err }
}

Write-Host "[kb_collect] ingest menus (pages=$Pages)" -ForegroundColor Cyan
$env:KB_PAGES = "$Pages"
# 외부 프로세스 stderr로 인한 NativeCommandError를 피하기 위해 일시적으로 Continue
$__oldEA = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
try {
  # 모듈 형태 실행 (경로 이슈 방지)
  Py -A @('-m','kb.ingest')
} finally { $ErrorActionPreference = $__oldEA }
