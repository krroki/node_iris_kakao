@echo off
chcp 65001 >nul
title IRIS 봇 관리 대시보드

echo 🤖 IRIS 봇 관리 대시보드
echo ================================
echo 📋 일반인을 위한 사용하기 쉬운 관리 인터페이스
echo 🌐 웹 브라우저에서 바로 사용 가능
echo ================================
echo.

echo 🚀 대시보드를 시작합니다...
echo 📱 웹 브라우저가 자동으로 열립니다...
echo.

cd /d "%~dp0"

python -m streamlit run dashboard/streamlit_dashboard.py --server.port 8501 --server.headless false --browser.gatherUsageStats false

pause