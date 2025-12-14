@echo off
setlocal enabledelayedexpansion
set ROOT=%~dp0..
set BOT=%ROOT%\node-iris-app
set LOGDIR=%ROOT%\windows\logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>&1
set OUT=%LOGDIR%\bot.out.log
set ERR=%LOGDIR%\bot.err.log

:: If log files are locked by another process, fall back to timestamped files
set TS=%DATE:~0,10%_%TIME:~0,8%
set TS=%TS::=_%
set TS=%TS:/=_%
set TS=%TS:.=_%
set TS=%TS: =_%
echo. >> "%OUT%" 2>nul || set OUT=%LOGDIR%\bot.out.%TS%.log
echo. >> "%ERR%" 2>nul || set ERR=%LOGDIR%\bot.err.%TS%.log

echo [bot] starting (cmd) >> "%OUT%"

REM Kill existing node bot processes
for /f "tokens=2 delims=," %%p in ('tasklist /nh /fi "imagename eq node.exe" /fo csv ^| findstr /i "node-iris-app"') do (
  taskkill /F /PID %%~p >nul 2>&1
)

REM Build with separate log file to avoid contention
set BUILDLOG=%LOGDIR%\bot.build.%DATE:~0,10%_%TIME:~0,8%.log
set BUILDLOG=%BUILDLOG::=_%
pushd "%BOT%"
call npm run --silent build 1>>"%BUILDLOG%" 2>>&1

REM Start bot and redirect logs
del /f /q "%OUT%" "%ERR%" >nul 2>&1
start "bot" /B node "dist\index.js" 1>>"%OUT%" 2>>"%ERR%"

REM Wait up to 25s for status.json
set STATUS=%BOT%\data\status.json
REM Optional fast mode: skip readiness wait if SKIP_WAIT is set
if defined SKIP_WAIT goto bot_ok

set /a tries=25
if defined WAIT_TRIES set /a tries=%WAIT_TRIES%
:wait_bot
ping -n 2 127.0.0.1 >nul
if exist "%STATUS%" goto bot_ok
set /a tries-=1
if !tries! GTR 0 goto wait_bot
echo [bot] TIMEOUT waiting status.json >> "%ERR%"
exit /b 1
:bot_ok
echo [bot] READY >> "%OUT%"
popd
exit /b 0
