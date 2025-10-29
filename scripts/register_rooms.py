#!/usr/bin/env python3
"""
IRIS API 기반 방 등록 스크립트
IRIS가 자동으로 감지하는 방들을 시스템에 등록
"""

import os
import sys
import time
from pathlib import Path

# 상위 디렉터리를 path에 추가
sys.path.append(str(Path(__file__).parent.parent))

from dotenv import load_dotenv
from src.services.room_manager import RoomManager
from src.services.message_store import MessageStore
from src.utils.logger import get_service_logger

load_dotenv('config/local.env')

def discover_rooms_via_iris():
    """IRIS를 통해 방 자동 발견"""
    logger = get_service_logger("room_discovery")
    manager = RoomManager()

    logger.info("IRIS 방 자동 발견 시작...")

    # 실제 IRIS 연결 시나리오
    try:
        from iris import Bot

        iris_url = os.getenv("IRIS_URL", "http://localhost:8765")
        bot = Bot(iris_url)

        # IRIS에서 방 정보 가져오기 (IRIS API 사용)
        # Note: 실제 IRIS API 메서드에 맞게 수정 필요
        logger.info("IRIS API에서 방 정보 조회...")

        # 샘플 방 데이터 (실제로는 IRIS API에서 가져옴)
        sample_rooms = [
            {"id": 1001, "name": "테스트 채팅방 1"},
            {"id": 1002, "name": "테스트 채팅방 2"},
            {"id": 1003, "name": "공지사항 방"},
        ]

        registered_count = 0
        for room in sample_rooms:
            if manager.auto_register_room(room["id"], room["name"]):
                registered_count += 1
                logger.info(f"방 등록 완료: {room['id']} - {room['name']}")

        logger.info(f"총 {registered_count}개 방 등록 완료")
        return registered_count

    except ImportError:
        logger.error("IRIS 라이브러리를 찾을 수 없습니다")
        return 0
    except Exception as e:
        logger.error(f"IRIS 방 발견 실패: {e}")
        return 0

def manual_room_registration():
    """수동 방 등록"""
    logger = get_service_logger("manual_registration")
    manager = RoomManager()

    print("🔧 수동 방 등록 시스템")
    print("등록할 방 정보를 입력하세요.")

    registered_rooms = []

    while True:
        try:
            room_id = input("\n방 ID (숫자, 종료하려면 엔터): ").strip()
            if not room_id:
                break

            room_id = int(room_id)
            room_name = input("방 이름: ").strip()

            if not room_name:
                print("⚠️ 방 이름은 필수입니다.")
                continue

            # 방 등록
            if manager.auto_register_room(room_id, room_name):
                registered_rooms.append({"id": room_id, "name": room_name})
                print(f"✅ 방 등록 완료: {room_id} - {room_name}")
            else:
                print(f"❌ 방 등록 실패: {room_id}")

        except ValueError:
            print("⚠️ 방 ID는 숫자여야 합니다.")
        except KeyboardInterrupt:
            print("\n취소되었습니다.")
            break

    if registered_rooms:
        print(f"\n✅ 총 {len(registered_rooms)}개 방 수동 등록 완료:")
        for room in registered_rooms:
            print(f"  - {room['id']}: {room['name']}")

    return len(registered_rooms)

def bulk_room_registration(room_list_file: str):
    """대량 방 등록 (파일에서)"""
    logger = get_service_logger("bulk_registration")
    manager = RoomManager()

    try:
        with open(room_list_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        registered_count = 0
        for line_num, line in enumerate(lines, 1):
            line = line.strip()
            if not line or line.startswith('#'):
                continue

            parts = line.split(',', 2)  # id,name,settings
            if len(parts) >= 2:
                try:
                    room_id = int(parts[0].strip())
                    room_name = parts[1].strip()

                    if manager.auto_register_room(room_id, room_name):
                        registered_count += 1
                        logger.info(f"대량 등록 완료 ({line_num}): {room_id} - {room_name}")
                    else:
                        logger.warning(f"대량 등록 실패 ({line_num}): {room_id}")

                except ValueError as e:
                    logger.warning(f"잘못은 형식 ({line_num}): {line}")

        logger.info(f"대량 등록 완료: 총 {registered_count}개 방")
        return registered_count

    except FileNotFoundError:
        logger.error(f"파일을 찾을 수 없습니다: {room_list_file}")
        return 0
    except Exception as e:
        logger.error(f"대량 등록 실패: {e}")
        return 0

def show_room_status():
    """현재 등록된 방 상태 보기"""
    manager = RoomManager()

    print("📋 현재 등록된 방 목록:")
    print("=" * 60)

    rooms = manager.get_active_rooms()
    if rooms:
        for room in rooms:
            settings = json.loads(room.get('settings_json', '{}'))
            status = "🟢 활성" if room['status'] == 'active' else "🔴 비활성"
            auto_welcome = "✅" if settings.get('auto_welcome', False) else "❌"

            print(f"{status} ID: {room['id']}")
            print(f"    이름: {room['name']}")
            print(f"    자동 환영: {auto_welcome}")
            print(f"    마지막 활동: {room['last_activity']}")
            print("-" * 40)
    else:
        print("등록된 방이 없습니다.")

    # 통계 정보
    stats = manager.get_room_stats()
    print(f"\n📊 통계: {stats}")

def main():
    """메인 함수"""
    print("🚀 방 등록 시스템")
    print("1. IRIS 자동 발견")
    print("2. 수동 등록")
    print("3. 대량 등록 (파일)")
    print("4. 방 상태 확인")
    print("5. 설정 파일에서 가져오기")
    print("6. 내보내기")

    choice = input("\n선택하세요 (1-6): ").strip()

    if choice == "1":
        discover_rooms_via_iris()
    elif choice == "2":
        manual_room_registration()
    elif choice == "3":
        file_path = input("방 목록 파일 경로: ").strip()
        bulk_room_registration(file_path)
    elif choice == "4":
        show_room_status()
    elif choice == "5":
        config_file = input("설정 파일 경로 (기본: config/rooms.json): ").strip()
        if not config_file:
            config_file = "config/rooms.json"
        manager = RoomManager()
        manager.import_rooms_from_config(config_file)
    elif choice == "6":
        config_file = input("내보낼 파일 경로 (기본: config/rooms_backup.json): ").strip()
        if not config_file:
            config_file = "config/rooms_backup.json"
        manager = RoomManager()
        manager.export_rooms_to_config(config_file)
    else:
        print("잘못된 선택입니다.")

if __name__ == "__main__":
    main()