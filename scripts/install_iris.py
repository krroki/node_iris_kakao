#!/usr/bin/env python3
"""
IRIS 설치 스크립트
네이버 카페에서 수집한 정보를 바탕으로 IRIS 설치
"""

import os
import subprocess
import sys
from pathlib import Path

def check_python_version():
    """Python 버전 확인"""
    version = sys.version_info
    print(f"Python 버전: {version.major}.{version.minor}.{version.micro}")

    if version < (3, 8):
        print("❌ IRIS는 Python 3.8 이상이 필요합니다.")
        return False

    print("✅ Python 버전 요구사항 충족")
    return True

def install_dependencies():
    """기본 의존성 설치"""
    print("🔄 기본 의존성 설치...")

    try:
        # requirements.txt가 있다면 사용
        if Path("requirements.txt").exists():
            subprocess.run([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"], check=True)
        else:
            # 기본 패키지 설치
            packages = [
                "websockets",
                "aiohttp",
                "python-dotenv",
                "pydantic",
                "asyncio-mqtt"
            ]
            for package in packages:
                print(f"  📦 {package} 설치...")
                subprocess.run([sys.executable, "-m", "pip", "install", package], check=True)

        print("✅ 기본 의존성 설치 완료")
        return True

    except subprocess.CalledProcessError as e:
        print(f"❌ 의존성 설치 실패: {e}")
        return False

def create_iris_mock():
    """IRIS 라이브러리 모킹 클래스 생성 (실제 IRIS 설치 전까지)"""
    print("🔄 IRIS 모킹 클래스 생성...")

    iris_dir = Path("iris")
    iris_dir.mkdir(exist_ok=True)

    # __init__.py 생성
    init_content = '''"""IRIS 라이브러리 모킹 - 실제 IRIS 설치 전까지 사용"""

from typing import Any, Dict, List, Optional
import asyncio
import json
import logging


class ChatContext:
    """채팅 컨텍스트 모킹 클래스"""

    def __init__(self, room_data: Dict[str, Any], sender_data: Dict[str, Any], message_data: Dict[str, Any]):
        self.room = type('Room', (), room_data)()
        self.sender = type('Sender', (), sender_data)()
        self.message = type('Message', (), message_data)()
        self.raw = {"mock": True}

    def reply(self, text: str) -> None:
        """메시지 응답 모킹"""
        logger = logging.getLogger(__name__)
        logger.info(f"[MOCK] Reply to {self.room.name}: {text}")


class Message:
    """메시지 클래스 모킹"""

    def __init__(self, msg: str, attachment: Dict[str, Any] = None):
        self.msg = msg
        self.attachment = attachment or {}


class Bot:
    """IRIS Bot 모킹 클래스"""

    def __init__(self, iris_url: str):
        self.iris_url = iris_url
        self.handlers = {}
        self.logger = logging.getLogger(__name__)

        # URL 형식 검증
        try:
            host, port = iris_url.split(':')
            port = int(port)
            if not (0 < port < 65536):
                raise ValueError("Invalid port")
        except (ValueError, AttributeError):
            raise ValueError(f"Invalid IRIS URL format: {iris_url}")

    def on_event(self, event_type: str):
        """이벤트 핸들러 데코이터"""
        def decorator(func):
            if event_type not in self.handlers:
                self.handlers[event_type] = []
            self.handlers[event_type].append(func)
            return func
        return decorator

    def run(self):
        """봇 실행 모킹"""
        self.logger.info(f"[MOCK] IRIS Bot started on {self.iris_url}")
        self.logger.info(f"[MOCK] Registered handlers: {list(self.handlers.keys())}")

        # 샘플 이벤트 생성 (테스트용)
        self._generate_mock_events()

    def _generate_mock_events(self):
        """테스트용 모킹 이벤트 생성"""
        # 샘플 채팅 컨텍스트 생성
        room_data = {"id": 1000, "name": "test-room"}
        sender_data = {"id": 500, "name": "test-user"}
        message_data = Message("테스트 메시지")

        chat = ChatContext(room_data, sender_data, message_data)

        # 이벤트 핸들러 호출
        for event_type, handlers in self.handlers.items():
            self.logger.info(f"[MOCK] Triggering {event_type} event")
            for handler in handlers:
                try:
                    handler(chat)
                except Exception as e:
                    self.logger.error(f"[MOCK] Handler error: {e}")
'''

    with open(iris_dir / "__init__.py", "w", encoding="utf-8") as f:
        f.write(init_content)

    print("✅ IRIS 모킹 클래스 생성 완료")
    print("📝 참고: 이는 개발용 모킹 클래스입니다. 실제 IRIS 설치가 필요합니다.")
    print("📖 카페 게시물 '25년 7월 기준 Iris 설치 방법'을 참조하세요.")

def setup_directory_structure():
    """필요한 디렉터리 구조 생성"""
    print("🔄 디렉터리 구조 생성...")

    directories = [
        "logs",
        "data",
        "config/templates/welcome",
        "src/services",
        "tests"
    ]

    for directory in directories:
        Path(directory).mkdir(parents=True, exist_ok=True)
        print(f"  📁 {directory}")

    print("✅ 디렉터리 구조 생성 완료")

def main():
    """메인 설치 함수"""
    print("🚀 IRIS 개발 환경 설치 시작")

    # Python 버전 확인
    if not check_python_version():
        return False

    # 디렉터리 구조 생성
    setup_directory_structure()

    # 의존성 설치
    if not install_dependencies():
        return False

    # IRIS 모킹 클래스 생성
    create_iris_mock()

    print("\n✅ IRIS 개발 환경 설치 완료!")
    print("\n📋 다음 단계:")
    print("1. 실제 IRIS 라이브러리 설치 (카페 참조)")
    print("2. LDPlayer 설치 및 설정")
    print("3. 환경변수 설정 확인")
    print("4. python -m src.bot.main --dry-run 실행")

    return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)