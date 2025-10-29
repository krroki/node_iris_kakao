#!/usr/bin/env python3
"""
IRIS 봇 관리 대시보드 실행 스크립트
일반인을 위한 사용하기 쉬운 GUI 관리 도구
"""

import os
import sys
import time
import webbrowser
from pathlib import Path

# 상위 디렉터리를 path에 추가
sys.path.append(str(Path(__file__).parent.parent))

def check_dependencies():
    """의존성 확인"""
    try:
        import streamlit
        import pandas
        import plotly
        return True
    except ImportError as e:
        print(f"❌ 필수 라이브러리가 설치되지 않았습니다: {e}")
        print("📦 다음 명령어로 설치해주세요:")
        print("   pip install -r dashboard/requirements.txt")
        return False

def start_dashboard():
    """대시보드 시작"""
    if not check_dependencies():
        return False

    # 대시보드 파일 경로
    dashboard_path = Path(__file__).parent.parent / "dashboard" / "streamlit_dashboard.py"

    if not dashboard_path.exists():
        print(f"❌ 대시보드 파일을 찾을 수 없습니다: {dashboard_path}")
        return False

    print("🚀 IRIS 봇 관리 대시보드를 시작합니다...")
    print("📱 웹 브라우저에서 자동으로 열립니다...")
    print("🔄 사용이 끝나면 브라우저 탭을 닫아주세요")

    # 잠시 대기 후 브라우저 열기
    def open_browser():
        time.sleep(3)
        webbrowser.open("http://localhost:8501")

    # 브라우저 열기 스레드 시작
    import threading
    browser_thread = threading.Thread(target=open_browser)
    browser_thread.daemon = True
    browser_thread.start()

    # Streamlit 실행
    try:
        import subprocess
        subprocess.run([
            sys.executable, "-m", "streamlit", "run",
            str(dashboard_path),
            "--server.port", "8501",
            "--server.headless", "false",
            "--browser.gatherUsageStats", "false"
        ])
    except KeyboardInterrupt:
        print("\n✅ 대시보드를 종료합니다")
        return True
    except Exception as e:
        print(f"❌ 대시보드 실행 실패: {e}")
        return False

def main():
    """메인 함수"""
    print("🤖 IRIS 봇 관리 대시보드")
    print("=" * 50)
    print("📋 일반인을 위한 사용하기 쉬운 관리 인터페이스")
    print("🌐 웹 브라우저 기반의 직관적인 UI")
    print("=" * 50)

    # 바로 시작
    print("\n🚀 대시보드를 자동으로 시작합니다...")
    start_dashboard()

if __name__ == "__main__":
    main()