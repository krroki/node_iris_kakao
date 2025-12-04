param(
  [string]$Venv = ".venv"
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $MyInvocation.MyCommand.Path) | Out-Null
Set-Location -LiteralPath (Join-Path (Get-Location).Path "..")

function Py { param([string[]]$A)
  $py = if (Test-Path ("{0}\Scripts\python.exe" -f $Venv)) { "{0}\Scripts\python.exe" -f $Venv } else { "python" }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $py
  $psi.Arguments = ($A -join ' ')
  $psi.WorkingDirectory = (Get-Location).Path
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $p = [System.Diagnostics.Process]::Start($psi)
  $p.WaitForExit()
  $out = $p.StandardOutput.ReadToEnd(); if ($out) { Write-Host $out }
  $err = $p.StandardError.ReadToEnd(); if ($err) { Write-Host $err }
}

Write-Host "[kb_embed] updating manual embeddings" -ForegroundColor Cyan
$__oldEA = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
try { Py @('-m','kb.update_embeddings') } finally { $ErrorActionPreference = $__oldEA }
