$ErrorActionPreference = 'Stop'
$wsl = "$env:WINDIR\System32\wsl.exe"
$repoWsl = "/home/glemfkcl/dev/12.kakao"
Write-Host "=== Tail WSL bot log ===" -ForegroundColor Green
Start-Process -FilePath $wsl -ArgumentList @('-e','bash','-lc',"cd $repoWsl && tail -f logs/bot_wsl.log")
