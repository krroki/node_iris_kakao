param(
  [int]$Port = 8615
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath $root

$env:KB_URL = $env:KB_URL -as [string]
if (-not $env:KB_URL) { $env:KB_URL = 'http://127.0.0.1:8610' }

$py = if (Test-Path '.venv_ui\Scripts\python.exe') { '.venv_ui\Scripts\python.exe' } elseif (Test-Path '.venv\Scripts\python.exe') { '.venv\Scripts\python.exe' } else { 'python' }

& $py -m pip install --quiet streamlit requests pandas || Write-Host 'streamlit already present'

Start-Process -FilePath $py -ArgumentList @('-m','streamlit','run','dashboard/kb_panel.py','--server.port',"$Port") -WorkingDirectory $root

