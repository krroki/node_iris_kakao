@echo off
setlocal enabledelayedexpansion

REM Operator entrypoint: start_all.cmd (double-click / cmd convenience)
REM - start_all.ps1 is the implementation and is invoked by this wrapper (and watchdog).
REM - Pass-through args example:
REM     start_all.cmd -IrisUrl "http://127.0.0.1:5050" -ApiPort 8650 -WebPort 3100
REM   (Redroid/Hyper-V) portproxy가 아직 없으면 VM IP로 직접:
REM     start_all.cmd -IrisUrl "http://<REDROID_IP>:3000" -ApiPort 8650 -WebPort 3100

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_all.ps1" %*
exit /b %errorlevel%
