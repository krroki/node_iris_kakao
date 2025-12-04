from __future__ import annotations

import json
from typing import Any, Optional
from contextlib import contextmanager
from sqlalchemy import text
from kb.db import db_session


def start(job_type: str, payload: Optional[dict] = None) -> int:
    with db_session() as s:
        row = s.execute(text(
            "INSERT INTO job_log (job_type, status, payload) VALUES (:t,'running',:p) RETURNING job_id"
        ), {"t": job_type, "p": json.dumps(payload or {})}).first()
        return int(row[0])


def finish(job_id: int, status: str = "done", result: Optional[dict] = None):
    with db_session() as s:
        s.execute(text(
            "UPDATE job_log SET status=:s, result=:r, finished_at=now() WHERE job_id=:id"
        ), {"s": status, "r": json.dumps(result or {}), "id": job_id})


@contextmanager
def job_scope(job_type: str, payload: Optional[dict] = None):
    jid = start(job_type, payload)
    try:
        yield jid
        finish(jid, "done")
    except Exception as e:  # pragma: no cover
        finish(jid, "error", {"error": str(e)})
        raise

