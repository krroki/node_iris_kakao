from __future__ import annotations

import json
import os
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional


def _locks_dir() -> Path:
    root = Path(__file__).resolve().parent.parent
    d = root / "logs" / "kb_locks"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _lock_path(name: str) -> Path:
    safe = "".join([c if c.isalnum() or c in ("-", "_") else "_" for c in (name or "lock")])
    return _locks_dir() / f"{safe}.lock"


def _is_stale(p: Path, stale_sec: int) -> bool:
    try:
        st = p.stat()
        age = time.time() - st.st_mtime
        return age >= max(1, int(stale_sec))
    except Exception:
        return True


def try_acquire_lock(name: str, *, stale_sec: int = 3 * 60 * 60) -> Optional[Path]:
    """프로세스 중복 실행 방지용 파일 락을 시도한다.

    - atomic create(O_EXCL)로 경쟁 조건을 줄인다.
    - 강제 종료 등으로 락 파일이 남으면 stale_sec 경과 후 자동 회수한다.
    """
    p = _lock_path(name)
    if p.exists() and _is_stale(p, stale_sec):
        try:
            p.unlink(missing_ok=True)  # type: ignore[arg-type]
        except Exception:
            pass

    try:
        fd = os.open(str(p), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        try:
            payload = {"pid": os.getpid(), "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
            os.write(fd, (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))
        finally:
            os.close(fd)
        return p
    except FileExistsError:
        return None
    except Exception:
        # 락 실패해도 작업 자체를 막지 않도록 None으로 폴백
        return None


@contextmanager
def lock_scope(name: str, *, stale_sec: int = 3 * 60 * 60) -> Iterator[bool]:
    """락을 획득하면 True를 yield, 못 하면 False를 yield 한다."""
    p = try_acquire_lock(name, stale_sec=stale_sec)
    if p is None:
        yield False
        return
    try:
        yield True
    finally:
        try:
            p.unlink(missing_ok=True)  # type: ignore[arg-type]
        except Exception:
            pass

