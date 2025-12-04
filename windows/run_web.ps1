param(
  [int]$FallbackPort = 3110
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath (Join-Path $root 'web')

function Test-PortFree([int]$port){
  try { $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), $port); $l.Start(); $l.Stop(); return $true } catch { return $false }
}

$port = 3100
if (-not (Test-PortFree $port)) { $port = $FallbackPort }

Write-Host ("Starting Next.js on port {0}" -f $port) -ForegroundColor Cyan

try {
  $env:NODE_OPTIONS='--max-old-space-size=4096'
  if (Test-Path '.\\node_modules\\next') {
    npm run dev --silent -- -p $port
  } else {
    # Fallback: use npx to run next without relying on local bin
    npx --yes next@14.2.15 dev -p $port
  }
} catch {
  Write-Warning $_
}
