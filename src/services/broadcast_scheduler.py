#!/usr/bin/env python3
"""Broadcast scheduler using SQLite for persistence."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from src.utils.logger import get_service_logger, ServiceLogger


@dataclass
class BroadcastTask:
    id: int
    channels: List[str]
    payload: Dict[str, Any]
    attempts: int
    status: str
    last_error: Optional[str]
    scheduled_at: datetime
    completed_at: Optional[datetime]

    @property
    def is_pending(self) -> bool:
        return self.status == "PENDING"


class BroadcastScheduler:
    """SQLite-backed broadcast queue."""

    def __init__(self, db_path: Path, logger: Optional[ServiceLogger] = None) -> None:
        self.db_path = Path(db_path)
        self.logger = logger or get_service_logger("broadcast_scheduler")
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.db_path)

    def _ensure_schema(self) -> None:
        conn = self._connect()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS broadcasts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    channels TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'PENDING',
                    last_error TEXT,
                    scheduled_at TEXT NOT NULL,
                    completed_at TEXT
                )
                """
            )
            conn.commit()
        finally:
            conn.close()

    def enqueue(self, channels: Iterable[str], payload: Dict[str, Any]) -> int:
        now = datetime.utcnow().isoformat()
        conn = self._connect()
        try:
            cur = conn.execute(
                "INSERT INTO broadcasts (channels, payload, scheduled_at) VALUES (?, ?, ?)",
                (json.dumps(list(channels)), json.dumps(payload, ensure_ascii=False), now),
            )
            conn.commit()
            task_id = cur.lastrowid
            self.logger.info("방송 큐 등록", task_id=task_id)
            return int(task_id)
        finally:
            conn.close()

    def fetch_pending(self, limit: int = 10) -> List[BroadcastTask]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT id, channels, payload, attempts, status, last_error, scheduled_at, completed_at"
                " FROM broadcasts WHERE status = 'PENDING' ORDER BY scheduled_at ASC LIMIT ?",
                (limit,),
            ).fetchall()
        finally:
            conn.close()
        tasks: List[BroadcastTask] = []
        for row in rows:
            tasks.append(
                BroadcastTask(
                    id=row[0],
                    channels=json.loads(row[1]),
                    payload=json.loads(row[2]),
                    attempts=row[3],
                    status=row[4],
                    last_error=row[5],
                    scheduled_at=datetime.fromisoformat(row[6]),
                    completed_at=datetime.fromisoformat(row[7]) if row[7] else None,
                )
            )
        return tasks

    def mark_success(self, task_id: int) -> None:
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE broadcasts SET status = 'DONE', completed_at = ?, last_error = NULL WHERE id = ?",
                (datetime.utcnow().isoformat(), task_id),
            )
            conn.commit()
            self.logger.info("방송 완료", task_id=task_id)
        finally:
            conn.close()

    def mark_retry(self, task_id: int, error: str, max_attempts: int = 3) -> None:
        conn = self._connect()
        try:
            row = conn.execute("SELECT attempts FROM broadcasts WHERE id = ?", (task_id,)).fetchone()
            if not row:
                return
            attempts = row[0] + 1
            status = "FAILED" if attempts >= max_attempts else "PENDING"
            conn.execute(
                "UPDATE broadcasts SET attempts = ?, status = ?, last_error = ? WHERE id = ?",
                (attempts, status, error, task_id),
            )
            conn.commit()
            self.logger.warning("방송 재시도", task_id=task_id, attempts=attempts, status=status)
        finally:
            conn.close()

    def summary(self) -> Dict[str, int]:
        conn = self._connect()
        try:
            rows = conn.execute("SELECT status, COUNT(1) FROM broadcasts GROUP BY status").fetchall()
        finally:
            conn.close()
        return {status: count for status, count in rows}


__all__ = ["BroadcastScheduler", "BroadcastTask"]
