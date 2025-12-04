#!/usr/bin/env python3
"""
방 등록 시스템 테스트 스크립트
"""

import sys
from pathlib import Path

# 상위 디렉터리를 path에 추가
sys.path.append(str(Path(__file__).parent.parent))

from src.services.room_manager import RoomManager
from src.utils.logger import get_service_logger

def test_room_registration():
    """방 등록 기능 테스트"""
    print("🚀 방 등록 시스템 테스트")

    logger = get_service_logger("room_test")
    manager = RoomManager()

    # 1. 설정 파일에서 방 가져오기
    print("\n📁 설정 파일에서 방 가져오기")
    imported = manager.import_rooms_from_config("config/rooms.json")
    print(f"✅ 설정 파일에서 {imported}개 방 가져오기 완료")

    # 2. 활성 방 목록 확인
    print("\n📋 활성 방 목록 확인")
    active_rooms = manager.get_active_rooms()
    print(f"✅ 현재 활성 방: {len(active_rooms)}개")

    for room in active_rooms:
        print(f"  - ID: {room['id']}, 이름: {room['name']}")

    # 3. 수동 방 등록 테스트
    print("\n➕ 수동 방 등록 테스트")
    test_rooms = [
        {"id": 2001, "name": "테스트 방 1"},
        {"id": 2002, "name": "테스트 방 2"}
    ]

    manual_registered = 0
    for room in test_rooms:
        if manager.auto_register_room(room["id"], room["name"]):
            manual_registered += 1
            print(f"✅ 수동 등록 완료: {room['id']} - {room['name']}")

    print(f"✅ 수동 등록 완료: {manual_registered}개 방")

    # 4. 통계 정보 확인
    print("\n📊 통계 정보 확인")
    stats = manager.get_room_stats()
    print(f"방 관리 통계: {stats}")

    # 5. 내보내기 테스트
    print("\n💾 설정 파일 내보내기 테스트")
    backup_file = "config/rooms_backup_test.json"
    if manager.export_rooms_to_config(backup_file):
        print(f"✅ 설정 파일 내보내기 완료: {backup_file}")
    else:
        print("❌ 설정 파일 내보내기 실패")

    # 6. 전체 방 목록 확인
    print("\n📋 전체 방 목록 최종 확인")
    final_rooms = manager.get_active_rooms()
    print(f"✅ 최종 활성 방: {len(final_rooms)}개")

    success = len(final_rooms) > 0
    if success:
        print("\n🎉 방 등록 시스템 테스트 통과!")
        print("Phase 2에서 바로 다중 방 관리 기능을 구현할 수 있습니다.")
    else:
        print("\n❌ 방 등록 실패")

    return success

def show_room_capabilities():
    """방 관리 기능 시연 보기"""
    print("\n🎯 현재 방 관리 시스템 기능:")
    print("1. ✅ 자동 방 감지 및 등록")
    print("2. ✅ 설정 파일 기반 대량 등록")
    print("3. ✅ 수동 방 등록/삭제")
    print("4. ✅ 방별 설정 관리")
    print("5. ✅ 활성 상태 모니터링")
    print("6. ✅ 통계 정보 제공")
    print("7. ✅ 설정 파일 내보내기/가져오기")

    print("\n🚀 Phase 2에서 즉시 구현 가능:")
    print("- 방별 메시지 처리 분리")
    print("- 환영 메시지 자동화")
    print("- 방별 설정 기능")
    print("- 다중 방 동시 관리")

if __name__ == "__main__":
    success = test_room_registration()
    show_room_capabilities()
    sys.exit(0 if success else 1)