from __future__ import annotations

import asyncio
import base64
import io
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

# ---- IRIS /reply reliability (image) ----
# IRIS /reply_media는 HTTP 200을 반환해도 실제 UI 전송은 비동기/지연/누락될 수 있다.
# 따라서 서버에서 "MessageStore 로그 에코"를 확인한 뒤에만 ok=true를 반환해,
# 여러 워커가 동시에 /send/iris/reply_media를 호출해도 IRIS UI 자동화가 겹치지 않도록 직렬화한다.
# NOTE: IRIS /config(bot_id) fetch가 일시 실패하면 이 기본값으로 echo 검증을 한다.
# 기본값이 레거시 senderId로 남아 있으면(= 계정 교체) "발신은 됐는데 echo가 실패"로 502가 나가며
# 상위 워커에서 재시도/스팸을 유발할 수 있다. 현재 운영 bot_id를 포함해 둔다.
_DEFAULT_IRIS_SENDER_IDS = ["437111754", "434886784", "435780965"]


def _load_iris_sender_ids_from_env() -> list[str]:
    raw = str(os.getenv("IRIS_SENDER_IDS") or os.getenv("IRIS_SENDER_ID") or "").strip()
    ids: list[str] = []
    if raw:
        ids = [x.strip() for x in re.split(r"[,\s]+", raw) if x.strip()]
        ids = [x for x in ids if re.fullmatch(r"\d+", x)]
    if not ids:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for x in ids:
        if x in seen:
            continue
        seen.add(x)
        out.append(x)
    return out


IRIS_SENDER_IDS_ENV = _load_iris_sender_ids_from_env()
IRIS_SENDER_ID_ENV = IRIS_SENDER_IDS_ENV[0] if IRIS_SENDER_IDS_ENV else ""
IRIS_SENDER_IDS_CACHE_SEC = int(os.getenv("IRIS_SENDER_IDS_CACHE_SEC", "30"))
_IRIS_SENDER_IDS_CACHE: dict[str, object] = {"at": 0.0, "ids": []}
IRIS_REPLY_ECHO_TIMEOUT_MS = int(os.getenv("IRIS_REPLY_ECHO_TIMEOUT_MS", "25000"))
# Text echo verification is optional by default (perf). Enable per-request via echoTimeoutMs.
IRIS_REPLY_TEXT_ECHO_TIMEOUT_MS = int(os.getenv("IRIS_REPLY_TEXT_ECHO_TIMEOUT_MS", "0"))
IRIS_REPLY_TEXT_DB_ECHO_TIMEOUT_MS = int(os.getenv("IRIS_REPLY_TEXT_DB_ECHO_TIMEOUT_MS", "8000"))
IRIS_REPLY_TEXT_DB_ECHO_POLL_MS = int(os.getenv("IRIS_REPLY_TEXT_DB_ECHO_POLL_MS", "400"))
IRIS_REPLY_TEXT_IMAGE_FALLBACK_ECHO_TIMEOUT_MS = int(os.getenv("IRIS_REPLY_TEXT_IMAGE_FALLBACK_ECHO_TIMEOUT_MS", "12000"))
IRIS_REPLY_TEXT_IMAGE_FALLBACK_SENDLOG_TIMEOUT_MS = int(os.getenv("IRIS_REPLY_TEXT_IMAGE_FALLBACK_SENDLOG_TIMEOUT_MS", "12000"))
IRIS_REPLY_TEXT_IMAGE_MAX_WIDTH_PX = int(os.getenv("IRIS_REPLY_TEXT_IMAGE_MAX_WIDTH_PX", "980"))
IRIS_REPLY_TEXT_IMAGE_FONT_SIZE = int(os.getenv("IRIS_REPLY_TEXT_IMAGE_FONT_SIZE", "26"))
IRIS_REPLY_TEXT_IMAGE_PADDING_PX = int(os.getenv("IRIS_REPLY_TEXT_IMAGE_PADDING_PX", "36"))
IRIS_REPLY_TEXT_IMAGE_LINE_SPACING_PX = int(os.getenv("IRIS_REPLY_TEXT_IMAGE_LINE_SPACING_PX", "10"))
IRIS_REPLY_TEXT_IMAGE_MAX_LINES = int(os.getenv("IRIS_REPLY_TEXT_IMAGE_MAX_LINES", "70"))
IRIS_REPLY_ECHO_POLL_MS = int(os.getenv("IRIS_REPLY_ECHO_POLL_MS", "700"))
IRIS_REPLY_LOG_SCAN_BYTES = int(os.getenv("IRIS_REPLY_LOG_SCAN_BYTES", str(256 * 1024)))
IRIS_REPLY_POST_ECHO_DELAY_MS = int(os.getenv("IRIS_REPLY_POST_ECHO_DELAY_MS", "800"))
IRIS_REPLY_SENDLOG_TIMEOUT_MS = int(os.getenv("IRIS_REPLY_SENDLOG_TIMEOUT_MS", "25000"))
IRIS_REPLY_SENDLOG_POLL_MS = int(os.getenv("IRIS_REPLY_SENDLOG_POLL_MS", "600"))
IRIS_REPLY_MEDIA_SENDLOG_START_TIMEOUT_MS = int(os.getenv("IRIS_REPLY_MEDIA_SENDLOG_START_TIMEOUT_MS", "5000"))
IRIS_REPLY_MAX_RETRIES = int(os.getenv("IRIS_REPLY_MAX_RETRIES", "0"))
IRIS_REPLY_RETRY_DELAY_MS = int(os.getenv("IRIS_REPLY_RETRY_DELAY_MS", "800"))
_IRIS_REPLY_LOCK = asyncio.Lock()
_IRIS_REPLY_ROOM_LOCKS: Dict[str, asyncio.Lock] = {}


def _get_iris_reply_room_lock(room_id: str) -> asyncio.Lock:
    rid = str(room_id or "").strip()
    if not rid:
        return _IRIS_REPLY_LOCK
    lock = _IRIS_REPLY_ROOM_LOCKS.get(rid)
    if lock is None:
        lock = asyncio.Lock()
        _IRIS_REPLY_ROOM_LOCKS[rid] = lock
    return lock


def _repo_root() -> Path:
    # server/app.py 기준 1단계 상위가 repo root
    return Path(__file__).resolve().parents[1]


def _safe_int0(v: object, default: int = 0) -> int:
    try:
        return int(v)  # type: ignore[arg-type]
    except Exception:
        return default


PINT_BRIEFING_BUNDLE_STATE_PATH = Path(
    os.getenv("PINT_BRIEFING_BUNDLE_STATE_PATH")
    or str(_repo_root() / "node-iris-app" / "data" / "pint_briefing_bundle_state.json")
)
PINT_BRIEFING_BUNDLE_STATE_TTL_SEC = int(os.getenv("PINT_BRIEFING_BUNDLE_STATE_TTL_SEC", str(7 * 24 * 60 * 60)))
PINT_BRIEFING_BUNDLE_STATE_MAX_ITEMS = int(os.getenv("PINT_BRIEFING_BUNDLE_STATE_MAX_ITEMS", "500"))


def _read_json_dict(path: Path) -> dict | None:
    try:
        if not path.exists():
            return None
        raw = path.read_text(encoding="utf-8-sig")
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None


def _write_json_atomic(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp-{os.getpid()}-{int(time.time() * 1000)}")
    try:
        tmp.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass


def _prune_pint_briefing_bundle_state_items(items: dict, now_sec: int) -> dict:
    ttl = max(60, int(PINT_BRIEFING_BUNDLE_STATE_TTL_SEC))
    max_items = max(50, int(PINT_BRIEFING_BUNDLE_STATE_MAX_ITEMS))
    keep: list[tuple[str, dict, int]] = []
    for k, v in (items or {}).items():
        if not isinstance(k, str) or not k:
            continue
        if not isinstance(v, dict):
            continue
        ts = _safe_int0(v.get("okAt") or v.get("lastAttemptAt") or v.get("albumOkAt") or 0)
        if ts <= 0:
            continue
        if now_sec - ts > ttl:
            continue
        keep.append((k, v, ts))

    keep.sort(key=lambda x: x[2], reverse=True)
    out: dict[str, dict] = {}
    for k, v, _ts in keep[:max_items]:
        out[k] = v
    return out


def _now_ts() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")

def _guess_image_ext(data: bytes) -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return ".gif"
    return ".bin"

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

    # heartbeat age (bot liveness)
    hb_age_sec = None
    try:
        from .log_utils import ts_to_ms
        ts = status.get('heartbeatTs')
        if ts:
            import time
            hb_age_sec = max(0, int((time.time()*1000 - ts_to_ms(ts)) / 1000))
    except Exception:
        hb_age_sec = None

    # logStore age (최근 로그 파일 mtime 기준; 단순 room 이벤트 유무와 분리)
    latest_ms = 0
    latest_ts = None
    log_age_sec = None
    try:
        logs_dir = get_logs_dir()
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
        if latest_ms > 0:
            now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
            log_age_sec = max(0, int((now_ms - latest_ms) / 1000))
    except Exception:
        latest_ms = 0
        latest_ts = None
        log_age_sec = None
    return {
        "ok": True,
        "rooms": len(rooms),
        "bot": {
            "pid": status.get('pid'),
            "irisUrl": status.get('irisUrl'),
            "lastEventTs": status.get('lastEventTs'),
            "lastEventAgeSec": age_sec,
            "heartbeatTs": status.get('heartbeatTs'),
            "heartbeatAgeSec": hb_age_sec,
        },
        "logStore": {
            "latestLogTs": latest_ts,
            "logAgeSec": log_age_sec,
        },
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
            dt_last: datetime | None = None
            dt_hb: datetime | None = None
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
                    "lastEventTs": last_event_ts,
                    "heartbeatTs": heartbeat_ts,
                    "lastEventAgeSec": None,
                    "heartbeatAgeSec": None,
                    "effectiveSource": None,
                    "effectiveTs": None,
                    "emfile": emfile_flag,
                    "emfileSince": emfile_since,
                }
                return stage
            now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
            age_ms = now_ms - int(dt_effective.timestamp() * 1000)
            # NOTE:
            # - "브릿지 다운" 판단을 lastEvent(채팅 이벤트) 기준으로 하면, 채팅이 잠시 없는 방에서 오탐이 잦다.
            # - heartbeat가 stale이면 이벤트 루프 hang/blocked 가능성이 높으므로 watchdog가 빠르게 재기동할 수 있어야 한다.
            BOT_HEARTBEAT_OK_MS = 180 * 1000
            BOT_LASTEVENT_FALLBACK_OK_MS = 15 * 60 * 1000

            hb_age_ms = None
            if dt_hb:
                hb_age_ms = now_ms - int(dt_hb.timestamp() * 1000)
            last_age_ms = None
            if dt_last:
                last_age_ms = now_ms - int(dt_last.timestamp() * 1000)

            use_hb = (dt_hb is not None) and (hb_age_ms is not None)
            healthy = (hb_age_ms < BOT_HEARTBEAT_OK_MS) if use_hb else (age_ms < BOT_LASTEVENT_FALLBACK_OK_MS)
            # EMFILE 상태에서는 ok=False로 내려 UI에서 즉시 알 수 있게 한다.
            stage["ok"] = healthy and not emfile_flag
            stage["timestamp"] = (dt_hb.isoformat() if use_hb else dt_effective.isoformat())
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
                "lastEventTs": last_event_ts,
                "heartbeatTs": heartbeat_ts,
                "lastEventAgeSec": (int(last_age_ms / 1000) if last_age_ms is not None else None),
                "heartbeatAgeSec": (int(hb_age_ms / 1000) if hb_age_ms is not None else None),
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
        if os.getenv("KB_SERVICE_DISABLE") == "1":
            stage["ok"] = True
            stage["detail"] = "KB disabled (KB_SERVICE_DISABLE=1)"
            stage["timestamp"] = datetime.now(timezone.utc).isoformat()
            stage["extra"] = {"disabled": True}
            return stage
        url = f"{KB_BASE}/health"
        url_selfcheck = f"{KB_BASE}/health/selfcheck"
        try:
            with _urlreq.urlopen(url, timeout=2) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                try:
                    data = json.loads(raw or "{}")
                except Exception:
                    data = {}
                ok_health = (getattr(resp, "status", None) in (200, None)) and bool(data.get("ok"))
            if not ok_health:
                stage["ok"] = False
                stage["detail"] = "KB /health 비정상 (body/ok=false)"
                stage["timestamp"] = datetime.now(timezone.utc).isoformat()
                stage["extra"] = {"url": url, "selfcheck_url": url_selfcheck}
                return stage

            # /health는 OK여도, 특정 기능(/chat/qa 등)이 500을 내는 '부분 고장'이 있을 수 있어 selfcheck를 추가로 본다.
            with _urlreq.urlopen(url_selfcheck, timeout=2) as resp2:
                raw2 = resp2.read().decode("utf-8", errors="replace")
                try:
                    data2 = json.loads(raw2 or "{}")
                except Exception:
                    data2 = {}
                ok_self = (getattr(resp2, "status", None) in (200, None)) and bool(data2.get("ok"))

            stage["ok"] = bool(ok_health and ok_self)
            stage["detail"] = "KB health/selfcheck OK" if stage["ok"] else "KB selfcheck 비정상"
            stage["timestamp"] = datetime.now(timezone.utc).isoformat()
            stage["extra"] = {"url": url, "selfcheck_url": url_selfcheck}
        except Exception as e:
            stage["ok"] = False
            stage["detail"] = f"KB 연결 실패: {e}"
            stage["timestamp"] = datetime.now(timezone.utc).isoformat()
            stage["extra"] = {"url": url, "selfcheck_url": url_selfcheck, "error": str(e)}
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
        if os.getenv("KB_SERVICE_DISABLE") == "1":
            stage["ok"] = True
            stage["detail"] = "disabled (KB_SERVICE_DISABLE=1)"
            stage["extra"] = {"host": host, "port": port, "disabled": True}
            return stage
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
async def rooms(openchat: str = ""):
    base = list_rooms()
    ids = []
    for r in base:
        if isinstance(r, dict) and r.get("roomId") is not None:
            ids.append(str(r.get("roomId")))

    only_openchat = str(openchat or "").strip().lower() in ("1", "true", "yes", "y")
    link_ids: dict[str, int] = {}
    if only_openchat and ids:
        link_ids = _fetch_room_link_ids(ids)
        open_ids = {rid for rid, link_id in link_ids.items() if (link_id or 0) > 0}
        if open_ids:
            filtered = []
            for r in base:
                if not isinstance(r, dict):
                    continue
                rid = str(r.get("roomId") or "").strip()
                if not rid or rid not in open_ids:
                    continue
                r["isOpenChat"] = True
                r["linkId"] = int(link_ids.get(rid) or 0)
                filtered.append(r)
            base = filtered
            ids = [str(r.get("roomId")) for r in base if isinstance(r, dict) and r.get("roomId") is not None]

            # open_link 썸네일(icon_url/image_url) 보강
            try:
                link_values = sorted({int(link_ids.get(rid) or 0) for rid in ids if int(link_ids.get(rid) or 0) > 0})
                thumbs_by_link_id: dict[int, str] = {}
                if link_values:
                    chunk_size = 200
                    for i in range(0, len(link_values), chunk_size):
                        chunk = link_values[i : i + chunk_size]
                        placeholders = ",".join(["?"] * len(chunk))
                        q = f"select id, icon_url, image_url from db2.open_link where id in ({placeholders})"
                        rows2 = _iris_query(q, chunk)
                        for row in rows2:
                            if not isinstance(row, dict):
                                continue
                            link_id = _safe_int(row.get("id")) or 0
                            if link_id <= 0:
                                continue
                            icon_url = str(row.get("icon_url") or "").strip()
                            img_url = str(row.get("image_url") or "").strip()
                            url = icon_url or img_url
                            if not url:
                                continue
                            if not (url.startswith("http://") or url.startswith("https://")):
                                continue
                            thumbs_by_link_id[link_id] = url

                if thumbs_by_link_id:
                    for r in base:
                        if not isinstance(r, dict):
                            continue
                        rid = str(r.get("roomId") or "").strip()
                        if not rid:
                            continue
                        link_id = int(link_ids.get(rid) or 0)
                        url = thumbs_by_link_id.get(link_id)
                        if url:
                            r["thumbnailUrl"] = url
            except Exception as e:
                logger.warning("[rooms] openchat thumbnail fetch failed: %s", str(e))
        else:
            base = []
            ids = []

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


def _resolve_room_link_id(room_id: str) -> int | None:
    rid = str(room_id or "").strip()
    if not rid:
        return None
    try:
        rows = _iris_query_strict("select link_id from chat_rooms where id=? limit 1", [rid], timeout_sec=6.0)
    except Exception:
        return None
    if rows and isinstance(rows[0], dict):
        return _safe_int(rows[0].get("link_id"))
    return None


def _fetch_room_admins_from_iris(room_id: str) -> dict:
    rid = str(room_id or "").strip()
    if not rid:
        raise HTTPException(status_code=400, detail="roomId required")

    # open_chat_member가 비어있을 수 있으므로, 호스트는 open_link로도 보강한다.
    # 1) loadedMembersCount / activeMembersCount
    link_id = _resolve_room_link_id(rid)
    if link_id is not None:
        cnt_rows = _iris_query_strict(
            "select count(distinct user_id) as cnt from db2.open_chat_member where link_id=?",
            [link_id],
            timeout_sec=6.0,
        )
    else:
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
    if link_id is not None:
        rows = _iris_query_strict(
            "select m.user_id, m.nickname, m.link_member_type "
            "from db2.open_chat_member m "
            "join ( "
            "  select x.user_id as user_id, max(x.rowid) as max_rowid "
            "  from db2.open_chat_member x "
            "  join (select distinct user_id from db2.open_chat_member where link_id=? and link_member_type in (8,4,1)) a "
            "    on a.user_id = x.user_id "
            "  where x.link_id=? "
            "  group by x.user_id "
            ") latest on latest.user_id = m.user_id and latest.max_rowid = m.rowid "
            "where m.link_id=? "
            "order by m.rowid desc limit 3000",
            [link_id, link_id, link_id],
            timeout_sec=8.0,
        )
    else:
        rows = _iris_query_strict(
            "select m.user_id, m.nickname, m.link_member_type "
            "from db2.open_chat_member m "
            "join ( "
            "  select x.user_id as user_id, max(x.rowid) as max_rowid "
            "  from db2.open_chat_member x "
            "  join (select distinct user_id from db2.open_chat_member where involved_chat_id=? and link_member_type in (8,4,1)) a "
            "    on a.user_id = x.user_id "
            "  where x.involved_chat_id=? "
            "  group by x.user_id "
            ") latest on latest.user_id = m.user_id and latest.max_rowid = m.rowid "
            "where m.involved_chat_id=? "
            "order by m.rowid desc limit 3000",
            [rid, rid, rid],
            timeout_sec=8.0,
        )

    # 2.1) 방장(Host) SSOT: chat_rooms ↔ open_link 조인(owner user_id)
    # - open_chat_member.link_member_type=8이 "오픈채팅봇" 등으로 드리프트하는 케이스가 있어
    #   대시보드 표시에 혼선을 줄 수 있다.
    member_host_uid: str | None = None
    member_host_nick: str | None = None
    for row in rows:
        if not isinstance(row, dict):
            continue
        t = _safe_int(row.get("link_member_type"))
        if t != 8:
            continue
        uid0 = str(row.get("user_id") or "").strip()
        if uid0:
            member_host_uid = uid0
            member_host_nick = str(row.get("nickname") or "").strip() or None
            break

    owner_uid: str | None = None
    owner_nick: str | None = None
    try:
        if link_id is not None:
            owner_rows = _iris_query_strict(
                "select user_id as user_id from db2.open_link where id=? limit 1",
                [link_id],
                timeout_sec=6.0,
            )
        else:
            owner_rows = _iris_query_strict(
                "select ol.user_id as user_id from chat_rooms cr join db2.open_link ol on cr.link_id=ol.id where cr.id=? limit 1",
                [rid],
                timeout_sec=6.0,
            )
        if owner_rows and isinstance(owner_rows[0], dict):
            owner_uid = str(owner_rows[0].get("user_id") or "").strip() or None
    except Exception as e:
        logger.warning("[rooms/admins] owner lookup failed: %s", str(e))

    if owner_uid:
        # 닉네임은 open_chat_member에 있으면 같이 내려준다(복호화/보강은 agent가 담당).
        for row in rows:
            if not isinstance(row, dict):
                continue
            if str(row.get("user_id") or "").strip() == owner_uid:
                owner_nick = str(row.get("nickname") or "").strip() or None
                break

        if not owner_nick:
            try:
                if link_id is not None:
                    nick_rows = _iris_query_strict(
                        "select nickname from db2.open_chat_member where link_id=? and user_id=? order by rowid desc limit 1",
                        [link_id, owner_uid],
                        timeout_sec=6.0,
                    )
                else:
                    nick_rows = _iris_query_strict(
                        "select nickname from db2.open_chat_member where involved_chat_id=? and user_id=? order by rowid desc limit 1",
                        [rid, owner_uid],
                        timeout_sec=6.0,
                    )
                if nick_rows and isinstance(nick_rows[0], dict):
                    owner_nick = str(nick_rows[0].get("nickname") or "").strip() or None
            except Exception as e:
                logger.warning("[rooms/admins] owner nickname lookup failed: %s", str(e))

    # 방장(Host) SSOT: open_link.user_id (링크 오너)
    # - open_chat_member.link_member_type=8은 "오픈채팅봇/방장봇" 등으로 드리프트하는 케이스가 있어
    #   운영 화면에서 혼선을 크게 만든다.
    host_uid: str | None = owner_uid or member_host_uid
    host_nick: str | None = owner_nick if host_uid and host_uid == owner_uid else member_host_nick

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
        # 방장은 1명(host_uid)만 내려준다.
        if host_uid and uid == host_uid:
            admins.append({"userId": uid, "nickname": nick})
            continue
        if t in (4, 1):
            subhosts.append({"userId": uid, "nickname": nick})
            admins.append({"userId": uid, "nickname": nick})
        elif t == 8:
            # host는 위에서 1명(host_uid)만 선택해 내려준다.
            continue

    if host_uid:
        host = [{"userId": host_uid, "nickname": host_nick}]
        if host_uid not in {a.get("userId") for a in admins}:
            admins.append({"userId": host_uid, "nickname": host_nick})
        subhosts = [x for x in subhosts if str((x or {}).get("userId") or "").strip() != host_uid]
    else:
        host = []

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

    link_id = _resolve_room_link_id(rid)
    if link_id is not None:
        where = "where (involved_chat_id=? or link_id=?)"
        bind: list[object] = [rid, link_id]
    else:
        where = "where involved_chat_id=?"
        bind = [rid]
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
    # legacy: do not expose Talk-API config/authHeader
    if isinstance(cfg, dict) and "talkApi" in cfg:
        cfg = dict(cfg)
        cfg.pop("talkApi", None)
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

    # nicknameReminder config (feature worker: nickname-reminder-worker)
    # - allow updating only selected safe keys (UI에서 2/3차 안내 간격을 조정 가능하게 하기 위함)
    if isinstance(body, dict) and "nicknameReminder" in body:
        nickname_reminder = body.get("nicknameReminder")
        if nickname_reminder is None:
            cur.pop("nicknameReminder", None)
        elif not isinstance(nickname_reminder, dict):
            raise HTTPException(status_code=400, detail="nicknameReminder must be an object or null")
        else:
            cur_nr = cur.get("nicknameReminder")
            if not isinstance(cur_nr, dict):
                cur_nr = {}

            allowed_nr_keys = {
                "enabled",
                "dryRun",
                "tickSec",
                "perRoomMinSendIntervalSec",
                "maxMentionsPerMessage",
                "betweenMessagesDelayMs",
                "memberLoadWaitMs",
                "memberLoadScrolls",
                "dailyAt",
                "dailyWindowMin",
                "messageText",
                "warningSchedule",
                "warningMessageByLevel",
            }
            for k in nickname_reminder.keys():
                if k not in allowed_nr_keys:
                    raise HTTPException(status_code=400, detail=f"nicknameReminder.{k} is not allowed")

            def _set_int_field(dst: dict, key: str, val, lo: int, hi: int, *, allow_null: bool = True):
                if val is None and allow_null:
                    dst.pop(key, None)
                    return
                if not isinstance(val, (int, float)):
                    raise HTTPException(status_code=400, detail=f"nicknameReminder.{key} must be number")
                n = int(val)
                if n < lo or n > hi:
                    raise HTTPException(status_code=400, detail=f"nicknameReminder.{key} out of range ({lo}..{hi})")
                dst[key] = n

            if "enabled" in nickname_reminder:
                v = nickname_reminder.get("enabled")
                if v is None:
                    cur_nr.pop("enabled", None)
                elif isinstance(v, bool):
                    cur_nr["enabled"] = v
                else:
                    raise HTTPException(status_code=400, detail="nicknameReminder.enabled must be boolean or null")

            if "dryRun" in nickname_reminder:
                v = nickname_reminder.get("dryRun")
                if v is None:
                    cur_nr.pop("dryRun", None)
                elif isinstance(v, bool):
                    cur_nr["dryRun"] = v
                else:
                    raise HTTPException(status_code=400, detail="nicknameReminder.dryRun must be boolean or null")

            if "dailyAt" in nickname_reminder:
                v = nickname_reminder.get("dailyAt")
                if v is None:
                    cur_nr.pop("dailyAt", None)
                elif not isinstance(v, str):
                    raise HTTPException(status_code=400, detail="nicknameReminder.dailyAt must be string or null")
                else:
                    parts = [p.strip() for p in re.split(r"[,\n]+", v) if p and str(p).strip()]
                    times = set()
                    for p in parts:
                        m = re.match(r"^\s*(\d{1,2})\s*:\s*(\d{1,2})\s*$", p)
                        if not m:
                            raise HTTPException(status_code=400, detail="nicknameReminder.dailyAt must be like 'HH:MM,HH:MM' (24h)")
                        hh = int(m.group(1))
                        mm = int(m.group(2))
                        if hh < 0 or hh > 23 or mm < 0 or mm > 59:
                            raise HTTPException(status_code=400, detail="nicknameReminder.dailyAt time out of range (00:00..23:59)")
                        times.add(f"{hh:02d}:{mm:02d}")
                    if not times:
                        raise HTTPException(status_code=400, detail="nicknameReminder.dailyAt must include at least 1 time")
                    cur_nr["dailyAt"] = ",".join(sorted(times))

            if "tickSec" in nickname_reminder:
                _set_int_field(cur_nr, "tickSec", nickname_reminder.get("tickSec"), 10, 3600)
            if "perRoomMinSendIntervalSec" in nickname_reminder:
                _set_int_field(cur_nr, "perRoomMinSendIntervalSec", nickname_reminder.get("perRoomMinSendIntervalSec"), 0, 30 * 24 * 60 * 60)
            if "maxMentionsPerMessage" in nickname_reminder:
                _set_int_field(cur_nr, "maxMentionsPerMessage", nickname_reminder.get("maxMentionsPerMessage"), 1, 15)
            if "betweenMessagesDelayMs" in nickname_reminder:
                _set_int_field(cur_nr, "betweenMessagesDelayMs", nickname_reminder.get("betweenMessagesDelayMs"), 0, 10_000)
            if "memberLoadWaitMs" in nickname_reminder:
                _set_int_field(cur_nr, "memberLoadWaitMs", nickname_reminder.get("memberLoadWaitMs"), 0, 10 * 60 * 1000)
            if "memberLoadScrolls" in nickname_reminder:
                _set_int_field(cur_nr, "memberLoadScrolls", nickname_reminder.get("memberLoadScrolls"), 50, 1200)
            if "dailyWindowMin" in nickname_reminder:
                _set_int_field(cur_nr, "dailyWindowMin", nickname_reminder.get("dailyWindowMin"), 0, 180)

            if "messageText" in nickname_reminder:
                v = nickname_reminder.get("messageText")
                if v is None:
                    cur_nr.pop("messageText", None)
                elif not isinstance(v, str):
                    raise HTTPException(status_code=400, detail="nicknameReminder.messageText must be string or null")
                else:
                    s = v.strip()
                    if not s:
                        cur_nr.pop("messageText", None)
                    elif len(s) > 600:
                        raise HTTPException(status_code=400, detail="nicknameReminder.messageText too long (max 600 chars)")
                    else:
                        cur_nr["messageText"] = s

            if "warningMessageByLevel" in nickname_reminder:
                wmb = nickname_reminder.get("warningMessageByLevel")
                if wmb is None:
                    cur_nr.pop("warningMessageByLevel", None)
                elif not isinstance(wmb, dict):
                    raise HTTPException(status_code=400, detail="nicknameReminder.warningMessageByLevel must be an object or null")
                else:
                    cur_nr["warningMessageByLevel"] = wmb

            if "warningSchedule" in nickname_reminder:
                ws = nickname_reminder.get("warningSchedule")
                if ws is None:
                    cur_nr.pop("warningSchedule", None)
                elif not isinstance(ws, dict):
                    raise HTTPException(status_code=400, detail="nicknameReminder.warningSchedule must be an object or null")
                else:
                    cur_ws = cur_nr.get("warningSchedule")
                    if not isinstance(cur_ws, dict):
                        cur_ws = {}

                    allowed_levels = {"level1", "level2", "level3"}
                    for lv_key in ws.keys():
                        if lv_key not in allowed_levels:
                            raise HTTPException(status_code=400, detail=f"nicknameReminder.warningSchedule.{lv_key} is not allowed")

                    for lv_key, lv_val in ws.items():
                        if lv_val is None:
                            cur_ws.pop(lv_key, None)
                            continue
                        if not isinstance(lv_val, dict):
                            raise HTTPException(status_code=400, detail=f"nicknameReminder.warningSchedule.{lv_key} must be an object or null")

                        cur_lv = cur_ws.get(lv_key)
                        if not isinstance(cur_lv, dict):
                            cur_lv = {}

                        if lv_key == "level1":
                            allowed_lv_keys = {"afterFirstSeenSec"}
                            for k2 in lv_val.keys():
                                if k2 not in allowed_lv_keys:
                                    raise HTTPException(status_code=400, detail=f"nicknameReminder.warningSchedule.{lv_key}.{k2} is not allowed")
                            if "afterFirstSeenSec" in lv_val:
                                _set_int_field(cur_lv, "afterFirstSeenSec", lv_val.get("afterFirstSeenSec"), 0, 30 * 24 * 60 * 60)
                        else:
                            allowed_lv_keys = {"afterLastWarnSec"}
                            for k2 in lv_val.keys():
                                if k2 not in allowed_lv_keys:
                                    raise HTTPException(status_code=400, detail=f"nicknameReminder.warningSchedule.{lv_key}.{k2} is not allowed")
                            if "afterLastWarnSec" in lv_val:
                                _set_int_field(cur_lv, "afterLastWarnSec", lv_val.get("afterLastWarnSec"), 0, 30 * 24 * 60 * 60)

                        if cur_lv:
                            cur_ws[lv_key] = cur_lv
                        else:
                            cur_ws.pop(lv_key, None)

                    if cur_ws:
                        cur_nr["warningSchedule"] = cur_ws
                    else:
                        cur_nr.pop("warningSchedule", None)

            cur["nicknameReminder"] = cur_nr
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

    # course ops config (legacy roster-worker send gate)
    if isinstance(body, dict) and "courseOps" in body:
        course_ops = body.get("courseOps")
        if course_ops is None:
            cur.pop("courseOps", None)
        elif not isinstance(course_ops, dict):
            raise HTTPException(status_code=400, detail="courseOps must be an object or null")
        else:
            allowed_co_keys = {"sendEnabled"}
            for k in course_ops.keys():
                if k not in allowed_co_keys:
                    raise HTTPException(status_code=400, detail=f"courseOps.{k} is not allowed")

            cur_co = cur.get("courseOps")
            if not isinstance(cur_co, dict):
                cur_co = {}

            if "sendEnabled" in course_ops:
                v = course_ops.get("sendEnabled")
                if v is None:
                    cur_co.pop("sendEnabled", None)
                elif isinstance(v, bool):
                    cur_co["sendEnabled"] = v
                else:
                    raise HTTPException(status_code=400, detail="courseOps.sendEnabled must be boolean or null")

            if cur_co:
                cur["courseOps"] = cur_co
            else:
                cur.pop("courseOps", None)
    # talk-api runtime config (legacy; disabled)
    if isinstance(body, dict) and "talkApi" in body:
        talk = body.get("talkApi")
        if talk is None:
            cur.pop("talkApi", None)
        else:
            raise HTTPException(status_code=410, detail="DEPRECATED_TALKAPI_DISABLED")

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


def _render_template_text(content: str, ctx: dict) -> str:
    """Render template text with variables.

    Supported:
      - {{var}} → ctx[var]
      - @{var}  → ctx[var]  (레거시 "멘션 토큰"이지만, 이제는 @를 붙이지 않는다)
      - {var}   → ctx[var]  (legacy)

    Korean aliases allowed, e.g., '입장인원변수' can be used as var name.
    """
    text = content or ""

    # legacy mention tokens: @{var} -> plain text name (no '@')
    def rep_mention(m: re.Match) -> str:
        key = (m.group(1) or "").strip()
        aliases = [key]
        if key in ("입장인원변수", "입장자", "입장닉네임"):
            aliases += ["entrant", "entrance", "entrantName", "username", "userName", "joinUser"]
        elif key in ("entrant", "entrance", "username", "userName", "joinUser", "entrantName"):
            aliases += ["입장인원변수", "입장자"]
        val = None
        for k in aliases:
            if k in ctx and str(ctx[k]).strip():
                val = str(ctx[k]).strip()
                break
        return val if val else m.group(0)  # leave as is

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

    # legacy mention tokens: @{var} -> plain text name (no '@')
    text = re.sub(r"@\{([^}]+)\}", rep_mention, text)

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
    return text


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
    rendered = _render_template_text(content, ctx)
    imgs = list(tpl.get('images') or [])
    safe = load_runtime().get('safeMode', True)
    return JSONResponse(content={
        "content": rendered,
        "mentions": [],
        "images": imgs,
        "safeMode": bool(safe),
    })


# NOTE(legacy): Talk-API/authHeader/“진짜 멘션(@ attachment)”/Reply(type=26) 헬퍼는
# `server/legacy/talkapi_mentions_reply_reference.py` 로 이동했다. (ADR-0053)


def _http_post_json(url: str, data: dict, headers: dict, timeout: float) -> tuple[int, str]:
    req = _urlreq.Request(url, method='POST')
    body = json.dumps(data, ensure_ascii=False).encode('utf-8')
    has_ua = False
    has_ct = False
    for k, v in (headers or {}).items():
        req.add_header(k, v)
        lk = str(k).strip().lower()
        if lk == 'user-agent':
            has_ua = True
        if lk == 'content-type':
            has_ct = True
    if not has_ct:
        # Some IRIS builds mis-decode JSON bodies when charset is omitted.
        # Be explicit to keep Hangul/emoji intact end-to-end.
        req.add_header('Content-Type', 'application/json; charset=utf-8')
    # NOTE: talk-api.naijun.dev is fronted by Cloudflare and blocks Python-urllib UA (error code: 1010).
    if not has_ua:
        req.add_header(
            'User-Agent',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        )
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
    except Exception as e:
        # socket.timeout 등 urllib이 URLError로 감싸지 않는 예외가 있어,
        # FastAPI 500으로 터지는 것을 방지한다.
        return 0, str(e)

def _http_get_text(url: str, headers: dict, timeout: float) -> tuple[int, str]:
    req = _urlreq.Request(url, method="GET")
    has_ua = False
    for k, v in (headers or {}).items():
        req.add_header(k, v)
        if str(k).strip().lower() == "user-agent":
            has_ua = True
    # NOTE: keep UA consistent with _http_post_json (some proxies block urllib default UA).
    if not has_ua:
        req.add_header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
    try:
        with _urlreq.urlopen(req, timeout=timeout) as resp:
            status = resp.getcode()
            txt = resp.read().decode("utf-8", errors="ignore")
            return status, txt
    except HTTPError as e:
        try:
            return e.code, e.read().decode("utf-8", errors="ignore")
        except Exception:
            return e.code, str(e)
    except URLError as e:
        return 0, str(e)
    except Exception as e:
        return 0, str(e)


def _load_iris_sender_ids_from_iris_config() -> list[str]:
    # IRIS /config -> bot_id 를 사용한다.
    # (env로 강제하지 않으면, 계정 교체 시 기본값(레거시 senderId) 불일치로 echo 검증이 항상 실패할 수 있다.)
    try:
        url = _iris_base() + "/config"
        status, txt = _http_get_text(url, headers={}, timeout=2.0)
        if status != 200:
            return []
        try:
            obj = json.loads(txt) if txt else {}
        except Exception:
            obj = {}
        if not isinstance(obj, dict):
            return []
        bid = str(obj.get("bot_id") or obj.get("botId") or "").strip()
        if bid and re.fullmatch(r"\d+", bid):
            return [bid]
        return []
    except Exception:
        return []


def _get_iris_sender_ids() -> list[str]:
    # 우선순위: env(IRIS_SENDER_IDS/IRIS_SENDER_ID) > IRIS /config(bot_id) > 레거시 기본값
    if IRIS_SENDER_IDS_ENV:
        return list(IRIS_SENDER_IDS_ENV)

    now = time.time()
    ttl = max(1, int(IRIS_SENDER_IDS_CACHE_SEC or 0))
    try:
        cached_at = float(_IRIS_SENDER_IDS_CACHE.get("at") or 0.0)
    except Exception:
        cached_at = 0.0
    cached_ids = _IRIS_SENDER_IDS_CACHE.get("ids")
    cached_list = [str(x).strip() for x in cached_ids if str(x).strip()] if isinstance(cached_ids, list) else []
    if cached_list and (now - cached_at) < ttl:
        return list(cached_list)

    ids = _load_iris_sender_ids_from_iris_config()
    if not ids:
        # IRIS /config 일시 실패 시에도, 마지막으로 학습한 senderId는 유지한다(기본값으로 되돌아가면 echo 검증이 깨질 수 있음).
        if cached_list:
            _IRIS_SENDER_IDS_CACHE["at"] = now
            _IRIS_SENDER_IDS_CACHE["ids"] = list(cached_list)
            return list(cached_list)
        ids = list(_DEFAULT_IRIS_SENDER_IDS)

    _IRIS_SENDER_IDS_CACHE["at"] = now
    _IRIS_SENDER_IDS_CACHE["ids"] = ids
    return list(ids)


# ---- IRIS reply echo check (MessageStore) ----
def _is_image_message_type(raw_type: object) -> bool:
    try:
        n = int(raw_type)  # may be str/float
    except Exception:
        return False
    # Kakao messageType may include flag 16384 in some cases.
    base = n - 16384 if n >= 16384 else n
    return base in (2, 27, 71)


def _is_text_message_type(raw_type: object) -> bool:
    try:
        n = int(raw_type)  # may be str/float
    except Exception:
        return False
    # Kakao messageType may include flag 16384 in some cases.
    base = n - 16384 if n >= 16384 else n
    return base in (1,)


def _normalize_echo_text(raw: object) -> str:
    try:
        s = str(raw or "")
    except Exception:
        return ""
    return s.replace("\r\n", "\n").replace("\r", "\n").strip()


def _has_iris_text_echo_since(room_id: str, since_ms: int, expected_text: str) -> bool:
    exp = _normalize_echo_text(expected_text)
    if not exp:
        return False

    p = _find_latest_room_log_path(room_id)
    if not p:
        return False
    try:
        st = p.stat()
    except Exception:
        return False
    try:
        if not p.is_file() or st.st_size <= 0:
            return False
    except Exception:
        return False

    try:
        # Fast path: if log file hasn't been updated since before since_ms, skip reading.
        mtime_ms = int(st.st_mtime * 1000)
        if mtime_ms + 2000 < int(since_ms):
            return False
    except Exception:
        pass

    try:
        size = int(st.st_size)
        start = max(0, size - max(1024, IRIS_REPLY_LOG_SCAN_BYTES))
        with p.open("rb") as f:
            f.seek(start)
            data = f.read()
        txt = data.decode("utf-8", errors="ignore")
        lines = txt.splitlines()
        sender_ids = _get_iris_sender_ids()
        def _matches_line(ln: str, require_sender_match: bool, allow_openchatbot_fallback: bool) -> bool:
            if not ln:
                return False
            if require_sender_match and sender_ids and not any(sid0 in ln for sid0 in sender_ids):
                return False
            if "\"messageType\"" not in ln:
                return False
            try:
                obj = json.loads(ln)
            except Exception:
                return False
            snap = obj.get("snapshot") if isinstance(obj, dict) else None
            payload = obj.get("payload") if isinstance(obj, dict) else None

            sid = None
            try:
                sid = str((snap or {}).get("senderId") or (obj.get("senderId") if isinstance(obj, dict) else "")).strip()
            except Exception:
                sid = None
            if require_sender_match and sender_ids and sid not in sender_ids:
                return False

            ts = ""
            try:
                ts = str(obj.get("timestamp") or obj.get("ts") or "").strip()
            except Exception:
                ts = ""
            tms = ts_to_ms(ts) if ts else 0
            if not tms:
                return False
            # allow slight skew
            if tms + 1500 < int(since_ms):
                return False

            mt = None
            try:
                mt = (payload or {}).get("messageType")
            except Exception:
                mt = None
            if allow_openchatbot_fallback:
                try:
                    n = int(mt)  # type: ignore[arg-type]
                except Exception:
                    return False
                base = n - 16384 if n >= 16384 else n
                if base != 71:
                    return False
                sender_name = ""
                try:
                    sender_name = str((snap or {}).get("senderName") or "").strip()
                except Exception:
                    sender_name = ""
                sid_tag = ""
                try:
                    sid_tag = str((((payload or {}).get("attachment") or {}).get("P") or {}).get("SID") or "").strip()
                except Exception:
                    sid_tag = ""
                if sender_name != "오픈채팅봇" and sid_tag != "chatbot":
                    return False
            elif not _is_text_message_type(mt):
                return False

            msg = None
            try:
                msg = (snap or {}).get("messageText")
            except Exception:
                msg = None
            return _normalize_echo_text(msg) == exp

        for ln in reversed(lines):
            if _matches_line(ln, True, False):
                return True
        if sender_ids:
            for ln in reversed(lines):
                if _matches_line(ln, False, True):
                    return True
        return False
    except Exception:
        return False


async def _wait_for_iris_text_echo(room_id: str, since_ms: int, expected_text: str, timeout_ms: int) -> bool:
    s = int(since_ms or 0)
    if s <= 0:
        return False
    exp = _normalize_echo_text(expected_text)
    if not exp:
        return False
    timeout = max(0, int(timeout_ms or 0))
    deadline = int(time.time() * 1000) + timeout
    while True:
        now = int(time.time() * 1000)
        if now > deadline:
            return False
        if _has_iris_text_echo_since(room_id, s, exp):
            return True
        await asyncio.sleep(max(0.05, min(1.0, IRIS_REPLY_ECHO_POLL_MS / 1000.0)))


def _find_latest_room_log_path(room_id: str) -> Path | None:
    rid = str(room_id or "").strip()
    if not rid:
        return None
    d = get_logs_dir() / rid
    try:
        if not d.exists() or not d.is_dir():
            return None
        files = sorted([p for p in d.iterdir() if p.is_file() and re.match(r"^\d{4}-\d{2}-\d{2}\.log$", p.name)])
        if not files:
            return None
        return files[-1]
    except Exception:
        return None


def _attachment_has_remote_image_url(att: object) -> bool:
    if not isinstance(att, dict):
        return False
    cand: list[str] = []
    for k in ("url", "thumbnailUrl", "imageUrl", "imageUrls", "urls"):
        v = att.get(k)
        if isinstance(v, str):
            cand.append(v)
        elif isinstance(v, list):
            cand.extend([x for x in v if isinstance(x, str)])
    for u in cand:
        t = u.strip()
        if t.startswith("http://") or t.startswith("https://"):
            return True
    return False


def _has_iris_image_echo_since(room_id: str, since_ms: int) -> bool:
    p = _find_latest_room_log_path(room_id)
    if not p:
        return False
    try:
        st = p.stat()
    except Exception:
        return False
    try:
        if not p.is_file() or st.st_size <= 0:
            return False
    except Exception:
        return False

    try:
        # Fast path: if log file hasn't been updated since before since_ms, skip reading.
        mtime_ms = int(st.st_mtime * 1000)
        if mtime_ms + 2000 < int(since_ms):
            return False
    except Exception:
        pass

    try:
        size = int(st.st_size)
        start = max(0, size - max(1024, IRIS_REPLY_LOG_SCAN_BYTES))
        with p.open("rb") as f:
            f.seek(start)
            data = f.read()
        txt = data.decode("utf-8", errors="ignore")
        lines = txt.splitlines()
        sender_ids = _get_iris_sender_ids()
        for ln in reversed(lines):
            if not ln:
                continue
            if sender_ids and not any(sid0 in ln for sid0 in sender_ids):
                continue
            if "\"messageType\"" not in ln:
                continue
            try:
                obj = json.loads(ln)
            except Exception:
                continue
            snap = obj.get("snapshot") if isinstance(obj, dict) else None
            payload = obj.get("payload") if isinstance(obj, dict) else None
            sid = None
            try:
                sid = str((snap or {}).get("senderId") or (obj.get("senderId") if isinstance(obj, dict) else "")).strip()
            except Exception:
                sid = None
            if sender_ids and sid not in sender_ids:
                continue
            ts = ""
            try:
                ts = str(obj.get("timestamp") or obj.get("ts") or "").strip()
            except Exception:
                ts = ""
            tms = ts_to_ms(ts) if ts else 0
            if not tms:
                continue
            # allow slight skew
            if tms + 1500 < int(since_ms):
                continue
            mt = None
            try:
                mt = (payload or {}).get("messageType")
            except Exception:
                mt = None
            if not _is_image_message_type(mt):
                continue
            # 이미지 전송 실패(재전송 필요) 상태에서는 attachment에 원격 URL이 없을 수 있다.
            # 성공 판정은 "원격 URL이 있는 이미지"로 한정한다.
            try:
                att = (payload or {}).get("attachment")
            except Exception:
                att = None
            if not _attachment_has_remote_image_url(att):
                continue
            return True
        return False
    except Exception:
        return False


async def _wait_for_iris_image_echo(room_id: str, since_ms: int, timeout_ms: int) -> bool:
    s = int(since_ms or 0)
    if s <= 0:
        return False
    timeout = max(0, int(timeout_ms or 0))
    deadline = int(time.time() * 1000) + timeout
    while True:
        now = int(time.time() * 1000)
        if now > deadline:
            return False
        if _has_iris_image_echo_since(room_id, s):
            return True
        await asyncio.sleep(max(0.05, min(1.0, IRIS_REPLY_ECHO_POLL_MS / 1000.0)))


def _count_iris_sending_logs_since(room_id: str, since_sec: int, send_type: int) -> int:
    rid = str(room_id or "").strip()
    if not rid:
        return 0
    try:
        st = int(send_type)
    except Exception:
        return 0
    s = int(since_sec or 0)
    if s < 0:
        s = 0
    rows = _iris_query_strict(
        "select count(1) as cnt from chat_sending_logs where chat_id=? and type=? and created_at>=?",
        [rid, st, s],
        timeout_sec=6.0,
    )
    if rows and isinstance(rows[0], dict):
        return _safe_int(rows[0].get("cnt")) or 0
    return 0


async def _wait_for_iris_sending_log_cleared(
    room_id: str, since_sec: int, send_type: int, timeout_ms: int, start_timeout_ms: int = 0
) -> bool:
    s = int(since_sec or 0)
    if s <= 0:
        return False
    timeout = max(0, int(timeout_ms or 0))
    deadline = int(time.time() * 1000) + timeout
    start_timeout = max(0, int(start_timeout_ms or 0))
    start_deadline = int(time.time() * 1000) + min(timeout, start_timeout) if start_timeout > 0 else 0

    saw_positive = False
    stable_zero = 0
    while True:
        now = int(time.time() * 1000)
        if now > deadline:
            return False

        cnt = _count_iris_sending_logs_since(room_id, s, send_type)
        if cnt > 0:
            saw_positive = True
            stable_zero = 0
        elif saw_positive:
            stable_zero += 1
            if stable_zero >= 2:
                return True
        elif start_deadline and now > start_deadline:
            return False

        await asyncio.sleep(max(0.05, min(1.0, IRIS_REPLY_SENDLOG_POLL_MS / 1000.0)))


def _safe_bool(v: object) -> bool:
    if isinstance(v, bool):
        return v
    if v is None:
        return False
    s = str(v).strip().lower()
    return s in ("1", "true", "t", "yes", "y", "on")


def _coerce_sender_ids_for_db(sender_ids: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in sender_ids or []:
        s = str(raw or "").strip()
        if not s:
            continue
        if not re.fullmatch(r"\d+", s):
            continue
        if s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


def _try_select_chatlog_max_id(room_id: str, sender_ids: list[str]) -> tuple[bool, int, str | None]:
    rid = str(room_id or "").strip()
    if not rid:
        return False, 0, "roomId required"

    sids = _coerce_sender_ids_for_db(sender_ids)
    if not sids:
        return False, 0, "senderIds unavailable"

    try:
        placeholders = ",".join(["?"] * len(sids))
        q = f"select max(_id) as max_id from chat_logs where chat_id=? and user_id in ({placeholders})"
        rows = _iris_query_strict(q, [rid, *sids], timeout_sec=6.0)
        if rows and isinstance(rows[0], dict):
            return True, _safe_int(rows[0].get("max_id")) or 0, None
        return True, 0, None
    except HTTPException as e:
        return False, 0, str(e.detail)
    except Exception as e:
        return False, 0, str(e)

def _try_select_chatlog_type_by_rowid(row_id: int) -> tuple[bool, int, str | None]:
    rid = int(row_id or 0)
    if rid <= 0:
        return False, 0, "rowId required"
    try:
        rows = _iris_query_strict("select type from chat_logs where _id=? limit 1", [rid], timeout_sec=6.0)
        if rows and isinstance(rows[0], dict):
            return True, _safe_int(rows[0].get("type")) or 0, None
        return True, 0, None
    except HTTPException as e:
        return False, 0, str(e.detail)
    except Exception as e:
        return False, 0, str(e)

def _try_find_recent_image_chatlog_type(
    room_id: str,
    sender_ids: list[str],
    before_id: int,
    after_id: int,
    limit: int = 12,
) -> tuple[bool, int, str | None]:
    """Best-effort fallback for image echo verification.

    IRIS may write multiple rows for a single "album" send, and other bot messages
    (text/ops) can race within the same room. If the latest rowId isn't an image,
    scan a small window of recent rows to find any image-type message.
    """
    rid = str(room_id or "").strip()
    if not rid:
        return False, 0, "roomId required"

    sids = _coerce_sender_ids_for_db(sender_ids)
    if not sids:
        return False, 0, "senderIds unavailable"

    b = int(before_id or 0)
    a = int(after_id or 0)
    if a <= 0:
        return False, 0, "afterId required"
    if b < 0:
        b = 0

    lim = int(limit or 0)
    lim = max(1, min(lim, 50))

    try:
        placeholders = ",".join(["?"] * len(sids))
        q = (
            f"select _id, type from chat_logs "
            f"where chat_id=? and user_id in ({placeholders}) and _id>? and _id<=? "
            f"order by _id desc limit ?"
        )
        rows = _iris_query_strict(q, [rid, *sids, b, a, lim], timeout_sec=6.0)
        if not rows:
            return False, 0, "no_recent_rows"

        last_type = 0
        for r in rows:
            if not isinstance(r, dict):
                continue
            t = _safe_int(r.get("type")) or 0
            last_type = t or last_type
            if _is_image_message_type(int(t or 0)):
                return True, int(t or 0), None

        return False, int(last_type or 0), f"type_mismatch_recent:{last_type}"
    except HTTPException as e:
        return False, 0, str(e.detail)
    except Exception as e:
        return False, 0, str(e)


async def _wait_for_iris_chatlog_advance(
    room_id: str,
    sender_ids: list[str],
    before_id: int,
    timeout_ms: int,
) -> tuple[bool, int, str | None]:
    timeout = max(0, int(timeout_ms or 0))
    if timeout <= 0:
        return True, int(before_id or 0), None

    deadline = int(time.time() * 1000) + timeout
    last_id = int(before_id or 0)
    last_err: str | None = None
    while True:
        now = int(time.time() * 1000)
        if now > deadline:
            return False, last_id, last_err

        ok, cur, err = _try_select_chatlog_max_id(room_id, sender_ids)
        if ok:
            last_id = cur
            if cur > int(before_id or 0):
                return True, cur, None
        else:
            last_err = err or last_err

        await asyncio.sleep(max(0.05, min(1.0, IRIS_REPLY_TEXT_DB_ECHO_POLL_MS / 1000.0)))


def _load_text_image_font(size: int):
    try:
        from PIL import ImageFont  # type: ignore
    except Exception:
        return None

    sz = int(size or 0)
    if sz <= 0:
        sz = 26

    candidates: list[str] = []
    env_path = str(os.getenv("IRIS_TEXT_IMAGE_FONT_PATH") or "").strip()
    if env_path:
        candidates.append(env_path)
    # Windows (Korean)
    candidates += [
        r"C:\Windows\Fonts\malgun.ttf",
        r"C:\Windows\Fonts\malgunbd.ttf",
        r"C:\Windows\Fonts\gulim.ttc",
        r"C:\Windows\Fonts\batang.ttc",
    ]
    for p in candidates:
        try:
            if p and os.path.exists(p):
                return ImageFont.truetype(p, size=sz)
        except Exception:
            continue
    try:
        return ImageFont.load_default()
    except Exception:
        return None


def _measure_text_width(draw, text: str, font) -> float:
    try:
        return float(draw.textlength(text, font=font))
    except Exception:
        try:
            box = draw.textbbox((0, 0), text, font=font)
            return float(box[2] - box[0])
        except Exception:
            return float(len(text) * 10)


def _wrap_text_lines_for_image(text: str, max_width_px: int, font, line_spacing_px: int) -> list[str]:
    raw = str(text or "")
    if not raw:
        return [""]

    maxw = int(max_width_px or 0)
    if maxw <= 200:
        maxw = 980

    dummy = None
    try:
        from PIL import Image, ImageDraw  # type: ignore

        dummy = Image.new("RGB", (10, 10), color=(255, 255, 255))
        draw = ImageDraw.Draw(dummy)
    except Exception:
        # fallback: do not wrap
        return raw.splitlines() or [raw]

    out: list[str] = []
    for ln in raw.splitlines() or [""]:
        s = str(ln or "")
        if not s:
            out.append("")
            continue
        cur = ""
        for ch in s:
            nxt = cur + ch
            if _measure_text_width(draw, nxt, font) <= maxw:
                cur = nxt
                continue
            if cur:
                out.append(cur)
                cur = ch
            else:
                # extreme case: single char wider than max width
                out.append(nxt)
                cur = ""
        if cur:
            out.append(cur)

    max_lines = max(10, min(int(IRIS_REPLY_TEXT_IMAGE_MAX_LINES or 0), 200))
    if len(out) > max_lines:
        clipped = out[:max_lines]
        clipped.append("… (일부 생략)")
        return clipped
    return out


def _render_text_as_png_base64(text: str) -> tuple[bool, str, str | None]:
    try:
        from PIL import Image, ImageDraw  # type: ignore
    except Exception as e:
        return False, "", f"PIL_NOT_AVAILABLE: {e}"

    font = _load_text_image_font(int(IRIS_REPLY_TEXT_IMAGE_FONT_SIZE))
    if font is None:
        return False, "", "FONT_LOAD_FAILED"

    pad = max(12, min(int(IRIS_REPLY_TEXT_IMAGE_PADDING_PX or 0), 120))
    line_spacing = max(4, min(int(IRIS_REPLY_TEXT_IMAGE_LINE_SPACING_PX or 0), 40))
    maxw = max(320, min(int(IRIS_REPLY_TEXT_IMAGE_MAX_WIDTH_PX or 0), 1400))
    lines = _wrap_text_lines_for_image(text, maxw, font, line_spacing)
    wrapped = "\n".join(lines)

    dummy = Image.new("RGB", (10, 10), color=(255, 255, 255))
    d0 = ImageDraw.Draw(dummy)
    try:
        box = d0.multiline_textbbox((0, 0), wrapped, font=font, spacing=line_spacing)
        tw = int(box[2] - box[0])
        th = int(box[3] - box[1])
    except Exception:
        tw = maxw
        th = max(200, 28 * len(lines))

    w = max(360, min(tw + pad * 2, 1600))
    h = max(180, min(th + pad * 2, 4000))

    img = Image.new("RGB", (w, h), color=(255, 255, 255))
    d = ImageDraw.Draw(img)
    try:
        d.multiline_text((pad, pad), wrapped, fill=(0, 0, 0), font=font, spacing=line_spacing)
    except Exception as e:
        return False, "", f"DRAW_FAILED: {e}"

    try:
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return True, b64, None
    except Exception as e:
        return False, "", f"ENCODE_FAILED: {e}"


# ---- Avatar auto-resolve (Kakao open_link icon_url) ----
_AVATAR_AUTO_CACHE_SEC = int(os.getenv("AVATAR_AUTO_CACHE_SEC", "3600"))        
_avatar_auto_cache: dict[str, tuple[float, str]] = {}
_ROOM_COUNT_CACHE_SEC = int(os.getenv("ROOM_COUNT_CACHE_SEC", "30"))
_room_count_cache: dict[str, tuple[float, int]] = {}
_ROOM_NAME_CACHE_SEC = int(os.getenv("ROOM_NAME_CACHE_SEC", "3600"))
_room_name_cache: dict[str, tuple[float, str]] = {}
_ROOM_LINK_CACHE_SEC = int(os.getenv("ROOM_LINK_CACHE_SEC", "3600"))
_room_link_cache: dict[str, tuple[float, int]] = {}


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


def _fetch_room_link_ids(room_ids: list[str]) -> dict[str, int]:
    now = datetime.now(timezone.utc).timestamp()
    out: dict[str, int] = {}

    todo: list[str] = []
    for rid in room_ids:
        rid2 = str(rid or "").strip()
        if not rid2:
            continue
        cached = _room_link_cache.get(rid2)
        if cached and now - cached[0] < max(1, _ROOM_LINK_CACHE_SEC):
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
        q = f"select id, link_id from chat_rooms where id in ({placeholders})"
        rows = _iris_query(q, chunk)
        for row in rows:
            if not isinstance(row, dict):
                continue
            rid = str(row.get("id") or "").strip()
            link_id = _safe_int(row.get("link_id")) or 0
            if not rid:
                continue
            out[rid] = link_id
            _room_link_cache[rid] = (now, link_id)

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
    raise HTTPException(status_code=410, detail="DEPRECATED_TALKAPI_DISABLED")


@app.post("/send/talkapi/dispatch")
async def talkapi_dispatch(request: Request):
    raise HTTPException(status_code=410, detail="DEPRECATED_TALKAPI_DISABLED")


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


def _coerce_url_list(v: object) -> list[str]:
    if not isinstance(v, list):
        raise HTTPException(status_code=400, detail="imageUrls must be a list")
    if not v:
        raise HTTPException(status_code=400, detail="imageUrls must not be empty")
    if len(v) > 6:
        raise HTTPException(status_code=400, detail="too many imageUrls (max 6)")

    out: list[str] = []
    for i, raw in enumerate(v):
        if not isinstance(raw, str):
            raise HTTPException(status_code=400, detail=f"invalid imageUrls[{i}]: expected string")
        s = raw.strip()
        if not s:
            raise HTTPException(status_code=400, detail=f"invalid imageUrls[{i}]: empty")
        if len(s) > 4096:
            raise HTTPException(status_code=400, detail=f"invalid imageUrls[{i}]: too long")
        out.append(s)
    return out


@app.post("/send/talkapi/prepare_raw")
async def talkapi_prepare_raw(request: Request):
    raise HTTPException(status_code=410, detail="DEPRECATED_TALKAPI_DISABLED")


@app.post("/send/talkapi/dispatch_raw")
async def talkapi_dispatch_raw(request: Request):
    raise HTTPException(status_code=410, detail="DEPRECATED_TALKAPI_DISABLED")


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

    # 운영/테스트성 텍스트는 테스트 방으로만 보낸다.
    pint_cfg = cfg.get("pintBriefing")
    if not isinstance(pint_cfg, dict):
        pint_cfg = {}
    test_rid = str(pint_cfg.get("testRoomId") or "18475752914588021").strip()
    if _looks_like_ops_test_text(text) and rid != test_rid:
        raise HTTPException(status_code=400, detail="OPS_TEXT_BLOCKED_FOR_NON_TEST_ROOM")

    payload = {
        "type": "text",
        "room": rid,
        "data": text,
    }
    max_retries = max(0, int(IRIS_REPLY_MAX_RETRIES))
    retry_delay_ms = int(IRIS_REPLY_RETRY_DELAY_MS)
    echo_timeout_ms = int(IRIS_REPLY_TEXT_ECHO_TIMEOUT_MS)
    db_echo_timeout_ms = int(IRIS_REPLY_TEXT_DB_ECHO_TIMEOUT_MS)
    sendlog_timeout_ms = int(IRIS_REPLY_SENDLOG_TIMEOUT_MS)
    fallback_to_image = False
    fallback_echo_timeout_ms = int(IRIS_REPLY_TEXT_IMAGE_FALLBACK_ECHO_TIMEOUT_MS)
    fallback_sendlog_timeout_ms = int(IRIS_REPLY_TEXT_IMAGE_FALLBACK_SENDLOG_TIMEOUT_MS)
    if isinstance(body, dict):
        mr = _safe_int(body.get("maxRetries"))
        if mr is not None:
            max_retries = max(0, min(int(mr), 5))
        rd = _safe_int(body.get("retryDelayMs"))
        if rd is not None:
            retry_delay_ms = max(0, min(int(rd), 10_000))
        et = _safe_int(body.get("echoTimeoutMs") or body.get("echo_timeout_ms"))
        if et is not None:
            echo_timeout_ms = max(0, min(int(et), 60_000))
        de = _safe_int(body.get("dbEchoTimeoutMs") or body.get("db_echo_timeout_ms"))
        if de is not None:
            db_echo_timeout_ms = max(0, min(int(de), 60_000))
        sl = _safe_int(body.get("sendlogTimeoutMs") or body.get("sendlog_timeout_ms"))
        if sl is not None:
            sendlog_timeout_ms = max(500, min(int(sl), 180_000))
        fb = body.get("fallbackToImage") if isinstance(body, dict) else None
        if fb is None and isinstance(body, dict):
            fb = body.get("fallback_to_image")
        if fb is not None:
            fallback_to_image = _safe_bool(fb)
        fe = _safe_int(body.get("fallbackEchoTimeoutMs") or body.get("fallback_echo_timeout_ms"))
        if fe is not None:
            fallback_echo_timeout_ms = max(500, min(int(fe), 180_000))
        fs = _safe_int(body.get("fallbackSendlogTimeoutMs") or body.get("fallback_sendlog_timeout_ms"))
        if fs is not None:
            fallback_sendlog_timeout_ms = max(500, min(int(fs), 180_000))

    async with _get_iris_reply_room_lock(rid):
        sender_ids = _get_iris_sender_ids()
        attempt = 0
        last_status = 0
        last_txt = ""
        last_iris_body = None
        last_echo_ok = False
        last_echo_wait_ms = 0
        last_db_ok = False
        last_db_wait_ms = 0
        last_db_err = None
        last_db_before_id = 0
        last_db_after_id = 0
        last_sendlog_ok = False
        last_sendlog_wait_ms = 0
        last_sendlog_err = None

        while True:
            attempt += 1
            sendlog_ok = False
            sendlog_wait_ms = 0
            sendlog_err = None
            db_ok = False
            db_wait_ms = 0
            db_err = None
            db_after_id = 0
            echo_ok = False
            echo_wait_ms = 0
            async with _IRIS_REPLY_LOCK:
                call_started_ms = int(time.time() * 1000) - 1500  # allow slight skew
                call_started_sec = max(0, int(call_started_ms / 1000) - 1)
                before_ok, before_id, before_err = _try_select_chatlog_max_id(rid, sender_ids)
                last_db_before_id = before_id
                url = _iris_base() + "/reply"
                status, txt = _http_post_json(url, payload, headers={}, timeout=15.0)
                if status == 200:
                    if echo_timeout_ms > 0:
                        try:
                            t0 = int(time.time() * 1000)
                            echo_ok = await _wait_for_iris_text_echo(rid, call_started_ms, text, echo_timeout_ms)
                            echo_wait_ms = max(0, int(time.time() * 1000) - t0)
                        except Exception:
                            echo_ok = False
                            echo_wait_ms = 0
            last_status = status
            last_txt = txt
            try:
                last_iris_body = json.loads(txt) if txt else None
            except Exception:
                last_iris_body = None

            iris_ok = status == 200
            if iris_ok and not echo_ok:
                try:
                    t1 = int(time.time() * 1000)
                    sendlog_ok = await _wait_for_iris_sending_log_cleared(
                        rid, call_started_sec, 1, sendlog_timeout_ms
                    )
                    sendlog_wait_ms = max(0, int(time.time() * 1000) - t1)
                except HTTPException as e:
                    sendlog_ok = False
                    sendlog_err = str(e.detail)
                except Exception as e:
                    sendlog_ok = False
                    sendlog_err = str(e)
                if sendlog_ok:
                    if db_echo_timeout_ms <= 0:
                        db_ok = True
                        db_after_id = before_id
                    elif before_ok:
                        try:
                            t2 = int(time.time() * 1000)
                            db_ok, db_after_id, db_err = await _wait_for_iris_chatlog_advance(
                                rid, sender_ids, before_id, db_echo_timeout_ms
                            )
                            db_wait_ms = max(0, int(time.time() * 1000) - t2)
                        except Exception as e:
                            db_ok = False
                            db_err = str(e)
                    else:
                        db_ok = False
                        db_after_id = before_id
                        db_err = before_err or "chatlog_before_failed"
            text_verified_ok = echo_ok or (sendlog_ok and db_ok)

            last_echo_ok = echo_ok
            last_echo_wait_ms = echo_wait_ms
            last_db_ok = db_ok
            last_db_wait_ms = db_wait_ms
            last_db_err = db_err
            last_db_after_id = db_after_id
            last_sendlog_ok = sendlog_ok
            last_sendlog_wait_ms = sendlog_wait_ms
            last_sendlog_err = sendlog_err

            ok = iris_ok and (text_verified_ok if echo_timeout_ms > 0 else (sendlog_ok and db_ok))
            if ok or attempt > max_retries:
                if ok:
                    content = {
                        "ok": True,
                        "attempt": attempt,
                        "iris": {
                            "httpStatus": last_status,
                            "body": last_iris_body,
                            "raw": last_txt,
                        },
                        "sendlog": {
                            "ok": last_sendlog_ok,
                            "timeoutMs": sendlog_timeout_ms,
                            "waitMs": last_sendlog_wait_ms,
                            "error": last_sendlog_err,
                        },
                        "dbEcho": {
                            "ok": last_db_ok,
                            "timeoutMs": db_echo_timeout_ms,
                            "waitMs": last_db_wait_ms,
                            "beforeId": last_db_before_id,
                            "afterId": last_db_after_id,
                            "error": last_db_err,
                        },
                        "sent": {"roomId": rid, "len": len(text), "type": payload["type"]},
                    }
                    if echo_timeout_ms > 0:
                        content["echo"] = {
                            "ok": last_echo_ok,
                            "timeoutMs": echo_timeout_ms,
                            "waitMs": last_echo_wait_ms,
                        }
                        content["verification"] = {
                            "basis": "echo" if last_echo_ok else "sendlog+dbEcho",
                        }
                    return JSONResponse(status_code=200, content=content)

                # 실패 + fallback 옵션이면 텍스트를 이미지로 렌더링해 발신한다.
                fallback_used = False
                fallback_ok = False
                fallback_detail: dict = {}
                if fallback_to_image:
                    fallback_used = True
                    ok_img, img_b64, render_err = _render_text_as_png_base64(text)
                    if not ok_img:
                        fallback_ok = False
                        fallback_detail = {"used": True, "ok": False, "mode": "image", "renderError": render_err}
                    else:
                        img_payload = {"type": "image", "room": rid, "data": img_b64}
                        async with _IRIS_REPLY_LOCK:
                            fb_call_started_ms = int(time.time() * 1000) - 1500  # allow slight skew
                            fb_call_started_sec = max(0, int(fb_call_started_ms / 1000) - 1)
                            fb_status, fb_txt = _http_post_json(
                                _iris_base() + "/reply", img_payload, headers={}, timeout=30.0
                            )
                        fb_body = None
                        try:
                            fb_body = json.loads(fb_txt) if fb_txt else None
                        except Exception:
                            fb_body = None
                        fb_iris_ok = fb_status == 200
                        fb_echo_ok = False
                        fb_echo_wait_ms = 0
                        fb_sendlog_ok = False
                        fb_sendlog_wait_ms = 0
                        fb_sendlog_err = None
                        if fb_iris_ok:
                            t0 = int(time.time() * 1000)
                            fb_echo_ok = await _wait_for_iris_image_echo(rid, fb_call_started_ms, fallback_echo_timeout_ms)
                            fb_echo_wait_ms = max(0, int(time.time() * 1000) - t0)
                            if fb_echo_ok and IRIS_REPLY_POST_ECHO_DELAY_MS > 0:
                                await asyncio.sleep(max(0.0, IRIS_REPLY_POST_ECHO_DELAY_MS / 1000.0))
                            if fb_echo_ok:
                                try:
                                    t1 = int(time.time() * 1000)
                                    fb_sendlog_ok = await _wait_for_iris_sending_log_cleared(
                                        rid, fb_call_started_sec, 2, fallback_sendlog_timeout_ms
                                    )
                                    fb_sendlog_wait_ms = max(0, int(time.time() * 1000) - t1)
                                except HTTPException as e:
                                    fb_sendlog_ok = False
                                    fb_sendlog_err = str(e.detail)
                                except Exception as e:
                                    fb_sendlog_ok = False
                                    fb_sendlog_err = str(e)
                        fallback_ok = fb_iris_ok and fb_echo_ok and fb_sendlog_ok
                        fallback_detail = {
                            "used": True,
                            "ok": fallback_ok,
                            "mode": "image",
                            "iris": {"httpStatus": fb_status, "body": fb_body, "raw": fb_txt},
                            "echo": {"ok": fb_echo_ok, "timeoutMs": fallback_echo_timeout_ms, "waitMs": fb_echo_wait_ms},
                            "sendlog": {
                                "ok": fb_sendlog_ok,
                                "timeoutMs": fallback_sendlog_timeout_ms,
                                "waitMs": fb_sendlog_wait_ms,
                                "error": fb_sendlog_err,
                            },
                        }

                code = 200 if fallback_ok else 502
                content = {
                    "ok": bool(fallback_ok),
                    "attempt": attempt,
                    "iris": {"httpStatus": last_status, "body": last_iris_body, "raw": last_txt},
                    "sendlog": {
                        "ok": last_sendlog_ok,
                        "timeoutMs": sendlog_timeout_ms,
                        "waitMs": last_sendlog_wait_ms,
                        "error": last_sendlog_err,
                    },
                    "dbEcho": {
                        "ok": last_db_ok,
                        "timeoutMs": db_echo_timeout_ms,
                        "waitMs": last_db_wait_ms,
                        "beforeId": last_db_before_id,
                        "afterId": last_db_after_id,
                        "error": last_db_err,
                    },
                    "sent": {"roomId": rid, "len": len(text), "type": payload["type"]},
                }
                if echo_timeout_ms > 0:
                    content["echo"] = {"ok": last_echo_ok, "timeoutMs": echo_timeout_ms, "waitMs": last_echo_wait_ms}
                if fallback_used:
                    content["fallback"] = fallback_detail
                return JSONResponse(status_code=code, content=content)

            if retry_delay_ms > 0:
                await asyncio.sleep(max(0.0, retry_delay_ms / 1000.0))


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
    max_retries = max(0, int(IRIS_REPLY_MAX_RETRIES))
    retry_delay_ms = int(IRIS_REPLY_RETRY_DELAY_MS)
    echo_timeout_ms = int(IRIS_REPLY_ECHO_TIMEOUT_MS)
    sendlog_timeout_ms = int(IRIS_REPLY_SENDLOG_TIMEOUT_MS)
    if isinstance(body, dict):
        mr = _safe_int(body.get("maxRetries"))
        if mr is not None:
            max_retries = max(0, min(int(mr), 5))
        rd = _safe_int(body.get("retryDelayMs"))
        if rd is not None:
            retry_delay_ms = max(0, min(int(rd), 10_000))
        et = _safe_int(body.get("echoTimeoutMs") or body.get("echo_timeout_ms"))
        if et is not None:
            echo_timeout_ms = max(500, min(int(et), 180_000))
        sl = _safe_int(body.get("sendlogTimeoutMs") or body.get("sendlog_timeout_ms"))
        if sl is not None:
            sendlog_timeout_ms = max(500, min(int(sl), 180_000))

    async with _get_iris_reply_room_lock(rid):
        sender_ids = _get_iris_sender_ids()
        attempt = 0
        last_status = 0
        last_txt = ""
        last_iris_body = None
        last_echo_ok = False
        last_echo_wait_ms = 0
        last_db_ok = False
        last_db_wait_ms = 0
        last_db_before_id = 0
        last_db_after_id = 0
        last_db_err = None
        last_db_type = 0
        last_sendlog_ok = False
        last_sendlog_wait_ms = 0
        last_sendlog_err = None
        last_file_echo_ok = False
        last_file_echo_wait_ms = 0

        while True:
            attempt += 1
            sendlog_ok = False
            sendlog_wait_ms = 0
            sendlog_err = None
            async with _IRIS_REPLY_LOCK:
                call_started_ms = int(time.time() * 1000) - 1500  # allow slight skew
                call_started_sec = max(0, int(call_started_ms / 1000) - 1)
                before_ok, before_id, before_err = _try_select_chatlog_max_id(rid, sender_ids)
                last_db_before_id = before_id
                url = _iris_base() + "/reply"
                status, txt = _http_post_json(url, payload, headers={}, timeout=30.0)
                if status == 200:
                    try:
                        t1 = int(time.time() * 1000)
                        sendlog_ok = await _wait_for_iris_sending_log_cleared(
                            rid,
                            call_started_sec,
                            2,
                            sendlog_timeout_ms,
                            IRIS_REPLY_MEDIA_SENDLOG_START_TIMEOUT_MS,
                        )
                        sendlog_wait_ms = max(0, int(time.time() * 1000) - t1)
                    except HTTPException as e:
                        sendlog_ok = False
                        sendlog_err = str(e.detail)
                    except Exception as e:
                        sendlog_ok = False
                        sendlog_err = str(e)
            last_status = status
            last_txt = txt
            try:
                last_iris_body = json.loads(txt) if txt else None
            except Exception:
                last_iris_body = None

            iris_ok = status == 200
            echo_ok = False
            echo_wait_ms = 0
            db_ok = False
            db_wait_ms = 0
            db_after_id = before_id
            db_err = before_err
            db_type = 0
            file_echo_ok = False
            file_echo_wait_ms = 0

            if iris_ok:
                if sendlog_ok:
                    if before_ok:
                        t0 = int(time.time() * 1000)
                        db_ok, db_after_id, db_err = await _wait_for_iris_chatlog_advance(rid, sender_ids, before_id, echo_timeout_ms)
                        db_wait_ms = max(0, int(time.time() * 1000) - t0)
                        if db_ok:
                            t_ok, t_val, t_err = _try_select_chatlog_type_by_rowid(db_after_id)
                            if t_ok:
                                db_type = int(t_val or 0)
                                if _is_image_message_type(db_type):
                                    echo_ok = True
                                    echo_wait_ms = db_wait_ms
                                else:
                                    # Fallback: race-proof scan. If any recent row within this send window
                                    # is an image, treat echo as OK to avoid false negatives.
                                    f_ok, f_type, f_err = _try_find_recent_image_chatlog_type(
                                        rid, sender_ids, before_id, db_after_id
                                    )
                                    if f_ok:
                                        db_type = int(f_type or db_type)
                                        echo_ok = True
                                        echo_wait_ms = db_wait_ms
                                    else:
                                        db_ok = False
                                        db_err = f_err or f"type_mismatch:{db_type}"
                            else:
                                db_ok = False
                                db_err = t_err or "type_lookup_failed"
                    else:
                        db_ok = False
                        db_err = before_err or "dbEcho unavailable"

            last_echo_ok = echo_ok
            last_echo_wait_ms = echo_wait_ms
            last_db_ok = db_ok
            last_db_wait_ms = db_wait_ms
            last_db_after_id = db_after_id
            last_db_err = db_err
            last_db_type = db_type
            last_sendlog_ok = sendlog_ok
            last_sendlog_wait_ms = sendlog_wait_ms
            last_sendlog_err = sendlog_err
            if iris_ok and not (echo_ok and sendlog_ok and db_ok):
                try:
                    tfe = int(time.time() * 1000)
                    file_echo_ok = await _wait_for_iris_image_echo(rid, call_started_ms, echo_timeout_ms)
                    file_echo_wait_ms = max(0, int(time.time() * 1000) - tfe)
                except Exception:
                    file_echo_ok = False
                    file_echo_wait_ms = 0
            last_file_echo_ok = file_echo_ok
            last_file_echo_wait_ms = file_echo_wait_ms

            ok = iris_ok and ((echo_ok and sendlog_ok and db_ok) or file_echo_ok)
            if ok or attempt > max_retries:
                code = 200 if ok else 502
                return JSONResponse(
                    status_code=code,
                    content={
                        "ok": ok,
                        "attempt": attempt,
                        "iris": {
                            "httpStatus": last_status,
                            "body": last_iris_body,
                            "raw": last_txt,
                        },
                        "echo": {
                            "ok": last_echo_ok,
                            "timeoutMs": echo_timeout_ms,
                            "waitMs": last_echo_wait_ms,
                        },
                        "dbEcho": {
                            "ok": last_db_ok,
                            "timeoutMs": echo_timeout_ms,
                            "waitMs": last_db_wait_ms,
                            "beforeId": last_db_before_id,
                            "afterId": last_db_after_id,
                            "type": last_db_type,
                            "error": last_db_err,
                        },
                        "sendlog": {
                            "ok": last_sendlog_ok,
                            "timeoutMs": sendlog_timeout_ms,
                            "waitMs": last_sendlog_wait_ms,
                            "error": last_sendlog_err,
                        },
                        "fileEcho": {
                            "ok": last_file_echo_ok,
                            "timeoutMs": echo_timeout_ms,
                            "waitMs": last_file_echo_wait_ms,
                        },
                        "sent": {"roomId": rid, "count": len(imgs), "type": payload["type"]},
                        "verification": {
                            "basis": "sendlog+dbEcho" if (last_echo_ok and last_sendlog_ok and last_db_ok) else ("fileEcho" if last_file_echo_ok else ""),
                        },
                    },
                )

            if retry_delay_ms > 0:
                await asyncio.sleep(max(0.0, retry_delay_ms / 1000.0))


def _looks_like_ops_test_text(text: str | None) -> bool:
    s = str(text or "").strip()
    if not s:
        return False
    sl = s.lower()
    korean_terms = (
        "테스트",
        "점검",
        "검증",
        "디버그",
        "스모크",
        "운영 발신",
        "운영 확인",
        "전송 점검",
        "발송 테스트",
        "테스트 발신",
        "확인용",
        "리허설",
        "헬스체크",
    )
    if any(term in s for term in korean_terms):
        return True
    english_terms = (
        "test",
        "debug",
        "smoke",
        "verify",
        "verification",
        "check",
        "ops",
        "fallback",
        "qa",
        "dry run",
        "staging",
    )
    return any(term in sl for term in english_terms)


@app.post("/send/pint/briefing_bundle")
async def pint_briefing_bundle(request: Request):
    """Send a Pint briefing as:
    1) image_multiple (Kakao album) 2) text detail.

    Body:
      - target: "test" | "prod"
      - imagesBase64?: [base64|dataUrl, ...] (max 6, min 1)
      - imageUrls?: [url, ...] (max 6, min 1 after download)
      - text: str
      - delayMs?: int (between album and text)
      - echoTimeoutMs?, sendlogTimeoutMs? (for album)
      - dbEchoTimeoutMs?, sendlogTimeoutMs? (for text)

    NOTE: This endpoint intentionally does NOT accept arbitrary roomId to prevent mis-sends.
    """
    cfg = load_runtime()
    if cfg.get("safeMode", True):
        raise HTTPException(status_code=403, detail="SAFE_MODE")
    try:
        body = await request.json()
    except Exception:
        body = {}

    if not isinstance(body, dict):
        body = {}

    pint_cfg = cfg.get("pintBriefing")
    if not isinstance(pint_cfg, dict):
        pint_cfg = {}

    target = str(body.get("target") or body.get("room") or "test").strip().lower()
    test_rid = str(pint_cfg.get("testRoomId") or "18475752914588021").strip()
    prod_rid = str(pint_cfg.get("roomId") or "").strip()
    allow_prod = _safe_bool(pint_cfg.get("allowProdSend"))

    is_test_target = target in ("test", "test_open_chat", "test-open-chat")
    is_prod_target = target in ("prod", "pint", "production")

    if is_test_target:
        rid = test_rid
    elif is_prod_target:
        if not allow_prod:
            raise HTTPException(status_code=403, detail="PROD_SEND_DISABLED")
        if not prod_rid:
            raise HTTPException(status_code=400, detail="pintBriefing.roomId required for prod send")
        rid = prod_rid
    else:
        raise HTTPException(status_code=400, detail="invalid target (use 'test' or 'prod')")

    text = str(body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text required")
    if is_prod_target and _looks_like_ops_test_text(text):
        raise HTTPException(status_code=400, detail="OPS_TEXT_BLOCKED_FOR_PROD_BRIEFING")

    req_job_id = str(body.get("jobId") or "").strip()
    req_template_label = str(body.get("templateLabel") or "").strip()

    imgs: list[str] = []
    image_urls_for_debug: list[str] = []
    download_failed: list[str] | None = None
    if "imagesBase64" in body and body.get("imagesBase64") is not None:
        imgs = _coerce_base64_list(body.get("imagesBase64"))
    elif "imageUrls" in body and body.get("imageUrls") is not None:
        urls = _coerce_url_list(body.get("imageUrls"))
        image_urls_for_debug = list(urls)

        def _download_url_as_base64(url: str) -> str | None:
            req0 = _urlreq.Request(url, method="GET")
            # Keep UA consistent with other helpers.
            req0.add_header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            try:
                with _urlreq.urlopen(req0, timeout=20.0) as resp:
                    status = resp.getcode()
                    if status != 200:
                        return None
                    ct = str(getattr(resp, "headers", {}).get("Content-Type") or "").lower()
                    if ct and not ct.startswith("image/"):
                        return None
                    data = resp.read(8 * 1024 * 1024 + 1)
                    if len(data) > 8 * 1024 * 1024:
                        return None
                    return base64.b64encode(data).decode("ascii")
            except Exception:
                return None

        failed: list[str] = []
        for u in urls:
            b64 = _download_url_as_base64(u)
            if not b64:
                failed.append(u)
                continue
            imgs.append(b64)

        if failed:
            # Keep response helpful for the caller (admin UI), without leaking to user chat.
            download_failed = list(failed)
    else:
        raise HTTPException(status_code=400, detail="imagesBase64 or imageUrls required")

    if len(imgs) < 1:
        raise HTTPException(status_code=400, detail="need at least 1 image")

    debug_save = _safe_bool(body.get("debugSave")) or _safe_bool(pint_cfg.get("debugSaveImages"))
    if debug_save and target == "test":
        try:
            from pathlib import Path as _Path

            base_dir_raw = str(pint_cfg.get("debugSaveDir") or "").strip()
            base_dir = _Path(base_dir_raw) if base_dir_raw else (_repo_root() / "out" / "pint_briefing_bundle_debug")
            base_dir.mkdir(parents=True, exist_ok=True)

            job_id = str(body.get("jobId") or "").strip()
            slug = re.sub(r"[^a-zA-Z0-9._-]+", "_", job_id)[:80] if job_id else ""
            out_dir_name = f"{_now_ts()}{'_' + slug if slug else ''}"
            out_dir = base_dir / out_dir_name
            out_dir.mkdir(parents=True, exist_ok=True)

            meta = {
                "ts": datetime.now(timezone.utc).isoformat(),
                "target": target,
                "jobId": str(body.get("jobId") or "").strip() or None,
                "templateLabel": str(body.get("templateLabel") or "").strip() or None,
                "imageUrls": image_urls_for_debug,
                "downloadFailed": download_failed,
                "textPreview": (text[:240] + "…") if len(text) > 240 else text,
                "sizes": [],
            }

            for idx, b64 in enumerate(imgs[:6], start=1):
                data = base64.b64decode(b64, validate=False)
                ext = _guess_image_ext(data)
                p = out_dir / f"{idx:02d}{ext}"
                p.write_bytes(data)
                meta["sizes"].append({"i": idx, "bytes": len(data), "ext": ext})

            (out_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            logger.info("[pint] saved briefing bundle debug images", extra={"dir": str(out_dir)})
        except Exception:
            logger.warning("[pint] failed to save briefing bundle debug images", exc_info=True)

    delay_ms = _safe_int(body.get("delayMs") or body.get("delay_ms"))
    if delay_ms is None:
        delay_ms = 700
    delay_ms = max(0, min(int(delay_ms), 10_000))

    media_echo_timeout_ms = int(IRIS_REPLY_ECHO_TIMEOUT_MS)
    media_sendlog_timeout_ms = int(IRIS_REPLY_SENDLOG_TIMEOUT_MS)
    text_db_echo_timeout_ms = int(IRIS_REPLY_TEXT_DB_ECHO_TIMEOUT_MS)
    text_sendlog_timeout_ms = int(IRIS_REPLY_SENDLOG_TIMEOUT_MS)
    if isinstance(body, dict):
        et = _safe_int(body.get("echoTimeoutMs") or body.get("echo_timeout_ms"))
        if et is not None:
            media_echo_timeout_ms = max(500, min(int(et), 180_000))
        sl = _safe_int(body.get("sendlogTimeoutMs") or body.get("sendlog_timeout_ms"))
        if sl is not None:
            media_sendlog_timeout_ms = max(500, min(int(sl), 180_000))
            text_sendlog_timeout_ms = max(500, min(int(sl), 180_000))
        de = _safe_int(body.get("dbEchoTimeoutMs") or body.get("db_echo_timeout_ms"))
        if de is not None:
            text_db_echo_timeout_ms = max(0, min(int(de), 60_000))

    async with _get_iris_reply_room_lock(rid):
        now_sec = int(time.time())

        # Idempotency + resume (prod only): jobId 기준으로 중복/부분성공 재발송을 막는다.
        pint_state_key = ""
        pint_state: dict | None = None
        pint_items: dict | None = None
        pint_item: dict | None = None
        skip_album = False
        if target == "prod" and req_job_id:
            try:
                pint_state_key = f"{target}:{req_job_id}"
                pint_state = _read_json_dict(PINT_BRIEFING_BUNDLE_STATE_PATH) or {}
                pint_items0 = pint_state.get("items")
                pint_items = pint_items0 if isinstance(pint_items0, dict) else {}
                pint_items = _prune_pint_briefing_bundle_state_items(pint_items, now_sec)

                prev0 = pint_items.get(pint_state_key)
                pint_item = prev0 if isinstance(prev0, dict) else None
                ok_at = _safe_int0((pint_item or {}).get("okAt") or 0)
                if ok_at > 0 and now_sec - ok_at <= int(PINT_BRIEFING_BUNDLE_STATE_TTL_SEC):
                    return JSONResponse(status_code=200, content={"ok": True, "dedup": {"target": target}})

                album_ok_at = _safe_int0((pint_item or {}).get("albumOkAt") or 0)
                if album_ok_at > 0:
                    skip_album = True

                attempts = _safe_int0((pint_item or {}).get("attempts") or 0) + 1
                new_item = dict(pint_item or {})
                new_item.update(
                    {
                        "jobId": req_job_id,
                        "target": target,
                        "templateLabel": req_template_label or None,
                        "attempts": attempts,
                        "lastAttemptAt": now_sec,
                    }
                )
                if ok_at > 0:
                    new_item["okAt"] = ok_at
                if album_ok_at > 0:
                    new_item["albumOkAt"] = album_ok_at
                pint_items[pint_state_key] = new_item
                pint_state = {"updatedAt": datetime.now(timezone.utc).isoformat(), "items": pint_items}
                _write_json_atomic(PINT_BRIEFING_BUNDLE_STATE_PATH, pint_state)
                pint_item = new_item
            except Exception:
                pint_state_key = ""
                pint_state = None
                pint_items = None
                pint_item = None
                skip_album = False

        started_ms = int(time.time() * 1000)

        # 1) Image/Album (image or image_multiple)
        sender_ids = _get_iris_sender_ids()
        media_imgs = imgs[:6]
        media_is_single = len(media_imgs) == 1
        media_payload = {
            "type": "image" if media_is_single else "image_multiple",
            "room": rid,
            "data": media_imgs[0] if media_is_single else media_imgs,
        }
        media_sent_count = 1 if media_is_single else len(media_imgs)
        media_call_started_ms = int(time.time() * 1000) - 1500
        media_call_started_sec = max(0, int(media_call_started_ms / 1000) - 1)

        album_skipped = False
        media_status = 0
        media_txt = ""
        media_body = None
        media_ok = False
        media_echo_ok = False
        media_echo_wait_ms = 0
        media_db_ok = False
        media_db_wait_ms = 0
        media_db_after_id = 0
        media_db_err = None
        media_db_type = 0
        media_sendlog_ok = False
        media_sendlog_wait_ms = 0
        media_sendlog_err = None
        media_file_echo_ok = False
        media_file_echo_wait_ms = 0

        if skip_album:
            album_skipped = True
            media_ok = True
            media_sendlog_ok = True
            media_db_ok = True
            media_echo_ok = True
            media_status = 200
            media_txt = "{\"ok\":true,\"skipped\":true}"
            media_body = {"ok": True, "skipped": True}
        else:
            media_http_timeout_sec = max(30.0, min(90.0, float(media_echo_timeout_ms) / 1000.0))
            media_sendlog_ok = False
            media_sendlog_wait_ms = 0
            media_sendlog_err = None
            async with _IRIS_REPLY_LOCK:
                media_before_ok, media_before_id, media_before_err = _try_select_chatlog_max_id(rid, sender_ids)
                media_db_after_id = media_before_id
                media_db_err = media_before_err
                media_call_started_ms = int(time.time() * 1000) - 1500
                media_call_started_sec = max(0, int(media_call_started_ms / 1000) - 1)
                media_status, media_txt = _http_post_json(
                    _iris_base() + "/reply", media_payload, headers={}, timeout=media_http_timeout_sec
                )
                if media_status == 200:
                    try:
                        t1 = int(time.time() * 1000)
                        media_sendlog_ok = await _wait_for_iris_sending_log_cleared(
                            rid, media_call_started_sec, 2, media_sendlog_timeout_ms
                        )
                        media_sendlog_wait_ms = max(0, int(time.time() * 1000) - t1)
                    except HTTPException as e:
                        media_sendlog_ok = False
                        media_sendlog_err = str(e.detail)
                    except Exception as e:
                        media_sendlog_ok = False
                        media_sendlog_err = str(e)
            try:
                media_body = json.loads(media_txt) if media_txt else None
            except Exception:
                media_body = None

            media_ok = media_status == 200
            if media_ok:
                if media_sendlog_ok:
                    if media_before_ok:
                        t0 = int(time.time() * 1000)
                        media_db_ok, media_db_after_id, media_db_err = await _wait_for_iris_chatlog_advance(
                            rid, sender_ids, media_before_id, media_echo_timeout_ms
                        )
                        media_db_wait_ms = max(0, int(time.time() * 1000) - t0)
                        if media_db_ok:
                            t_ok, t_val, t_err = _try_select_chatlog_type_by_rowid(media_db_after_id)
                            if t_ok:
                                media_db_type = int(t_val or 0)
                                if _is_image_message_type(media_db_type):
                                    media_echo_ok = True
                                    media_echo_wait_ms = media_db_wait_ms
                                else:
                                    # Fallback: race-proof scan. If any recent row within this send window
                                    # is an image, treat echo as OK to avoid false negatives.
                                    f_ok, f_type, f_err = _try_find_recent_image_chatlog_type(
                                        rid, sender_ids, media_before_id, media_db_after_id
                                    )
                                    if f_ok:
                                        media_db_type = int(f_type or media_db_type)
                                        media_echo_ok = True
                                        media_echo_wait_ms = media_db_wait_ms
                                    else:
                                        media_db_ok = False
                                        media_db_err = f_err or f"type_mismatch:{media_db_type}"
                            else:
                                media_db_ok = False
                                media_db_err = t_err or "type_lookup_failed"
                    else:
                        media_db_ok = False
                        media_db_err = media_before_err or "dbEcho unavailable"

        album_ok = bool(media_ok and media_echo_ok and media_sendlog_ok and media_db_ok)
        if not album_ok:
            try:
                tfe = int(time.time() * 1000)
                media_file_echo_ok = await _wait_for_iris_image_echo(rid, media_call_started_ms, media_echo_timeout_ms)
                media_file_echo_wait_ms = max(0, int(time.time() * 1000) - tfe)
            except Exception:
                media_file_echo_ok = False
            album_ok = bool(album_ok or media_file_echo_ok)

        if not album_ok:
            return JSONResponse(
                status_code=502,
                content={
                    "ok": False,
                    "stage": "album",
                    "iris": {"httpStatus": media_status, "body": media_body, "raw": media_txt},
                    "echo": {"ok": media_echo_ok, "timeoutMs": media_echo_timeout_ms, "waitMs": media_echo_wait_ms},
                    "fileEcho": {"ok": media_file_echo_ok, "timeoutMs": media_echo_timeout_ms, "waitMs": media_file_echo_wait_ms},
                    "dbEcho": {
                        "ok": media_db_ok,
                        "timeoutMs": media_echo_timeout_ms,
                        "waitMs": media_db_wait_ms,
                        "afterId": media_db_after_id,
                        "type": media_db_type,
                        "error": media_db_err,
                    },
                    "sendlog": {
                        "ok": media_sendlog_ok,
                        "timeoutMs": media_sendlog_timeout_ms,
                        "waitMs": media_sendlog_wait_ms,
                        "error": media_sendlog_err,
                    },
                    "sent": {"target": target, "count": media_sent_count, "type": media_payload["type"]},
                },
            )

        if pint_state_key and pint_items is not None and isinstance(pint_item, dict) and not pint_item.get("albumOkAt"):
            try:
                pint_item["albumOkAt"] = now_sec
                pint_items[pint_state_key] = pint_item
                _write_json_atomic(PINT_BRIEFING_BUNDLE_STATE_PATH, {"updatedAt": datetime.now(timezone.utc).isoformat(), "items": pint_items})
            except Exception:
                pass

        if delay_ms > 0 and not album_skipped:
            await asyncio.sleep(max(0.0, delay_ms / 1000.0))

        # 2) Text detail
        text_payload = {"type": "text", "room": rid, "data": text}
        text_http_timeout_sec = max(15.0, min(30.0, float(text_sendlog_timeout_ms) / 1000.0))
        text_sendlog_ok = False
        text_sendlog_wait_ms = 0
        text_sendlog_err = None
        async with _IRIS_REPLY_LOCK:
            before_ok, before_id, before_err = _try_select_chatlog_max_id(rid, sender_ids)
            text_call_started_ms = int(time.time() * 1000) - 1500
            text_call_started_sec = max(0, int(text_call_started_ms / 1000) - 1)
            text_status, text_txt = _http_post_json(
                _iris_base() + "/reply", text_payload, headers={}, timeout=text_http_timeout_sec
            )
            if text_status == 200:
                try:
                    t2 = int(time.time() * 1000)
                    text_sendlog_ok = await _wait_for_iris_sending_log_cleared(
                        rid, text_call_started_sec, 1, text_sendlog_timeout_ms
                    )
                    text_sendlog_wait_ms = max(0, int(time.time() * 1000) - t2)
                except HTTPException as e:
                    text_sendlog_ok = False
                    text_sendlog_err = str(e.detail)
                except Exception as e:
                    text_sendlog_ok = False
                    text_sendlog_err = str(e)
        text_body = None
        try:
            text_body = json.loads(text_txt) if text_txt else None
        except Exception:
            text_body = None

        text_ok = text_status == 200
        text_db_ok = False
        text_db_wait_ms = 0
        text_db_after_id = before_id
        text_db_err = before_err
        text_file_echo_ok = False
        text_file_echo_wait_ms = 0

        if text_ok:
            if text_sendlog_ok:
                if text_db_echo_timeout_ms <= 0:
                    text_db_ok = True
                elif before_ok:
                    t3 = int(time.time() * 1000)
                    text_db_ok, text_db_after_id, text_db_err = await _wait_for_iris_chatlog_advance(
                        rid, sender_ids, before_id, text_db_echo_timeout_ms
                    )
                    text_db_wait_ms = max(0, int(time.time() * 1000) - t3)
                else:
                    # DB echo unavailable → do not claim success.
                    text_db_ok = False

        text_ok_final = bool(text_ok and text_sendlog_ok and text_db_ok)
        if not text_ok_final:
            try:
                tfe2 = int(time.time() * 1000)
                # file echo는 "실제 메시지가 방 로그에 남았는지"로 확인한다(쿼리/네트워크 레이스 완화).
                text_file_echo_ok = await _wait_for_iris_text_echo(
                    rid, text_call_started_ms, text, max(2500, min(60_000, int(text_sendlog_timeout_ms)))
                )
                text_file_echo_wait_ms = max(0, int(time.time() * 1000) - tfe2)
            except Exception:
                text_file_echo_ok = False
            text_ok_final = bool(text_ok_final or text_file_echo_ok)

        ok = bool(album_ok and text_ok_final)
        stage = None if ok else ("text" if album_ok else "album")
        code = 200 if ok else 502

        if ok and pint_state_key and pint_items is not None and isinstance(pint_item, dict):
            try:
                pint_item["textOkAt"] = now_sec
                pint_item["okAt"] = now_sec
                pint_items[pint_state_key] = pint_item
                _write_json_atomic(PINT_BRIEFING_BUNDLE_STATE_PATH, {"updatedAt": datetime.now(timezone.utc).isoformat(), "items": pint_items})
            except Exception:
                pass

        return JSONResponse(
            status_code=code,
            content={
                "ok": ok,
                "stage": stage,
                "ms": max(0, int(time.time() * 1000) - started_ms),
                "sent": {"target": target, "images": media_sent_count, "textLen": len(text)},
                "download": {"failed": download_failed} if download_failed else None,
                "album": {
                    "ok": bool(album_ok),
                    "skipped": bool(album_skipped),
                    "iris": {"httpStatus": media_status, "body": media_body, "raw": media_txt},
                    "echo": {"ok": media_echo_ok, "timeoutMs": media_echo_timeout_ms, "waitMs": media_echo_wait_ms},
                    "fileEcho": {"ok": media_file_echo_ok, "timeoutMs": media_echo_timeout_ms, "waitMs": media_file_echo_wait_ms},
                    "sendlog": {
                        "ok": media_sendlog_ok,
                        "timeoutMs": media_sendlog_timeout_ms,
                        "waitMs": media_sendlog_wait_ms,
                        "error": media_sendlog_err,
                    },
                    "dbEcho": {
                        "ok": media_db_ok,
                        "timeoutMs": media_echo_timeout_ms,
                        "waitMs": media_db_wait_ms,
                        "afterId": media_db_after_id,
                        "type": media_db_type,
                        "error": media_db_err,
                    },
                },
                "text": {
                    "ok": bool(text_ok_final),
                    "iris": {"httpStatus": text_status, "body": text_body, "raw": text_txt},
                    "sendlog": {
                        "ok": text_sendlog_ok,
                        "timeoutMs": text_sendlog_timeout_ms,
                        "waitMs": text_sendlog_wait_ms,
                        "error": text_sendlog_err,
                    },
                    "fileEcho": {"ok": text_file_echo_ok, "timeoutMs": text_sendlog_timeout_ms, "waitMs": text_file_echo_wait_ms},
                    "dbEcho": {
                        "ok": text_db_ok,
                        "timeoutMs": text_db_echo_timeout_ms,
                        "waitMs": text_db_wait_ms,
                        "beforeId": before_id,
                        "afterId": text_db_after_id,
                        "error": text_db_err,
                    },
                },
            },
        )


@app.get("/talkapi/health")
async def talkapi_health():
    return JSONResponse(
        content={
            "enabled": False,
            "deprecated": True,
            "baseUrl": None,
            "reachable": False,
            "status": None,
            "error": "DEPRECATED_TALKAPI_DISABLED",
        }
    )


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
    rendered = _render_template_text(content, ctx)
    imgs = list(tpl.get('images') or [])
    safe = load_runtime().get('safeMode', True)
    return JSONResponse(content={
        "content": rendered,
        "mentions": [],
        "mentionees": [],
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
