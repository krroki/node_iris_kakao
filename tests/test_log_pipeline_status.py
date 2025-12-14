"""
로그 파이프라인 상태(/status) 회귀 테스트

- 로그 디렉터리와 status.json의 타임라인이 일치하는지 검증한다.
- SAVE_CHAT_LOGS 오작동 등으로 "봇 이벤트는 있는데 로그가 안 쓰이는" 상황을
  조기에 탐지하기 위한 안전망이다.
"""

import json
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def logs_env(tmp_path, monkeypatch):
    """
    IRIS_LOGS_DIR를 임시 디렉터리로 바인딩한다.
    server.log_utils.get_logs_dir()는 항상 환경변수를 기준으로 동작하므로,
    이 값을 통해 /status 내부의 logStore 스테이지를 격리 테스트할 수 있다.
    """

    logs_dir = tmp_path / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("IRIS_LOGS_DIR", str(logs_dir))
    return logs_dir


def _write_log(log_file, ts: datetime):
    """단일 메시지 로그 레코드를 생성하고 파일 mtime을 ts로 맞춘다."""

    payload = {
        "timestamp": ts.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
        "snapshot": {
            "roomId": "room1",
            "roomName": "room1",
            "senderId": "user1",
            "senderName": "user1",
            "messageText": "hello",
            "messageId": 1,
        },
        "payload": {},
    }
    log_file.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")
    ts_epoch = ts.replace(tzinfo=timezone.utc).timestamp()
    os.utime(log_file, (ts_epoch, ts_epoch))


def _call_status():
    from server.app import app

    client = TestClient(app)
    resp = client.get("/status")
    assert resp.status_code == 200
    return resp.json()


class TestLogPipelineStatus:
    def test_log_stage_ok_with_recent_logs(self, logs_env):
        """
        최근 로그가 몇 초 이내에 존재하면 logStore.ok 가 True 이고
        detail 에 '최근 로그' 문구가 포함되어야 한다.
        """

        room_dir = logs_env / "room1"
        room_dir.mkdir(parents=True, exist_ok=True)
        now = datetime.now(timezone.utc)
        log_file = room_dir / "test.log"
        _write_log(log_file, now)

        data = _call_status()
        log_stage = data["stages"]["logStore"]
        assert log_stage["ok"] is True
        assert "최근 로그" in log_stage["detail"]

    def test_log_stage_detects_bot_log_mismatch(self, logs_env):
        """
        status.json의 lastEventTs는 매우 최근인데,
        로그 파일 mtime이 그보다 60초 이상 과거라면
        logStore.ok 가 False 이고 '로그 파일 업데이트가 지연' 문구가 포함돼야 한다.
        """

        room_dir = logs_env / "room1"
        room_dir.mkdir(parents=True, exist_ok=True)

        now = datetime.now(timezone.utc)
        old = now - timedelta(minutes=30)
        log_file = room_dir / "old.log"
        _write_log(log_file, old)

        # logs_dir 상위 디렉터리에 status.json 생성
        status_file = logs_env.parent / "status.json"
        status_payload = {
            "pid": 1234,
            "startedAt": old.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
            "lastEventTs": now.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        status_file.write_text(json.dumps(status_payload, ensure_ascii=False), encoding="utf-8")

        data = _call_status()
        log_stage = data["stages"]["logStore"]
        assert log_stage["ok"] is False
        assert "로그 파일 업데이트가 지연" in log_stage["detail"]

