from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from src.utils.logger import (
    LogValidator,
    ServiceLogger,
    log_execution_time,
    setup_global_logging,
)


@pytest.fixture()
def temp_log_dir(tmp_path: Path) -> Path:
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    return log_dir


def test_structured_logging_creates_json_lines(temp_log_dir: Path) -> None:
    setup_global_logging("DEBUG", str(temp_log_dir))
    logger = ServiceLogger("test_service", log_dir=str(temp_log_dir))

    logger.debug("debug message", debug_field="value")
    logger.info("info message", info_field=123)
    logger.warning("warning message")
    logger.error("error message", error_field=True)
    logger.log_event("custom_event", room_id="42", user_id="99")
    logger.log_performance("operation", 12.5, status="success")

    log_file = temp_log_dir / "test_service.log"
    assert log_file.exists(), "구조화 로그 파일이 생성되어야 합니다."

    with log_file.open("r", encoding="utf-8") as f:
        lines = [json.loads(line.strip()) for line in f if line.strip()]

    assert len(lines) >= 4
    for entry in lines[:4]:
        assert {"timestamp", "level", "logger", "message"} <= entry.keys()


def test_log_validator_distinguishes_valid_and_invalid_json() -> None:
    valid = '{"timestamp":"2025-10-27T10:00:00","level":"INFO","logger":"test","message":"ok"}'
    invalid = '{"timestamp":"2025-10-27T10:00:00","level":"INFO"'

    assert LogValidator.validate_json_log(valid) is True
    assert LogValidator.validate_json_log(invalid) is False


def test_performance_logging_writes_duration(temp_log_dir: Path) -> None:
    perf_logger = ServiceLogger("perf_test", log_dir=str(temp_log_dir))

    @log_execution_time(perf_logger)
    def slow_call() -> str:
        time.sleep(0.05)
        return "done"

    assert slow_call() == "done"

    log_file = temp_log_dir / "perf_test.log"
    with log_file.open("r", encoding="utf-8") as f:
        entries = [json.loads(line.strip()) for line in f if line.strip()]

    assert any(entry.get("operation") for entry in entries)
    assert any(entry.get("duration_ms") for entry in entries)


def test_error_logging_writes_context(temp_log_dir: Path) -> None:
    error_logger = ServiceLogger("error_test", log_dir=str(temp_log_dir))

    try:
        raise ValueError("테스트 에러")
    except ValueError as exc:
        error_logger.log_error_with_context(
            error=exc,
            context={"operation": "unit_test"},
        )

    error_log = temp_log_dir / "error_test_error.log"
    assert error_log.exists()

    with error_log.open("r", encoding="utf-8") as f:
        entries = [json.loads(line.strip()) for line in f if line.strip()]

    assert any(entry.get("error_message") == "테스트 에러" for entry in entries)
