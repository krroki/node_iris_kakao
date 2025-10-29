from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.services.message_store import MessageStore


class DummyChat:
    def __init__(self, room_id: int, sender_id: int, message_id: int, name: str = "room") -> None:
        self.room = type("Room", (), {"id": room_id, "name": name})()
        self.sender = type("Sender", (), {"id": sender_id, "name": "tester"})()
        self.message = type("Message", (), {"id": message_id, "msg": "hello", "attachment": {}})()
        self.raw = {"dummy": True}


@pytest.fixture()
def temp_dir(tmp_path: Path) -> Path:
    return tmp_path


def test_message_store_creates_daily_log(temp_dir: Path) -> None:
    store = MessageStore(temp_dir)
    chat = DummyChat(room_id=1234, sender_id=99, message_id=555)

    log_path = store.record(chat, {"type": "message"})

    assert log_path.exists()
    lines = log_path.read_text("utf-8").strip().splitlines()
    assert len(lines) == 1
    payload = json.loads(lines[0])
    assert payload["payload"]["type"] == "message"
    assert payload["snapshot"]["room_id"] == 1234
