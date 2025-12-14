@echo off
setlocal enabledelayedexpansion
set ROOT=%~dp0..
set LOGDIR=%ROOT%\windows\logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>&1
set TS=%DATE:~0,10%_%TIME:~0,8%
set TS=%TS::=_%
set TS=%TS:/=_%
set TS=%TS:.=_%
set TS=%TS: =_%
set OUT=%LOGDIR%\api.out.log
set ERR=%LOGDIR%\api.err.log
echo. >> "%OUT%" 2>nul || set OUT=%LOGDIR%\api.out.%TS%.log
echo. >> "%ERR%" 2>nul || set ERR=%LOGDIR%\api.err.%TS%.log
set VENV=%ROOT%\dashboard\.venv_ui
set PY=%VENV%\Scripts\python.exe

echo [api] starting (cmd) >> "%OUT%"

REM Kill uvicorn on :8650 if any
for /f "tokens=5" %%p in ('netstat -ano ^| find ":8650" ^| find "LISTENING"') do (
  taskkill /F /PID %%p >nul 2>&1
)

REM Ensure correct working directory and module path
pushd "%ROOT%"
set PYTHONPATH=%ROOT%
set IRIS_LOGS_DIR=%ROOT%\node-iris-app\data\logs
set IRIS_APP_BASE=%ROOT%\node-iris-app
start "api8650" /B "%PY%" -m uvicorn server.app:app --host 0.0.0.0 --port 8650 1>>"%OUT%" 2>>"%ERR%"

REM Optional fast mode: skip readiness wait if SKIP_WAIT is set
if defined SKIP_WAIT goto api_ok

REM Wait up to 30s (configurable via WAIT_TRIES)
set /a tries=30
if defined WAIT_TRIES set /a tries=%WAIT_TRIES%
:wait_api
ping -n 2 127.0.0.1 >nul
curl -s http://127.0.0.1:8650/health >nul 2>nul && goto api_ok
set /a tries-=1
if !tries! GTR 0 goto wait_api
echo [api] TIMEOUT >> "%ERR%"
exit /b 1
:api_ok
echo [api] READY >> "%OUT%"
exit /b 0
