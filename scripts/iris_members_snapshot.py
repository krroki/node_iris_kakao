#!/usr/bin/env python3
"""
IRIS open_chat_member snapshot reporter.

정확한 현재 방 인원수와 닉네임 목록을 IRIS DB(open_chat_member)에서 조회합니다.

전제
- IRIS HTTP 게이트웨이가 '/query' 엔드포인트를 제공해야 합니다.
- 쿼리: select enc, nickname, user_id, involved_chat_id from db2.open_chat_member

사용법
  IRIS_BASE_URL=http://127.0.0.1:3000 \
  python3 scripts/iris_members_snapshot.py \
    --rooms 18426993080683374,18455243186079943 \
    --output logs/analysis/iris_members_snapshot.json

옵션
- --token: Bearer 토큰(있다면)
- --rooms: 특정 방만 쉼표로 제한(없으면 전체)
- --timeout: 요청 타임아웃
"""
from __future__ import annotations

import argparse
import json
import os
from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, List, Optional

import requests

DEFAULT_QUERY = {
    "query": "select enc,nickname,user_id,involved_chat_id from db2.open_chat_member",
    "bind": [],
}


@dataclass
class Member:
    user_id: str
    nickname: str
    room_id: str


def fetch_members(base_url: str, token: Optional[str], timeout: float = 10.0) -> List[Member]:
    url = base_url.rstrip("/") + "/query"
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    res = requests.post(url, headers=headers, json=DEFAULT_QUERY, timeout=timeout)
    res.raise_for_status()
    data = (res.json() or {}).get("data", [])
    members: List[Member] = []
    for item in data:
        uid = str(item.get("user_id", "")).strip()
        nick = str(item.get("nickname", "")).strip()
        rid = str(item.get("involved_chat_id", "")).strip()
        if not uid or not rid:
            continue
        members.append(Member(user_id=uid, nickname=nick, room_id=rid))
    return members


def main() -> None:
    ap = argparse.ArgumentParser(description="IRIS open_chat_member snapshot reporter")
    ap.add_argument("--base-url", default=os.getenv("IRIS_BASE_URL") or os.getenv("IRIS_URL"), help="IRIS HTTP base URL (e.g. http://127.0.0.1:3000)")
    ap.add_argument("--token", default=os.getenv("IRIS_API_TOKEN"))
    ap.add_argument("--rooms", default=None, help="Comma-separated room IDs to include")
    ap.add_argument("--timeout", type=float, default=10.0)
    ap.add_argument("--output", default="logs/analysis/iris_members_snapshot.json")
    args = ap.parse_args()

    if not args.base_url:
        raise SystemExit("IRIS_BASE_URL 또는 IRIS_URL 환경변수를 지정하거나 --base-url 제공 필요")

    try:
        members = fetch_members(args.base_url, args.token, args.timeout)
    except Exception as e:
        raise SystemExit(f"[오류] IRIS /query 호출 실패: {e}")

    allow_rooms = None
    if args.rooms:
        allow_rooms = {s.strip() for s in args.rooms.split(',') if s.strip()}

    rooms: Dict[str, List[Member]] = defaultdict(list)
    for m in members:
        if allow_rooms and m.room_id not in allow_rooms:
            continue
        rooms[m.room_id].append(m)

    report = {
        "base_url": args.base_url,
        "rooms": {},
        "total_rooms": 0,
        "total_members": 0,
    }
    total_members = 0
    for rid, lst in rooms.items():
        unique_users = {}
        for m in lst:
            unique_users[m.user_id] = m.nickname
        nicknames = sorted([(uid, unique_users[uid]) for uid in unique_users.keys()], key=lambda x: x[1] or "")
        report["rooms"][rid] = {
            "count": len(nicknames),
            "nicknames": nicknames,
        }
        total_members += len(nicknames)
    report["total_rooms"] = len(report["rooms"])
    report["total_members"] = total_members

    out_path = args.output
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"[완료] 보고서 저장: {out_path}")


if __name__ == "__main__":
    main()

