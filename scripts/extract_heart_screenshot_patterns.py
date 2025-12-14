#!/usr/bin/env python3
"""
Extract and quantify "하트 스샷(스크린샷) 보내는 법/인증" 질문 패턴 from real logs.

Reads node-iris JSON Lines logs and reports strict, data-backed statistics:
- total matches, by room, by date
- categorized intents (how_to_send / how_to_capture / certification / where_to_send)
- top example utterances (verbatim, truncated)

Usage:
  python3 scripts/extract_heart_screenshot_patterns.py \
    --root node-iris-app/data/logs --max-files 1000 --max-lines 1000000 \
    --output logs/analysis/heart_screenshot_report.txt
"""
from __future__ import annotations

import argparse
import glob
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple


@dataclass
class Rec:
    ts: datetime
    date: str
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
    return Rec(ts=ts, date=ts.strftime("%Y-%m-%d"), room_id=room_id, room_name=room_name, user=user or "", text=txt.strip(), feed_type=feed_type)


# Lexicon
HEART = re.compile(r"하트")
SHOT = re.compile(r"(스샷|스크린샷|스크샷|캡처|캡쳐|사진)")
ASK = re.compile(r"(어떻게|어케|방법|하는법|하는 법|되나요|맞나요|보내|올리|찍)")
CERT = re.compile(r"인증")
WHERE = re.compile(r"어디(로|에)?")

FEED_WORDS = re.compile(r"(입장하셨습니다|입장했습니다|나가셨습니다|퇴장했습니다)")
GREETING = re.compile(r"^(안녕|안녕하세요|ㅎ{2,}|하이|반갑|수고|감사|고마워|감사합니다)[^\w\S]?$")


def is_feed(rec: Rec) -> bool:
    if rec.feed_type in (2, 4):
        return True
    return bool(FEED_WORDS.search(rec.text))


def matches_heart_question(text: str) -> bool:
    t = text.strip()
    if not t:
        return False
    # Must contain '하트' AND one of screenshot/cert words
    if not HEART.search(t):
        return False
    if not (SHOT.search(t) or CERT.search(t)):
        return False
    # Require interrogative pattern or explicit question mark
    if ASK.search(t) or WHERE.search(t) or '?' in t:
        return True
    return False


def categorize(text: str) -> str:
    t = text
    how_send = re.search(r"(보내|올리|업로드|첨부)", t)
    how_capture = re.search(r"(찍|캡처|캡쳐|스크린샷|스샷|스크샷)", t)
    cert = CERT.search(t)
    where = WHERE.search(t)
    if how_send:
        return "how_to_send"
    if how_capture:
        return "how_to_capture"
    if where:
        return "where_to_send"
    if cert:
        return "certification"
    return "other"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="node-iris-app/data/logs")
    ap.add_argument("--max-files", type=int, default=1000)
    ap.add_argument("--max-lines", type=int, default=1000000)
    ap.add_argument("--output", default="logs/analysis/heart_screenshot_report.txt")
    args = ap.parse_args()

    files = sorted(glob.glob(str(Path(args.root) / "*" / "*.log")))
    files = files[-args.max_files :]

    total = 0
    by_room = Counter()
    by_date = Counter()
    by_user = Counter()
    by_cat = Counter()
    samples = defaultdict(list)  # cat -> examples

    line_count = 0
    for fp in files:
        try:
            with open(fp, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line_count += 1
                    if line_count > args.max_lines:
                        break
                    line = line.strip()
                    if not line:
                        continue
                    rec = parse_line(line)
                    if not rec or not rec.text:
                        continue
                    if is_feed(rec) or GREETING.match(rec.text):
                        continue
                    # Focus on real users asking (exclude automated bot lines)
                    if rec.user in ("오픈채팅봇", "쿠로 AI"):
                        continue
                    if not matches_heart_question(rec.text):
                        continue
                    total += 1
                    by_room[rec.room_name] += 1
                    by_date[rec.date] += 1
                    if rec.user:
                        by_user[rec.user] += 1
                    cat = categorize(rec.text)
                    by_cat[cat] += 1
                    if len(samples[cat]) < 8:
                        t = rec.text.replace('\n', ' ')
                        if len(t) > 220:
                            t = t[:200] + ' …(생략)'
                        samples[cat].append(f"[{rec.date}] [{rec.room_name}] {rec.user}: {t}")
        except Exception:
            continue

    out_lines = []
    out_lines.append(f"[총 파일 수] {len(files)}")
    out_lines.append(f"[총 처리 라인] {line_count}")
    out_lines.append("")
    out_lines.append(f"[하트 스샷 관련 질의 매치 수] {total}")
    out_lines.append("")
    out_lines.append("[의도별 집계]")
    for k, v in by_cat.most_common():
        out_lines.append(f"- {k}: {v}")
    out_lines.append("")
    out_lines.append("[방별 상위]")
    for rn, c in by_room.most_common(15):
        out_lines.append(f"- {rn}: {c}")
    out_lines.append("")
    out_lines.append("[일자별 집계]")
    for d, c in sorted(by_date.items()):
        out_lines.append(f"- {d}: {c}")
    out_lines.append("")
    out_lines.append("[사용자 상위]")
    for u, c in by_user.most_common(15):
        out_lines.append(f"- {u}: {c}")
    out_lines.append("")
    out_lines.append("[예시(카테고리별 최대 8건, 원문)]")
    for cat in ("how_to_send","how_to_capture","where_to_send","certification","other"):
        ex = samples.get(cat)
        if ex:
            out_lines.append(f"- {cat}")
            out_lines.extend(["  " + s for s in ex])
            out_lines.append("")

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(out_lines), encoding="utf-8")
    print(f"[완료] 보고서 저장: {out_path}")


if __name__ == "__main__":
    main()
