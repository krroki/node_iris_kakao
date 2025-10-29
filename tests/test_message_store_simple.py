from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from src.services.message_store import ChatSnapshot, MessageStore


def test_message_store_creates_expected_tables(tmp_path: Path) -> None:
    db_path = tmp_path / "messages.db"
    MessageStore(tmp_path, str(db_path))

    with sqlite3.connect(db_path) as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}

    assert {"rooms", "users", "messages", "events"}.issubset(tables)


def test_message_store_writes_file_logs(tmp_path: Path) -> None:
    store = MessageStore(tmp_path)
    snapshot = ChatSnapshot(
        room_id=1001,
        room_name="test-room",
        sender_id=5001,
        sender_name="tester",
        message_id=12345,
        message_text="hello world",
        raw={"example": True},
    )

    log_path = store._save_to_file(snapshot, {"type": "message"})
    assert log_path.exists()

    payload = json.loads(log_path.read_text(encoding="utf-8"))
    assert payload["snapshot"]["room_id"] == 1001
    assert payload["payload"]["type"] == "message"
