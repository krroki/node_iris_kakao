from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import requests

from src.utils.logger import get_service_logger, ServiceLogger


_DEFAULT_QUERY = {
    "query": "select enc,nickname,user_id,involved_chat_id from db2.open_chat_member",
    "bind": []
}


@dataclass
class NicknameWatcherConfig:
    """Configuration for nickname change detection."""

    base_url: str
    rooms: Optional[Iterable[str]] = None
    interval: float = 3.0
    timeout: float = 10.0
    api_token: Optional[str] = None
    message_template: str = "닉네임이 변경되었어요!\n{old} -> {new}"
    state_file: Path = Path("data/automation/nickname_watcher_state.json")
    query_payload: Dict[str, object] = field(default_factory=lambda: dict(_DEFAULT_QUERY))

    def __post_init__(self) -> None:
        if not self.base_url:
            raise ValueError("base_url must be provided")
        self.base_url = self.base_url.rstrip("/")
        if self.rooms is not None:
            self.rooms = [str(room) for room in self.rooms]
        self.state_file = Path(self.state_file)


@dataclass
class NicknameChange:
    """Represents a nickname change event."""

    user_id: str
    room_id: str
    old_nickname: str
    new_nickname: str


class NicknameWatcher:
    """Detects and reports nickname changes using IRIS HTTP endpoints."""

    def __init__(
        self,
        config: NicknameWatcherConfig,
        session: Optional[requests.Session] = None,
        logger: Optional[ServiceLogger] = None,
    ) -> None:
        self.config = config
        self.session = session or requests.Session()
        self.logger = logger or get_service_logger("nickname_watcher")
        self._state: Dict[str, Dict[str, str]] = {}
        self._running = False
        self._load_state()

    # ------------------------------------------------------------------
    # Public control methods
    # ------------------------------------------------------------------
    def start(self) -> None:
        """Start the watcher loop until :meth:`stop` is called."""
        if self._running:
            return
        self._running = True
        self.logger.info("닉네임 감시 시작")
        try:
            while self._running:
                self.run_once()
                time.sleep(self.config.interval)
        finally:
            self.logger.info("닉네임 감시 종료")

    def stop(self) -> None:
        """Signal the watcher loop to stop."""
        self._running = False

    def run_once(self) -> List[NicknameChange]:
        """Fetch members, detect changes, notify, and persist state."""
        members = self._fetch_members()
        changes = self._detect_changes(members)
        for change in changes:
            if not self._should_notify(change.room_id):
                self.logger.debug(
                    "방 필터로 인해 알림 제외",
                    user_id=change.user_id,
                    room_id=change.room_id,
                )
                continue
            self._send_notification(change)
        self._state = members
        self._save_state()
        return changes

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _headers(self) -> Dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.config.api_token:
            headers["Authorization"] = f"Bearer {self.config.api_token}"
        return headers

    def _fetch_members(self) -> Dict[str, Dict[str, str]]:
        url = f"{self.config.base_url}/query"
        response = self.session.post(
            url,
            headers=self._headers(),
            json=self.config.query_payload,
            timeout=self.config.timeout,
        )
        response.raise_for_status()
        payload = response.json()
        data = payload.get("data", [])
        members: Dict[str, Dict[str, str]] = {}
        for item in data:
            user_id = str(item.get("user_id", ""))
            nickname = str(item.get("nickname", ""))
            room_id = str(item.get("involved_chat_id", ""))
            if user_id:
                members[user_id] = {"nickname": nickname, "room_id": room_id}
        return members

    def _detect_changes(self, members: Dict[str, Dict[str, str]]) -> List[NicknameChange]:
        changes: List[NicknameChange] = []
        for user_id, info in members.items():
            previous = self._state.get(user_id)
            if not previous:
                continue
            if previous.get("nickname") != info.get("nickname"):
                changes.append(
                    NicknameChange(
                        user_id=user_id,
                        room_id=info.get("room_id", ""),
                        old_nickname=previous.get("nickname", ""),
                        new_nickname=info.get("nickname", ""),
                    )
                )
        return changes

    def _should_notify(self, room_id: str) -> bool:
        if not room_id:
            return False
        if self.config.rooms is None:
            return True
        return room_id in self.config.rooms

    def _send_notification(self, change: NicknameChange) -> None:
        message = self.config.message_template.format(
            old=change.old_nickname,
            new=change.new_nickname,
            user_id=change.user_id,
            room_id=change.room_id,
        )
        payload = {
            "type": "text",
            "room": change.room_id,
            "data": message,
        }
        url = f"{self.config.base_url}/reply"
        try:
            response = self.session.post(
                url,
                headers=self._headers(),
                json=payload,
                timeout=self.config.timeout,
            )
            response.raise_for_status()
            self.logger.info(
                "닉네임 변경 알림 전송",
                user_id=change.user_id,
                room_id=change.room_id,
                old_nickname=change.old_nickname,
                new_nickname=change.new_nickname,
            )
        except Exception as exc:  # noqa: BLE001
            self.logger.error(
                "알림 전송 실패",
                user_id=change.user_id,
                room_id=change.room_id,
                error=str(exc),
            )

    # ------------------------------------------------------------------
    # State persistence helpers
    # ------------------------------------------------------------------
    def _load_state(self) -> None:
        path = self.config.state_file
        if not path.exists():
            self._state = {}
            return
        try:
            self._state = json.loads(path.read_text("utf-8"))
        except json.JSONDecodeError:
            self.logger.warning("상태 파일을 읽을 수 없습니다. 새로 생성합니다.", path=str(path))
            self._state = {}

    def _save_state(self) -> None:
        path = self.config.state_file
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self._state, ensure_ascii=False, indent=2), encoding="utf-8")


__all__ = [
    "NicknameWatcherConfig",
    "NicknameWatcher",
    "NicknameChange",
]
