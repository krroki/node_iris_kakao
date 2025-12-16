Option Explicit

' Windows Task Scheduler에서 powershell.exe를 직접 실행하면(Interactive)
' 파란 콘솔 창이 잠깐이라도 뜨는 플래시가 발생할 수 있다.
' 이 스크립트는 ensure_watchdog.ps1를 "완전 숨김"으로 실행하기 위한 래퍼다.
'
' 호출 예:
'   wscript.exe "C:\dev\12.kakao\windows\run_ensure_watchdog.vbs"

Dim fso, scriptDir, repoRoot, ps1Path, cmd, shell
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
repoRoot = fso.GetParentFolderName(scriptDir)

ps1Path = repoRoot & "\\windows\\ensure_watchdog.ps1"
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & ps1Path & """"

Set shell = CreateObject("WScript.Shell")
shell.Run cmd, 0, False

