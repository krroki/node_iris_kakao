"""방 관리 서비스 - 자동 감지 기반 방 등록 시스템"""

import json
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Set

from src.utils.logger import get_service_logger

class RoomManager:
    """방 관리자 - 자동 감지 및 관리 기능"""

    def __init__(self, db_path: str = None):
        self.db_path = db_path or "data/rooms.db"
        self.logger = get_service_logger("room_manager")
        self.monitored_rooms: Set[int] = set()
        self._init_database()

    def _init_database(self):
        """방 관리 데이터베이스 초기화"""
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)

        with sqlite3.connect(self.db_path) as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS room_registry (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    auto_welcome_enabled BOOLEAN DEFAULT 1,
                    welcome_template TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS room_settings (
                    room_id INTEGER PRIMARY KEY,
                    settings_json TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (room_id) REFERENCES room_registry (id)
                );

                CREATE INDEX IF NOT EXISTS idx_room_status ON room_registry (status);
                CREATE INDEX IF NOT EXISTS idx_room_activity ON room_registry (last_activity);
            """)

    def auto_register_room(self, room_id: int, room_name: str, initial_settings: Dict = None) -> bool:
        """방 자동 등록 (IRIS 이벤트 수신 시)"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                # 이미 등록된 방인지 확인
                existing = conn.execute(
                    "SELECT id FROM room_registry WHERE id = ?", (room_id,)
                ).fetchone()

                if existing:
                    # 마지막 활동 시간 업데이트
                    conn.execute(
                        "UPDATE room_registry SET last_activity = CURRENT_TIMESTAMP WHERE id = ?",
                        (room_id,)
                    )
                    self.logger.info(f"방 활동 업데이트: {room_id} ({room_name})")
                else:
                    # 신규 방 등록
                    conn.execute("""
                        INSERT INTO room_registry (id, name, status)
                        VALUES (?, ?, 'active')
                    """, (room_id, room_name))

                    # 초기 설정 저장
                    if initial_settings:
                        conn.execute("""
                            INSERT INTO room_settings (room_id, settings_json)
                            VALUES (?, ?)
                        """, (room_id, json.dumps(initial_settings)))

                    self.logger.info(f"신규 방 등록: {room_id} ({room_name})")

                self.monitored_rooms.add(room_id)
                return True

        except Exception as e:
            self.logger.log_error_with_context(
                error=e,
                context={"operation": "auto_register_room", "room_id": room_id}
            )
            return False

    def get_active_rooms(self) -> List[Dict]:
        """활성 방 목록 조회"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute("""
                    SELECT r.*, s.settings_json
                    FROM room_registry r
                    LEFT JOIN room_settings s ON r.id = s.room_id
                    WHERE r.status = 'active'
                    ORDER BY r.last_activity DESC
                """)
                return [dict(row) for row in cursor.fetchall()]
        except Exception as e:
            self.logger.error(f"활성 방 조회 실패: {e}")
            return []

    def update_room_settings(self, room_id: int, settings: Dict) -> bool:
        """방 설정 업데이트"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO room_settings (room_id, settings_json)
                    VALUES (?, ?)
                """, (room_id, json.dumps(settings)))

                conn.execute(
                    "UPDATE room_registry SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (room_id,)
                )

                self.logger.info(f"방 설정 업데이트: {room_id}")
                return True

        except Exception as e:
            self.logger.error(f"방 설정 업데이트 실패: {e}")
            return False

    def deactivate_room(self, room_id: int) -> bool:
        """방 비활성화 (방 나가감 등)"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute(
                    "UPDATE room_registry SET status = 'inactive' WHERE id = ?",
                    (room_id,)
                )

                self.monitored_rooms.discard(room_id)
                self.logger.info(f"방 비활성화: {room_id}")
                return True

        except Exception as e:
            self.logger.error(f"방 비활성화 실패: {e}")
            return False

    def get_room_stats(self) -> Dict:
        """방 관리 통계"""
        try:
            with sqlite3.connect(self.db_path) as conn:
                total_rooms = conn.execute("SELECT COUNT(*) FROM room_registry").fetchone()[0]
                active_rooms = conn.execute("SELECT COUNT(*) FROM room_registry WHERE status = 'active'").fetchone()[0]

                # 오늘 등록된 방 수
                today_rooms = conn.execute("""
                    SELECT COUNT(*) FROM room_registry
                    WHERE DATE(created_at) = DATE('now')
                """).fetchone()[0]

                return {
                    "total_rooms": total_rooms,
                    "active_rooms": active_rooms,
                    "inactive_rooms": total_rooms - active_rooms,
                    "today_registered": today_rooms,
                    "monitored_rooms": len(self.monitored_rooms)
                }
        except Exception as e:
            self.logger.error(f"통계 조회 실패: {e}")
            return {}

    def import_rooms_from_config(self, config_file: str) -> int:
        """설정 파일에서 방 정보 가져오기"""
        try:
            config_path = Path(config_file)
            if not config_path.exists():
                self.logger.warning(f"설정 파일 없음: {config_file}")
                return 0

            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)

            imported = 0
            for room_data in config.get('rooms', []):
                room_id = room_data.get('id')
                room_name = room_data.get('name')
                settings = room_data.get('settings', {})

                if room_id and room_name:
                    if self.auto_register_room(room_id, room_name, settings):
                        imported += 1

            self.logger.info(f"설정 파일에서 {imported}개 방 가져오기 완료")
            return imported

        except Exception as e:
            self.logger.error(f"설정 파일 가져오기 실패: {e}")
            return 0

    def export_rooms_to_config(self, config_file: str) -> bool:
        """방 정보를 설정 파일로 내보내기"""
        try:
            rooms = self.get_active_rooms()
            config_data = {
                "rooms": [
                    {
                        "id": room["id"],
                        "name": room["name"],
                        "settings": json.loads(room.get("settings_json", "{}"))
                    }
                    for room in rooms
                ],
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "total_count": len(rooms)
            }

            config_path = Path(config_file)
            config_path.parent.mkdir(parents=True, exist_ok=True)

            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(config_data, f, ensure_ascii=False, indent=2)

            self.logger.info(f"{len(rooms)}개 방 정보 내보내기 완료: {config_file}")
            return True

        except Exception as e:
            self.logger.error(f"설정 파일 내보내기 실패: {e}")
            return False


# 샘플 설정 파일 생성
def create_sample_room_config():
    """샘플 방 설정 파일 생성"""
    sample_config = {
        "rooms": [
            {
                "id": 1001,
                "name": "메인 채팅방",
                "settings": {
                    "auto_welcome": True,
                    "welcome_template": "default",
                    "logging_enabled": True
                }
            },
            {
                "id": 1002,
                "name": "공지사항 방",
                "settings": {
                    "auto_welcome": False,
                    "read_only": True
                }
            }
        ]
    }

    config_dir = Path("config")
    config_dir.mkdir(exist_ok=True)

    with open(config_dir / "rooms.json", 'w', encoding='utf-8') as f:
        json.dump(sample_config, f, ensure_ascii=False, indent=2)

    print("✅ 샘플 방 설정 파일 생성: config/rooms.json")


if __name__ == "__main__":
    # 샘플 설정 파일 생성
    create_sample_room_config()

    # RoomManager 테스트
    manager = RoomManager()

    # 샘플 설정에서 방 가져오기
    imported = manager.import_rooms_from_config("config/rooms.json")
    print(f"✅ {imported}개 방 가져오기 완료")

    # 활성 방 목록 확인
    active_rooms = manager.get_active_rooms()
    print(f"✅ 현재 활성 방: {len(active_rooms)}개")

    # 통계 정보 확인
    stats = manager.get_room_stats()
    print(f"✅ 방 관리 통계: {stats}")