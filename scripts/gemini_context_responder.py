#!/usr/bin/env python3
"""
Gemini 1.5 Pro context-aware responder (test harness).

기능 요약
- JSON Lines 로그(예: logs/10000001/2025-10-28.log)를 읽어 메시지 스트림을 구성
- 질문 뉘앙스면 즉시 트리거, 평문은 10개마다 1회 트리거
- 트리거 시 최근 대화 요약 + 마지막 N개 메시지 발췌를 컨텍스트로 전달
- 상냥한 운영진 톤의 시스템 프롬프트 구성
- 드라이런(--dry-run) 기본, --execute 시 실제 Gemini 호출
- 간단한 토큰/문자수 기반 입력/출력 추정치 표시(비용 산정은 별도 단가로 계산)

주의
- 실제 카카오 발신은 수행하지 않으며 콘솔에 결과만 출력합니다.
- API Key는 환경변수 GEMINI_API_KEY 또는 --api-key 인자로 받습니다.

사용 예시
  python3 scripts/gemini_context_responder.py \
    --log logs/10000001/2025-10-28.log --room-name "숏천모 2번방" --dry-run

  GEMINI_API_KEY=... python3 scripts/gemini_context_responder.py \
    --log logs/10000001/2025-10-28.log --room-name "디하클 시크릿톡방" --execute
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import textwrap
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Optional

try:
    import google.generativeai as genai  # legacy SDK (v1beta)
except Exception:  # pragma: no cover - optional at import time
    genai = None  # type: ignore

try:
    from google import genai as genai_new  # new SDK
except Exception:  # pragma: no cover - optional at import time
    genai_new = None  # type: ignore

try:
    # .env 자동 로딩 (선택사항)
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

# module-level API key for new SDK client
GENAI_API_KEY: Optional[str] = None


def _to_int(v: Optional[object]) -> Optional[int]:
    try:
        if v is None:
            return None
        s = str(v).strip()
        if not s:
            return None
        return int(s)
    except Exception:
        return None


# ---------- Data structures ----------

@dataclass
class ChatEvent:
    timestamp: datetime
    room_id: Optional[int]
    room_name: Optional[str]
    user_name: Optional[str]
    text: str
    feed_type: Optional[int] = None  # 2: leave, 4: join (observed in raw)


# ---------- Parsing helpers ----------

def load_jsonl(path: str) -> List[dict]:
    rows: List[dict] = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                # 무해화: 비정상 라인은 건너뜀
                continue
    return rows


def _derive_text_from_raw(praw: str) -> str:
    # Try to extract msg field from textual dumps like: Message(id=..., msg=...)
    try:
        m = re.search(r"msg=(?:\"([^\"]*)\"|([^,\)]*))", praw)
        if m:
            return (m.group(1) or m.group(2) or "").strip()
    except Exception:
        pass
    return praw


def _derive_msg_from_message_text(s: str) -> tuple[str, Optional[int]]:
    """Extract msg and feedType from textual dump like 'Message(id=..., feedType=2, msg=... )'."""
    feed = None
    try:
        mft = re.search(r"feedType=(\d+)", s)
        if mft:
            try:
                feed = int(mft.group(1))
            except Exception:
                feed = None
        m = re.search(r"msg=(?:\"([^\"]*)\"|([^,\)]*))", s)
        if m:
            msg = (m.group(1) or m.group(2) or "").strip()
            return msg, feed
    except Exception:
        pass
    return s, feed


def parse_events(rows: Iterable[dict]) -> List[ChatEvent]:
    events: List[ChatEvent] = []
    for r in rows:
        ts_raw = r.get("timestamp")
        try:
            ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00")) if isinstance(ts_raw, str) else datetime.utcnow()
        except Exception:
            ts = datetime.utcnow()

        snap = r.get("snapshot", {}) or {}
        payload = r.get("payload", {}) or {}
        # Prefer payload.text, then snapshot.message_text/messageText
        text = payload.get("text")
        if not isinstance(text, str) or not text.strip() or text.strip() == "[object Object]":
            text = snap.get("message_text") or snap.get("messageText") or ""
        # If still a textual dump like Message(...), try to extract msg/feedType
        feed_type = None
        if isinstance(text, str) and text.startswith("Message("):
            text, feed_type = _derive_msg_from_message_text(text)
        if isinstance(text, str) and text.strip() in ("", "[object Object]"):
            raw = payload.get("raw")
            if isinstance(raw, str) and raw.strip():
                derived = _derive_text_from_raw(raw)
                text = derived
                # try feedType from raw
                if feed_type is None:
                    try:
                        mft = re.search(r"feedType=(\d+)", raw)
                        if mft:
                            feed_type = int(mft.group(1))
                    except Exception:
                        pass
        if not isinstance(text, str):
            text = str(text)

        events.append(
            ChatEvent(
                timestamp=ts,
                room_id=snap.get("room_id") or _to_int(snap.get("roomId")),
                room_name=snap.get("room_name") or snap.get("roomName"),
                user_name=payload.get("user_name") or snap.get("sender_name") or snap.get("senderName"),
                text=(text.strip() if isinstance(text, str) else str(text).strip()),
                feed_type=feed_type,
            )
        )
    # 시간순 정렬 보장
    events.sort(key=lambda e: e.timestamp)
    return events


# ---------- Classification & triggers ----------

QUESTION_PATTERNS = [
    r"\?$",  # 물음표로 끝남
    r"\?\?+$",
    r"(왜|어떻게|무엇|뭐|언제|어디|누구|몇)\b",
    r"(가능할까요|가능한가요|되나요|되나요\?|되요\?|맞나요|맞는가요|알려주세요|설명해줘|도와줘)",
]

CONFIRM_PATTERNS = [
    r"맞나요\??$",
    r"이렇게 하는거\s*맞나요\??",
    r"이렇게 하면\s*되나요\??",
    r"이게\s*맞죠\??",
    r"이런\s*식으로\s*하면\s*되나요\??",
]

GREETING_PATTERNS = [
    r"^(안녕|안녕하세요|하이|ㅎ{1,}|ㅋ{1,}|반갑|감사|고맙|굿모닝|굿밤|수고|수고하세).*",
]


def is_feed_event(ev: ChatEvent) -> bool:
    if ev.feed_type in (2, 4):
        return True
    t = ev.text.strip()
    if not t:
        return False
    if re.search(r"(입장하셨습니다|나가셨습니다|입장했습니다|퇴장했습니다)", t):
        return True
    return False


def is_question_like(text: str) -> bool:
    t = text.strip()
    if not t:
        return False
    for pat in QUESTION_PATTERNS:
        if re.search(pat, t):
            return True
    return False


def is_greeting_like(text: str) -> bool:
    t = text.strip()
    if not t:
        return False
    if len(t) <= 10:
        for pat in GREETING_PATTERNS:
            if re.search(pat, t):
                return True
    return False


def is_confirm_like(text: str) -> bool:
    t = text.strip()
    if not t:
        return False
    for pat in CONFIRM_PATTERNS:
        if re.search(pat, t):
            return True
    return False


def is_link_like(text: str) -> bool:
    return bool(re.search(r"https?://|cafe\.naver\.com|youtu(\.be|be\.com)", text))


DOMAIN_KEYWORDS = [
    "설치", "오류", "에러", "버전", "업데이트", "가이드", "방법", "계정", "로그인", "연결", "권한",
    "속도", "테스트", "배포", "링크", "신청", "시간", "주소", "영상", "편집", "캡컷", "쇼츠",
    "공지", "닉네임", "인증", "하트", "규칙", "강퇴", "무료특강", "디하클", "카페",
]


def categorize_text(text: str, feed_type: Optional[int] = None) -> str:
    t = text.strip()
    if not t:
        return "other"
    if feed_type in (2, 4) or re.search(r"(입장하셨습니다|입장했습니다|나가셨습니다|퇴장했습니다)", t):
        return "feed"
    if is_greeting_like(t) or len(t) <= 2:
        return "greeting"
    has_q = ("?" in t) or bool(re.search(r"(왜|어떻게|무엇|뭐|언제|어디|누구|몇|가능|맞나요|되나요)", t))
    has_link = is_link_like(t)
    has_kw = any(k in t for k in DOMAIN_KEYWORDS)
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
    # Admin/moderation style requests (변경/수정/삭제/제목/공지/부탁/요청)
    if any(k in t for k in ("변경", "수정", "삭제", "제목", "공지")) and any(k in t for k in ("부탁", "요청")):
        return "request_admin"
    if has_kw and longish and not has_q:
        return "statement_with_keywords"
    if has_q:
        return "q_other"
    return "other"


def iter_triggers(
    events: List[ChatEvent],
    plain_every_n: int = 10,
    skip_feed: bool = True,
    skip_greetings: bool = True,
    min_gap_seconds: int = 60,
    max_calls_per_room: Optional[int] = None,
) -> Iterable[tuple[int, ChatEvent]]:
    """Yield (index, event) for which we should call the model.

    - 질문 뉘앙스: 즉시 트리거
    - 평문: N개마다 1회
    """
    from collections import defaultdict
    plain_count = defaultdict(int)
    last_called_ts = {}
    called_count = {}
    for idx, ev in enumerate(events):
        if not ev.text:
            continue
        rid = ev.room_id or -1
        # Skip feed/join/leave
        if skip_feed and is_feed_event(ev):
            continue
        # Skip short greetings
        if skip_greetings and is_greeting_like(ev.text):
            continue
        if is_question_like(ev.text):
            # Rate limit per room
            last_ts = last_called_ts.get(rid)
            if last_ts is None or (ev.timestamp - last_ts).total_seconds() >= min_gap_seconds:
                # Check per-room count
                if not max_calls_per_room or called_count.get(rid, 0) < max_calls_per_room:
                    yield idx, ev
                    last_called_ts[rid] = ev.timestamp
                    called_count[rid] = called_count.get(rid, 0) + 1
                    plain_count[rid] = 0
        else:
            plain_count[rid] += 1
            if plain_count[rid] >= plain_every_n:
                last_ts = last_called_ts.get(rid)
                if last_ts is None or (ev.timestamp - last_ts).total_seconds() >= min_gap_seconds:
                    if not max_calls_per_room or called_count.get(rid, 0) < max_calls_per_room:
                        yield idx, ev
                        last_called_ts[rid] = ev.timestamp
                        called_count[rid] = called_count.get(rid, 0) + 1
                        plain_count[rid] = 0


# ---------- Context building ----------

def summarize_recent(events: List[ChatEvent], upto_idx: int, limit: int = 30) -> str:
    """최근 메시지 중 핵심만 짧게 요약(휴리스틱)."""
    start = max(0, upto_idx - limit)
    window = events[start:upto_idx]
    # 간단 요약: 주제 후보 키워드 집계 + 참여자 목록
    participants = []
    for e in window:
        if e.user_name and e.user_name not in participants:
            participants.append(e.user_name)
    # 키워드 후보(아주 단순)
    keywords = []
    keypats = [r"설치", r"오류", r"버전", r"가이드", r"방법", r"계정", r"연결", r"권한", r"속도", r"테스트", r"배포", r"링크", r"신청", r"시간", r"주소", r"영상", r"편집", r"쇼츠", r"캡컷", r"알고리즘"]
    for e in window:
        for p in keypats:
            if re.search(p, e.text):
                k = p.strip("\\b")
                if k not in keywords:
                    keywords.append(k)

    parts = []
    if participants:
        parts.append(f"참여자: {', '.join(participants[:10])}" + (" 외" if len(participants) > 10 else ""))
    if keywords:
        parts.append(f"주제 키워드: {', '.join(keywords[:8])}")
    if not parts:
        parts.append("최근 메시지를 기반으로 간단 요약을 생성합니다.")
    return "\n".join(parts)


def excerpt_messages(
    events: List[ChatEvent],
    start_idx: int,
    upto_idx: int,
    max_items: int = 10,
    skip_feed: bool = True,
) -> str:
    start = max(0, upto_idx - max_items)
    window = events[start:upto_idx]
    lines = []
    for e in window:
        if skip_feed and is_feed_event(e):
            continue
        # Skip trivial greetings in context excerpt
        if is_greeting_like(e.text):
            continue
        user = e.user_name or "사용자"
        text = e.text
        # 한 줄 길이 제한
        if len(text) > 220:
            text = text[:200] + " …(생략)"
        lines.append(f"- {user}: {text}")
    return "\n".join(lines) if lines else "(최근 메시지 없음)"


def _window_indices(events: List[ChatEvent], upto_idx: int, window_seconds: int) -> List[int]:
    if window_seconds <= 0:
        return list(range(max(0, upto_idx - 50), upto_idx))
    threshold = events[upto_idx].timestamp.timestamp() - window_seconds
    out: List[int] = []
    for i in range(max(0, upto_idx - 200), upto_idx):
        if events[i].timestamp.timestamp() >= threshold:
            out.append(i)
    return out


def _find_user_anchors(events: List[ChatEvent], upto_idx: int, lookback: int = 40, min_len: int = 10, max_items: int = 3) -> List[str]:
    target = events[upto_idx].user_name
    out: List[str] = []
    for i in range(max(0, upto_idx - lookback), upto_idx)[::-1]:
        e = events[i]
        if e.user_name == target and not is_feed_event(e) and not is_greeting_like(e.text):
            if len(e.text.strip()) >= min_len or is_link_like(e.text):
                t = e.text
                if len(t) > 240:
                    t = t[:220] + " …(생략)"
                out.append(f"- {e.user_name or '사용자'}: {t}")
                if len(out) >= max_items:
                    break
    out.reverse()
    return out


def _collect_recent_links(events: List[ChatEvent], idxs: List[int], max_items: int = 5) -> List[str]:
    out: List[str] = []
    for i in idxs[::-1]:
        e = events[i]
        if is_link_like(e.text):
            out.append(f"- {e.user_name or '사용자'}: {e.text}")
            if len(out) >= max_items:
                break
    out.reverse()
    return out


def _build_local_flow(events: List[ChatEvent], upto_idx: int, max_items: int = 24) -> str:
    start = max(0, upto_idx - max_items)
    lines: List[str] = []
    for i in range(start, upto_idx):
        e = events[i]
        # Always skip feed events; include brief interjections to keep flow coherent
        if is_feed_event(e):
            continue
        text = e.text
        if len(text) > 220:
            text = text[:200] + " …(생략)"
        lines.append(f"- {e.user_name or '사용자'}: {text}")
    return "\n".join(lines) if lines else "(인접 대화 없음)"


def build_system_prompt(room_name: Optional[str]) -> str:
    return textwrap.dedent(
        f"""
        당신은 네이버 카페 오픈채팅방의 상냥한 운영진입니다.
        - 한국어 존댓말로 답합니다.
        - 과도한 개입은 피하고, 핵심만 2~4문장으로 정리해 답합니다.
        - 불분명하면 필요한 한두 가지를 정중히 되묻습니다.
        - 규칙 안내/자료 링크 유도/다음 단계 제시 등으로 대화를 정리합니다.
        - 위험한 조언, 과도한 확신, 사실 단정은 피합니다.
        - 방 이름: {room_name or '알 수 없음'}
        - 제공된 [대화 요약]과 [최근 메시지 발췌]를 우선적으로 참고합니다.
        - 컨텍스트가 부족해 단정하기 어렵다면, 1개의 구체적 질문만 정중히 요청합니다(장황 금지).
        """
    ).strip()


def build_prompt_pack(
    events: List[ChatEvent],
    upto_idx: int,
    room_name: Optional[str],
    excerpt_count: int = 15,
    window_seconds: int = 1800,
    local_count: int = 24,
) -> list[dict]:
    system = build_system_prompt(room_name)
    summary = summarize_recent(events, upto_idx)
    # Build time-bounded window and rich context
    idxs = _window_indices(events, upto_idx, window_seconds)
    # Compose a compact excerpt from window (contentful only is handled downstream by model)
    excerpt = []
    cnt = 0
    for i in idxs[::-1]:
        e = events[i]
        if is_feed_event(e) or is_greeting_like(e.text):
            continue
        line = f"- {e.user_name or '사용자'}: {e.text[:200] + ' …(생략)' if len(e.text) > 220 else e.text}"
        excerpt.append(line)
        cnt += 1
        if cnt >= excerpt_count:
            break
    excerpt_text = "\n".join(reversed(excerpt)) if excerpt else "(최근 메시지 없음)"

    current = events[upto_idx]
    anchors = _find_user_anchors(events, upto_idx)
    links = _collect_recent_links(events, idxs)
    local_flow = _build_local_flow(events, upto_idx, max_items=local_count)

    parts = [
        {"role": "system", "parts": [system]},
        {
            "role": "user",
            "parts": [
                "[대화 요약]\n" + summary,
                "[사용자 맥락]\n" + ("\n".join(anchors) if anchors else "(이 사용자 맥락 없음)"),
                "[로컬 대화 흐름]\n" + local_flow,
                "[최근 메시지 발췌]\n" + excerpt_text,
                ("[관련 링크]\n" + "\n".join(links)) if links else "",
                "[현재 메시지]\n" + f"{current.user_name or '사용자'}: {current.text}",
                "[요청]\n친절한 운영진 톤으로 간단히 안내/답변해주세요. 불명확하면 1문장으로 핵심만 확인 질문.",
            ],
        },
    ]
    return parts


def is_contentful(text: str) -> bool:
    if len(text.strip()) >= 15:
        return True
    if is_link_like(text):
        return True
    if any(k in text for k in DOMAIN_KEYWORDS):
        return True
    return False


def compute_answer_score(text: str, context_lines: List[str], has_user_anchors: bool = False, has_local_context: bool = False) -> int:
    score = 0
    if is_question_like(text):
        score += 1
    if any(w in text for w in ("왜", "어떻게", "무엇", "언제", "어디", "누구", "몇", "맞나요", "되나요")):
        score += 1
    if is_link_like(text):
        score += 2
    if any(k in text for k in DOMAIN_KEYWORDS):
        score += 1
    if len(text.strip()) >= 15:
        score += 1
    # Context signals: recent contentful lines
    ctx_hits = sum(1 for ln in context_lines if is_contentful(ln))
    if ctx_hits >= 2:
        score += 1
    if ctx_hits >= 4:
        score += 1
    # Confirmation questions need anchor context
    if is_confirm_like(text) and has_user_anchors:
        score += 2
    if is_confirm_like(text) and has_local_context:
        score += 1
    return score


# ---------- Token/cost estimation ----------

def estimate_tokens_char_based(text: str, divisor: float = 3.5) -> int:
    """아주 단순 문자수 기반 토큰 근사치.
    한국어는 형태소 단위로 토큰화되어 편차가 큼. 참고용으로만 사용.
    """
    return int(max(1, round(len(text) / max(divisor, 1.0))))


def count_prompt_tokens(prompt: list[dict]) -> int:
    total_chars = 0
    for turn in prompt:
        parts = turn.get("parts") or []
        for p in parts:
            if isinstance(p, str):
                total_chars += len(p)
            else:
                total_chars += len(str(p))
    return estimate_tokens_char_based("x" * total_chars)


# ---------- Execution ----------

def _try_generate(model_name: str, prompt: list[dict]) -> Optional[str]:
    try:
        model = genai.GenerativeModel(model_name)
        # 전달 형식을 단일 텍스트로 변환하여 role 오류 회피
        text = _serialize_prompt_to_text(prompt)
        resp = model.generate_content(text)
        return getattr(resp, "text", str(resp))
    except Exception as e:
        msg = str(e)
        # 404/not supported 시에는 None 반환하여 폴백 시도
        if "not found" in msg.lower() or "is not supported" in msg.lower() or "404" in msg:
            return None
        # 기타 예외는 상위로
        raise


def _serialize_prompt_to_text(prompt: list[dict]) -> str:
    parts: list[str] = []
    for turn in prompt:
        role = turn.get("role", "user")
        p = turn.get("parts") or []
        txt = []
        for x in p:
            txt.append(x if isinstance(x, str) else str(x))
        body = "\n".join(txt).strip()
        parts.append(f"[{role.upper()}]\n{body}")
    return "\n\n".join(parts)


def _call_with_new_sdk(prompt: list[dict], model_name: str) -> Optional[str]:
    if genai_new is None or not GENAI_API_KEY:
        return None
    try:
        client = genai_new.Client(api_key=GENAI_API_KEY)
        text = _serialize_prompt_to_text(prompt)
        # Prefer Responses API if available
        try:
            resp = client.responses.generate(model=model_name, input=text)
            out = getattr(resp, "output_text", None)
            if isinstance(out, str) and out.strip():
                return out.strip()
            return str(resp)
        except Exception as e:
            msg = str(e)
            # Fallback to older surface in new SDK
            try:
                resp = client.models.generate_content(model=model_name, contents=[{"role": "user", "parts": [{"text": text}]}])
                out = getattr(resp, "text", None)
                if isinstance(out, str) and out.strip():
                    return out.strip()
                return str(resp)
            except Exception as e2:
                msg = str(e2)
                if "not found" in msg.lower() or "is not supported" in msg.lower() or "404" in msg:
                    return None
                raise
    except Exception:
        return None


def _list_models_new() -> tuple[list, Optional[str]]:
    if genai_new is None or not GENAI_API_KEY:
        return [], None
    try:
        client = genai_new.Client(api_key=GENAI_API_KEY)
        models = list(client.models.list())
        names: list[str] = []
        for m in models:
            name = getattr(m, "name", None) or getattr(m, "model", None) or str(m)
            if isinstance(name, str):
                names.append(name)
        return names, None
    except Exception as e:
        return [], str(e)


def _list_models_legacy() -> tuple[list, Optional[str]]:
    if genai is None or not GENAI_API_KEY:
        return [], None
    try:
        genai.configure(api_key=GENAI_API_KEY)
        models = list(genai.list_models())
        names: list[str] = []
        for m in models:
            name = getattr(m, "name", None) or str(m)
            if isinstance(name, str):
                names.append(name)
        return names, None
    except Exception as e:
        return [], str(e)


def _resolve_model_candidates(preferred: str) -> tuple[list, list, list]:
    available: list[str] = []
    errors: list[str] = []
    names_new, err_new = _list_models_new()
    if names_new:
        available.extend(names_new)
    if err_new:
        errors.append(f"new-sdk: {err_new}")
    names_legacy, err_legacy = _list_models_legacy()
    if names_legacy:
        for n in names_legacy:
            if n not in available:
                available.append(n)
    if err_legacy:
        errors.append(f"legacy-sdk: {err_legacy}")

    base = [
        preferred,
        # plain names (legacy SDK)
        "gemini-1.5-flash",
        "gemini-1.5-flash-8b",
        "gemini-1.5-pro",
        "gemini-1.5-pro-002",
        "gemini-pro",
        # models/ prefix (new SDK)
        "models/gemini-1.5-flash",
        "models/gemini-1.5-flash-8b",
        "models/gemini-1.5-pro",
        "models/gemini-1.5-pro-002",
        "models/gemini-pro",
    ]

    if available:
        candidates = [n for n in base if n in available] or available
    else:
        candidates = base
    return candidates, available, errors


def call_gemini(prompt: list[dict], model_name: str = "gemini-1.5-flash") -> str:
    candidates, available, errors = _resolve_model_candidates(model_name)
    tried: list[str] = []

    # 1) Try new SDK first (if available)
    for m in candidates:
        if m in tried:
            continue
        tried.append(m)
        out = _call_with_new_sdk(prompt, m)
        if out is not None:
            return out

    # 2) Fallback to legacy SDK
    if genai is not None:
        for m in candidates:
            out = _try_generate(m, prompt)
            if out is not None:
                return out

    detail = []
    if available:
        detail.append("사용 가능한 모델: " + ", ".join(available))
    if errors:
        detail.append("오류: " + " | ".join(errors))
    extra = ("\n" + "\n".join(detail)) if detail else ""
    raise RuntimeError(f"모델 호출 실패. 시도한 모델: {', '.join(tried)}{extra}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Gemini 1.5 Pro 컨텍스트 응답 테스트")
    ap.add_argument("--log", required=False, help="JSON Lines 로그 파일 경로")
    ap.add_argument("--room-id", required=False, help="node-iris 로그의 방 ID (node-iris-app/data/logs/<roomId>)")
    ap.add_argument("--room-name", default=None, help="방 이름 라벨(로그에 없을 때 표기용)")
    ap.add_argument("--plain-every", type=int, default=10, help="평문 N개마다 1회 트리거")
    ap.add_argument("--excerpt", type=int, default=15, help="최근 메시지 발췌 개수")
    ap.add_argument("--window-seconds", type=int, default=1800, help="컨텍스트 시간 범위(초), 기본 30분")
    ap.add_argument("--local-excerpt", type=int, default=24, help="로컬(인접) 대화 라인 수")
    ap.add_argument("--execute", action="store_true", help="실제 Gemini 호출")
    ap.add_argument("--api-key", default=None, help="Gemini API Key (미지정 시 환경변수 사용)")
    ap.add_argument("--model", default="models/gemini-1.5-flash", help="모델명 (기본: models/gemini-1.5-flash)")
    ap.add_argument("--max-calls", type=int, default=None, help="최대 호출 횟수(샘플 테스트용)")
    ap.add_argument("--min-gap-seconds", type=int, default=60, help="같은 방 연속 호출 최소 간격(초)")
    ap.add_argument("--max-calls-per-room", type=int, default=None, help="방별 최대 호출 횟수")
    ap.add_argument("--include-feed", action="store_true", help="입장/퇴장 등 피드 이벤트도 포함")
    ap.add_argument("--include-greetings", action="store_true", help="짧은 인사/잡음도 포함")
    ap.add_argument("--gate-mode", default="smart", choices=["smart","always","clarify-or-skip"], help="응답 게이팅 모드")
    ap.add_argument("--min-answer-score", type=int, default=3, help="답변 임계 점수")
    ap.add_argument("--clarify-cooldown-seconds", type=int, default=900, help="같은 방 재확인 질문 쿨다운")
    args = ap.parse_args()

    # API Key 우선순위: --api-key > GEMINI_API_KEY > config/gemini.key
    api_key = args.api_key or os.getenv("GEMINI_API_KEY")
    if not api_key:
        try:
            key_path = Path(__file__).resolve().parents[1] / "config" / "gemini.key"
            if key_path.exists():
                api_key = key_path.read_text(encoding="utf-8").splitlines()[0].strip()
        except Exception:
            pass
    if args.execute and not api_key:
        print("[오류] --execute 사용 시 GEMINI_API_KEY가 필요합니다.")
        sys.exit(2)

    if api_key and genai is not None:
        genai.configure(api_key=api_key)
    # store for new SDK
    global GENAI_API_KEY
    GENAI_API_KEY = api_key

    # Resolve log path: --log or latest from --room-id
    log_path = args.log
    if not log_path:
        if args.room_id:
            base = Path(__file__).resolve().parents[1] / "node-iris-app" / "data" / "logs" / str(args.room_id)
            files = sorted(base.glob("*.log")) if base.exists() else []
            if files:
                log_path = str(files[-1])
                if not args.room_name:
                    # Best-effort: peek first line to get roomName
                    try:
                        with open(log_path, "r", encoding="utf-8", errors="ignore") as fp:
                            for _ in range(50):
                                ln = fp.readline()
                                if not ln:
                                    break
                                import json as _json
                                try:
                                    obj = _json.loads(ln)
                                    snap = obj.get("snapshot") or {}
                                    rn = snap.get("roomName") or snap.get("room_name")
                                    if rn:
                                        args.room_name = rn
                                        break
                                except Exception:
                                    continue
                    except Exception:
                        pass
            else:
                raise SystemExit(f"--room-id={args.room_id} 경로에 로그 파일이 없습니다.")
        else:
            raise SystemExit("--log 또는 --room-id 중 하나를 지정하세요.")

    rows = load_jsonl(str(log_path))
    events = parse_events(rows)
    if not events:
        print("[경고] 이벤트가 없습니다.")
        return

    print(f"[정보] 총 이벤트 {len(events)}건, 트리거 규칙: 질문 즉시 / 평문 {args.plain_every}개마다 1회")

    calls = 0
    for idx, ev in iter_triggers(
        events,
        plain_every_n=args.plain_every,
        skip_feed=(not args.include_feed),
        skip_greetings=(not args.include_greetings),
        min_gap_seconds=max(0, args.min_gap_seconds),
        max_calls_per_room=args.max_calls_per_room,
    ):
        prompt = build_prompt_pack(
            events,
            idx,
            args.room_name or ev.room_name,
            excerpt_count=args.excerpt,
            window_seconds=max(60, args.window_seconds),
            local_count=max(5, args.local_excerpt),
        )
        est_in_tokens = count_prompt_tokens(prompt)

        print("\n===== [트리거] ==================================")
        print(f"시간: {ev.timestamp.isoformat()}  사용자: {ev.user_name or '사용자'}  방: {args.room_name or ev.room_name or '미상'}")
        print(f"메시지: {ev.text}")
        print(f"입력 추정 토큰 수(참고용): ~{est_in_tokens}")

        if args.execute:
            try:
                # Gating: decide answer/clarify/skip based on category + score
                cat = categorize_text(ev.text, ev.feed_type)
                ctx_lines: List[str] = []
                has_user_anchors = False
                has_local_context = False
                for turn in prompt:
                    for p in (turn.get("parts") or []):
                        if isinstance(p, str) and p.startswith("[최근 메시지 발췌]"):
                            ctx_lines = [ln[2:].strip() if ln.startswith("- ") else ln.strip() for ln in p.splitlines()[1:]]
                        if isinstance(p, str) and p.startswith("[사용자 맥락]"):
                            # If at least one anchor line exists
                            lines = [ln for ln in p.splitlines()[1:] if ln.strip().startswith("-")]
                            has_user_anchors = len(lines) > 0
                        if isinstance(p, str) and p.startswith("[로컬 대화 흐름]"):
                            # Provide additional local context lines
                            flow_lines = [ln[2:].strip() if ln.strip().startswith("-") else ln.strip() for ln in p.splitlines()[1:]]
                            ctx_lines.extend(flow_lines)
                            has_local_context = len(flow_lines) >= 5
                score = compute_answer_score(ev.text, ctx_lines, has_user_anchors=has_user_anchors, has_local_context=has_local_context)

                # Track per-room clarify cooldown
                from collections import defaultdict
                if not hasattr(main, "_last_clarify_ts"):
                    main._last_clarify_ts = {}
                last_clarify_ts = main._last_clarify_ts  # type: ignore[attr-defined]
                now_ts = ev.timestamp.timestamp()
                last_ts = last_clarify_ts.get(ev.room_id or -1, 0)
                can_clarify = (now_ts - last_ts) >= max(0, args.clarify_cooldown_seconds)

                # Category-first gating: only answer for high-value categories
                answerable_cats = {"q_troubleshoot", "q_schedule_info", "q_howto_content", "q_with_link", "request_admin"}
                action = "answer"
                if args.gate_mode != "always":
                    # Confirmation overrides: if confirm-like and has context, force answer
                    if is_confirm_like(ev.text) and (has_user_anchors or has_local_context):
                        action = "answer"
                    else:
                        if cat not in answerable_cats:
                            action = "clarify" if (args.gate_mode == "smart" and can_clarify and cat.startswith("q_")) else "skip"
                        else:
                            # Even in answerable cats, require minimum score
                            if score < max(1, args.min_answer_score):
                                # Slightly relax for confirm-like with some context
                                if is_confirm_like(ev.text) and (has_user_anchors or has_local_context) and args.min_answer_score > 2:
                                    # allow with lower threshold
                                    if score >= 2:
                                        action = "answer"
                                    else:
                                        action = "clarify" if (args.gate_mode == "smart" and can_clarify) else "skip"
                                else:
                                    action = "clarify" if (args.gate_mode == "smart" and can_clarify) else "skip"

                if action == "skip":
                    print(f"[GATE] cat={cat} score={score} -> SKIP")
                    continue
                if action == "clarify":
                    # 비용 절감을 위해 모델 호출 없이 고정 멘트
                    print(f"[GATE] cat={cat} score={score} -> CLARIFY")
                    print("[CLARIFY] 어떤 점이 궁금하신가요? (예: 설치/오류/연결/권한/시간/주소/링크/편집/쇼츠)")
                    last_clarify_ts[ev.room_id or -1] = now_ts
                    continue

                out = call_gemini(prompt, model_name=args.model)
            except Exception as e:
                emsg = str(e)
                print(f"[오류] Gemini 호출 실패: {emsg}")
                if any(k in emsg.lower() for k in ("quota", "rate limit", "429")):
                    print("[중단] 쿼터/레이트리밋 감지, 추가 호출을 중단합니다.")
                    break
            out_tokens = estimate_tokens_char_based(out)
            print("[Gemini 응답]\n")
            print(out)
            print(f"[출력 추정 토큰 수(참고용)]: ~{out_tokens}")
            calls += 1
            if args.max_calls and calls >= args.max_calls:
                print(f"\n[정보] --max-calls={args.max_calls} 도달, 테스트 종료")
                break
        else:
            # 드라이런: 전송 페이로드 미리보기(요약)
            sys_msg = prompt[0]["parts"][0]
            print("[시스템 프롬프트(요약)]\n" + "\n".join(sys_msg.splitlines()[:6]) + "\n...")
            user_parts = prompt[1]["parts"]
            # 최근 메시지 발췌만 보여줌
            for p in user_parts:
                if isinstance(p, str) and p.startswith("[최근 메시지 발췌]"):
                    print("\n" + p)
                    break
            print("\n-- 실행 안 함(드라이런). --execute로 실제 호출 가능")


if __name__ == "__main__":
    main()
