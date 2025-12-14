#!/usr/bin/env python3
"""
카카오톡 오픈채팅방 실시간 닉네임 리스트 수집기.

전제
- FastAPI 실시간 서버가 기동 중이어야 함 (`scripts/serve_api_fastapi.sh` 또는 `windows/start_api.ps1`).
- IRIS 로그가 `node-iris-app/data/logs` 아래에 쌓이고 있어야 함.
- SAFE_MODE 여부와 무관하게 읽기 전용 동작.

환경 변수
- REALTIME_API_URL: FastAPI 실시간 서버 주소 (기본 `http://127.0.0.1:8600`).
- ROOM_IDS: 콤마로 구분한 roomId 목록. 비워두면 `/rooms` API로 자동 탐색.

실행 예시
    python scripts/live_roster.py
    REALTIME_API_URL=http://localhost:8600 ROOM_IDS=12345,67890 python scripts/live_roster.py
"""

from __future__ import annotations

import json
import os
import sys
import time
from typing import Dict, List, Set

import requests


API_BASE = os.getenv("REALTIME_API_URL", "http://127.0.0.1:8600").rstrip("/")
ROOM_IDS_ENV = [r.strip() for r in os.getenv("ROOM_IDS", "").split(",") if r.strip()]


def log(msg: str) -> None:
    now = time.strftime("%H:%M:%S")
    print(f"[{now}] {msg}", flush=True)


def fetch_rooms() -> List[str]:
    resp = requests.get(f"{API_BASE}/rooms", timeout=5)
    resp.raise_for_status()
    rooms = resp.json()
    return [str(r.get("roomId")) for r in rooms if r.get("roomId")]


def apply_entry(room_set: Set[str], entry: dict) -> bool:
    """엔트리를 적용하고 변경 여부를 반환."""
    before = set(room_set)
    text = str(entry.get("text") or "").lower()
    sender = str(entry.get("sender") or "").strip()
    if text.startswith("join") and sender:
        room_set.add(sender)
    elif text.startswith("leave") and sender:
        room_set.discard(sender)
    return room_set != before


def build_snapshot(room_ids: List[str]) -> Dict[str, Set[str]]:
    roster: Dict[str, Set[str]] = {rid: set() for rid in room_ids}
    for rid in room_ids:
        try:
            resp = requests.get(
                f"{API_BASE}/logs",
                params={"roomId": rid, "limit": 500, "include": "join,leave"},
                timeout=10,
            )
            resp.raise_for_status()
            entries = resp.json() or []
            for e in entries:
                apply_entry(roster[rid], e)
        except Exception as e:  # pragma: no cover - 런타임 로깅 목적
            log(f"초기 스냅샷 실패: room={rid}, err={e}")
    return roster


def print_roster(roster: Dict[str, Set[str]]) -> None:
    for rid, members in roster.items():
        names = ", ".join(sorted(members))
        log(f"room {rid}: {len(members)}명 [{names}]")


def handle_payload(payload: dict, roster: Dict[str, Set[str]]) -> bool:
    """SSE payload를 반영. 변경 발생 시 True."""
    changed = False
    rooms = payload.get("rooms") or {}
    if isinstance(rooms, dict):
        for rid, entries in rooms.items():
            if not isinstance(entries, list):
                continue
            bucket = roster.setdefault(str(rid), set())
            for e in entries:
                try:
                    if apply_entry(bucket, e):
                        changed = True
                except Exception:
                    continue
    return changed


def stream(room_ids: List[str], roster: Dict[str, Set[str]]) -> None:
    params = {
        "rooms": ",".join(room_ids),
        "limit": 200,
        "include": "join,leave",
        "interval": 1000,
    }
    log(f"SSE 구독 시작: rooms={room_ids}, api={API_BASE}")
    with requests.get(f"{API_BASE}/logs/stream", params=params, stream=True, timeout=300) as resp:
        resp.raise_for_status()
        for raw in resp.iter_lines(decode_unicode=True):
            if raw is None or raw.strip() == "":
                continue
            if raw.startswith(":"):
                continue  # heartbeat
            if not raw.startswith("data:"):
                continue
            try:
                payload = json.loads(raw[len("data:"):].strip())
            except Exception:
                continue
            if handle_payload(payload, roster):
                print_roster(roster)


def main() -> int:
    room_ids = ROOM_IDS_ENV or fetch_rooms()
    if not room_ids:
        log("roomId를 찾을 수 없습니다. ROOM_IDS 환경 변수를 지정하거나 로그가 존재하는지 확인하세요.")
        return 1

    log(f"초기 스냅샷 수집: rooms={room_ids}")
    roster = build_snapshot(room_ids)
    print_roster(roster)

    while True:
        try:
            stream(room_ids, roster)
        except requests.RequestException as e:
            log(f"연결 끊김, 3초 후 재시도: {e}")
            time.sleep(3)
            continue
        except KeyboardInterrupt:
            log("중단")
            return 0
        except Exception as e:  # pragma: no cover - 런타임 로깅
            log(f"예상치 못한 오류, 3초 후 재시도: {e}")
            time.sleep(3)


if __name__ == "__main__":
    sys.exit(main())
