param(
  [string]$Device,
  [string]$VmName = 'redroid',
  [string]$ScrcpyRoot = "$env:USERPROFILE\scrcpy",
  [string]$Version = 'v3.1',
  [switch]$NoInstall,
  [string[]]$ScrcpyArgs
)

$ErrorActionPreference = 'Stop'

function Write-Step {
  param([string]$Message,[ConsoleColor]$Color=[ConsoleColor]::Cyan)
  $old = $Host.UI.RawUI.ForegroundColor
  $Host.UI.RawUI.ForegroundColor = $Color
  Write-Host $Message
  $Host.UI.RawUI.ForegroundColor = $old
}

function Ensure-Scrcpy {
  param([string]$Root,[string]$Version)
  $folderName = "scrcpy-win64-$Version"
  $folderPath = Join-Path $Root $folderName
  $scrcpy = Join-Path $folderPath 'scrcpy.exe'
  $adb = Join-Path $folderPath 'adb.exe'
  if (-not (Test-Path $scrcpy) -or -not (Test-Path $adb)) {
    if ($NoInstall) { throw "scrcpy not found. Set up at $folderPath or omit -NoInstall." }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    New-Item -ItemType Directory -Force -Path $Root | Out-Null
    $zipUrl = "https://github.com/Genymobile/scrcpy/releases/download/$Version/$folderName.zip"
    $zipPath = Join-Path $Root ("{0}.zip" -f $folderName)
    Write-Step ("Downloading {0}" -f $zipUrl) Yellow
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    if (Test-Path $folderPath) { Remove-Item -Recurse -Force $folderPath }
    Expand-Archive -LiteralPath $zipPath -DestinationPath $Root -Force
    Remove-Item $zipPath -Force
  }
  return @{ Folder = $folderPath; Scrcpy = $scrcpy; Adb = $adb }
}

function Detect-Device {
  param([string]$VmName)
  # 1) If Hyper-V is available, try it
  try {
    Import-Module Hyper-V -ErrorAction Stop | Out-Null
    $adapter = Get-VMNetworkAdapter -VMName $VmName -ErrorAction Stop
    $ip = $adapter.IPAddresses | Where-Object { $_ -and ($_ -notmatch ':') } | Select-Object -First 1
    if ($ip) { return "$ip:5555" }
  } catch {}
  # 2) Parse netsh portproxy for 5050 -> <IP>:3000 mapping
  try {
    $out = netsh interface portproxy show v4tov4 | Out-String
    foreach ($line in ($out -split "`n")) {
      if ($line -match "\s5050\s" -and $line -match "\s([0-9]{1,3}(?:\.[0-9]{1,3}){3})\s+3000\s*$") {
        return ("{0}:5555" -f $Matches[1])
      }
    }
  } catch {}
  # 3) Fallback
  return '127.0.0.1:5555'
}

try {
  $bin = Ensure-Scrcpy -Root $ScrcpyRoot -Version $Version
  $scrcpy = $bin.Scrcpy
  $adb = $bin.Adb

  if (-not $Device) { $Device = Detect-Device -VmName $VmName }
  Write-Step ("device = {0}" -f $Device) Yellow

  Write-Step ("adb connect {0}" -f $Device) Yellow
  & $adb connect $Device | Write-Host

  $args = @('-s', $Device)
  if ($ScrcpyArgs) { $args += $ScrcpyArgs }
  Write-Step 'launch scrcpy' Green
  Start-Process -FilePath $scrcpy -ArgumentList $args -WorkingDirectory (Split-Path $scrcpy -Parent) | Out-Null
} catch {
  Write-Error $_
  exit 1
}

