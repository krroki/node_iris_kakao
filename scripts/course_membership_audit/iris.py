from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests


def read_realtime_base() -> str:
    return (
        str(os.getenv("REALTIME_API_BASE") or os.getenv("REALTIME_API_URL") or "").strip()
        or "http://127.0.0.1:8650"
    ).rstrip("/")


def read_iris_base(repo_root: Path) -> str:
    env_url = (
        str(os.getenv("IRIS_URL") or "").strip()
        or str(os.getenv("IRIS_QUERY_BASE") or "").strip()
        or str(os.getenv("IRIS_BRIDGE_URL") or "").strip()
    )
    if env_url:
        return env_url.rstrip("/")
    p = (repo_root / "config" / "windows" / "iris_url.txt").resolve()
    try:
        s = p.read_text(encoding="utf-8-sig").strip()
    except Exception:
        s = ""
    return (s or "http://127.0.0.1:5050").rstrip("/")


def iris_query(iris_base: str, query: str, bind: list, timeout: float = 10.0) -> list[dict]:
    url = iris_base.rstrip("/") + "/query"
    body = {"query": query, "bind": bind}
    try:
        r = requests.post(url, json=body, timeout=timeout)
    except Exception as e:
        raise SystemExit(f"[오류] IRIS /query 호출 실패: {e}")
    if r.status_code != 200:
        raise SystemExit(f"[오류] IRIS /query 실패: HTTP {r.status_code} body={r.text[:200]}")
    try:
        j = r.json()
    except Exception as e:
        raise SystemExit(f"[오류] IRIS /query 응답 JSON 파싱 실패: {e}")
    data = j.get("data")
    if not isinstance(data, list):
        raise SystemExit("[오류] IRIS /query 응답 형식 오류: data[] 없음")
    out: list[dict] = []
    for it in data:
        if isinstance(it, dict):
            out.append(it)
    return out


def _safe_int(v: object) -> Optional[int]:
    try:
        if isinstance(v, bool):
            return None
        if isinstance(v, int):
            return v
        if isinstance(v, float):
            if v != v:
                return None
            return int(v)
        if isinstance(v, str):
            t = v.strip()
            if t and t.isdigit():
                return int(t)
    except Exception:
        return None
    return None


def _parse_room_name_from_meta(meta_raw: object) -> Optional[str]:
    s = str(meta_raw or "").strip()
    if not s:
        return None
    if not (s.startswith("[") or s.startswith("{")):
        return None
    try:
        j = json.loads(s)
    except Exception:
        return None

    contents: list[str] = []
    if isinstance(j, list):
        for it in j:
            if isinstance(it, dict):
                c = it.get("content")
                if isinstance(c, str) and c.strip():
                    contents.append(c.strip())
    elif isinstance(j, dict):
        c = j.get("content")
        if isinstance(c, str) and c.strip():
            contents.append(c.strip())

    # Observed pattern in chat_rooms.meta:
    #   "Welcome to '<ROOM_NAME>'."
    for c in contents:
        m = re.search(r"Welcome to\\s+['\\\"](.+?)['\\\"]", c)
        if m:
            name = (m.group(1) or "").strip()
            if name:
                return name
    return None


def fetch_rooms(realtime_base: str, timeout: float = 10.0) -> list[dict]:
    url = realtime_base.rstrip("/") + "/rooms"
    try:
        r = requests.get(url, timeout=timeout)
    except Exception as e:
        raise SystemExit(f"[오류] Realtime API /rooms 호출 실패: {e}")
    if r.status_code != 200:
        raise SystemExit(f"[오류] Realtime API /rooms 실패: HTTP {r.status_code} body={r.text[:200]}")
    try:
        j = r.json()
    except Exception as e:
        raise SystemExit(f"[오류] Realtime API /rooms 응답 JSON 파싱 실패: {e}")
    if not isinstance(j, list):
        raise SystemExit("[오류] Realtime API /rooms 응답 형식 오류: 배열(list) 필요")
    out: list[dict] = []
    for it in j:
        if isinstance(it, dict):
            out.append(it)
    return out


def fetch_room_meta(iris_base: str, room_id: str) -> tuple[str, Optional[int]]:
    rows = iris_query(iris_base, "select active_members_count, meta from chat_rooms where id=?", [room_id], timeout=10.0)
    if not rows:
        return room_id, None
    row = rows[0] if isinstance(rows[0], dict) else {}
    name = _parse_room_name_from_meta(row.get("meta")) or room_id
    active = _safe_int(row.get("active_members_count"))
    return name, active


def fetch_loaded_member_count(iris_base: str, room_id: str) -> int:
    rows = iris_query(
        iris_base,
        "select count(distinct user_id) as cnt from db2.open_chat_member where involved_chat_id=?",
        [room_id],
        timeout=20.0,
    )
    if not rows:
        return 0
    row = rows[0] if isinstance(rows[0], dict) else {}
    return _safe_int(row.get("cnt")) or 0


def fetch_openchat_members(iris_base: str, room_id: str, page_size: int = 500) -> list[dict]:
    out: dict[str, dict] = {}
    offset = 0
    while True:
        rows = iris_query(
            iris_base,
            "select user_id, nickname from db2.open_chat_member where involved_chat_id=? order by nickname limit ? offset ?",
            [room_id, page_size, offset],
            timeout=30.0,
        )
        if not rows:
            break
        for row in rows:
            if not isinstance(row, dict):
                continue
            uid = str(row.get("user_id") or "").strip()
            if not uid:
                continue
            nick = str(row.get("nickname") or "").strip()
            rec = out.get(uid)
            if not rec:
                out[uid] = {"userId": uid, "nickname": nick}
            else:
                if nick and not rec.get("nickname"):
                    rec["nickname"] = nick

        if len(rows) < page_size:
            break
        offset += page_size

    members = [out[uid] for uid in sorted(out.keys(), key=lambda x: (out[x].get("nickname") or "", x))]
    return members
