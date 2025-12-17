from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import subprocess
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import AsyncGenerator, Dict, List, Optional

from fastapi import FastAPI, Request, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, RedirectResponse
from fastapi.responses import Response
import re
from urllib import request as _urlreq
from urllib.error import URLError, HTTPError

from .log_utils import (
    get_logs_dir,
    tail_room,
    tail_all,
    tail_bulk,
    apply_keyword_filter,
    ts_to_ms,
    list_rooms,
    find_avatar_path,
    load_runtime,
    save_runtime,
    list_templates,
    load_template,
    save_template,
    delete_template,
    assets_dir_for,
)


_ROOM_ADMIN_REFRESH_LAST_BY_ROOM: dict[str, float] = {}
_ROOM_ADMIN_REFRESH_LAST_GLOBAL: float = 0.0
_ROOM_ADMIN_REFRESH_COOLDOWN_SEC_BY_ROOM = 15 * 60
_ROOM_ADMIN_REFRESH_COOLDOWN_SEC_GLOBAL = 3 * 60


def _repo_root() -> Path:
    # server/app.py 기준 1단계 상위가 repo root
    return Path(__file__).resolve().parents[1]


def _now_ts() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")

def _parse_keywords(s: str | None) -> list[str]:
    if not s:
        return []
    s = s.lower().replace(',', ' ')
    return [x for x in s.split() if x]


app = FastAPI(title="IRIS Realtime API (FastAPI/SSE)")
logger = logging.getLogger("realtime")

# KB 서비스(8610) 상태는 /status에서 함께 노출해 대시보드/Watchdog에서 자동 복구할 수 있게 한다.
KB_BASE = (os.getenv("KB_BASE") or os.getenv("NEXT_PUBLIC_KB_URL") or "http://127.0.0.1:8610").rstrip("/")

# CORS: allow localhost/default dev ports
origins = [
    "http://localhost",
    "http://127.0.0.1",
    "http://localhost:8512",
    "http://127.0.0.1:8512",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3100",
    "http://127.0.0.1:3100",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    try:
        rooms = [d.name for d in get_logs_dir().iterdir() if d.is_dir()]
    except Exception:
        rooms = []
    # Bot status
    status = {}
    try:
        p = (get_logs_dir().parents[0] / 'status.json')
        if p.exists():
            import json as _json
            status = _json.loads(p.read_text(encoding='utf-8'))
    except Exception:
        status = {}
    # lastEvent age
    age_sec = None
    try:
        from .log_utils import ts_to_ms
        ts = status.get('lastEventTs')
        if ts:
            import time
            age_sec = max(0, int((time.time()*1000 - ts_to_ms(ts)) / 1000))
    except Exception:
        age_sec = None
    return {
        "ok": True,
        "rooms": len(rooms),
        "bot": {
            "pid": status.get('pid'),
            "lastEventTs": status.get('lastEventTs'),
            "lastEventAgeSec": age_sec,
        }
    }


@app.get("/status")
async def status():
    """Aggregate multi-stage status for UI (device/bot/logStore/realtime/kb/ui)."""
    # device: windows/device_health_cache.json 기반
    from pathlib import Path as _Path
    root = _Path(__file__).resolve().parents[1]
    device_cache = root / "windows" / "device_health_cache.json"
    DEVICE_CACHE_TTL_MS = 15 * 60 * 1000

    def _device_stage():
        stage = {
            "key": "device",
            "name": "Redroid / IRIS 단말",
            "ok": False,
            "detail": "단말 상태 확인 중...",
        }
        try:
            raw = device_cache.read_text(encoding="utf-8")
            cache = json.loads(raw)
            updated_at = cache.get("updatedAt")
            ts = None
            if isinstance(updated_at, str):
                try:
                    dt = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
                    ts = int(dt.timestamp() * 1000)
                except Exception:
                    ts = None
            age_ms = (int(datetime.now(timezone.utc).timestamp() * 1000) - ts) if ts else None
            if age_ms is not None and age_ms > DEVICE_CACHE_TTL_MS:
                stage["ok"] = bool(cache.get("ok"))
                stage["detail"] = f"단말 상태 캐시가 {round(age_ms / 60000)}분 전에 갱신됨 (주의)."
                stage["timestamp"] = updated_at
                stage["extra"] = {"cached": True, "stale": True, "ageMs": age_ms}
            else:
                stage["ok"] = bool(cache.get("ok"))
                stage["detail"] = cache.get("detail") or ("VM/IRIS 단말 정상" if stage["ok"] else "단말 상태 이상")
                stage["timestamp"] = updated_at
                extra = dict(cache)
                extra["cached"] = True
                stage["extra"] = extra
        except Exception as e:
            stage["ok"] = False
            stage["detail"] = "단말 상태 캐시 없음. /api/device/repair 또는 /api/device/health로 수동 점검 필요."
            stage["extra"] = {"cached": False, "error": str(e)}
        return stage

    def _bot_stage():
        stage = {
            "key": "bot",
            "name": "Node-IRIS Bot",
            "ok": False,
            "detail": "상태 파일을 아직 읽지 못했습니다.",
        }
        try:
            # status.json은 logs_dir 상위 디렉터리에 있음
            logs_dir = get_logs_dir()
            status_file = logs_dir.parents[0] / "status.json"
            raw = status_file.read_text(encoding="utf-8")
            data = json.loads(raw or "{}")
            last_event_ts = data.get("lastEventTs") if isinstance(data.get("lastEventTs"), str) else None
            heartbeat_ts = data.get("heartbeatTs") if isinstance(data.get("heartbeatTs"), str) else None
            started_at = data.get("startedAt") if isinstance(data.get("startedAt"), str) else None
            # NOTE: lastEventTs가 존재하더라도 heartbeatTs가 더 최신일 수 있다.
            # (채팅이 한동안 없더라도 봇이 살아있음을 나타내는 heartbeat를 최신 활동으로 간주)
            candidates: list[tuple[str, datetime, str]] = []
            if last_event_ts:
                try:
                    dt_last = datetime.fromisoformat(last_event_ts.replace("Z", "+00:00"))
                    candidates.append(("lastEventTs", dt_last, last_event_ts))
                except Exception:
                    pass
            if heartbeat_ts:
                try:
                    dt_hb = datetime.fromisoformat(heartbeat_ts.replace("Z", "+00:00"))
                    candidates.append(("heartbeatTs", dt_hb, heartbeat_ts))
                except Exception:
                    pass

            effective_src: str | None = None
            dt_effective: datetime | None = None
            effective_ts: str | None = None
            if candidates:
                effective_src, dt_effective, effective_ts = max(candidates, key=lambda x: x[1])

            # node-iris MessageStore가 EMFILE(too many open files)로 디스크 로그 쓰기를 중단했는지 health 파일로 확인
            bot_health = logs_dir.parents[0] / "bot_health.json"
            emfile_flag = False
            emfile_since: str | None = None
            try:
                if bot_health.exists():
                    _raw = bot_health.read_text(encoding="utf-8")
                    _h = json.loads(_raw or "{}")
                    if _h.get("emfile"):
                        emfile_flag = True
                        if isinstance(_h.get("since"), str):
                            emfile_since = _h["since"]
            except Exception:
                emfile_flag = False
                emfile_since = None

            if not effective_ts or not dt_effective:
                stage["ok"] = False
                stage["timestamp"] = started_at
                stage["detail"] = (
                    f"최근 이벤트가 없습니다 (시작: {started_at})" if started_at else "최근 이벤트가 없습니다."
                )
                stage["extra"] = {
                    "pid": data.get("pid"),
                    "lastEventText": None,
                    "heartbeatTs": heartbeat_ts,
                    "effectiveSource": None,
                    "effectiveTs": None,
                    "emfile": emfile_flag,
                    "emfileSince": emfile_since,
                }
                return stage
            now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
            age_ms = now_ms - int(dt_effective.timestamp() * 1000)
            healthy = age_ms < 15 * 60 * 1000
            # EMFILE 상태에서는 ok=False로 내려 UI에서 즉시 알 수 있게 한다.
            stage["ok"] = healthy and not emfile_flag
            stage["timestamp"] = dt_effective.isoformat()
            if emfile_flag:
                stage["detail"] = "봇은 이벤트를 받고 있지만 파일 핸들 한도(EMFILE)로 로그 기록이 중단된 상태입니다."
            else:
                if not healthy:
                    stage["detail"] = "최근 활동(이벤트/하트비트)이 너무 오래되었습니다."
                elif effective_src == "heartbeatTs":
                    last_hint = f" (마지막 이벤트: {last_event_ts})" if last_event_ts else ""
                    stage["detail"] = f"하트비트 {age_ms // 1000}s 전{last_hint}"
                else:
                    stage["detail"] = f"최근 이벤트 {age_ms // 1000}s 전 ({data.get('lastEventRoomId') or 'room n/a'})"
            stage["extra"] = {
                "pid": data.get("pid"),
                "lastEventText": data.get("lastEventText"),
                "heartbeatTs": heartbeat_ts,
                "effectiveSource": effective_src,
                "effectiveTs": effective_ts,
                "emfile": emfile_flag,
                "emfileSince": emfile_since,
            }
        except Exception as e:
            stage["ok"] = False
            stage["detail"] = f"status.json을 읽지 못했습니다: {e}"
        return stage

    def _log_stage():
        stage = {
            "key": "logStore",
            "name": "Log Store",
            "ok": False,
            "detail": "로그 디렉터리를 아직 확인하지 못했습니다.",
        }
        latest_ms = 0
        latest_ts: str | None = None
        last_event_ms = None
        last_event_ts: str | None = None
        try:
            # status.json의 lastEventTs는 "봇이 이벤트를 받고 있는지" 판단에만 사용하고,
            # 실제 로그 신선도(log freshness)는 파일 mtime 기준으로만 계산한다.
            logs_dir = get_logs_dir()
            status_file = logs_dir.parents[0] / "status.json"
            try:
                raw = status_file.read_text(encoding="utf-8")
                data = json.loads(raw or "{}")
                last = data.get("lastEventTs")
                if isinstance(last, str):
                    dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
                    last_event_ms = int(dt.timestamp() * 1000)
                    last_event_ts = dt.isoformat()
            except Exception:
                pass

            # logs_dir 내 최근 로그 파일 mtime로 보강
            try:
                # NOTE:
                # Windows에서는 "파일 내용 변경"이 디렉터리 mtime에 반영되지 않을 수 있어,
                # 디렉터리 mtime 기반 top-N 샘플링은 최신 로그를 놓치기 쉽다.
                # 방 수가 100 전후인 운영에서는 "최근 N일의 날짜 로그 파일(YYYY-MM-DD.log)"만 직접 stat 하는 방식이 충분히 빠르고 더 정확하다.
                now_utc = datetime.now(timezone.utc)
                day_keys = [(now_utc - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(0, 3)]
                for d in logs_dir.iterdir():
                    if not d.is_dir():
                        continue
                    for day in day_keys:
                        f = d / f"{day}.log"
                        if not f.exists():
                            continue
                        try:
                            st = f.stat()
                            ts_ms = int(st.st_mtime * 1000)
                            if ts_ms > latest_ms:
                                latest_ms = ts_ms
                                latest_ts = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat()
                        except Exception:
                            continue

                # 테스트/개발 환경에서는 날짜 로그 파일 규칙을 따르지 않을 수 있으므로,
                # 날짜 로그가 전혀 없을 때는 모든 *.log 파일로 한 번 더 폴백한다.
                if latest_ms == 0:
                    for d in logs_dir.iterdir():
                        if not d.is_dir():
                            continue
                        try:
                            for f in d.glob("*.log"):
                                if not f.exists():
                                    continue
                                st = f.stat()
                                ts_ms = int(st.st_mtime * 1000)
                                if ts_ms > latest_ms:
                                    latest_ms = ts_ms
                                    latest_ts = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat()
                        except Exception:
                            continue
            except Exception:
                pass

            if latest_ms == 0:
                # 로그 파일이 전혀 없는 경우
                stage["ok"] = False
                if last_event_ms is not None:
                    stage["detail"] = (
                        "봇 이벤트는 들어오지만 로그 파일이 생성되지 않았습니다 "
                        "(SAVE_CHAT_LOGS 또는 파일 권한을 확인하세요)."
                    )
                else:
                    stage["detail"] = "로그 파일이 없거나, 아직 어떤 메시지도 기록되지 않았습니다."
                stage["timestamp"] = None
                stage["extra"] = {
                    "lastEventTs": last_event_ts,
                    "latestLogTs": None,
                }
            else:
                now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
                age_ms = now_ms - latest_ms
                stale_ms = 15 * 60 * 1000

                # 봇 이벤트와 로그 타임라인이 어긋나는 경우(주요 사고 지점)
                if last_event_ms is not None and (last_event_ms - latest_ms) > 60 * 1000:
                    # 봇은 최근까지 이벤트를 받았는데, 로그는 60초 이상 뒤처져 있음
                    stage["ok"] = False
                    stage["timestamp"] = latest_ts
                    stage["detail"] = (
                        "봇 이벤트는 최근까지 들어오지만 로그 파일 업데이트가 지연되고 있습니다 "
                        "(SAVE_CHAT_LOGS 설정 또는 디스크/권한 문제를 확인하세요)."
                    )
                    stage["extra"] = {
                        "lastEventTs": last_event_ts,
                        "latestLogTs": latest_ts,
                        "lastEventAgeSec": max(0, int((now_ms - last_event_ms) / 1000)),
                        "logAgeSec": max(0, int(age_ms / 1000)),
                    }
                else:
                    # 일반적인 로그 TTL 체크
                    stage["ok"] = age_ms < stale_ms
                    stage["timestamp"] = latest_ts
                    stage["detail"] = (
                        f"최근 로그 {age_ms // 1000}s 전"
                        if stage["ok"]
                        else f"로그가 {age_ms // 1000}s 동안 기록되지 않았습니다."
                    )
                    stage["extra"] = {
                        "lastEventTs": last_event_ts,
                        "latestLogTs": latest_ts,
                        "logAgeSec": max(0, int(age_ms / 1000)),
                    }
        except Exception as e:
            stage["ok"] = False
            stage["detail"] = f"로그 상태를 확인하지 못했습니다: {e}"
            stage["extra"] = {"error": str(e)}
        return stage, latest_ts

    async def _realtime_stage():
        stage = {
            "key": "realtime",
            "name": "Realtime API (FastAPI)",
            "ok": False,
            "detail": "상태 확인 중...",
        }
        try:
            # self-call: /health
            from starlette.testclient import TestClient  # type: ignore

            client = TestClient(app)
            resp = client.get("/health")
            data = resp.json()
            stage["ok"] = bool(data.get("ok"))
            stage["detail"] = (
                f"Rooms {data.get('rooms', 0)} · Bot 이벤트 {data.get('bot', {}).get('lastEventAgeSec')}s 전"
                if stage["ok"]
                else "FastAPI가 비정상 상태입니다."
            )
            stage["timestamp"] = data.get("bot", {}).get("lastEventTs")
            stage["extra"] = data
        except Exception as e:
            stage["ok"] = False
            stage["detail"] = f"연결 오류: {e}"
        return stage

    def _kb_stage():
        stage = {
            "key": "kb",
            "name": "KB API (FastAPI)",
            "ok": False,
            "detail": "상태 확인 중...",
        }
        url = f"{KB_BASE}/health"
        try:
            with _urlreq.urlopen(url, timeout=2) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                try:
                    data = json.loads(raw or "{}")
                except Exception:
                    data = {}
                ok = (getattr(resp, "status", None) in (200, None)) and bool(data.get("ok"))
                stage["ok"] = bool(ok)
                stage["detail"] = "KB /health 200 OK" if stage["ok"] else f"KB /health 비정상 (body/ok=false)"
                stage["timestamp"] = datetime.now(timezone.utc).isoformat()
                stage["extra"] = {"url": url}
        except Exception as e:
            stage["ok"] = False
            stage["detail"] = f"KB 연결 실패: {e}"
            stage["timestamp"] = datetime.now(timezone.utc).isoformat()
            stage["extra"] = {"url": url, "error": str(e)}
        return stage

    def _kb_postgres_stage():
        import socket

        host = os.getenv("KB_PG_HOST") or "127.0.0.1"
        port_raw = os.getenv("KB_PG_PORT") or "5433"
        try:
            port = int(port_raw)
        except Exception:
            port = 5433

        stage = {
            "key": "kbPostgres",
            "name": "KB Postgres (pgvector)",
            "ok": False,
            "detail": "상태 확인 중...",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "extra": {"host": host, "port": port},
        }
        try:
            sock = socket.create_connection((host, port), timeout=0.8)
            try:
                sock.close()
            except Exception:
                pass
            stage["ok"] = True
            stage["detail"] = f"TCP 연결 OK ({host}:{port})"
        except Exception as e:
            stage["ok"] = False
            stage["detail"] = f"연결 실패: {e}"
            stage["extra"] = {"host": host, "port": port, "error": str(e)}
        return stage

    device_stage = _device_stage()
    bot_stage = _bot_stage()
    log_stage, latest_ts = _log_stage()
    realtime_stage = await _realtime_stage()
    kb_stage = _kb_stage()
    kb_pg_stage = _kb_postgres_stage()

    stages = {
        "device": device_stage,
        "bot": bot_stage,
        "logStore": log_stage,
        "realtime": realtime_stage,
        "kb": kb_stage,
        "kbPostgres": kb_pg_stage,
        "ui": {
            "key": "ui",
            "name": "Dashboard (Next.js)",
            "ok": True,
            "detail": "현재 대시보드 UI는 정상적으로 동작 중입니다.",
        },
    }
    updated_at = latest_ts or device_stage.get("timestamp") or bot_stage.get("timestamp")
    return JSONResponse(content={"updatedAt": updated_at, "stages": stages})


@app.get("/logs")
async def logs(roomId: Optional[str] = None, limit: int = 80, include: str = "", exclude: str = ""):
    limit = max(1, min(int(limit), 500))
    inc = _parse_keywords(include)
    exc = _parse_keywords(exclude)
    if roomId:
        recs = tail_room(roomId, limit * 2)
    else:
        recs = tail_all(limit * 2)
    out = apply_keyword_filter(recs, inc, exc, limit)
    return JSONResponse(content=out)


@app.get("/logs/bulk")
async def logs_bulk(rooms: Optional[str] = None, limit: int = 80, include: str = "", exclude: str = "", all: int = 0):
    """Return recent logs for multiple rooms in one snapshot.
    Query params:
      - rooms: comma-separated room ids
      - limit: max per room
      - include/exclude: keywords (spaces/commas)
      - all: 1 to include global recent feed (deduped)
    """
    limit = max(1, min(int(limit), 500))
    inc = _parse_keywords(include)
    exc = _parse_keywords(exclude)
    result: Dict[str, List[dict]] = {}
    room_ids: List[str] = []
    if rooms:
      room_ids = [r.strip() for r in rooms.split(',') if r.strip()]
    if room_ids:
      base = tail_bulk(room_ids, limit * 2)
      for rid, entries in base.items():
        result[rid] = apply_keyword_filter(entries, inc, exc, limit)
    out: Dict[str, any] = { 'rooms': result }
    send_all = str(all).lower() in ("1","true","yes","y") or (all == 1)
    if send_all:
      out['all'] = apply_keyword_filter(tail_all(limit * 2), inc, exc, limit)
    return JSONResponse(content=out)


@app.get("/rooms")
async def rooms():
    base = list_rooms()
    ids = []
    for r in base:
        if isinstance(r, dict) and r.get("roomId") is not None:
            ids.append(str(r.get("roomId")))

    counts: dict[str, int] = {}
    names: dict[str, str] = {}
    try:
        counts = _fetch_active_member_counts(ids)
    except Exception as e:
        logger.warning("[rooms] activeMembersCount fetch failed: %s", str(e))
    try:
        names = _fetch_room_names(ids)
    except Exception as e:
        logger.warning("[rooms] roomName(meta) fetch failed: %s", str(e))

    for r in base:
        if not isinstance(r, dict):
            continue
        rid = str(r.get("roomId") or "").strip()
        if rid and rid in counts:
            r["activeMembersCount"] = counts[rid]
        # log snapshot에 roomName이 없거나 roomId로만 표시되는 경우, IRIS meta에서 보강한다.
        cur_name = str(r.get("roomName") or "").strip()
        if rid and (not cur_name or cur_name == rid) and rid in names:
            r["roomName"] = names[rid]
    return JSONResponse(content=base)


@app.post("/rooms/resolve")
async def rooms_resolve(request: Request):
    """roomId → roomName을 best-effort로 해석한다.

    Body:
      { "roomIds": ["184...", ...] }

    Returns:
      { ok: true, names: { roomId: roomName, ... }, missing: [roomId, ...] }
    """
    try:
        body = await request.json()
    except Exception:
        body = {}

    raw = None
    if isinstance(body, dict):
        raw = body.get("roomIds")
        if raw is None:
            raw = body.get("room_ids")
        if raw is None:
            raw = body.get("ids")
    if raw is None:
        raw = []
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail="roomIds는 배열이어야 합니다")

    ids: list[str] = []
    seen: set[str] = set()
    for it in raw:
        rid = str(it or "").strip()
        if not rid:
            continue
        if rid in seen:
            continue
        seen.add(rid)
        ids.append(rid)
        if len(ids) >= 500:
            break

    if not ids:
        return JSONResponse(content={"ok": True, "names": {}, "missing": []})

    names = _fetch_room_names(ids)
    log_names: dict[str, str] = {}
    try:
        # log snapshot(last line) 기반 roomName 보정(= /rooms와 동일한 fallback)
        # - IRIS meta(chat_rooms.meta)에 없는 방도 logs/*/last snapshot에는 roomName이 있을 수 있다.
        for r in list_rooms():
            if not isinstance(r, dict):
                continue
            rid = str(r.get("roomId") or "").strip()
            nm = str(r.get("roomName") or "").strip()
            if not rid or not nm:
                continue
            # name==rid는 정보가 없다는 뜻이므로 우선순위 낮음
            if nm != rid:
                log_names[rid] = nm
    except Exception as e:
        logger.warning("[rooms/resolve] log snapshot fallback failed: %s", str(e))
    out_names: dict[str, str] = {}
    missing: list[str] = []
    for rid in ids:
        nm = names.get(rid)
        if not nm:
            nm = log_names.get(rid)
        if nm:
            out_names[rid] = nm
        else:
            missing.append(rid)

    return JSONResponse(content={"ok": True, "names": out_names, "missing": missing})


def _clamp_int(v: object, lo: int, hi: int, default: int) -> int:
    try:
        n = int(v)  # type: ignore[arg-type]
    except Exception:
        return default
    if n < lo:
        return lo
    if n > hi:
        return hi
    return n


def _iris_query_strict(query: str, bind: list, timeout_sec: float = 3.0) -> list[dict]:
    base = _iris_base()
    url = base + "/query"
    status, txt = _http_post_json(url, {"query": query, "bind": bind}, headers={}, timeout=timeout_sec)
    if status != 200:
        raise HTTPException(status_code=503, detail=f"IRIS /query failed: HTTP {status}")
    try:
        obj = json.loads(txt) if txt else {}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"IRIS /query invalid json: {e}")
    data = obj.get("data")
    if not isinstance(data, list):
        raise HTTPException(status_code=503, detail="IRIS /query invalid response: missing data[]")
    return data


def _fetch_room_admins_from_iris(room_id: str) -> dict:
    rid = str(room_id or "").strip()
    if not rid:
        raise HTTPException(status_code=400, detail="roomId required")

    # open_chat_member가 비어있을 수 있으므로, 호스트는 open_link로도 보강한다.
    # 1) loadedMembersCount / activeMembersCount
    cnt_rows = _iris_query_strict(
        "select count(distinct user_id) as cnt from db2.open_chat_member where involved_chat_id=?",
        [rid],
        timeout_sec=6.0,
    )
    loaded_cnt = 0
    if cnt_rows and isinstance(cnt_rows[0], dict):
        loaded_cnt = _safe_int(cnt_rows[0].get("cnt")) or 0
    active = _fetch_active_member_counts([rid]).get(rid)

    # 2) 운영진 목록(최신 rowid 기준)
    rows = _iris_query_strict(
        "select user_id, nickname, link_member_type from db2.open_chat_member "
        "where involved_chat_id=? and link_member_type in (8,4,1) order by rowid desc limit 3000",
        [rid],
        timeout_sec=8.0,
    )

    seen: set[str] = set()
    host: list[dict] = []
    subhosts: list[dict] = []
    admins: list[dict] = []

    for row in rows:
        if not isinstance(row, dict):
            continue
        uid = str(row.get("user_id") or "").strip()
        if not uid or uid in seen:
            continue
        seen.add(uid)
        nick = str(row.get("nickname") or "").strip() or None
        t = _safe_int(row.get("link_member_type"))
        if t == 8:
            host.append({"userId": uid, "nickname": nick})
            admins.append({"userId": uid, "nickname": nick})
        elif t in (4, 1):
            subhosts.append({"userId": uid, "nickname": nick})
            admins.append({"userId": uid, "nickname": nick})

    if not host:
        try:
            owner_rows = _iris_query_strict(
                "select ol.user_id as user_id from chat_rooms cr join db2.open_link ol on cr.link_id=ol.id where cr.id=? limit 1",
                [rid],
                timeout_sec=6.0,
            )
            if owner_rows and isinstance(owner_rows[0], dict):
                ouid = str(owner_rows[0].get("user_id") or "").strip()
                if ouid:
                    host.append({"userId": ouid, "nickname": None})
                    if ouid not in {a.get("userId") for a in admins}:
                        admins.append({"userId": ouid, "nickname": None})
        except Exception as e:
            logger.warning("[rooms/admins] owner fallback failed: %s", str(e))

    hint = None
    if loaded_cnt == 0:
        hint = "IRIS open_chat_member가 비어있습니다. Redroid(단말)에서 멤버 목록을 열어 스크롤해 DB를 채워야 권한 판별이 정확해집니다."

    return {
        "ok": True,
        "roomId": rid,
        "activeMembersCount": active,
        "loadedMembersCount": loaded_cnt,
        "host": host,
        "subhosts": subhosts,
        "admins": admins,
        "hint": hint,
    }


@app.get("/rooms/{room_id}/members")
async def room_members(room_id: str, q: str | None = None, limit: int = 200, offset: int = 0):
    """Return openchat members from IRIS db2.open_chat_member.

    Notes:
    - For very large rooms, db2.open_chat_member may be incomplete until member list is opened/scrolled on device.
      See: scripts/openchat_load_members.ps1
    """
    rid = str(room_id or "").strip()
    if not rid:
        raise HTTPException(status_code=400, detail="roomId required")

    limit2 = _clamp_int(limit, 1, 500, 200)
    offset2 = _clamp_int(offset, 0, 2_000_000_000, 0)
    q2 = str(q or "").strip()

    where = "where involved_chat_id=?"
    bind: list[object] = [rid]
    if q2:
        where += " and nickname like ?"
        bind.append(f"%{q2}%")

    # total loaded members (distinct user_id)
    cnt_rows = _iris_query_strict(
        f"select count(distinct user_id) as cnt from db2.open_chat_member {where}",
        bind,
        timeout_sec=6.0,
    )
    loaded_cnt = 0
    if cnt_rows and isinstance(cnt_rows[0], dict):
        loaded_cnt = _safe_int(cnt_rows[0].get("cnt")) or 0

    # paged list
    rows = _iris_query_strict(
        f"select user_id, max(nickname) as nickname from db2.open_chat_member {where} "
        "group by user_id order by nickname limit ? offset ?",
        bind + [limit2, offset2],
        timeout_sec=10.0,
    )
    members: list[dict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        uid = str(row.get("user_id") or "").strip()
        nick = str(row.get("nickname") or "").strip()
        if not uid:
            continue
        members.append({"userId": uid, "nickname": nick})

    active = _fetch_active_member_counts([rid]).get(rid)
    hint = None
    if loaded_cnt == 0:
        hint = "IRIS open_chat_member가 비어있습니다. 단말에서 멤버 목록을 열어 스크롤해 DB를 채우거나 scripts/openchat_load_members.ps1 를 실행하세요."

    return JSONResponse(
        content={
            "ok": True,
            "roomId": rid,
            "activeMembersCount": active,
            "loadedMembersCount": loaded_cnt,
            "limit": limit2,
            "offset": offset2,
            "members": members,
            "hint": hint,
        },
    )


@app.get("/avatar/{room_id}")
async def avatar(room_id: str):
    p = find_avatar_path(room_id)
    if not p:
        # auto: room avatar가 업로드되어 있지 않으면 IRIS DB(open_link.icon_url) 기반으로 썸네일을 자동 제공한다.
        url = _resolve_openchat_icon_url(str(room_id))
        if not url:
            return Response(status_code=404)
        return RedirectResponse(url=url, status_code=307, headers={"Cache-Control": "public, max-age=3600"})
    # naive content-type
    ext = p.suffix.lower()
    ctype = "image/jpeg"
    if ext == ".png":
        ctype = "image/png"
    elif ext == ".webp":
        ctype = "image/webp"
    return Response(content=p.read_bytes(), media_type=ctype)


@app.post("/avatar/{room_id}")
async def upload_avatar(room_id: str, file: UploadFile = File(...)):
    # Save avatar to AVATAR_DIR with detected extension
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    from .log_utils import AVATAR_DIR
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    ext = ".jpg"
    name = (file.filename or "").lower()
    if name.endswith(".png"): ext = ".png"
    elif name.endswith(".webp"): ext = ".webp"
    # Clean previous
    for e in (".jpg",".jpeg",".png",".webp"):
        p = AVATAR_DIR / f"{room_id}{e}"
        try:
            if p.exists(): p.unlink()
        except Exception:
            pass
    dst = AVATAR_DIR / f"{room_id}{ext}"
    dst.write_bytes(data)
    return {"ok": True}


@app.get("/runtime")
async def get_runtime():
    cfg = load_runtime()
    # no enforcement here; runtime decides (default True via load_runtime)
    return JSONResponse(content=cfg)


@app.post("/runtime")
async def update_runtime(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid json")
    cur = load_runtime()
    # allowedRoomIds: only set when explicitly provided; otherwise keep existing.
    allowed_from_body = body.get("allowedRoomIds") if isinstance(body, dict) else None
    if isinstance(allowed_from_body, list):
        cur["allowedRoomIds"] = [str(x).strip() for x in allowed_from_body if str(x).strip()]
    # Only allow updating features, excludedRoomIds, and template selection.
    features = body.get("features")
    if isinstance(features, dict):
        cur["features"] = features
    excluded = body.get("excludedRoomIds")
    if isinstance(excluded, list):
        # normalize to strings
        cur["excludedRoomIds"] = [str(x) for x in excluded]
    # announcement config (source → targets mirror)
    announcement = body.get("announcement")
    if announcement is not None:
        if not isinstance(announcement, dict):
            raise HTTPException(status_code=400, detail="announcement must be an object")
        cur_ann = cur.get("announcement")
        if not isinstance(cur_ann, dict):
            cur_ann = {}

        if "allowWhenSafeMode" in announcement:
            v = announcement.get("allowWhenSafeMode")
            if v is None:
                cur_ann.pop("allowWhenSafeMode", None)
            elif isinstance(v, bool):
                cur_ann["allowWhenSafeMode"] = v
            else:
                raise HTTPException(status_code=400, detail="announcement.allowWhenSafeMode must be boolean or null")

        if "routes" in announcement:
            routes = announcement.get("routes")
            if routes is None:
                cur_ann.pop("routes", None)
            elif not isinstance(routes, list):
                raise HTTPException(status_code=400, detail="announcement.routes must be an array or null")
            else:
                norm_routes = []
                for i, r in enumerate(routes):
                    if not isinstance(r, dict):
                        raise HTTPException(status_code=400, detail=f"announcement.routes[{i}] must be an object")

                    rid = str(r.get("id") or "").strip()
                    if not rid:
                        raise HTTPException(status_code=400, detail=f"announcement.routes[{i}].id is required")

                    source = str(r.get("source") or "").strip()
                    if not source:
                        raise HTTPException(status_code=400, detail=f"announcement.routes[{i}].source is required")

                    targets = r.get("targets")
                    if not isinstance(targets, list) or len(targets) == 0:
                        raise HTTPException(status_code=400, detail=f"announcement.routes[{i}].targets must be a non-empty array")
                    norm_targets: list[str] = []
                    seen: set[str] = set()
                    for t in targets:
                        ts = str(t or "").strip()
                        if not ts:
                            continue
                        # loop 방지: source를 targets에 넣어도 저장은 하되, 정규화 시 제외한다.
                        if ts == source:
                            continue
                        if ts in seen:
                            continue
                        seen.add(ts)
                        norm_targets.append(ts)
                    if len(norm_targets) == 0:
                        raise HTTPException(status_code=400, detail=f"announcement.routes[{i}].targets must include at least 1 valid target")

                    enabled = r.get("enabled")
                    if not isinstance(enabled, bool):
                        raise HTTPException(status_code=400, detail=f"announcement.routes[{i}].enabled must be boolean")

                    include_images = r.get("includeImages")
                    if include_images is not None and not isinstance(include_images, bool):
                        raise HTTPException(status_code=400, detail=f"announcement.routes[{i}].includeImages must be boolean or null")

                    include_sender = r.get("includeSenderName")
                    if include_sender is not None and not isinstance(include_sender, bool):
                        raise HTTPException(status_code=400, detail=f"announcement.routes[{i}].includeSenderName must be boolean or null")

                    delay_ms = r.get("delayMs")
                    norm_delay_ms = None
                    if delay_ms is not None:
                        try:
                            norm_delay_ms = int(delay_ms)
                        except Exception:
                            raise HTTPException(status_code=400, detail=f"announcement.routes[{i}].delayMs must be int or null")
                        norm_delay_ms = max(0, min(30_000, norm_delay_ms))

                    append_target_index = r.get("appendTargetIndex")
                    if append_target_index is not None and not isinstance(append_target_index, bool):
                        raise HTTPException(status_code=400, detail=f"announcement.routes[{i}].appendTargetIndex must be boolean or null")

                    target_index_start = r.get("targetIndexStart")
                    norm_target_index_start = None
                    if target_index_start is not None:
                        try:
                            norm_target_index_start = int(target_index_start)
                        except Exception:
                            raise HTTPException(status_code=400, detail=f"announcement.routes[{i}].targetIndexStart must be int or null")
                        norm_target_index_start = max(1, norm_target_index_start)

                    out = {
                        "id": rid,
                        "source": source,
                        "targets": norm_targets,
                        "enabled": enabled,
                    }
                    if include_images is not None:
                        out["includeImages"] = include_images
                    if include_sender is not None:
                        out["includeSenderName"] = include_sender
                    if norm_delay_ms is not None:
                        out["delayMs"] = norm_delay_ms
                    if append_target_index is not None:
                        out["appendTargetIndex"] = append_target_index
                    if norm_target_index_start is not None:
                        out["targetIndexStart"] = norm_target_index_start
                    norm_routes.append(out)

                cur_ann["routes"] = norm_routes

        if cur_ann:
            cur["announcement"] = cur_ann
        else:
            cur.pop("announcement", None)
    # Legacy single welcome template name (kept for compatibility)
    wt = body.get("welcomeTemplateName")
    if isinstance(wt, str) and wt:
        cur["welcomeTemplateName"] = wt
        tbf = cur.get("templateByFeature") or {}
        if isinstance(tbf, dict):
            tbf["welcome"] = wt
            cur["templateByFeature"] = tbf
    # New style multi-feature template mapping
    tbf = body.get("templateByFeature")
    if isinstance(tbf, dict):
        # string-only normalization
        norm: dict[str, str] = {}
        for k, v in tbf.items():
            if isinstance(k, str) and isinstance(v, str) and v:
                norm[k] = v
        cur["templateByFeature"] = norm
        # keep legacy key in sync
        if "welcome" in norm:
            cur["welcomeTemplateName"] = norm["welcome"]
    # SAFE MODE: allow explicit toggle via body.safeMode (default True on first load)
    safe = body.get("safeMode")
    if isinstance(safe, bool):
        cur["safeMode"] = safe
    # talk-api runtime config (optional)
    talk = body.get("talkApi")
    if isinstance(talk, dict):
        cur.setdefault("talkApi", {})
        cur["talkApi"].update({
            "enabled": bool(talk.get("enabled", cur.get("talkApi",{}).get("enabled", False))),
            "baseUrl": str(talk.get("baseUrl", cur.get("talkApi",{}).get("baseUrl", "https://talk-api.naijun.dev"))),
            "authHeader": str(talk.get("authHeader", cur.get("talkApi",{}).get("authHeader", ""))),
            "timeoutMs": int(talk.get("timeoutMs", cur.get("talkApi",{}).get("timeoutMs", 8000))),
        })

    # Welcome template set config (optional)
    w = body.get("welcome")
    if w is not None:
        if not isinstance(w, dict):
            raise HTTPException(status_code=400, detail="welcome must be an object")

        cur_w = cur.get("welcome")
        if not isinstance(cur_w, dict):
            cur_w = {}

        # templateSets can be set to null to disable set mode
        if "templateSets" in w:
            ts = w.get("templateSets")
            if ts is None:
                cur_w.pop("templateSets", None)
            elif not isinstance(ts, dict):
                raise HTTPException(status_code=400, detail="welcome.templateSets must be an object or null")
            else:
                def _norm_list(key: str) -> list[str]:
                    arr = ts.get(key)
                    if not isinstance(arr, list) or len(arr) == 0:
                        raise HTTPException(status_code=400, detail=f"welcome.templateSets.{key} must be a non-empty array of strings")
                    out: list[str] = []
                    for i, v in enumerate(arr):
                        if not isinstance(v, str) or not v.strip():
                            raise HTTPException(status_code=400, detail=f"welcome.templateSets.{key}[{i}] must be a non-empty string")
                        out.append(v.strip())
                    return out

                cur_w["templateSets"] = {
                    "kakaoDefaultNickname": _norm_list("kakaoDefaultNickname"),
                    "customNickname": _norm_list("customNickname"),
                }

        if "templateSetPick" in w:
            pick = w.get("templateSetPick")
            if pick is None:
                cur_w.pop("templateSetPick", None)
            elif not isinstance(pick, str) or pick.strip() not in ("random", "hash_sender_id", "hash_user_name"):
                raise HTTPException(status_code=400, detail="welcome.templateSetPick must be one of: random | hash_sender_id | hash_user_name")
            else:
                cur_w["templateSetPick"] = pick.strip()

        if "kakaoDefaultNicknameRegexes" in w:
            rx = w.get("kakaoDefaultNicknameRegexes")
            if rx is None:
                cur_w.pop("kakaoDefaultNicknameRegexes", None)
            elif not isinstance(rx, list) or len(rx) == 0:
                raise HTTPException(status_code=400, detail="welcome.kakaoDefaultNicknameRegexes must be a non-empty array of strings")
            else:
                out: list[str] = []
                for i, v in enumerate(rx):
                    if not isinstance(v, str) or not v.strip():
                        raise HTTPException(status_code=400, detail=f"welcome.kakaoDefaultNicknameRegexes[{i}] must be a non-empty string")
                    out.append(v.strip())
                cur_w["kakaoDefaultNicknameRegexes"] = out

        # Welcome send delay config (optional, ms)
        if "sendDelayMinMs" in w:
            v = w.get("sendDelayMinMs")
            if v is None:
                cur_w.pop("sendDelayMinMs", None)
            else:
                try:
                    n = int(v)
                except Exception:
                    raise HTTPException(status_code=400, detail="welcome.sendDelayMinMs must be an integer (ms)")
                if n < 0 or n > 600_000:
                    raise HTTPException(status_code=400, detail="welcome.sendDelayMinMs must be between 0 and 600000 (ms)")
                cur_w["sendDelayMinMs"] = n

        if "sendDelayMaxMs" in w:
            v = w.get("sendDelayMaxMs")
            if v is None:
                cur_w.pop("sendDelayMaxMs", None)
            else:
                try:
                    n = int(v)
                except Exception:
                    raise HTTPException(status_code=400, detail="welcome.sendDelayMaxMs must be an integer (ms)")
                if n < 0 or n > 600_000:
                    raise HTTPException(status_code=400, detail="welcome.sendDelayMaxMs must be between 0 and 600000 (ms)")
                cur_w["sendDelayMaxMs"] = n

        # Validate delay range when both exist
        if "sendDelayMinMs" in cur_w and "sendDelayMaxMs" in cur_w:
            try:
                mn = int(cur_w.get("sendDelayMinMs") or 0)
                mx = int(cur_w.get("sendDelayMaxMs") or 0)
            except Exception:
                raise HTTPException(status_code=400, detail="welcome.sendDelayMinMs/sendDelayMaxMs must be integers (ms)")
            if mx < mn:
                raise HTTPException(status_code=400, detail="welcome.sendDelayMaxMs must be >= welcome.sendDelayMinMs")

        # If set mode is enabled, require pick + regexes to exist (after merge)
        if isinstance(cur_w.get("templateSets"), dict):
            if not isinstance(cur_w.get("templateSetPick"), str) or not str(cur_w.get("templateSetPick") or "").strip():
                raise HTTPException(status_code=400, detail="welcome.templateSetPick is required when welcome.templateSets is set")
            rx = cur_w.get("kakaoDefaultNicknameRegexes")
            if not isinstance(rx, list) or len(rx) == 0:
                raise HTTPException(status_code=400, detail="welcome.kakaoDefaultNicknameRegexes is required when welcome.templateSets is set")

        if cur_w:
            cur["welcome"] = cur_w
        else:
            cur.pop("welcome", None)
    # Normalize/expand allowedRoomIds
    # - 기본은 "명시적으로 받은 allowedRoomIds" 또는 "기존 값"을 유지한다.
    # - 단, 공지(source/targets) 및 기능 토글로 실제 발신이 필요한 방은 allowlist에 반드시 포함되어야 하므로
    #   현재 설정(cur) 기준으로 required ids를 union 한다.
    try:
        # excludedRoomIds는 allowlist에서 항상 제거한다.
        excluded_set: set[str] = set()
        try:
            if isinstance(cur.get("excludedRoomIds"), list):
                for x in cur.get("excludedRoomIds") or []:
                    t = str(x or "").strip()
                    if t:
                        excluded_set.add(t)
        except Exception:
            excluded_set = set()

        required: set[str] = set()

        # 1) features: value가 True인 feature가 하나라도 있으면 allowlist에 포함
        feats = cur.get("features") or {}
        if isinstance(feats, dict):
            for rid, flags in feats.items():
                rid2 = str(rid or "").strip()
                if not rid2 or not isinstance(flags, dict):
                    continue
                if any(v is True for v in flags.values()):
                    required.add(rid2)

        # 2) announcement routes: source/targets는 allowlist에 포함되어야 공지 전파가 동작한다.
        ann = cur.get("announcement")
        if isinstance(ann, dict):
            routes = ann.get("routes")
            if isinstance(routes, list):
                for r in routes:
                    if not isinstance(r, dict):
                        continue
                    src = str(r.get("source") or "").strip()
                    if src:
                        required.add(src)
                    tgts = r.get("targets")
                    if isinstance(tgts, list):
                        for t in tgts:
                            ts = str(t or "").strip()
                            if ts:
                                required.add(ts)

        # 3) merge(keep existing order)
        existing = cur.get("allowedRoomIds") or []
        merged: list[str] = []
        seen: set[str] = set()
        if isinstance(existing, list):
            for x in existing:
                rid = str(x or "").strip()
                if not rid or rid in excluded_set or rid in seen:
                    continue
                seen.add(rid)
                merged.append(rid)

        for rid in sorted(required):
            if not rid or rid in excluded_set or rid in seen:
                continue
            seen.add(rid)
            merged.append(rid)

        cur["allowedRoomIds"] = merged
    except Exception:
        # On error, keep existing allowedRoomIds as-is
        pass
    save_runtime(cur)
    return JSONResponse(content=cur)


# Templates
@app.get("/templates")
async def templates(category: str | None = None):
    return JSONResponse(content=list_templates(category))


@app.get("/templates/{category}/{name}")
async def template_get(category: str, name: str):
    try:
        data = load_template(category, name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="not found")
    return JSONResponse(content=data)


@app.post("/templates/{category}/{name}")
async def template_put(category: str, name: str, request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid json")
    data = save_template(category, name, body)
    return JSONResponse(content=data)


@app.delete("/templates/{category}/{name}")
async def template_delete(category: str, name: str):
    delete_template(category, name)
    return {"ok": True}


@app.post("/templates/{category}/{name}/image")
async def template_add_image(category: str, name: str, file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    assets = assets_dir_for(category, name)
    assets.mkdir(parents=True, exist_ok=True)
    low = (file.filename or "").lower()
    ext = ".jpg"
    if low.endswith('.png'): ext = '.png'
    elif low.endswith('.webp'): ext = '.webp'
    import time
    fname = f"{int(time.time()*1000)}_{low or 'image'}"
    if not any(fname.endswith(e) for e in ('.jpg','.jpeg','.png','.webp')):
        fname = fname + ext
    dst = assets / fname
    dst.write_bytes(data)
    # Update template JSON images list
    try:
        tpl = load_template(category, name)
    except FileNotFoundError:
        tpl = {"title": name, "content": "", "category": category, "images": []}
    rel = f"assets/{category}/{name}/{fname}"
    imgs = list(tpl.get('images') or [])
    imgs.append(rel)
    tpl['images'] = imgs
    save_template(category, name, tpl)
    return {"ok": True, "path": rel}


@app.get("/templates/assets/{category}/{name}/{rest:path}")
async def template_asset(category: str, name: str, rest: str):
    p = assets_dir_for(category, name) / rest
    if not p.exists():
        return Response(status_code=404)
    ext = p.suffix.lower()
    ctype = "image/jpeg"
    if ext == ".png": ctype = "image/png"
    elif ext == ".webp": ctype = "image/webp"
    return Response(content=p.read_bytes(), media_type=ctype)


def _render_template_text(content: str, ctx: dict) -> tuple[str, list[str]]:
    """Render template text with variables and extract mention targets.
    Supported:
      - {{var}} → ctx[var]
      - @{var}  → "@" + ctx[var] and collect as mention target
    Korean aliases allowed, e.g., '입장인원변수' can be used as var name.
    """
    text = content or ""
    mentions: list[str] = []

    # mention tokens: @{var}
    def rep_mention(m: re.Match) -> str:
        key = (m.group(1) or '').strip()
        # common aliases
        aliases = [key]
        if key in ('입장인원변수','입장자','입장닉네임'):
            aliases += ['entrant', 'entrance', 'entrantName', 'username', 'userName', 'joinUser']
        elif key in ('entrant','entrance','username','userName','joinUser','entrantName'):
            aliases += ['입장인원변수','입장자']
        val = None
        for k in aliases:
            if k in ctx and str(ctx[k]).strip():
                val = str(ctx[k]).strip()
                break
        if val:
            if val not in mentions:
                mentions.append(val)
            return '@' + val
        return m.group(0)  # leave as is

    text = re.sub(r"@\{([^}]+)\}", rep_mention, text)

    # simple {{var}} replacement (no escaping)
    def rep_var(m: re.Match) -> str:
        key = (m.group(1) or '').strip()
        if key in ctx:
            try:
                return str(ctx[key])
            except Exception:
                return ''
        return m.group(0)

    text = re.sub(r"\{\{\s*([^}]+?)\s*\}\}", rep_var, text)

    # legacy-style {var} replacement (kept for compatibility with existing templates)
    def rep_var1(m: re.Match) -> str:
        key = (m.group(1) or '').strip()
        if key in ctx:
            try:
                return str(ctx[key])
            except Exception:
                return ''
        return m.group(0)

    text = re.sub(r"\{([^}]+)\}", rep_var1, text)
    return text, mentions


def _map_names_to_ids(room_id: str, names: list[str]) -> list[dict]:
    """Best-effort mapping: use recent logs in this room to map senderName -> senderId.
    Returns list of { name, userId } for names we could map.
    """
    try:
        from .log_utils import get_logs_dir
        names_set = {str(n).strip() for n in names if str(n).strip()}
        out = []
        d = get_logs_dir() / str(room_id)
        files = sorted(d.glob('*.log'))
        seen = set()
        for p in reversed(files[-3:]):
            try:
                lines = p.read_text(encoding='utf-8', errors='ignore').splitlines()
            except Exception:
                continue
            for ln in reversed(lines[-800:]):
                try:
                    o = json.loads(ln)
                except Exception:
                    continue
                snap = o.get('snapshot', {}) if isinstance(o, dict) else {}
                nm = str(snap.get('senderName') or '').strip()
                uid = str(snap.get('senderId') or '').strip()
                if nm and uid and nm in names_set and nm not in seen:
                    out.append({ 'name': nm, 'userId': uid })
                    seen.add(nm)
                if names_set.issubset(seen):
                    break
        return out
    except Exception:
        return []


@app.post("/templates/{category}/{name}/render")
async def template_render(category: str, name: str, request: Request):
    """Render a template with provided variables (SAFE: no send).
    Body JSON can be either the raw context or {"context": {...}}.
    Returns: { content, mentions, images, safeMode }
    """
    try:
        body = await request.json()
    except Exception:
        body = {}
    ctx = body.get('context') if isinstance(body, dict) else None
    if not isinstance(ctx, dict):
        ctx = body if isinstance(body, dict) else {}
    try:
        tpl = load_template(category, name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="not found")
    content = str(tpl.get('content') or '')
    rendered, mention_targets = _render_template_text(content, ctx)
    imgs = list(tpl.get('images') or [])
    safe = load_runtime().get('safeMode', True)
    return JSONResponse(content={
        "content": rendered,
        "mentions": mention_targets,
        "images": imgs,
        "safeMode": bool(safe),
    })


# --- Talk-API integration (prepare + optional send) ---

def _runtime_get_talk_cfg() -> dict:
    cfg = load_runtime()
    talk = cfg.get("talkApi") or {}
    if not isinstance(talk, dict):
        talk = {}
    talk.setdefault("enabled", False)
    talk.setdefault("baseUrl", "https://talk-api.naijun.dev")
    talk.setdefault("authHeader", "")
    talk.setdefault("timeoutMs", 8000)
    return talk


def _make_mention_attachment(message: str, mentionees: list[dict]) -> dict:
    """Build an attachment object for Kakao mention.

    LOCO-style mention struct:
      attachment.mentions: [{ user_id: <int64>, at: [1,2,...], len: <name_len_utf16> }]

    Notes (aligned with storycraft/node-kakao MentionStruct):
    - `at` is NOT a character offset. It is a 1-based mention order index list.
      (e.g., first mention -> at=[1], second -> at=[2], ...; same user can have multiple at entries)
    - `len` is the display name length excluding '@', measured in UTF-16 code units
      (matches JS/Kotlin String.length behavior; important for emoji).
    - `user_id` should be int64 (we accept string input but validate/convert to int).
    """
    def _utf16_len(s: str) -> int:
        # JS/Kotlin String.length == UTF-16 code units
        try:
            return len((s or "").encode("utf-16-le")) // 2
        except Exception:
            return len(str(s or ""))

    msg = str(message or "")
    if not mentionees:
        return {}
    if not isinstance(mentionees, list):
        raise ValueError("mentionees must be a list")

    entries: list[dict] = []
    for i, m in enumerate(mentionees):
        if not isinstance(m, dict):
            raise ValueError(f"mentionees[{i}] must be an object")
        name = str(m.get("name") or "").strip()
        uid_raw = str(m.get("userId") or m.get("user_id") or "").strip()
        if not name or not uid_raw:
            raise ValueError(f"mentionees[{i}] missing name/userId")
        if not uid_raw.isdigit():
            raise ValueError(f"mentionees[{i}].userId must be digits (int64)")
        token = "@" + name
        entries.append({
            "i": i,
            "name": name,
            "uid": int(uid_raw),
            "token": token,
            "tlen": len(token),
        })

    # Enforce Kakao server side limit (commonly 15 mentions per message).
    if len(entries) > 15:
        raise ValueError(f"too many mentions: {len(entries)} (max 15)")

    # Assign each mentionee to a distinct token occurrence, scanning message left-to-right.
    # This avoids ambiguous duplicates (same name or same user mentioned multiple times).
    queues: dict[str, list[int]] = {}
    for idx, e in enumerate(entries):
        queues.setdefault(e["token"], []).append(idx)

    cursor = 0
    ordered_indices: list[int] = []
    remaining = sum(len(v) for v in queues.values())
    while remaining > 0:
        best = None  # (pos, -tlen, token)
        for token, q in queues.items():
            if not q:
                continue
            pos = msg.find(token, cursor)
            if pos < 0:
                continue
            tlen = len(token)
            cand = (pos, -tlen, token)
            if best is None or cand < best:
                best = cand
        if best is None:
            # Find one missing token for a clearer error message.
            missing = next((t for t, q in queues.items() if q), None)
            raise ValueError(f"message does not contain required mention token after pos={cursor}: {missing}")
        pos, _, token = best
        idx = queues[token].pop(0)
        ordered_indices.append(idx)
        cursor = pos + len(token)
        remaining -= 1

    # Build MentionStruct list grouped by user_id with at indices.
    mentions: list[dict] = []
    idx_by_uid: dict[int, int] = {}
    for order, entry_idx in enumerate(ordered_indices, start=1):
        e = entries[entry_idx]
        uid = int(e["uid"])
        name = str(e["name"])
        if uid in idx_by_uid:
            mi = idx_by_uid[uid]
            # Same user can be mentioned multiple times; at is a list.
            if mentions[mi]["len"] != _utf16_len(name):
                raise ValueError(f"same userId mentioned with different name length: {uid}")
            mentions[mi]["at"].append(order)
        else:
            idx_by_uid[uid] = len(mentions)
            mentions.append({
                "user_id": uid,
                "at": [order],
                "len": _utf16_len(name),
            })

    return {"mentions": mentions} if mentions else {}


def _http_post_json(url: str, data: dict, headers: dict, timeout: float) -> tuple[int, str]:
    req = _urlreq.Request(url, method='POST')
    body = json.dumps(data, ensure_ascii=False).encode('utf-8')
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    if 'Content-Type' not in req.headers:
        req.add_header('Content-Type', 'application/json')
    try:
        with _urlreq.urlopen(req, data=body, timeout=timeout) as resp:
            status = resp.getcode()
            txt = resp.read().decode('utf-8', errors='ignore')
            return status, txt
    except HTTPError as e:
        try:
            return e.code, e.read().decode('utf-8', errors='ignore')
        except Exception:
            return e.code, str(e)
    except URLError as e:
        return 0, str(e)


# ---- Avatar auto-resolve (Kakao open_link icon_url) ----
_AVATAR_AUTO_CACHE_SEC = int(os.getenv("AVATAR_AUTO_CACHE_SEC", "3600"))
_avatar_auto_cache: dict[str, tuple[float, str]] = {}
_ROOM_COUNT_CACHE_SEC = int(os.getenv("ROOM_COUNT_CACHE_SEC", "30"))
_room_count_cache: dict[str, tuple[float, int]] = {}
_ROOM_NAME_CACHE_SEC = int(os.getenv("ROOM_NAME_CACHE_SEC", "3600"))
_room_name_cache: dict[str, tuple[float, str]] = {}


def _iris_base() -> str:
    return (os.getenv("IRIS_URL") or os.getenv("IRIS_BRIDGE_URL") or "http://127.0.0.1:5050").rstrip("/")


def _iris_query(query: str, bind: list) -> list[dict]:
    base = _iris_base()
    url = base + "/query"
    status, txt = _http_post_json(url, {"query": query, "bind": bind}, headers={}, timeout=3.0)
    if status != 200:
        logger.warning("[iris] /query non-OK: HTTP %s", status)
        return []
    try:
        obj = json.loads(txt) if txt else {}
    except Exception:
        logger.warning("[iris] /query invalid json")
        return []
    data = obj.get("data")
    return data if isinstance(data, list) else []


def _resolve_openchat_icon_url(room_id: str) -> str | None:
    now = datetime.now(timezone.utc).timestamp()
    cached = _avatar_auto_cache.get(room_id)
    if cached and now - cached[0] < max(1, _AVATAR_AUTO_CACHE_SEC):
        return cached[1]

    # 1) chat_rooms -> link_id
    rows = _iris_query("select link_id from chat_rooms where id=?", [room_id])
    link_id = None
    try:
        if rows and isinstance(rows[0], dict):
            link_id = str(rows[0].get("link_id") or "").strip()
    except Exception:
        link_id = None
    if not link_id or not link_id.isdigit():
        return None

    # 2) open_link -> icon_url/image_url
    rows2 = _iris_query("select icon_url,image_url from db2.open_link where id=?", [link_id])
    icon_url = None
    img_url = None
    if rows2 and isinstance(rows2[0], dict):
        icon_url = str(rows2[0].get("icon_url") or "").strip()
        img_url = str(rows2[0].get("image_url") or "").strip()
    url = icon_url or img_url
    if not url:
        return None
    if not (url.startswith("http://") or url.startswith("https://")):
        return None

    _avatar_auto_cache[room_id] = (now, url)
    return url


def _safe_int(v: object) -> int | None:
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


def _parse_room_name_from_meta(meta_raw: object) -> str | None:
    """Best-effort room name parse from IRIS chat_rooms.meta (JSON).

    Observed pattern in meta.content:
      "Welcome to '<ROOM_NAME>'."
    """
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

    for c in contents:
        m = re.search(r"Welcome to\s+['\"](.+?)['\"]", c)
        if m:
            name = str(m.group(1) or "").strip()
            if name:
                return name
    return None


def _fetch_room_names(room_ids: list[str]) -> dict[str, str]:
    now = datetime.now(timezone.utc).timestamp()
    out: dict[str, str] = {}

    todo: list[str] = []
    for rid in room_ids:
        rid2 = str(rid or "").strip()
        if not rid2:
            continue
        cached = _room_name_cache.get(rid2)
        if cached and now - cached[0] < max(1, _ROOM_NAME_CACHE_SEC):
            out[rid2] = cached[1]
            continue
        todo.append(rid2)

    if not todo:
        return out

    # IRIS sqlite bind limit을 고려해 chunk
    chunk_size = 200
    for i in range(0, len(todo), chunk_size):
        chunk = todo[i : i + chunk_size]
        placeholders = ",".join(["?"] * len(chunk))
        q = f"select id, meta from chat_rooms where id in ({placeholders})"
        rows = _iris_query(q, chunk)
        for row in rows:
            if not isinstance(row, dict):
                continue
            rid = str(row.get("id") or "").strip()
            if not rid:
                continue
            name = _parse_room_name_from_meta(row.get("meta"))
            if not name:
                continue
            out[rid] = name
            _room_name_cache[rid] = (now, name)

    return out


def _fetch_active_member_counts(room_ids: list[str]) -> dict[str, int]:
    now = datetime.now(timezone.utc).timestamp()
    out: dict[str, int] = {}

    todo: list[str] = []
    for rid in room_ids:
        rid2 = str(rid or "").strip()
        if not rid2:
            continue
        cached = _room_count_cache.get(rid2)
        if cached and now - cached[0] < max(1, _ROOM_COUNT_CACHE_SEC):
            out[rid2] = cached[1]
            continue
        todo.append(rid2)

    if not todo:
        return out

    # IRIS sqlite bind limit을 고려해 chunk
    chunk_size = 200
    for i in range(0, len(todo), chunk_size):
        chunk = todo[i:i + chunk_size]
        placeholders = ",".join(["?"] * len(chunk))
        q = f"select id, active_members_count from chat_rooms where id in ({placeholders})"
        rows = _iris_query(q, chunk)
        for row in rows:
            if not isinstance(row, dict):
                continue
            rid = str(row.get("id") or "").strip()
            cnt = _safe_int(row.get("active_members_count"))
            if not rid or cnt is None:
                continue
            out[rid] = cnt
            _room_count_cache[rid] = (now, cnt)

    return out


@app.post("/send/talkapi/prepare")
async def talkapi_prepare(request: Request):
    """Return payload for Talk-API send without sending (SAFE). Body:
    { roomId, message, mentionees:[{name,userId}] }
    """
    try:
        body = await request.json()
    except Exception:
        body = {}
    rid = str((body or {}).get('roomId') or '').strip()
    message = str((body or {}).get('message') or '')
    mentionees = body.get('mentionees') if isinstance(body, dict) else []
    if not isinstance(mentionees, list):
        mentionees = []
    try:
        att = _make_mention_attachment(message, mentionees)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    payload = {
        "chatId": int(rid) if rid.isdigit() else rid,
        "message": message,
        "attachment": att or {},
    }
    return JSONResponse(content={"ok": True, "payload": payload, "note": "payload only; not sent"})


@app.post("/send/talkapi/dispatch")
async def talkapi_dispatch(request: Request):
    """Send via Talk-API if runtime.talkApi.enabled and SAFE_MODE is False.
    Body: { roomId, message, mentionees:[{name,userId}], type?: int }
    """
    cfg = load_runtime()
    if cfg.get('safeMode', True):
        raise HTTPException(status_code=403, detail='SAFE_MODE')
    talk = _runtime_get_talk_cfg()
    if not talk.get('enabled'):
        raise HTTPException(status_code=400, detail='talkApi disabled')
    try:
        body = await request.json()
    except Exception:
        body = {}
    rid = str((body or {}).get('roomId') or '').strip()
    message = str((body or {}).get('message') or '')
    mentionees = body.get('mentionees') if isinstance(body, dict) else []
    if not isinstance(mentionees, list):
        mentionees = []
    try:
        att = _make_mention_attachment(message, mentionees)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    payload = {
        "chatId": int(rid) if rid.isdigit() else rid,
        "message": message,
        "attachment": att or {},
    }
    if 'type' in body:
        payload['type'] = body.get('type')
    url = (talk.get('baseUrl') or '').rstrip('/') + '/api/v1/send'
    headers = {}
    auth = talk.get('authHeader') or ''
    if auth:
        if ':' in auth:
            k, v = auth.split(':', 1)
            headers[k.strip()] = v.strip()
        else:
            headers['Authorization'] = auth
    status, txt = _http_post_json(url, payload, headers, timeout=max(1, int(talk.get('timeoutMs', 8000))) / 1000.0)
    talk_body = None
    talk_status = None
    talk_err = None
    try:
        talk_body = json.loads(txt) if txt else None
    except Exception:
        talk_body = None
    if isinstance(talk_body, dict):
        talk_status = talk_body.get('status')
        talk_err = talk_body.get('errMsg') or talk_body.get('message') or talk_body.get('error')
    ok = False
    try:
        ok = (int(talk_status) == 0)
    except Exception:
        ok = False
    # Talk-API often returns HTTP 200 even when send fails; use body.status as source of truth.
    code = 200 if ok else 502
    return JSONResponse(
        status_code=code,
        content={
            "ok": ok,
            "talkApi": {
                "httpStatus": status,
                "status": talk_status,
                "errMsg": talk_err,
                "body": talk_body,
                "raw": txt,
            },
            "payload": payload,
        },
    )


def _coerce_int(v: object, field: str) -> int:
    if isinstance(v, bool):
        raise HTTPException(status_code=400, detail=f"invalid {field}: bool not allowed")
    if isinstance(v, int):
        return v
    if isinstance(v, str):
        t = v.strip()
        if t and t.isdigit():
            return int(t)
    raise HTTPException(status_code=400, detail=f"invalid {field}: expected int")


def _coerce_reply_attachment_types(att: dict) -> dict:
    # Talk-API reply(type=26)는 attachment의 일부 필드를 number로 요구한다.
    # (특히 src_userId/src_linkId/src_type이 string이면 INVALID_ARGUMENT(-203)로 실패하는 케이스 확인)
    required = ("src_logId", "src_userId", "src_linkId", "src_type")
    missing = [k for k in required if k not in att]
    if missing:
        raise HTTPException(status_code=400, detail=f"invalid attachment: missing {', '.join(missing)} for reply(type=26)")

    att["src_userId"] = _coerce_int(att.get("src_userId"), "attachment.src_userId")
    att["src_linkId"] = _coerce_int(att.get("src_linkId"), "attachment.src_linkId")
    att["src_type"] = _coerce_int(att.get("src_type"), "attachment.src_type")
    if "attach_type" in att:
        att["attach_type"] = _coerce_int(att.get("attach_type"), "attachment.attach_type")
    return att


def _coerce_base64_list(v: object) -> list[str]:
    if not isinstance(v, list):
        raise HTTPException(status_code=400, detail="imagesBase64 must be a list")
    if not v:
        raise HTTPException(status_code=400, detail="imagesBase64 must not be empty")
    if len(v) > 6:
        raise HTTPException(status_code=400, detail="too many imagesBase64 (max 6)")

    out: list[str] = []
    for i, raw in enumerate(v):
        if not isinstance(raw, str):
            raise HTTPException(status_code=400, detail=f"invalid imagesBase64[{i}]: expected string")
        s = raw.strip()
        if not s:
            raise HTTPException(status_code=400, detail=f"invalid imagesBase64[{i}]: empty")
        # allow data URL prefix (data:image/png;base64,...)
        if s.startswith("data:") and "," in s:
            s = s.split(",", 1)[1].strip()
        try:
            data = base64.b64decode(s, validate=True)
        except Exception:
            raise HTTPException(status_code=400, detail=f"invalid imagesBase64[{i}]: base64 decode failed")
        if len(data) > 8 * 1024 * 1024:
            raise HTTPException(status_code=413, detail=f"imagesBase64[{i}] too large (max 8MB)")
        out.append(s)
    return out


@app.post("/send/talkapi/prepare_raw")
async def talkapi_prepare_raw(request: Request):
    """Return payload for Talk-API send without sending (SAFE). Body:
    { roomId, message, type, attachment }
    """
    try:
        body = await request.json()
    except Exception:
        body = {}
    rid = str((body or {}).get('roomId') or '').strip()
    if not rid:
        raise HTTPException(status_code=400, detail='roomId required')
    message = str((body or {}).get('message') or '')
    mtype = _coerce_int((body or {}).get('type'), 'type')
    attachment = (body or {}).get('attachment')
    if not isinstance(attachment, dict):
        raise HTTPException(status_code=400, detail='invalid attachment: expected object')
    if mtype == 26:
        attachment = _coerce_reply_attachment_types(attachment)
    payload = {
        "chatId": int(rid) if rid.isdigit() else rid,
        "message": message,
        "type": mtype,
        "attachment": attachment,
    }
    return JSONResponse(content={"ok": True, "payload": payload, "note": "payload only; not sent"})


@app.post("/send/talkapi/dispatch_raw")
async def talkapi_dispatch_raw(request: Request):
    """Send raw payload via Talk-API if runtime.talkApi.enabled and SAFE_MODE is False.
    Body: { roomId, message, type, attachment }
    """
    cfg = load_runtime()
    if cfg.get('safeMode', True):
        raise HTTPException(status_code=403, detail='SAFE_MODE')
    talk = _runtime_get_talk_cfg()
    if not talk.get('enabled'):
        raise HTTPException(status_code=400, detail='talkApi disabled')
    try:
        body = await request.json()
    except Exception:
        body = {}
    rid = str((body or {}).get('roomId') or '').strip()
    if not rid:
        raise HTTPException(status_code=400, detail='roomId required')
    message = str((body or {}).get('message') or '')
    mtype = _coerce_int((body or {}).get('type'), 'type')
    attachment = (body or {}).get('attachment')
    if not isinstance(attachment, dict):
        raise HTTPException(status_code=400, detail='invalid attachment: expected object')
    if mtype == 26:
        attachment = _coerce_reply_attachment_types(attachment)
    payload = {
        "chatId": int(rid) if rid.isdigit() else rid,
        "message": message,
        "type": mtype,
        "attachment": attachment,
    }
    url = (talk.get('baseUrl') or '').rstrip('/') + '/api/v1/send'
    headers = {}
    auth = talk.get('authHeader') or ''
    if auth:
        if ':' in auth:
            k, v = auth.split(':', 1)
            headers[k.strip()] = v.strip()
        else:
            headers['Authorization'] = auth
    status, txt = _http_post_json(url, payload, headers, timeout=max(1, int(talk.get('timeoutMs', 8000))) / 1000.0)
    talk_body = None
    talk_status = None
    talk_err = None
    try:
        talk_body = json.loads(txt) if txt else None
    except Exception:
        talk_body = None
    if isinstance(talk_body, dict):
        talk_status = talk_body.get('status')
        talk_err = talk_body.get('errMsg') or talk_body.get('message') or talk_body.get('error')
    ok = False
    try:
        ok = (int(talk_status) == 0)
    except Exception:
        ok = False
    # Talk-API often returns HTTP 200 even when send fails; use body.status as source of truth.
    code = 200 if ok else 502
    return JSONResponse(
        status_code=code,
        content={
            "ok": ok,
            "talkApi": {
                "httpStatus": status,
                "status": talk_status,
                "errMsg": talk_err,
                "body": talk_body,
                "raw": txt,
            },
            "payload": payload,
        },
    )


@app.post("/send/iris/reply_text")
async def iris_reply_text(request: Request):
    """Send text via IRIS /reply if SAFE_MODE is False.
    Body: { roomId, text }
    """
    cfg = load_runtime()
    if cfg.get("safeMode", True):
        raise HTTPException(status_code=403, detail="SAFE_MODE")
    try:
        body = await request.json()
    except Exception:
        body = {}

    rid = str((body or {}).get("roomId") or "").strip()
    if not rid:
        raise HTTPException(status_code=400, detail="roomId required")
    text = str((body or {}).get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text required")

    payload = {
        "type": "text",
        "room": rid,
        "data": text,
    }
    url = _iris_base() + "/reply"
    status, txt = _http_post_json(url, payload, headers={}, timeout=15.0)
    iris_body = None
    try:
        iris_body = json.loads(txt) if txt else None
    except Exception:
        iris_body = None
    ok = status == 200
    code = 200 if ok else 502
    return JSONResponse(
        status_code=code,
        content={
            "ok": ok,
            "iris": {
                "httpStatus": status,
                "body": iris_body,
                "raw": txt,
            },
            "sent": {"roomId": rid, "len": len(text), "type": payload["type"]},
        },
    )


@app.get("/rooms/{room_id}/admins")
async def room_admins(room_id: str):
    return JSONResponse(content=_fetch_room_admins_from_iris(room_id))


@app.post("/rooms/{room_id}/admins/refresh")
async def room_admins_refresh(room_id: str, request: Request):
    global _ROOM_ADMIN_REFRESH_LAST_GLOBAL

    rid = str(room_id or "").strip()
    if not rid:
        raise HTTPException(status_code=400, detail="roomId required")

    # 레이트리밋(안전): room 15분, 전역 3분
    now = time.time()
    last_room = _ROOM_ADMIN_REFRESH_LAST_BY_ROOM.get(rid) or 0.0
    wait_room = _ROOM_ADMIN_REFRESH_COOLDOWN_SEC_BY_ROOM - (now - last_room)
    wait_global = _ROOM_ADMIN_REFRESH_COOLDOWN_SEC_GLOBAL - (now - _ROOM_ADMIN_REFRESH_LAST_GLOBAL)
    wait = max(wait_room, wait_global)
    if wait > 0:
        raise HTTPException(status_code=429, detail=f"too_many_requests: retry_after_sec={int(wait)}")

    try:
        body = await request.json()
    except Exception:
        body = {}

    serial = None
    scrolls = 200
    pause_ms = 400
    if isinstance(body, dict):
        serial_raw = str(body.get("serial") or "").strip()
        if serial_raw:
            serial = serial_raw
        s = _safe_int(body.get("scrolls"))
        if s is not None:
            scrolls = max(50, min(int(s), 2000))
        p = _safe_int(body.get("pauseMs") or body.get("scrollPauseMs"))
        if p is not None:
            pause_ms = max(150, min(int(p), 1500))

    repo = _repo_root()
    script = repo / "scripts" / "openchat_load_members.ps1"
    if not script.exists():
        raise HTTPException(status_code=500, detail=f"script_missing: {script}")

    log_dir = repo / "logs" / "openchat_load_members"
    log_dir.mkdir(parents=True, exist_ok=True)
    ts = _now_ts()
    out_path = log_dir / f"{rid}.{ts}.out.log"
    err_path = log_dir / f"{rid}.{ts}.err.log"

    args = [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(script),
        "-RoomId",
        rid,
        "-Scrolls",
        str(scrolls),
        "-ScrollPauseMs",
        str(pause_ms),
    ]
    if serial:
        args += ["-Serial", serial]

    try:
        # 콘솔 창 없이 백그라운드 실행
        CREATE_NO_WINDOW = 0x08000000
        DETACHED_PROCESS = 0x00000008
        CREATE_NEW_PROCESS_GROUP = 0x00000200
        with open(out_path, "wb") as out_f, open(err_path, "wb") as err_f:
            p = subprocess.Popen(
                args,
                cwd=str(repo),
                stdout=out_f,
                stderr=err_f,
                creationflags=CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"spawn_failed: {e}")

    _ROOM_ADMIN_REFRESH_LAST_BY_ROOM[rid] = now
    _ROOM_ADMIN_REFRESH_LAST_GLOBAL = now

    return JSONResponse(
        content={
            "ok": True,
            "roomId": rid,
            "started": True,
            "pid": getattr(p, "pid", None),
            "logOut": str(out_path),
            "logErr": str(err_path),
            "note": "Redroid(단말)에서 방 진입/멤버 목록 스크롤을 수행해 open_chat_member DB를 채웁니다. 1~2분 후 다시 조회하세요.",
        }
    )


@app.post("/send/iris/reply_media")
async def iris_reply_media(request: Request):
    """Send image(s) via IRIS /reply if SAFE_MODE is False.
    Body: { roomId, imagesBase64: [base64, ...] }
    """
    cfg = load_runtime()
    if cfg.get("safeMode", True):
        raise HTTPException(status_code=403, detail="SAFE_MODE")
    try:
        body = await request.json()
    except Exception:
        body = {}

    rid = str((body or {}).get("roomId") or "").strip()
    if not rid:
        raise HTTPException(status_code=400, detail="roomId required")
    imgs = _coerce_base64_list((body or {}).get("imagesBase64"))

    payload = {
        "type": "image" if len(imgs) == 1 else "image_multiple",
        "room": rid,
        "data": imgs[0] if len(imgs) == 1 else imgs,
    }
    url = _iris_base() + "/reply"
    status, txt = _http_post_json(url, payload, headers={}, timeout=30.0)
    iris_body = None
    try:
        iris_body = json.loads(txt) if txt else None
    except Exception:
        iris_body = None
    ok = status == 200
    code = 200 if ok else 502
    return JSONResponse(
        status_code=code,
        content={
            "ok": ok,
            "iris": {
                "httpStatus": status,
                "body": iris_body,
                "raw": txt,
            },
            "sent": {"roomId": rid, "count": len(imgs), "type": payload["type"]},
        },
    )


@app.get("/talkapi/health")
async def talkapi_health():
    talk = _runtime_get_talk_cfg()
    enabled = bool(talk.get('enabled'))
    base = (talk.get('baseUrl') or '').rstrip('/')
    if not base:
        base = 'https://talk-api.naijun.dev'
    reachable = False
    status = None
    err = None
    if enabled:
        try:
            req = _urlreq.Request(base + '/', method='GET')
            with _urlreq.urlopen(req, timeout=max(1, int(talk.get('timeoutMs', 8000))) / 1000.0) as resp:
                status = resp.getcode()
                reachable = (200 <= status < 300)
        except HTTPError as e:
            status = e.code
            err = str(e)
        except URLError as e:
            status = 0
            err = str(e)
        except Exception as e:
            status = 0
            err = str(e)
    return JSONResponse(content={
        'enabled': enabled,
        'baseUrl': base,
        'reachable': reachable,
        'status': status,
        'error': err,
    })


@app.post("/templates/{category}/{name}/prepareSend")
async def template_prepare_send(category: str, name: str, request: Request):
    """Prepare send payload from a template without actually sending (SAFE).
    Body: { roomId: str, context: dict }
    Returns: { content, mentions, mentionees: [{name,userId}], images, safeMode }
    """
    try:
        body = await request.json()
    except Exception:
        body = {}
    room_id = str((body or {}).get('roomId') or '').strip()
    ctx = body.get('context') if isinstance(body, dict) else None
    if not isinstance(ctx, dict):
        ctx = body if isinstance(body, dict) else {}
    try:
        tpl = load_template(category, name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="not found")
    content = str(tpl.get('content') or '')
    rendered, mention_targets = _render_template_text(content, ctx)
    imgs = list(tpl.get('images') or [])
    safe = load_runtime().get('safeMode', True)
    mentionees = _map_names_to_ids(room_id, mention_targets) if room_id else []
    return JSONResponse(content={
        "content": rendered,
        "mentions": mention_targets,
        "mentionees": mentionees,
        "images": imgs,
        "safeMode": bool(safe),
    })


def _sse_format(data: dict) -> bytes:
    # SSE: data: <json>\n\n
    try:
        payload = json.dumps(data, ensure_ascii=False)
    except Exception:
        payload = "{}"
    return ("data: " + payload + "\n\n").encode("utf-8")


async def _stream_generator(request: Request, rooms: List[str], limit: int, include: str, exclude: str, send_all: bool, since_ms: int, interval_ms: int) -> AsyncGenerator[bytes, None]:
    # Initial snapshot
    inc = _parse_keywords(include)
    exc = _parse_keywords(exclude)
    payload = {"type": "snapshot"}
    if rooms:
        rb = tail_bulk(rooms, limit)
        payload["rooms"] = {rid: apply_keyword_filter(entries, inc, exc, limit) for rid, entries in rb.items()}
    if send_all:
        payload["all"] = apply_keyword_filter(tail_all(limit * 2), inc, exc, limit)
    yield _sse_format(payload)

    # State: last seen ts per (room) and global
    last_ts_per_room: Dict[str, int] = {}
    if since_ms:
        for rid in rooms:
            last_ts_per_room[rid] = int(since_ms)
    else:
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        for rid in rooms:
            last_ts_per_room[rid] = now_ms
    last_all_ms = last_ts_per_room.get("__all__", 0)
    if not last_all_ms:
        last_all_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

    # Loop
    iv = max(200, int(interval_ms)) / 1000.0
    heartbeat = 0
    while True:
        if await request.is_disconnected():
            break
        try:
            batch: Dict[str, List[dict]] = {}
            # rooms increment
            for rid in rooms:
                entries = tail_room(rid, limit * 2)
                if inc or exc:
                    entries = apply_keyword_filter(entries, inc, exc, limit * 2)
                # only new ones
                cur = []
                lt = last_ts_per_room.get(rid, 0)
                for e in entries:
                    tms = ts_to_ms(e.get("ts") or "")
                    if tms > lt:
                        cur.append(e)
                        if tms > lt:
                            lt = tms
                if cur:
                    batch[rid] = cur[-limit:]
                    last_ts_per_room[rid] = lt
            out: Dict[str, Any] = {"type": "append"}
            if batch:
                out["rooms"] = batch
            if send_all:
                all_entries = tail_all(limit * 2)
                if inc or exc:
                    all_entries = apply_keyword_filter(all_entries, inc, exc, limit * 2)
                cur_all = []
                for e in all_entries:
                    tms = ts_to_ms(e.get("ts") or "")
                    if tms > last_all_ms:
                        cur_all.append(e)
                        if tms > last_all_ms:
                            last_all_ms = tms
                if cur_all:
                    out["all"] = cur_all[-limit:]
            if out.get("rooms") or out.get("all"):
                yield _sse_format(out)
            else:
                # periodic heartbeat comment to keep connection open
                heartbeat += 1
                if heartbeat % int(max(1, 15000 / (iv * 1000))) == 0:
                    yield b": keep-alive\n\n"
        except Exception:
            # transient error → emit error event and continue
            yield _sse_format({"type": "error", "message": "internal_error"})
        await asyncio.sleep(iv)


@app.get("/logs/stream")
async def logs_stream(request: Request, rooms: Optional[str] = None, limit: int = 80, include: str = "", exclude: str = "", all: int = 0, since: Optional[str] = None, interval: int = 1000):
    room_ids: List[str] = []
    if rooms:
        room_ids = [r for r in rooms.split(',') if r.strip()]
    try:
        since_ms = int(since) if since else 0
    except Exception:
        since_ms = 0
    send_all = str(all).lower() in ("1", "true", "yes", "y") or (all == 1)
    generator = _stream_generator(request, room_ids, max(1, min(limit, 500)), include, exclude, send_all, since_ms, interval)
    return StreamingResponse(generator, media_type="text/event-stream")


# Entry point helper for `uvicorn server.app:app`
if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("REALTIME_API_HOST", "0.0.0.0")
    port = int(os.environ.get("REALTIME_API_PORT", "8650"))
    uvicorn.run("server.app:app", host=host, port=port, reload=False)
