param(
  [string]$Venv = ".venv"
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $MyInvocation.MyCommand.Path) | Out-Null
Set-Location -LiteralPath (Join-Path (Get-Location).Path "..")

function Py { param([string[]]$A)
  $py = if (Test-Path ("{0}\\Scripts\\python.exe" -f $Venv)) { "{0}\\Scripts\\python.exe" -f $Venv } else { "python" }
  Write-Host ("[kb_embed] exec: {0} {1}" -f $py, ($A -join ' '))
  & $py @A 2>&1 | ForEach-Object { Write-Host $_ }
  $rc = $LASTEXITCODE
  if ($rc -ne 0) { throw ("python exited with {0}" -f $rc) }
}

Write-Host "[kb_embed] updating manual embeddings" -ForegroundColor Cyan
if (-not $env:KB_LOG_FILE) { $env:KB_LOG_FILE = 'kb_embed.log' }
$__oldEA = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
try { Py @('-m','kb.update_embeddings') } finally { $ErrorActionPreference = $__oldEA }
