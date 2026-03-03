from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from src.services.automation.nickname_watcher import (
    NicknameChange,
    NicknameWatcher,
    NicknameWatcherConfig,
)
from src.utils.logger import get_service_logger


class DummyResponse:
    def __init__(self, json_data: Dict[str, Any], status_code: int = 200) -> None:
        self._json = json_data
        self.status_code = status_code

    def json(self) -> Dict[str, Any]:
        return self._json

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class DummySession:
    def __init__(self, query_rows: List[Dict[str, Any]]) -> None:
        self.query_rows = query_rows
        self.reply_payloads: List[Dict[str, Any]] = []
        self.calls: List[str] = []

    def post(self, url: str, headers: Dict[str, Any] = None, json: Dict[str, Any] = None, timeout: float = 0) -> DummyResponse:
        self.calls.append(url)
        if url.endswith("/query"):
            return DummyResponse({"data": self.query_rows})
        if url.endswith("/reply"):
            assert json is not None
            self.reply_payloads.append(json)
            return DummyResponse({})
        return DummyResponse({}, status_code=404)


def write_state(path: Path, data: Dict[str, Any]) -> None:
    path.write_text(json.dumps(data), encoding="utf-8")


def read_state(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text("utf-8"))


def test_run_once_detects_change_and_notifies(tmp_path: Path) -> None:
    state_file = tmp_path / "state.json"
    write_state(state_file, {"42": {"nickname": "old", "room_id": "123"}})

    session = DummySession([
        {"user_id": "42", "nickname": "new", "involved_chat_id": "123"},
        {"user_id": "43", "nickname": "stay", "involved_chat_id": "123"},
    ])
    config = NicknameWatcherConfig(
        base_url="http://example.com",
        rooms=["123"],
        interval=0.1,
        state_file=state_file,
    )
    watcher = NicknameWatcher(config, session=session, logger=get_service_logger("nickname_watcher_test"))

    changes = watcher.run_once()

    assert len(changes) == 1
    change: NicknameChange = changes[0]
    assert change.old_nickname == "old"
    assert change.new_nickname == "new"
    assert session.reply_payloads
    payload = session.reply_payloads[0]
    assert payload["room"] == "123"
    assert "old -> new" in payload["data"]
    saved = read_state(state_file)
    assert saved["42"]["nickname"] == "new"


def test_run_once_skips_rooms_not_in_filter(tmp_path: Path) -> None:
    state_file = tmp_path / "state.json"
    write_state(state_file, {"42": {"nickname": "old", "room_id": "999"}})

    session = DummySession([
        {"user_id": "42", "nickname": "new", "involved_chat_id": "999"},
    ])
    config = NicknameWatcherConfig(
        base_url="http://example.com",
        rooms=["123"],
        interval=0.1,
        state_file=state_file,
    )
    watcher = NicknameWatcher(config, session=session, logger=get_service_logger("nickname_watcher_test"))

    changes = watcher.run_once()

    assert len(changes) == 1  # 감지는 되지만 알림은 전송되지 않는다
    assert session.reply_payloads == []


def test_run_once_handles_first_snapshot(tmp_path: Path) -> None:
    state_file = tmp_path / "state.json"
    session = DummySession([
        {"user_id": "42", "nickname": "init", "involved_chat_id": "123"},
    ])
    config = NicknameWatcherConfig(
        base_url="http://example.com",
        rooms=None,
        interval=0.1,
        state_file=state_file,
    )
    watcher = NicknameWatcher(config, session=session, logger=get_service_logger("nickname_watcher_test"))

    changes = watcher.run_once()

    assert changes == []
    saved = read_state(state_file)
    assert saved["42"]["nickname"] == "init"
