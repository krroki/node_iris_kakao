#!/usr/bin/env python3
"""
Analyze node-iris chat logs and extract answerable patterns for Gemini.

Reads JSONL logs under node-iris-app/data/logs/**/<date>.log and outputs a
report with measured counts, sample messages, and recommended gating rules.

Usage:
  python3 scripts/patterns_from_logs.py --max-files 200 --max-lines 200000 \
      --output logs/analysis/patterns_report.txt
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


BASE_DIR = Path(__file__).resolve().parents[1]
LOG_BASE = BASE_DIR / "node-iris-app" / "data" / "logs"


@dataclass
class Rec:
    ts: datetime
    room_id: str
    room_name: str
    user: str
    text: str
    feed_type: Optional[int] = None


def iso_to_dt(s: str) -> datetime:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return datetime.utcnow()


def derive_msg_from_raw(raw: str) -> Tuple[str, Optional[int]]:
    msg = raw
    ft = None
    try:
        m = re.search(r"msg=(?:\"([^\"]*)\"|([^,\)]*))", raw)
        if m:
            msg = (m.group(1) or m.group(2) or "").strip()
        m2 = re.search(r"feedType=(\d+)", raw)
        if m2:
            ft = int(m2.group(1))
    except Exception:
        pass
    return msg, ft


def parse_line(line: str) -> Optional[Rec]:
    try:
        obj = json.loads(line)
    except Exception:
        return None
    snap = obj.get("snapshot") or {}
    payload = obj.get("payload") or {}
    room_id = str(snap.get("roomId") or snap.get("room_id") or "").strip()
    room_name = str(snap.get("roomName") or snap.get("room_name") or room_id)
    user = str(snap.get("senderName") or payload.get("user_name") or snap.get("sender_name") or snap.get("senderId") or "").strip()
    txt = payload.get("text")
    if not isinstance(txt, str) or not txt.strip() or txt.strip() == "[object Object]":
        txt = snap.get("messageText") or snap.get("message_text") or ""
    feed_type = None
    if isinstance(txt, str) and txt.startswith("Message("):
        txt, feed_type = derive_msg_from_raw(txt)
    if isinstance(txt, str) and (txt.strip() == "" or txt.strip() == "[object Object]"):
        raw = payload.get("raw")
        if isinstance(raw, str) and raw.strip():
            txt2, ft2 = derive_msg_from_raw(raw)
            txt = txt2
            feed_type = feed_type or ft2
    if not isinstance(txt, str):
        txt = str(txt)
    ts = iso_to_dt(obj.get("timestamp") or "")
    return Rec(ts=ts, room_id=room_id, room_name=room_name, user=user or "", text=txt.strip(), feed_type=feed_type)


GREETING = re.compile(r"^(안녕|안녕하세요|ㅎ{2,}|하이|반갑|수고|감사|고마워|감사합니다)[^\w\S]?$")
QUESTION = re.compile(r"[\?]|")
QUESTION_WORDS = re.compile(r"(왜|어떻게|무엇|뭐|언제|어디|누구|몇|가능|맞나요|되나요)")
FEED_WORDS = re.compile(r"(입장하셨습니다|입장했습니다|나가셨습니다|퇴장했습니다)")
LINK = re.compile(r"https?://|cafe\.naver\.com|youtu(\.be|be\.com)")

DOMAIN_KWS = [
    "설치", "오류", "에러", "버전", "업데이트", "가이드", "방법", "계정", "로그인", "연결", "권한",
    "속도", "테스트", "배포", "링크", "신청", "시간", "주소", "영상", "편집", "캡컷", "쇼츠",
    "공지", "닉네임", "인증", "하트", "규칙", "강퇴", "무료특강", "디하클", "카페",
]


def is_feed(rec: Rec) -> bool:
    if rec.feed_type in (2, 4):
        return True
    return bool(FEED_WORDS.search(rec.text))


def categorize(rec: Rec) -> str:
    t = rec.text
    if is_feed(rec):
        return "feed"
    if GREETING.match(t) or len(t) <= 2:
        return "greeting"
    has_q = ("?" in t) or bool(QUESTION_WORDS.search(t))
    has_link = bool(LINK.search(t))
    has_kw = any(k in t for k in DOMAIN_KWS)
    longish = len(t) >= 15

    if has_q and any(k in t for k in ("설치", "오류", "에러", "연결", "권한", "로그인", "버전", "업데이트", "안돼", "안되")):
        return "q_troubleshoot"
    if has_q and any(k in t for k in ("시간", "언제", "주소", "링크", "신청", "어디")):
        return "q_schedule_info"
    if has_q and any(k in t for k in ("쇼츠", "영상", "편집", "캡컷", "알고리즘")):
        return "q_howto_content"
    if has_link and has_q:
        return "q_with_link"
    if has_link and not has_q:
        return "link_share"
    if has_kw and longish and not has_q:
        return "statement_with_keywords"
    if has_q:
        return "q_other"
    return "other"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(LOG_BASE))
    ap.add_argument("--max-files", type=int, default=400)
    ap.add_argument("--max-lines", type=int, default=400000)
    ap.add_argument("--output", default="logs/analysis/patterns_report.txt")
    args = ap.parse_args()

    base = Path(args.root)
    files = sorted(glob.glob(str(base / "*" / "*.log")))
    files = files[-args.max_files :]

    counts = Counter()
    top_rooms = Counter()
    kw_counts = Counter()
    samples: Dict[str, List[str]] = defaultdict(list)
    total_lines = 0

    for fp in files:
        try:
            with open(fp, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    total_lines += 1
                    if total_lines > args.max_lines:
                        break
                    line = line.strip()
                    if not line:
                        continue
                    rec = parse_line(line)
                    if not rec or not rec.text:
                        continue
                    cat = categorize(rec)
                    counts[cat] += 1
                    if cat not in ("feed", "greeting"):
                        top_rooms[rec.room_name] += 1
                    for kw in DOMAIN_KWS:
                        if kw in rec.text:
                            kw_counts[kw] += 1
                    # Keep a few samples per category
                    if len(samples[cat]) < 5:
                        text = rec.text.replace("\n", " ")
                        samples[cat].append(f"[{rec.room_name}] {rec.user}: {text[:160]}")
        except Exception:
            continue

    # Build report
    out = []
    out.append("[총 파일 수] " + str(len(files)))
    out.append("[총 처리 라인] " + str(total_lines))
    out.append("")
    out.append("[카테고리 집계]")
    for cat, c in counts.most_common():
        out.append(f"- {cat}: {c}")
    out.append("")
    out.append("[상위 방(내용 있는 메시지 기준)]")
    for rn, c in top_rooms.most_common(10):
        out.append(f"- {rn}: {c}")
    out.append("")
    out.append("[키워드 상위]")
    for kw, c in kw_counts.most_common(20):
        out.append(f"- {kw}: {c}")
    out.append("")
    out.append("[카테고리별 샘플(최대 5개)]")
    for cat in (
        "q_troubleshoot",
        "q_schedule_info",
        "q_howto_content",
        "q_with_link",
        "statement_with_keywords",
        "q_other",
        "link_share",
        "other",
        "greeting",
    ):
        if samples.get(cat):
            out.append(f"- {cat}")
            out.extend(["  " + s for s in samples[cat]])
            out.append("")

    # Recommendations derived from counts
    out.append("[권장 응답 패턴]")
    out.extend([
        "- 응답 우선: q_troubleshoot, q_schedule_info, q_howto_content, q_with_link",
        "- 조건부: statement_with_keywords(맥락 충분할 때)",
        "- 제외: feed, greeting, link_share(링크만), other(맥락 부족)",
    ])

    out_dir = Path(args.output).parent
    out_dir.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text("\n".join(out), encoding="utf-8")
    print(f"[완료] 보고서 저장: {args.output}")


if __name__ == "__main__":
    main()

