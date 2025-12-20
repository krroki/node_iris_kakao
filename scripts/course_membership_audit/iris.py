from __future__ import annotations

import json
import os
import base64
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


_KOREAN_RE = re.compile(r"[가-힣ㄱ-ㅎㅏ-ㅣ]")


def decode_nickname_from_db(raw: object) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    # IRIS /query가 open_chat_member.nickname을 UTF-8 bytes를 latin1로 잘못 디코딩해 내리는 케이스가 있다.
    # 예: "ìµì°" → bytes(latin1) → utf8 → "융쓰"
    # - 이미 한글이 포함되어 있으면 그대로 사용
    # - 그렇지 않으면 latin1→utf8을 시도하고, 결과에 한글이 있으면 교체
    if _KOREAN_RE.search(s):
        return s
    try:
        decoded = s.encode("latin1", errors="ignore").decode("utf-8", errors="ignore").strip()
        if decoded and _KOREAN_RE.search(decoded):
            return decoded
    except Exception:
        pass

    # Some builds return nickname as base64 string (selecting `enc` can change server-side decoding behavior).
    # Decode only when it *clearly* yields Korean text to avoid mangling normal ASCII nicknames.
    try:
        if len(s) >= 16 and (len(s) % 4 == 0) and re.fullmatch(r"[A-Za-z0-9+/=]+", s or ""):
            raw_b = base64.b64decode(s, validate=True)
            decoded_b64 = raw_b.decode("utf-8", errors="ignore").strip()
            if decoded_b64 and _KOREAN_RE.search(decoded_b64):
                return decoded_b64
    except Exception:
        pass
    return s


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


def fetch_room_meta(iris_base: str, room_id: str) -> tuple[str, Optional[int], Optional[int]]:
    rows = iris_query(
        iris_base,
        "select active_members_count, meta, link_id from chat_rooms where id=?",
        [room_id],
        timeout=10.0,
    )
    if not rows:
        return room_id, None, None
    row = rows[0] if isinstance(rows[0], dict) else {}
    name = _parse_room_name_from_meta(row.get("meta"))
    link_id = _safe_int(row.get("link_id"))
    if not name:
        link_id_str = str(link_id if link_id is not None else "").strip()
        if link_id_str:
            try:
                r2 = iris_query(iris_base, "select name from db2.open_link where id=?", [link_id_str], timeout=10.0)
                if r2 and isinstance(r2[0], dict):
                    name2 = str(r2[0].get("name") or "").strip()
                    if name2:
                        name = name2
            except Exception:
                name = name or None
    name = name or room_id
    active = _safe_int(row.get("active_members_count"))
    return name, active, link_id


def fetch_loaded_member_count(iris_base: str, room_id: str, link_id: Optional[int]) -> int:
    # NOTE: 일부 환경에서 open_chat_member.involved_chat_id가 0으로 들어오는 케이스가 많다.
    # membership list는 link_id 기준으로 조회하는 것이 더 안정적이다.
    if link_id is not None:
        rows = iris_query(
            iris_base,
            "select count(distinct user_id) as cnt from db2.open_chat_member where link_id=?",
            [int(link_id)],
            timeout=20.0,
        )
    else:
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


def fetch_openchat_members(iris_base: str, room_id: str, link_id: Optional[int], page_size: int = 500) -> list[dict]:
    out: dict[str, dict] = {}
    offset = 0
    if link_id is not None:
        where = "where link_id=?"
        bind_prefix: list = [int(link_id)]
    else:
        where = "where involved_chat_id=?"
        bind_prefix = [room_id]
    while True:
        rows = iris_query(
            iris_base,
            # NOTE: IRIS /query can return open_chat_member.nickname as base64 unless we also select `enc`.
            f"select user_id, nickname, enc from db2.open_chat_member {where} order by nickname limit ? offset ?",
            bind_prefix + [page_size, offset],
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
            nick = decode_nickname_from_db(row.get("nickname"))
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
