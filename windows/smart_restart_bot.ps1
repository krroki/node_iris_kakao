<#
.SYNOPSIS
    Smart Bot Restart - IRIS auto-recovery + bot restart

.DESCRIPTION
    1. Check IRIS health (127.0.0.1:5050/config)
    2. If failed, detect VM IP + auto-update portproxy
    3. Restart bot

.PARAMETER Force
    Force restart even if IRIS is healthy

.PARAMETER DryRun
    Diagnose only, no actual changes

.PARAMETER Timeout
    Health check timeout in seconds (default: 3)
#>
param(
    [switch]$Force,
    [switch]$DryRun,
    [int]$Timeout = 3
)

$ErrorActionPreference = 'Stop'
$IRIS_PORT = 5050
$IRIS_TARGET_PORT = 3000
$VM_NAME = "redroid"

function Write-Status($msg, $color = "White") {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $msg" -ForegroundColor $color
}

function Test-IrisHealth {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$IRIS_PORT/config" -TimeoutSec $Timeout -UseBasicParsing -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            $json = $response.Content | ConvertFrom-Json
            if ($json.bot_name) {
                return @{ Ok = $true; BotName = $json.bot_name; BotId = $json.bot_id }
            }
        }
    } catch {}
    return @{ Ok = $false }
}

function Get-VmIpAddress {
    # Method 1: Hyper-V Integration Services
    try {
        $adapter = Get-VMNetworkAdapter -VMName $VM_NAME -ErrorAction SilentlyContinue
        if ($adapter -and $adapter.IPAddresses -and $adapter.IPAddresses.Count -gt 0) {
            foreach ($ip in $adapter.IPAddresses) {
                if ($ip -match '^\d+\.\d+\.\d+\.\d+$' -and $ip -notlike '169.254.*') {
                    return $ip
                }
            }
        }
    } catch {}

    # Method 2: Scan Default Switch subnet
    Write-Status "VM IP not found via Hyper-V, scanning Default Switch subnet..." "Yellow"
    try {
        $defaultSwitchIp = (Get-NetIPAddress -InterfaceAlias 'vEthernet (Default Switch)' -AddressFamily IPv4 -ErrorAction SilentlyContinue).IPAddress
        if ($defaultSwitchIp) {
            $subnet = $defaultSwitchIp -replace '\.\d+$', ''
            for ($i = 2; $i -le 254; $i++) {
                $testIp = "$subnet.$i"
                try {
                    $tcpClient = New-Object System.Net.Sockets.TcpClient
                    $result = $tcpClient.BeginConnect($testIp, $IRIS_TARGET_PORT, $null, $null)
                    $success = $result.AsyncWaitHandle.WaitOne(300, $false)
                    if ($success) {
                        $tcpClient.EndConnect($result)
                        $tcpClient.Close()
                        # Verify IRIS
                        try {
                            $check = Invoke-WebRequest -Uri "http://${testIp}:$IRIS_TARGET_PORT/config" -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop
                            if ($check.StatusCode -eq 200) {
                                return $testIp
                            }
                        } catch {}
                    }
                    $tcpClient.Close()
                } catch {}
            }
        }
    } catch {}

    return $null
}

function Get-CurrentPortProxy {
    $output = netsh interface portproxy show v4tov4
    foreach ($line in $output -split "`n") {
        if ($line -match "127\.0\.0\.1\s+$IRIS_PORT\s+(\d+\.\d+\.\d+\.\d+)\s+$IRIS_TARGET_PORT") {
            return $matches[1]
        }
    }
    return $null
}

function Update-PortProxy($newIp) {
    if ($DryRun) {
        Write-Status "[DryRun] Would update portproxy: 127.0.0.1:$IRIS_PORT -> ${newIp}:$IRIS_TARGET_PORT" "Cyan"
        return $true
    }

    # Delete existing
    netsh interface portproxy delete v4tov4 listenport=$IRIS_PORT listenaddress=127.0.0.1 2>$null

    # Add new
    $result = netsh interface portproxy add v4tov4 listenport=$IRIS_PORT listenaddress=127.0.0.1 connectport=$IRIS_TARGET_PORT connectaddress=$newIp
    if ($LASTEXITCODE -eq 0) {
        Write-Status "Portproxy updated: 127.0.0.1:$IRIS_PORT -> ${newIp}:$IRIS_TARGET_PORT" "Green"
        return $true
    } else {
        Write-Status "Failed to update portproxy" "Red"
        return $false
    }
}

function Stop-ExistingBot {
    if ($DryRun) {
        Write-Status "[DryRun] Would stop existing bot processes" "Cyan"
        return
    }

    # Only stop node-iris-app related processes (check command line)
    # ADR-0011: dist\index.js 패턴 포함 (start_bot.ps1과 일관성)
    $stopped = 0
    Get-WmiObject Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.CommandLine -like "*node-iris-app*" -or $_.CommandLine -like "*iris*bot*" -or
            $_.CommandLine -like "*dist\index*" -or $_.CommandLine -like "*dist/index*") {
            try {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
                Write-Status "Stopped bot process (PID: $($_.ProcessId))" "Yellow"
                $stopped++
            } catch {}
        }
    }
    if ($stopped -eq 0) {
        Write-Status "No bot processes found to stop" "Gray"
    }
}

function Start-Bot {
    if ($DryRun) {
        Write-Status "[DryRun] Would start bot" "Cyan"
        return
    }

    $botScript = Join-Path $PSScriptRoot 'start_bot.ps1'
    if (Test-Path $botScript) {
        # Always use Windows-local start_bot.ps1 with canonical IRIS_URL (127.0.0.1:5050)
        $irisUrl = "http://127.0.0.1:$IRIS_PORT"
        Write-Status "Starting bot via $botScript (IrisUrl=$irisUrl)" "Yellow"
        & $botScript -IrisUrl $irisUrl -Restart
    } else {
        Write-Status "Bot start script not found: $botScript" "Red"
    }
}

# ============== MAIN ==============
Write-Status "=== Smart Bot Restart ===" "Cyan"

# Step 1: Health check
Write-Status "Checking IRIS health at 127.0.0.1:$IRIS_PORT..."
$health = Test-IrisHealth

if ($health.Ok -and -not $Force) {
    Write-Status "IRIS is healthy (bot: $($health.BotName), id: $($health.BotId))" "Green"
    Write-Status "Restarting bot..." "Yellow"
    Stop-ExistingBot
    Start-Sleep -Seconds 2
    Start-Bot
    exit 0
}

if (-not $health.Ok) {
    Write-Status "IRIS not responding at 127.0.0.1:$IRIS_PORT" "Red"
}

# Step 2: Check current portproxy
$currentProxyIp = Get-CurrentPortProxy
Write-Status "Current portproxy target: $currentProxyIp"

# Step 3: Find VM IP
Write-Status "Finding VM IP..."
$vmIp = Get-VmIpAddress

if (-not $vmIp) {
    Write-Status "ERROR: Could not find VM IP. Is the VM running?" "Red"
    Write-Status "Try: Get-VM -Name $VM_NAME | Select State" "Yellow"
    exit 1
}

Write-Status "Found VM IP: $vmIp" "Green"

# Step 4: Test IRIS direct connection
Write-Status "Testing IRIS at ${vmIp}:$IRIS_TARGET_PORT..."
try {
    $check = Invoke-WebRequest -Uri "http://${vmIp}:$IRIS_TARGET_PORT/config" -TimeoutSec $Timeout -UseBasicParsing -ErrorAction Stop
    if ($check.StatusCode -eq 200) {
        Write-Status "IRIS responding at ${vmIp}:$IRIS_TARGET_PORT" "Green"
    }
} catch {
    Write-Status "ERROR: IRIS not responding at ${vmIp}:$IRIS_TARGET_PORT" "Red"
    Write-Status "Check: ./iris_control status (in VM)" "Yellow"
    exit 1
}

# Step 5: Update portproxy if needed
if ($currentProxyIp -ne $vmIp) {
    Write-Status "Portproxy needs update: $currentProxyIp -> $vmIp" "Yellow"
    if (-not (Update-PortProxy $vmIp)) {
        exit 1
    }
} else {
    Write-Status "Portproxy already correct" "Green"
}

# Step 6: Restart bot
Write-Status "Restarting bot..."
Stop-ExistingBot
Start-Sleep -Seconds 2
Start-Bot

Write-Status "=== Done ===" "Cyan"

