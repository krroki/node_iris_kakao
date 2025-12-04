param(
  [string]$KeyPath = "$env:USERPROFILE\.ssh\redroid",
  [string]$Comment = "redroid"
)

$ErrorActionPreference = 'Stop'

Write-Host "=== Redroid SSH 키 설정 ===" -ForegroundColor Cyan

$pubPath = "$KeyPath.pub"

if (-not (Test-Path -Path (Split-Path $KeyPath -Parent))) {
  New-Item -ItemType Directory -Path (Split-Path $KeyPath -Parent) -Force | Out-Null
}

if (-not (Test-Path $KeyPath)) {
  Write-Host "[ssh] 새 키를 생성합니다: $KeyPath" -ForegroundColor Yellow
  ssh-keygen -t ed25519 -f $KeyPath -N "" -C $Comment
} else {
  Write-Host "[ssh] 이미 키가 존재합니다: $KeyPath" -ForegroundColor Yellow
}

if (-not (Test-Path $pubPath)) {
  throw "공개키 파일을 찾을 수 없습니다: $pubPath"
}

$pub = Get-Content $pubPath -Raw

Write-Host ""
Write-Host "1) VM(redroid)에서 아래 공개키를 ~/.ssh/authorized_keys 에 추가하세요." -ForegroundColor Green
Write-Host "   (VM 콘솔 또는 ssh kakao@<VM_IP> 이용)" -ForegroundColor Green
Write-Host ""
Write-Host $pub -ForegroundColor White
Write-Host ""
Write-Host "2) VM에서 권한 설정:" -ForegroundColor Green
Write-Host "   mkdir -p ~/.ssh" -ForegroundColor White
Write-Host "   echo '위 공개키 한 줄' >> ~/.ssh/authorized_keys" -ForegroundColor White
Write-Host "   chmod 700 ~/.ssh" -ForegroundColor White
Write-Host "   chmod 600 ~/.ssh/authorized_keys" -ForegroundColor White
Write-Host ""
Write-Host "3) Windows PowerShell에서 ssh 접속 테스트:" -ForegroundColor Green
Write-Host "   ssh -i `"$KeyPath`" kakao@<VM_IP>" -ForegroundColor White
Write-Host ""
Write-Host "테스트가 통과하면 windows/repair_redroid_iris.ps1 -Fix 및 /api/device/repair 자동 복구가 정상 동작합니다." -ForegroundColor Green

