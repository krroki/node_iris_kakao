@echo off
setlocal enabledelayedexpansion
set ROOT=%~dp0..
set WEB=%ROOT%\web
set LOGDIR=%ROOT%\windows\logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>&1
set OUT=%LOGDIR%\web.out.log
set ERR=%LOGDIR%\web.err.log

:: If log files are locked, fall back to timestamped copies
set TS=%DATE:~0,10%_%TIME:~0,8%
set TS=%TS::=_%
set TS=%TS:/=_%
set TS=%TS:.=_%
set TS=%TS: =_%
echo. >> "%OUT%" 2>nul || set OUT=%LOGDIR%\web.out.%TS%.log
echo. >> "%ERR%" 2>nul || set ERR=%LOGDIR%\web.err.%TS%.log

echo [web] delegating to PowerShell start_web.ps1 >> "%OUT%"

set PS=PowerShell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_web.ps1"
%PS% -Port 3100 -TimeoutSec 180 -ForceKillPort -Mode prod -LogDir "%LOGDIR%" 1>>"%OUT%" 2>>"%ERR%"
if errorlevel 1 (
  echo [web] ERROR from start_web.ps1 >> "%ERR%"
  exit /b 1
)
echo [web] READY on :3100 >> "%OUT%"
exit /b 0
