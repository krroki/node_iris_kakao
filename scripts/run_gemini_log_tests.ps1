Param(
  [string]$KeyPath = ""
)

$ErrorActionPreference = 'Stop'

# Root dir = repository root
$Root = Split-Path -Parent $PSScriptRoot
if (-not $KeyPath) {
  $KeyPath = Join-Path $Root 'config\gemini.key'
}

if (-not (Test-Path $KeyPath)) {
  Write-Error "키 파일이 없습니다: $KeyPath`n아래 명령으로 생성하세요:`n  Set-Content -Path config\gemini.key -Value '<YOUR_GEMINI_API_KEY>'"
  exit 2
}

$apiKey = (Get-Content -Path $KeyPath -TotalCount 1).Trim()
if (-not $apiKey) {
  Write-Error "키 파일이 비어있습니다: $KeyPath"
  exit 2
}

$env:GEMINI_API_KEY = $apiKey
Write-Host "[정보] GEMINI_API_KEY 로드 완료. 테스트를 진행합니다." -ForegroundColor Cyan
# 고정 모델(요청): Gemini 1.5 Flash
$Model = 'models/gemini-1.5-flash'
Write-Host "[정보] 모델(고정): $Model" -ForegroundColor Cyan

# 최신 로그 파일 자동 선택 (node-iris-app\data\logs)
$nodeLogDir = Join-Path $Root 'node-iris-app\data\logs'
# 실방 ID: 숏천모 2번방, 디하클 시크릿톡방
$rid1 = '18426993080683374'
$rid2 = '18455243186079943'
$log1 = Get-ChildItem -Path (Join-Path $nodeLogDir $rid1) -Filter *.log -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$log2 = Get-ChildItem -Path (Join-Path $nodeLogDir $rid2) -Filter *.log -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $log1) { Write-Error "$nodeLogDir\$rid1 디렉터리에 로그 파일이 없습니다."; exit 2 }
if (-not $log2) { Write-Error "$nodeLogDir\$rid2 디렉터리에 로그 파일이 없습니다."; exit 2 }

$py = 'python'

& $py (Join-Path $Root 'scripts\gemini_context_responder.py') `
  --log $log1.FullName `
  --room-name '숏천모 2번방' `
  --model $Model `
  --min-gap-seconds 600 `
  --max-calls-per-room 2 `
  --execute `
  --max-calls 2

& $py (Join-Path $Root 'scripts\gemini_context_responder.py') `
  --log $log2.FullName `
  --room-name '디하클 시크릿톡방' `
  --plain-every 3 `
  --model $Model `
  --min-gap-seconds 600 `
  --max-calls-per-room 2 `
  --execute `
  --max-calls 2

Write-Host "[완료] 두 로그에 대한 호출을 마쳤습니다." -ForegroundColor Green
