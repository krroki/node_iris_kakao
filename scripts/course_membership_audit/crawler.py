from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, Tuple


def _read_json(path: Path) -> dict:
    try:
        raw = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return {}
    except Exception:
        return {}
    try:
        obj = json.loads(raw or "{}")
    except Exception:
        return {}
    return obj if isinstance(obj, dict) else {}


def crawl_cafe_members(
    *,
    python_exe: str,
    crawler_repo: str,
    settings_path: str,
    club_id: str,
    cafe_name: str,
    output_json: Path,
    timeout_sec: int = 900,
) -> Tuple[int, dict, str, str, float]:
    script = (Path(__file__).resolve().parent.parent / "crawl_naver_cafe_members.py").resolve()
    args = [
        str(python_exe),
        str(script),
        "--crawler-repo",
        str(crawler_repo),
        "--club-id",
        str(club_id),
        "--cafe-name",
        str(cafe_name),
        "--output",
        str(output_json),
    ]
    if str(settings_path or "").strip():
        args.extend(["--settings", str(settings_path)])

    output_json.parent.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    p = subprocess.run(
        args,
        capture_output=True,
        text=True,
        timeout=max(60, int(timeout_sec)),
    )
    dur = time.time() - t0
    snap: dict[str, Any] = _read_json(output_json)
    return p.returncode, snap, (p.stdout or ""), (p.stderr or ""), dur

