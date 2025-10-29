from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.services.broadcast_scheduler import BroadcastScheduler


@pytest.fixture()
def scheduler(tmp_path: Path) -> BroadcastScheduler:
    return BroadcastScheduler(tmp_path / "queue.sqlite")


def test_enqueue_and_fetch(scheduler: BroadcastScheduler) -> None:
    task_id = scheduler.enqueue(["room1", "room2"], {"message": "hello"})
    tasks = scheduler.fetch_pending()
    assert len(tasks) == 1
    task = tasks[0]
    assert task.id == task_id
    assert task.is_pending
    assert task.channels == ["room1", "room2"]


def test_mark_success(scheduler: BroadcastScheduler) -> None:
    task_id = scheduler.enqueue(["room"], {"message": "ok"})
    scheduler.mark_success(task_id)
    summary = scheduler.summary()
    assert summary.get("DONE") == 1


def test_mark_retry(scheduler: BroadcastScheduler) -> None:
    task_id = scheduler.enqueue(["room"], {"message": "retry"})
    scheduler.mark_retry(task_id, "timeout", max_attempts=2)
    tasks = scheduler.fetch_pending()
    assert tasks[0].attempts == 1
    scheduler.mark_retry(task_id, "timeout", max_attempts=2)
    summary = scheduler.summary()
    assert summary.get("FAILED") == 1
