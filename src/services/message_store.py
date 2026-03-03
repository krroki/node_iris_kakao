"""IRIS 이벤트를 파일과 SQLite 데이터베이스로 보존하는 스토리지."""

from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from iris import ChatContext
except ImportError:  # pragma: no cover - 테스트에서 더미 객체 사용
    ChatContext = Any  # type: ignore


@dataclass
class ChatSnapshot:
    room_id: int
    room_name: str
    sender_id: int
    sender_name: str | None
    message_id: int | None
    message_text: str | None
    raw: Dict[str, Any] | None


class MessageStore:
    """이벤트별로 파일과 SQLite 데이터베이스에 저장한다."""

    def __init__(self, base_dir: Path, db_path: Optional[str] = None) -> None:
        self.base_dir = Path(base_dir)
        self.db_path = db_path or os.getenv("DATABASE_PATH", "data/messages.db")
        self._init_database()

    def _init_database(self) -> None:
        """SQLite 데이터베이스 초기화"""
        db_dir = Path(self.db_path).parent
        db_dir.mkdir(parents=True, exist_ok=True)

        with sqlite3.connect(self.db_path) as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS rooms (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY,
                    name TEXT,
                    profile_image TEXT,
                    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id INTEGER,
                    room_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    message_type TEXT NOT NULL DEFAULT 'message',
                    content TEXT,
                    attachment TEXT, -- JSON string
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    raw_data TEXT, -- JSON string
                    FOREIGN KEY (room_id) REFERENCES rooms (id),
                    FOREIGN KEY (user_id) REFERENCES users (id)
                );

                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    room_id INTEGER NOT NULL,
                    user_id INTEGER,
                    event_type TEXT NOT NULL,
                    event_data TEXT, -- JSON string
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (room_id) REFERENCES rooms (id),
                    FOREIGN KEY (user_id) REFERENCES users (id)
                );

                CREATE INDEX IF NOT EXISTS idx_messages_room_timestamp
                    ON messages (room_id, timestamp);

                CREATE INDEX IF NOT EXISTS idx_events_room_timestamp
                    ON events (room_id, timestamp);

                CREATE INDEX IF NOT EXISTS idx_messages_user_timestamp
                    ON messages (user_id, timestamp);
            """)

    def _ensure_dir(self, room_id: int) -> Path:
        room_dir = self.base_dir / str(room_id)
        room_dir.mkdir(parents=True, exist_ok=True)
        return room_dir

    @staticmethod
    def _snapshot(chat: ChatContext) -> ChatSnapshot:
        return ChatSnapshot(
            room_id=int(chat.room.id),
            room_name=str(getattr(chat.room, "name", "")),
            sender_id=int(chat.sender.id),
            sender_name=getattr(chat.sender, "name", None),
            message_id=int(getattr(chat.message, "id", 0)) if getattr(chat, "message", None) else None,
            message_text=getattr(chat.message, "msg", None) if getattr(chat, "message", None) else None,
            raw=getattr(chat, "raw", None),
        )

    def record(self, chat: ChatContext, payload: Dict[str, Any]) -> Path:
        """이벤트를 파일과 SQLite 데이터베이스에 저장한다."""
        snapshot = self._snapshot(chat)

        # 파일 저장 (기존 방식 유지)
        log_path = self._save_to_file(snapshot, payload)

        # 데이터베이스 저장
        try:
            self._save_to_database(snapshot, payload)
        except Exception as e:
            print(f"데이터베이스 저장 실패: {e}")

        return log_path

    def _save_to_file(self, snapshot: ChatSnapshot, payload: Dict[str, Any]) -> Path:
        """파일에 저장하는 기존 로직"""
        room_dir = self._ensure_dir(snapshot.room_id)
        filename = datetime.now(tz=timezone.utc).strftime("%Y-%m-%d") + ".log"
        log_path = room_dir / filename

        record = {
            "timestamp": datetime.now(tz=timezone.utc).isoformat(),
            "snapshot": asdict(snapshot),
            "payload": payload,
        }
        with log_path.open("a", encoding="utf-8") as fp:
            fp.write(json.dumps(record, ensure_ascii=False) + "\n")
        return log_path

    def _save_to_database(self, snapshot: ChatSnapshot, payload: Dict[str, Any]) -> None:
        """데이터베이스에 저장"""
        with sqlite3.connect(self.db_path) as conn:
            # 방 정보 저장/업데이트
            conn.execute("""
                INSERT OR REPLACE INTO rooms (id, name, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            """, (snapshot.room_id, snapshot.room_name))

            # 사용자 정보 저장/업데이트
            if snapshot.sender_id:
                conn.execute("""
                    INSERT OR REPLACE INTO users (id, name, last_seen)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                """, (snapshot.sender_id, snapshot.sender_name))

            # 이벤트 타입에 따라 다른 테이블에 저장
            event_type = payload.get("type", "unknown")

            if event_type == "message":
                # 메시지 테이블에 저장
                attachment_json = json.dumps(snapshot.raw.get("attachment", {})) if snapshot.raw else None
                raw_json = json.dumps(snapshot.raw) if snapshot.raw else None

                conn.execute("""
                    INSERT INTO messages (
                        message_id, room_id, user_id, message_type,
                        content, attachment, raw_data, timestamp
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    snapshot.message_id,
                    snapshot.room_id,
                    snapshot.sender_id,
                    "message",
                    snapshot.message_text,
                    attachment_json,
                    raw_json,
                    datetime.now(tz=timezone.utc).isoformat()
                ))
            else:
                # 이벤트 테이블에 저장
                event_data = {
                    "snapshot": asdict(snapshot),
                    "payload": payload
                }

                conn.execute("""
                    INSERT INTO events (
                        room_id, user_id, event_type, event_data, timestamp
                    ) VALUES (?, ?, ?, ?, ?)
                """, (
                    snapshot.room_id,
                    snapshot.sender_id,
                    event_type,
                    json.dumps(event_data, ensure_ascii=False),
                    datetime.now(tz=timezone.utc).isoformat()
                ))

    def get_messages(self, room_id: int, limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
        """특정 방의 메시지 조회"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("""
                SELECT m.*, u.name as user_name, r.name as room_name
                FROM messages m
                JOIN users u ON m.user_id = u.id
                JOIN rooms r ON m.room_id = r.id
                WHERE m.room_id = ?
                ORDER BY m.timestamp DESC
                LIMIT ? OFFSET ?
            """, (room_id, limit, offset))
            return [dict(row) for row in cursor.fetchall()]

    def get_events(self, room_id: int, event_type: str = None, limit: int = 100) -> List[Dict[str, Any]]:
        """특정 방의 이벤트 조회"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            if event_type:
                cursor = conn.execute("""
                    SELECT e.*, u.name as user_name, r.name as room_name
                    FROM events e
                    LEFT JOIN users u ON e.user_id = u.id
                    JOIN rooms r ON e.room_id = r.id
                    WHERE e.room_id = ? AND e.event_type = ?
                    ORDER BY e.timestamp DESC
                    LIMIT ?
                """, (room_id, event_type, limit))
            else:
                cursor = conn.execute("""
                    SELECT e.*, u.name as user_name, r.name as room_name
                    FROM events e
                    LEFT JOIN users u ON e.user_id = u.id
                    JOIN rooms r ON e.room_id = r.id
                    WHERE e.room_id = ?
                    ORDER BY e.timestamp DESC
                    LIMIT ?
                """, (room_id, limit))
            return [dict(row) for row in cursor.fetchall()]

    def get_room_stats(self, room_id: int) -> Dict[str, Any]:
        """방별 통계 정보 조회"""
        with sqlite3.connect(self.db_path) as conn:
            # 기본 정보
            room_info = conn.execute("""
                SELECT * FROM rooms WHERE id = ?
            """, (room_id,)).fetchone()

            # 메시지 수
            message_count = conn.execute("""
                SELECT COUNT(*) as count FROM messages WHERE room_id = ?
            """, (room_id,)).fetchone()[0]

            # 이벤트 수
            event_count = conn.execute("""
                SELECT COUNT(*) as count FROM events WHERE room_id = ?
            """, (room_id,)).fetchone()[0]

            # 활성 사용자 수
            active_users = conn.execute("""
                SELECT COUNT(DISTINCT user_id) as count FROM messages WHERE room_id = ?
            """, (room_id,)).fetchone()[0]

            # 최근 활동
            last_activity = conn.execute("""
                SELECT MAX(timestamp) as last_msg FROM messages WHERE room_id = ?
            """, (room_id,)).fetchone()[0]

            return {
                "room_info": dict(room_info) if room_info else None,
                "message_count": message_count,
                "event_count": event_count,
                "active_users": active_users,
                "last_activity": last_activity
            }

    def search_messages(self, room_id: int, query: str, limit: int = 50) -> List[Dict[str, Any]]:
        """메시지 내용 검색"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("""
                SELECT m.*, u.name as user_name, r.name as room_name
                FROM messages m
                JOIN users u ON m.user_id = u.id
                JOIN rooms r ON m.room_id = r.id
                WHERE m.room_id = ? AND (m.content LIKE ? OR m.raw_data LIKE ?)
                ORDER BY m.timestamp DESC
                LIMIT ?
            """, (room_id, f"%{query}%", f"%{query}%", limit))
            return [dict(row) for row in cursor.fetchall()]

    def get_recent_activity(self, hours: int = 24, limit: int = 100) -> List[Dict[str, Any]]:
        """최근 활동 조회"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("""
                SELECT 'message' as type, m.timestamp, m.content, u.name as user_name, r.name as room_name
                FROM messages m
                JOIN users u ON m.user_id = u.id
                JOIN rooms r ON m.room_id = r.id
                WHERE m.timestamp >= datetime('now', '-{} hours')
                UNION ALL
                SELECT 'event' as type, e.timestamp, e.event_type as content, u.name as user_name, r.name as room_name
                FROM events e
                LEFT JOIN users u ON e.user_id = u.id
                JOIN rooms r ON e.room_id = r.id
                WHERE e.timestamp >= datetime('now', '-{} hours')
                ORDER BY timestamp DESC
                LIMIT ?
            """.format(hours, hours), (limit,))
            return [dict(row) for row in cursor.fetchall()]
