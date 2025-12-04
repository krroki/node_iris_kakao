param(
  [string]$RoomId = 'test-room',
  [string]$Text = 'SMOKE',
  [string]$Sender = 'system'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$logs = Join-Path $root 'node-iris-app\data\logs'
$roomDir = Join-Path $logs $RoomId
New-Item -ItemType Directory -Force -Path $roomDir | Out-Null

$ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$file = Join-Path $roomDir ((Get-Date).ToString('yyyy-MM-dd') + '.log')

$record = [ordered]@{
  timestamp = $ts
  snapshot  = [ordered]@{
    roomId      = $RoomId
    roomName    = 'Smoke Test'
    senderId    = '0'
    senderName  = $Sender
    messageId   = ('smoke-' + [guid]::NewGuid().ToString('N'))
    messageText = $Text
  }
  payload   = [ordered]@{
    type = 'message'
    text = $Text
  }
}

$json = ($record | ConvertTo-Json -Depth 5 -Compress)
Add-Content -LiteralPath $file -Value $json
Write-Host "appended -> $file" -ForegroundColor Green

