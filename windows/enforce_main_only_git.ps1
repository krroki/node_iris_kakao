param(
  [switch]$FixHead
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root

function Say($msg) { Write-Host ("[git-main-only] {0}" -f $msg) -ForegroundColor Cyan }
function Warn($msg) { Write-Host ("[git-main-only] WARN: {0}" -f $msg) -ForegroundColor Yellow }

Say "core.hooksPath=.githooks 설정 적용"
& git config core.hooksPath .githooks | Out-Null

$hooksPath = (& git config --get core.hooksPath) -as [string]
Say ("core.hooksPath={0}" -f $hooksPath)

$branch = (& git rev-parse --abbrev-ref HEAD) -as [string]
Say ("current branch={0}" -f $branch)

if ($branch -ne 'main') {
  Warn ("이 워킹트리는 main-only입니다. 현재={0}" -f $branch)
  if ($FixHead) {
    Say "HEAD를 main으로 재부착(git symbolic-ref)합니다. (파일 변경 없음)"
    & git symbolic-ref HEAD refs/heads/main | Out-Null
  } else {
    Warn "복구하려면: windows/enforce_main_only_git.ps1 -FixHead"
  }
}

Say "done"

