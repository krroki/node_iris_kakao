param(
  [string]$EnvFile = ".env"
)
if (-not (Test-Path $EnvFile)) { return }
Get-Content -LiteralPath $EnvFile | ForEach-Object {
  if ($_ -match '^(\s*#|\s*$)') { return }
  $i = $_.IndexOf('=')
  if ($i -lt 1) { return }
  $k = $_.Substring(0,$i).Trim()
  $v = $_.Substring($i+1).Trim()
  [Environment]::SetEnvironmentVariable($k, $v, 'Process')
}

