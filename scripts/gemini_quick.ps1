Param(
  [string]$Model = 'models/gemini-1.5-flash'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$KeyPath = Join-Path $Root 'config\gemini.key'
if (-not (Test-Path $KeyPath)) {
  Write-Error "키 파일이 없습니다: $KeyPath"
}
$env:GEMINI_API_KEY = (Get-Content -Path $KeyPath -TotalCount 1).Trim()
Write-Host "[정보] 모델: $Model" -ForegroundColor Cyan

$rid1 = '18426993080683374' # 숏천모 2번방
$rid2 = '18455243186079943' # 디하클 시크릿톡방

$py = 'python'

& $py (Join-Path $Root 'scripts\gemini_context_responder.py') `
  --room-id $rid1 `
  --model $Model `
  --gate-mode smart `
  --min-answer-score 3 `
  --excerpt 18 `
  --window-seconds 1800 `
  --local-excerpt 24 `
  --min-gap-seconds 600 `
  --max-calls-per-room 1 `
  --execute `
  --max-calls 1

& $py (Join-Path $Root 'scripts\gemini_context_responder.py') `
  --room-id $rid2 `
  --model $Model `
  --gate-mode smart `
  --min-answer-score 3 `
  --excerpt 18 `
  --window-seconds 1800 `
  --local-excerpt 24 `
  --min-gap-seconds 600 `
  --max-calls-per-room 1 `
  --execute `
  --max-calls 1

Write-Host "[완료] gemini_quick 실행 종료" -ForegroundColor Green
