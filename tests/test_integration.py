from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

from src.bot.main import IRISConnectionManager
from src.services.message_store import MessageStore
from src.utils.logger import get_service_logger

PROJECT_ROOT = Path(__file__).parent.parent


def test_core_components_importable() -> None:
    logger = get_service_logger("integration_smoke")
    assert logger is not None

    manager = IRISConnectionManager("127.0.0.1:3000")
    assert manager._validate_url() is True


def test_message_store_initializes_database(tmp_path: Path) -> None:
    db_path = tmp_path / "messages.db"
    MessageStore(tmp_path, str(db_path))

    with sqlite3.connect(db_path) as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}

    expected = {"rooms", "users", "messages", "events"}
    assert expected.issubset(tables)


def test_dry_run_executes_and_writes_logs(tmp_path: Path) -> None:
    log_dir = tmp_path / "dry_logs"
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "src.bot.main",
            "--dry-run",
            "--log-dir",
            str(log_dir),
        ],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="ignore",
        env=env,
    )

    assert result.returncode == 0, result.stderr
    room_dir = log_dir / "1000"
    assert room_dir.exists(), "샘플 이벤트 로그 디렉터리가 생성되어야 합니다."
    assert any(room_dir.glob("*.log")), "샘플 로그 파일이 존재해야 합니다."
