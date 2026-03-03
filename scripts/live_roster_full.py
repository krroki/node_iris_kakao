#!/usr/bin/env python3
"""
IRIS open_chat_member 기반 실시간 참여자 닉네임 리스트 수집기.

동작 개요
- IRIS HTTP `/query` 엔드포인트로 `db2.open_chat_member` 테이블을 주기적으로 조회해 전체 참여자 스냅샷을 만든다.
- 필요 시 `/logs/stream`(join/leave 필터)와 병행해 변화 감지 속도를 높인다.
- SAFE_MODE 여부와 무관한 읽기 전용 스크립트.

환경 변수
- IRIS_BASE_URL 또는 IRIS_URL: IRIS HTTP 베이스 URL (기본 `http://127.0.0.1:3000`)
- IRIS_API_TOKEN: 필요 시 Bearer 토큰
- REALTIME_API_URL: FastAPI 실시간 서버 주소 (옵션, 기본 `http://127.0.0.1:8600`)
- ROOM_IDS: 콤마로 구분한 roomId 목록. 비우면 DB 스냅샷 전체를 사용.

옵션 예시
    python scripts/live_roster_full.py --interval 20
    ROOM_IDS=18426993080683374 IRIS_BASE_URL=http://localhost:3000 python scripts/live_roster_full.py --once
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from typing import Dict, List, Optional, Set, Tuple

import requests


DEFAULT_QUERY = {
    "query": "select enc,nickname,user_id,involved_chat_id from db2.open_chat_member",
    "bind": [],
}

API_BASE = os.getenv("IRIS_BASE_URL") or os.getenv("IRIS_URL") or "http://127.0.0.1:3000"
REALTIME_API = os.getenv("REALTIME_API_URL", "http://127.0.0.1:8600").rstrip("/")
ROOM_IDS_ENV = [r.strip() for r in os.getenv("ROOM_IDS", "").split(",") if r.strip()]
TOKEN = os.getenv("IRIS_API_TOKEN") or None


def log(msg: str) -> None:
    now = time.strftime("%H:%M:%S")
    print(f"[{now}] {msg}", flush=True)


def fetch_members(base_url: str, token: Optional[str], timeout: float = 10.0) -> List[Tuple[str, str, str]]:
    """return list of (room_id, user_id, nickname)"""
    url = base_url.rstrip("/") + "/query"
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    res = requests.post(url, headers=headers, json=DEFAULT_QUERY, timeout=timeout)
    res.raise_for_status()
    data = (res.json() or {}).get("data", [])
    out: List[Tuple[str, str, str]] = []
    for item in data:
        rid = str(item.get("involved_chat_id", "")).strip()
        uid = str(item.get("user_id", "")).strip()
        nick = str(item.get("nickname", "")).strip()
        if rid and uid:
            out.append((rid, uid, nick))
    return out


def build_roster(rows: List[Tuple[str, str, str]], allow_rooms: Optional[Set[str]]) -> Dict[str, Dict[str, str]]:
    roster: Dict[str, Dict[str, str]] = defaultdict(dict)
    for rid, uid, nick in rows:
        if allow_rooms and rid not in allow_rooms:
            continue
        roster[rid][uid] = nick
    return roster


def diff_and_print(prev: Dict[str, Dict[str, str]], curr: Dict[str, Dict[str, str]]) -> None:
    # 신규/이탈/닉변을 표기
    rooms = sorted(set(prev.keys()) | set(curr.keys()))
    for rid in rooms:
        before = prev.get(rid, {})
        after = curr.get(rid, {})
        joined = [uid for uid in after.keys() if uid not in before]
        left = [uid for uid in before.keys() if uid not in after]
        renamed = [uid for uid in after.keys() if uid in before and before[uid] != after[uid]]

        if joined or left or renamed:
            if joined:
                log(f"room {rid}: +{len(joined)} join -> {[after[u] for u in joined][:5]}{' ...' if len(joined) > 5 else ''}")
            if left:
                log(f"room {rid}: -{len(left)} leave")
            if renamed:
                samples = [f"{before[u]}->{after[u]}" for u in renamed[:5]]
                log(f"room {rid}: {len(renamed)} renamed -> {samples}{' ...' if len(renamed) > 5 else ''}")

        # Always print current count
        log(f"room {rid}: {len(after)}명")


def main() -> int:
    ap = argparse.ArgumentParser(description="IRIS open_chat_member 실시간 참여자 추적")
    ap.add_argument("--base-url", default=API_BASE)
    ap.add_argument("--token", default=TOKEN)
    ap.add_argument("--interval", type=int, default=30, help="재조회 간격(초). 0이면 한 번만 조회")
    ap.add_argument("--rooms", default=None, help="콤마 구분 roomId 목록(미지정 시 전체)")
    ap.add_argument("--timeout", type=float, default=10.0)
    ap.add_argument("--once", action="store_true", help="단일 스냅샷만 출력하고 종료")
    args = ap.parse_args()

    allow_rooms = set([r.strip() for r in (args.rooms.split(",") if args.rooms else ROOM_IDS_ENV) if r.strip()]) or None

    interval = 0 if args.once else max(1, args.interval)

    prev: Dict[str, Dict[str, str]] = {}
    while True:
        try:
            rows = fetch_members(args.base_url, args.token, args.timeout)
            curr = build_roster(rows, allow_rooms)
            diff_and_print(prev, curr) if prev else diff_and_print(curr, curr)
            prev = curr
        except KeyboardInterrupt:
            log("중단")
            return 0
        except Exception as e:
            log(f"조회 실패: {e}")
        if interval <= 0:
            return 0
        time.sleep(interval)


if __name__ == "__main__":
    sys.exit(main())
