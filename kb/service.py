import os
import time
import uuid
import json
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
import threading
import subprocess
import platform
import datetime as _dt
import logging as _logging

from kb.db import db_session
from kb.search import vector_search
from kb.disabled_menus import DISABLED_MENU_IDS
from kb.cafe_api import fetch_member_count
from kb.logging_util import get_logger
from kb.auto_login import login_and_store
from kb.creds import save_creds, load_meta
from kb.menu_ssot import load_ssot, get_all_menus, get_cafe_id, get_cafe_url
from typing import List, Dict, Any, Optional
import re


# 검색/링크 거리 임계값 (벡터 스케일에 맞게 환경변수로 조정)
KB_DIST_MAX_DEFAULT = float(os.getenv("KB_DIST_MAX", "1.5"))
KB_LINK_HINT_DIST_MAX = float(os.getenv("KB_LINK_HINT_DIST_MAX", str(KB_DIST_MAX_DEFAULT)))


app = FastAPI(title="Cafe KB Service")
log = get_logger("kb.service")
_logging.getLogger("httpcore").setLevel(_logging.WARNING)
_logging.getLogger("httpx").setLevel(_logging.WARNING)


@lru_cache(maxsize=1)
def _load_entity_overrides() -> list[dict[str, Any]]:
    """인물/고유명 역할(운영자/강사 등)을 SSOT로 관리한다.

    NOTE:
    - '누구야' 류 질문에서 LLM 환각(직함/수익/서사)을 막기 위해 역할은 결정적으로 제공한다.
    - 실명/외부 계정/연락처/계좌번호는 이 파일에 넣지 않는다.
    """
    cfg = Path(__file__).resolve().parent.parent / "config" / "entities_dinohighclass.json"
    if not cfg.exists():
        return []
    try:
        data = json.loads(cfg.read_text(encoding="utf-8"))
        out: list[dict[str, Any]] = []
        for e in (data.get("entities") or []):
            name = str(e.get("name") or "").strip()
            if not name:
                continue
            role = str(e.get("role") or "").strip()
            aliases = [str(a).strip() for a in (e.get("aliases") or []) if str(a).strip()]
            out.append({"name": name, "role": role, "aliases": aliases})
        return out
    except Exception as e:
        log.warning(f"[entity] config load failed: {e}")
        return []


def _match_entity_override(keyword: str) -> dict[str, Any] | None:
    kw = (keyword or "").strip().lower()
    if not kw:
        return None
    for e in _load_entity_overrides():
        name = str(e.get("name") or "").strip()
        if name and name.lower() == kw:
            return e
        aliases = e.get("aliases") or []
        for a in aliases:
            if str(a).strip().lower() == kw:
                return e
    return None

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AskRequest(BaseModel):
    query: str
    top_k: int = 6


class AskLlmRequest(BaseModel):
    query: str
    top_k: int = 4
    model: str | None = None  # LLM model name
    # optional context tags from caller (예: 'sajulab_student')
    context_tags: Optional[list[str]] = None


class ChatMessage(BaseModel):
    ts: str
    sender: Optional[str] = None
    text: str


class ChatSummaryRequest(BaseModel):
    room_id: str
    room_name: Optional[str] = None
    messages: List[ChatMessage]


class ChatQaRequest(BaseModel):
    room_id: str
    room_name: Optional[str] = None
    question: str
    messages: List[ChatMessage]


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/ask")
def ask(req: AskRequest):
    t0 = time.time()
    try:
        res = vector_search(req.query, top_k=req.top_k)
        return {"ok": True, "query": req.query, **res}
    except Exception as e:
        log.exception(f"/ask failed: {e}")
        return JSONResponse(status_code=500, content={"ok": False, "code": "search_failed", "detail": str(e)})
    finally:
        log.info(f"/ask qlen={len(req.query)} took={time.time()-t0:.3f}s")


_gemini_client = None
_openai_client = None


def _load_env_key(key_names: list[str]) -> str | None:
    """환경변수 파일들에서 키를 로드한다. 이미 설정되어 있으면 그대로 반환."""
    from pathlib import Path
    for name in key_names:
        if os.getenv(name):
            return os.getenv(name)
    # 환경변수에 없으면 .env 파일들에서 찾기
    root = Path(__file__).resolve().parent.parent
    for env_file in (".env.kb", ".env.local", ".env"):
        p = root / env_file
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            for key_name in key_names:
                if line.startswith(f"{key_name}="):
                    val = line.split("=", 1)[1].strip()
                    os.environ[key_name] = val
                    return val
    return None


def _ensure_gemini_client():
    global _gemini_client
    if _gemini_client:
        return _gemini_client
    key = _load_env_key(["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APIKEY", "GENAI_API_KEY"])
    if not key:
        raise HTTPException(status_code=503, detail="missing_google_api_key")
    try:
        from google import genai  # type: ignore
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=503, detail=f"google-genai not installed: {e}")
    _gemini_client = genai.Client(api_key=key)
    return _gemini_client


def _ensure_openai_client():
    """OpenAI 클라이언트를 lazy-init 한다."""
    global _openai_client
    if _openai_client:
        return _openai_client
    key = _load_env_key(["OPENAI_API_KEY", "OPENAI_APIKEY"])
    if not key:
        raise HTTPException(status_code=503, detail="missing_openai_api_key")
    try:
        from openai import OpenAI  # type: ignore
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=503, detail=f"openai not installed: {e}")
    # NOTE:
    # - SDK 기본 재시도(429 등)는 쿼터/장애 상황에서 응답 지연을 크게 만들 수 있다.
    # - RAG는 폴백 경로(키워드 검색/결정적 답변)가 있으므로, 기본은 재시도 0으로 둔다.
    _openai_client = OpenAI(
        api_key=key,
        max_retries=int(os.getenv("OPENAI_MAX_RETRIES", "0") or "0"),
        timeout=float(os.getenv("KB_LLM_HTTP_TIMEOUT", os.getenv("KB_HTTP_TIMEOUT", "20"))),
    )
    return _openai_client


def _close_openai_client() -> None:
    global _openai_client
    if _openai_client is None:
        return
    try:
        _openai_client.close()
    except Exception:
        pass
    finally:
        _openai_client = None


def _openai_generate_text(
    prompt: str,
    model: str,
    temperature: float = 0.2,
    max_output_tokens: int = 900,
    tools: Optional[list[dict[str, Any]]] = None,
    tool_choice: Any | None = None,
    max_tool_calls: Optional[int] = None,
    include: Optional[list[Any]] = None,
) -> str:
    client = _ensure_openai_client()
    kwargs: dict[str, Any] = {
        "model": model,
        "input": prompt,
        "temperature": temperature,
        "max_output_tokens": max_output_tokens,
    }
    if tools is not None:
        kwargs["tools"] = tools
    if tool_choice is not None:
        kwargs["tool_choice"] = tool_choice
    if max_tool_calls is not None:
        kwargs["max_tool_calls"] = max_tool_calls
    if include is not None:
        kwargs["include"] = include
    resp = client.responses.create(
        **kwargs,
    )
    text = (getattr(resp, "output_text", None) or "").strip()
    return text


def _openai_generate_text_with_tool_diag(
    prompt: str,
    model: str,
    temperature: float = 0.2,
    max_output_tokens: int = 900,
    tools: Optional[list[dict[str, Any]]] = None,
    tool_choice: Any | None = None,
    max_tool_calls: Optional[int] = None,
    include: Optional[list[Any]] = None,
) -> tuple[str, dict[str, Any]]:
    """LLM 호출 결과 텍스트 + tool 사용 여부(diag)를 함께 반환한다."""
    client = _ensure_openai_client()
    kwargs: dict[str, Any] = {
        "model": model,
        "input": prompt,
        "temperature": temperature,
        "max_output_tokens": max_output_tokens,
    }
    if tools is not None:
        kwargs["tools"] = tools
    if tool_choice is not None:
        kwargs["tool_choice"] = tool_choice
    if max_tool_calls is not None:
        kwargs["max_tool_calls"] = max_tool_calls
    if include is not None:
        kwargs["include"] = include

    resp = client.responses.create(**kwargs)
    text = (getattr(resp, "output_text", None) or "").strip()

    diag: dict[str, Any] = {
        "web_search_used": False,
        "web_search_calls": 0,
        # URL은 정책상 노출하지 않으므로, 도메인/날짜/제목만 일부 미리보기로 남긴다.
        "web_search_results_preview": [],
    }

    def _get(obj: Any, key: str, default: Any = None) -> Any:
        if obj is None:
            return default
        if isinstance(obj, dict):
            return obj.get(key, default)
        return getattr(obj, key, default)

    def _as_list(x: Any) -> list[Any]:
        if x is None:
            return []
        if isinstance(x, list):
            return x
        return [x]

    outputs = _get(resp, "output", []) or []
    for item in _as_list(outputs):
        t = str(_get(item, "type", "") or "").lower()
        if "web_search" not in t:
            continue
        diag["web_search_used"] = True
        diag["web_search_calls"] = int(diag.get("web_search_calls") or 0) + 1
        results = _get(item, "results", None)
        if results is None:
            # 일부 스키마는 'output' 내부에 results가 중첩될 수 있다.
            results = _get(_get(item, "output", None), "results", None)
        for r in _as_list(results)[:3]:
            title = str(_get(r, "title", "") or "").strip()
            snippet = str(
                _get(r, "snippet", "")
                or _get(r, "description", "")
                or _get(r, "summary", "")
                or _get(r, "content", "")
                or ""
            ).strip()
            published = str(_get(r, "published_date", "") or _get(r, "date", "") or "").strip()
            # source는 없으면 url의 도메인만 사용(단, URL 문자열은 저장하지 않음)
            source = str(_get(r, "source", "") or "").strip()
            if not source:
                url = str(_get(r, "url", "") or "").strip()
                try:
                    from urllib.parse import urlparse

                    netloc = urlparse(url).netloc
                    source = netloc
                except Exception:
                    source = ""
            preview = {
                "title": title[:140] if title else "",
                "source": source[:80],
                "published_date": published[:32],
                "snippet": snippet[:180] if snippet else "",
            }
            if any(preview.values()):
                diag["web_search_results_preview"].append(preview)

        # 일부 웹 검색 도구는 results 대신 action.sources(URL 목록)만 반환한다.
        # URL은 저장/노출하지 않고, 도메인 + (가능하면) URL 내 날짜만 미리보기로 남긴다.
        action = _get(item, "action", None)
        sources = _get(action, "sources", None)
        if sources:
            try:
                from urllib.parse import urlparse

                def _date_from_url(u: str) -> str:
                    # 20250102 or 2025/01/02 형태를 YYYY-MM-DD로 변환
                    m = re.search(r"(20\d{2})([01]\d)([0-3]\d)", u)
                    if m:
                        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
                    m = re.search(r"(20\d{2})[/\.-]([01]\d)[/\.-]([0-3]\d)", u)
                    if m:
                        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
                    return ""

                for s in _as_list(sources)[:3]:
                    url = str(_get(s, "url", "") or s or "").strip()
                    if not url:
                        continue
                    domain = urlparse(url).netloc
                    published = _date_from_url(url)
                    preview = {"title": "", "source": domain[:80], "published_date": published[:32], "snippet": ""}
                    if any(preview.values()):
                        diag["web_search_results_preview"].append(preview)
            except Exception:
                pass

    return text, diag


@app.post("/chat/summary")
def chat_summary(req: ChatSummaryRequest):
    """단일 채팅방의 최근 메시지를 요약한다.

    - node-iris가 오늘자 로그를 읽어 messages 배열로 보내준다.
    - 여기서는 LLM에 그대로 넘기기 전에 개수/길이를 제한하고, 요약 템플릿과 규칙만 정의한다.
    - KB/RAG와는 별개 기능이며, 외부 카페 글을 조회하지 않는다.
    """
    if not req.messages:
        return {
            "ok": False,
            "code": "no_messages",
            "detail": "요약할 메시지가 없습니다.",
        }

    model = os.getenv("KB_CHAT_SUMMARY_MODEL") or os.getenv("KB_LLM_MODEL") or "gpt-4.1-mini"

    # 과도한 토큰 사용을 막기 위해 최근 N개만 사용하고, 각 메시지는 앞부분만 사용한다.
    max_messages = int(os.getenv("KB_CHAT_SUMMARY_MAX_MESSAGES", "200"))
    max_chars_per_msg = int(os.getenv("KB_CHAT_SUMMARY_MAX_CHARS", "220"))
    msgs = req.messages[-max_messages:]

    lines: list[str] = [
        "너는 '디하클(디지털노마드 하이클래스)' 오픈채팅방의 친절하고 센스 있는 AI 매니저야.",
        "사용자가 '!요약'을 요청했어. 아래 대화 로그(Context)를 바탕으로 핵심만 깔끔하게 요약해줘.",
        "",
        "제일 중요한 규칙(필수):",
        "- 말투는 친절한 구어체(존댓말, ~해요/~네요)로 써줘.",
        "- '답변:', '근거:', '다음 액션:', '참고 로그:' 같은 보고서형 헤더는 절대 쓰지 마.",
        "- 타임스탬프([2025-...])나 로그 원문을 그대로 복사해서 보여주지 마.",
        "- 발신자 이름이 숫자만(예: 296043063)이라면 userId일 수 있으니, 그 숫자를 그대로 쓰지 말고 '어떤 분'처럼 완곡하게 표현해줘.",
        "- 대화 로그에 명시적으로 나온 내용만 말하고, 없는 건 솔직하게 '대화에서 못 찾았어요'라고 말해줘.",
        "- 개인정보(전화번호/이메일/계좌 등)는 절대 노출하지 마.",
        "",
        "출력 구조(모바일 친화):",
        "1) 첫 줄: \"내용 찾아봤어요! 요약해 드릴게요 📝\" 같은 짧은 말",
        "2) **💡 요약 내용**",
        "   - 다음 줄부터 2~5줄로 핵심만(불릿은 선택)",
        "3) (있을 때만) **🔗 관련 링크**",
        "   - 다음 줄부터 URL만 줄바꿈으로 나열",
        "",
        f"방 이름: {req.room_name or req.room_id}",
        "--- 대화 로그 ---",
    ]

    for m in msgs:
        text = (m.text or "").replace("\n", " ").strip()
        if not text:
            continue
        if len(text) > max_chars_per_msg:
            text = text[:max_chars_per_msg] + "…"
        sender = (m.sender or "").strip() or "사용자"
        lines.append(f"{sender}: {text}")

    lines.append("--- 위 로그를 규칙에 따라 요약해라. ---")
    prompt = "\n".join(lines)

    try:
        answer = _openai_generate_text(prompt, model=model, temperature=0.3, max_output_tokens=1200)
    except Exception as e:  # pragma: no cover - 외부 API 오류
        log.exception(f"/chat/summary failed: {e}")
        raise HTTPException(status_code=502, detail="chat_summary_call_failed")

    if not answer:
        raise HTTPException(status_code=502, detail="empty_chat_summary_answer")

    # 모델이 간혹 보고서형 헤더/타임스탬프를 섞는 경우가 있어, 최후 방어로 제거한다.
    answer = _postprocess_chat_answer(str(answer or ""))
    return {
        "ok": True,
        "room_id": req.room_id,
        "room_name": req.room_name,
        "answer": answer.strip(),
        "model": model,
    }


@app.post("/chat/qa")
def chat_qa(req: ChatQaRequest):
    """단일 채팅방의 최근 메시지(로그)를 근거로 질문에 답한다.

    - node-iris가 최근 로그를 읽어 messages 배열 + question을 보내준다.
    - 여기서는 "대화 로그에 있는 근거만" 사용하도록 규칙을 강하게 고정한다.
    - 외부 카페 글/매뉴얼(RAG)은 조회하지 않는다.
    """
    question = (req.question or "").strip()
    if not question:
        return {"ok": False, "code": "no_question", "detail": "질문이 비어 있습니다."}

    if not req.messages:
        return {"ok": False, "code": "no_messages", "detail": "답변할 대화 로그가 없습니다."}

    model = os.getenv("KB_CHAT_QA_MODEL") or os.getenv("KB_LLM_MODEL") or "gpt-4.1-mini"

    # Node 쪽에서 Q&A 모드는 더 넓은 범위(+더 많은 메시지)를 보낼 수 있으므로,
    # 여기서는 입력을 넉넉히 받고, LLM 프롬프트는 키워드 기반으로 강하게 축약한다.
    max_messages = int(os.getenv("KB_CHAT_QA_MAX_MESSAGES", "800"))
    max_chars_per_msg = int(os.getenv("KB_CHAT_QA_MAX_CHARS", "360"))
    msgs = req.messages[-max_messages:]

    q = question.strip()
    wants_link = bool(re.search(r"(링크|url|URL|주소)", q))

    def _dedupe_keep_order(items: list[str]) -> list[str]:
        out: list[str] = []
        seen: set[str] = set()
        for it in items:
            k = it.strip()
            if not k:
                continue
            if k in seen:
                continue
            seen.add(k)
            out.append(k)
        return out

    def _extract_keywords(query: str) -> list[str]:
        # 너무 흔한 조사/어미/동사 위주의 토큰은 제외하고, 핵심 명사 위주로만 매칭한다.
        raw = re.findall(r"[0-9A-Za-z가-힣]{2,}", query or "")
        stop = {
            "링크",
            "주소",
            "알려줘",
            "알려주세요",
            "어떻게",
            "어케",
            "뭐야",
            "무엇",
            "언제",
            "나와",
            "나오",
            "되나",
            "되요",
            "되나요",
            "되면",
            "안되면",
            "안돼",
            "안됨",
            "안돼요",
            "가능",
            "가능해",
            "가능한",
            "확인",
            "할수",
            "할수있",
            "할수있어",
        }
        cleaned: list[str] = []
        for t in raw:
            t2 = t.strip()
            if not t2:
                continue
            # stopword는 그대로 제외하되, '링크/주소'는 wants_link 판단에만 사용한다.
            if t2 in stop:
                continue
            cleaned.append(t2)
        return _dedupe_keep_order(cleaned)[:12]

    keywords = _extract_keywords(q)

    def _has_any_keyword(text: str) -> bool:
        if not text or not keywords:
            return False
        tl = text.lower()
        for kw in keywords:
            if kw.lower() in tl:
                return True
        return False

    def _compact_ws(s: str) -> str:
        return re.sub(r"\s+", " ", s or "").strip()

    def _excerpt_around(text: str, kw: str, max_len: int) -> str:
        if not text or not kw or len(text) <= max_len:
            return text
        tl = text.lower()
        k = kw.lower()
        idx = tl.find(k)
        if idx < 0:
            return text[: max_len - 1] + "…"
        before = min(140, max_len // 3)
        after = max_len - before
        start = max(0, idx - before)
        end = min(len(text), idx + after)
        out = text[start:end]
        if start > 0:
            out = "…" + out
        if end < len(text):
            out = out + "…"
        return out

    def _render_msg_text_for_qa(raw_text: str) -> str:
        t = _compact_ws(raw_text)
        if not t:
            return ""
        if len(t) <= max_chars_per_msg:
            return t
        # 키워드가 걸리면 해당 위치 주변으로 발췌(링크/표 형태의 긴 메시지에서 특히 중요)
        for kw in keywords:
            if kw and kw.lower() in t.lower():
                return _excerpt_around(t, kw, max_chars_per_msg)
        # 링크 질문인데 URL이 포함된 긴 메시지라면 URL이 나오는 구간 중심으로 발췌
        if wants_link:
            m = re.search(r"https?://\S+", t)
            if m:
                return _excerpt_around(t, m.group(0), max_chars_per_msg)
        return t[: max_chars_per_msg - 1] + "…"

    def _extract_requester_name() -> str | None:
        # Node가 messages에 '!요약 ...' 메시지를 포함하는 경우가 있어, 마지막 커맨드 발신자를 요청자로 본다.
        for m in reversed(req.messages or []):
            t = (m.text or "").strip()
            if not t:
                continue
            if t.startswith("!요약") or t.startswith("!채팅요약") or t.startswith("!요약:") or t.startswith("!채팅요약:"):
                name = (m.sender or "").strip()
                return name or None
        return None

    requester = _extract_requester_name()
    requester_disp = f"**{requester}**님, " if requester and not re.match(r"^\d{6,}$", requester.strip()) else ""
    # Q&A는 "전체 로그"를 LLM에 그대로 넣기보다, 질문 키워드에 걸리는 메시지 + 주변 컨텍스트만 남긴다.
    picked_idx: set[int] = set()
    if keywords:
        for i, m in enumerate(msgs):
            t = (m.text or "")
            if not t:
                continue
            if _has_any_keyword(t) or (wants_link and ("http://" in t or "https://" in t)):
                for j in range(max(0, i - 2), min(len(msgs), i + 3)):
                    picked_idx.add(j)
    elif wants_link:
        for i, m in enumerate(msgs):
            t = (m.text or "")
            if "http://" in t or "https://" in t:
                for j in range(max(0, i - 1), min(len(msgs), i + 2)):
                    picked_idx.add(j)

    # 키워드 매칭이 하나도 없으면(=로그에 없을 가능성), 최근 메시지 일부만 남겨도 충분하다.
    if not picked_idx:
        # 키워드가 있는데도 하나도 안 걸리면 LLM을 호출해도 "확인 불가"가 최선이므로
        # 여기서는 결정적으로 안내하고, 사용자가 기간을 늘려 재시도할 수 있게 힌트를 준다.
        if keywords or wants_link:
            kw_hint = " / ".join(keywords[:3]) if keywords else "질문하신 내용"
            hint = f"흠, 최근 대화 내역을 찾아봤는데 **{kw_hint}** 관련 얘기는 아직 안 나왔어요 😅"
            hint2 = "혹시 공지/고정글에 있을 수도 있으니 한 번만 확인해 주세요!"
            return {
                "ok": True,
                "room_id": req.room_id,
                "room_name": req.room_name,
                "question": question,
                "answer": "\n".join([f"{requester_disp}{hint}", "", hint2]).strip(),
                "model": "deterministic_no_match",
            }

        tail_n = min(len(msgs), 80)
        picked = msgs[-tail_n:]
    else:
        picked = [msgs[i] for i in sorted(picked_idx)]

    url_re = re.compile(r"https?://\S+")

    def _extract_urls_from_text(text: str) -> list[str]:
        if not text:
            return []
        out: list[str] = []
        for u in url_re.findall(text):
            # trailing punctuation 제거(간단 버전)
            out.append(u.rstrip(").,]}>\"'"))
        return _dedupe_keep_order(out)

    # 1) 링크 요청은 LLM 없이 결정적으로 URL만 뽑아 응답한다(가장 흔한 실패 케이스 방지).
    if wants_link:
        urls_kw: list[str] = []
        urls_any: list[str] = []
        for m in picked:
            text = m.text or ""
            u = _extract_urls_from_text(text)
            if not u:
                continue
            urls_any.extend(u)
            if keywords and _has_any_keyword(text):
                urls_kw.extend(u)

        urls = _dedupe_keep_order(urls_kw)[:8] if urls_kw else _dedupe_keep_order(urls_any)[:8]
        if urls:
            answer_lines: list[str] = [
                f"{requester_disp}질문하신 내용 찾아봤어요! 링크만 깔끔하게 모아드릴게요 📝",
                "",
                "**🔗 관련 링크**",
                *urls,
            ]
            # 링크를 못 찾았을 때와 달리, 여기서는 굳이 기간 힌트까지 길게 쓰지 않는다.
            return {
                "ok": True,
                "room_id": req.room_id,
                "room_name": req.room_name,
                "question": question,
                "answer": "\n".join(answer_lines).strip(),
                "model": "deterministic_url_extract",
            }

    # 2) “언제/일정/날짜” 질문은 로그에서 날짜 표현을 우선 추출해 LLM 의존을 줄인다.
    wants_date = bool(re.search(r"(언제|일정|날짜|몇\s*일|며칠|나와|나오|출간|업로드|오픈|발표)", q))

    if wants_date and keywords:
        date_re = re.compile(
            r"(?:(20\d{2})[./-]([01]?\d)[./-]([0-3]?\d))|(?:(\d{1,2})\s*월\s*(\d{1,2})\s*일)|(?:(\d{1,2})\s*일)"
        )
        hits: list[tuple[str, str]] = []  # (date_text, evidence_line)
        for m in picked:
            text = _compact_ws(m.text or "")
            if not text:
                continue
            if not _has_any_keyword(text):
                continue
            m2 = date_re.search(text)
            if not m2:
                continue
            date_text = m2.group(0)
            hits.append((date_text, _format_evidence_line(m.ts, m.sender or "", text)))

        # 중복 제거
        seen_hit: set[str] = set()
        uniq_hits: list[tuple[str, str]] = []
        for d, ev in hits:
            k = f"{d}||{ev}"
            if k in seen_hit:
                continue
            seen_hit.add(k)
            uniq_hits.append((d, ev))

        if uniq_hits:
            uniq_hits = uniq_hits[:5]
            # 타임스탬프/근거 노출 금지: 날짜 텍스트만 자연스럽게 전달한다.
            dates = _dedupe_keep_order([d for d, _ in uniq_hits])[:5]
            hint_line = "표현이 '28일'처럼 월/연도가 빠져 있을 수도 있어서, 딱 떨어지는 날짜로는 못 박기 어렵네요."
            answer_lines = [
                f"{requester_disp}질문하신 내용 찾아봤어요! 대화에서 날짜/일정 언급이 이렇게 있었어요 📝",
                "",
                "**💡 요약 내용**",
                *[f"- {d}" for d in dates],
                "",
                hint_line,
            ]
            return {
                "ok": True,
                "room_id": req.room_id,
                "room_name": req.room_name,
                "question": question,
                "answer": "\n".join(answer_lines).strip(),
                "model": "deterministic_date_extract",
            }

    lines: list[str] = [
        "너는 '디하클(디지털노마드 하이클래스)' 오픈채팅방의 친절하고 센스 있는 AI 매니저야.",
        "사용자의 질문(\"!요약 <질문>\")에 대해, 제공된 대화 로그(Context)만 보고 답해줘.",
        "",
        "제약(무조건 지켜):",
        "- 말투는 분석 보고서체가 아니라, 친절하고 자연스러운 구어체(존댓말, ~해요/~네요).",
        "- '답변:', '근거:', '다음 액션:', '참고 로그:' 같은 헤더는 절대 출력하지 마.",
        "- 타임스탬프([2025-...])나 로그 원문을 그대로 복사해서 보여주지 마(필요하면 자연스럽게 요약만).",
        "- 발신자 이름이 숫자만(예: 296043063)이라면 userId일 수 있으니, 그 숫자를 그대로 쓰지 말고 '어떤 분'처럼 완곡하게 표현해줘.",
        "- 대화 로그에 명시적으로 나온 내용만 말하고, 없는 건 솔직하게 없다고 말해줘.",
        "- 링크/URL/주소를 요청했다면, 로그에 실제로 포함된 URL만 그대로 적어줘(없으면 없다고 말해줘).",
        "- 개인정보(전화번호/이메일/계좌번호 등)는 답변에서 모두 제거해줘.",
        "",
        "답변 템플릿(상황별):",
        "CASE 1) 정보가 전혀 없을 때:",
        f"- \"흠, 최근 대화 내역을 찾아봤는데 **<키워드>** 관련 얘기는 아직 안 나왔어요 😅\" 같은 톤으로 말해줘.",
        "- \"혹시 아시는 분 계시면 알려주세요!\" + \"공지/고정글도 한 번 확인해 주세요\" 정도만 덧붙여줘.",
        "CASE 2) 정보가 확실하게 있을 때:",
        f"- 첫 줄: \"{requester_disp}질문하신 내용 찾아봤어요! 봇이 요약해 드릴게요 📝\"",
        "- 다음 줄은 반드시 빈 줄 1개",
        "- 다음은 **💡 요약 내용** (콜론 없이) 라인을 단독으로 출력",
        "- 그 아래 줄부터 2~3줄로 핵심만",
        "- (있으면) 빈 줄 1개 후 **🔗 관련 링크** 라인을 단독으로 출력하고, 아래 줄부터 URL만 출력",
        "CASE 3) 일부만 있거나 모호할 때:",
        "- \"아쉽게도 **<핵심 정보>**는 대화에서 못 찾았어요 😭\"",
        "- 대신 확인된 내용은 **💡 요약 내용**으로 1~3줄로 정리해줘.",
        "- 마지막에 \"정확한 건 공지/운영진 확인이 빠를 것 같아요\" 정도로 마무리해줘.",
        "",
        f"방 이름: {req.room_name or req.room_id}",
        f"질문: {question}",
        "--- 대화 로그 ---",
    ]

    for m in picked:
        text = _render_msg_text_for_qa(m.text or "")
        if not text:
            continue
        sender = (m.sender or "").strip() or "사용자"
        lines.append(f"{sender}: {text}")

    lines.append("--- 위 로그를 근거로 질문에 답해라. ---")
    prompt = "\n".join(lines)

    try:
        answer = _openai_generate_text(prompt, model=model, temperature=0.2, max_output_tokens=900)
    except Exception as e:  # pragma: no cover - 외부 API 오류
        log.exception(f"/chat/qa failed: {e}")
        raise HTTPException(status_code=502, detail="chat_qa_call_failed")

    answer = _strip_sensitive_numbers_in_answer(str(answer or ""))
    answer = _postprocess_chat_answer(answer)
    if not answer.strip():
        raise HTTPException(status_code=502, detail="empty_chat_qa_answer")

    return {
        "ok": True,
        "room_id": req.room_id,
        "room_name": req.room_name,
        "question": question,
        "answer": answer.strip(),
        "model": model,
    }


def _postprocess_chat_answer(answer: str) -> str:
    """chat/summary, chat/qa 전용 후처리.

    - 보고서형 헤더(근거/다음 액션/참고 로그/답변 등) 제거
    - 타임스탬프 패턴 제거
    - 로그 원문 인용처럼 보이는 라인(예: "- [ts] sender: ...") 제거
    """
    s = str(answer or "")
    if not s.strip():
        return ""

    # 1) 라인 단위 정리
    out_lines: list[str] = []
    for raw in s.splitlines():
        line = raw.rstrip()
        if not line.strip():
            out_lines.append("")
            continue

        # 금지 헤더/섹션 타이틀 제거(영/한 혼합 방어)
        if re.match(
            r"^\s*(\d+\)\s*)?(답변|근거|증거|Evidence|Next Action|다음\s*액션|다음\s*할\s*일|To\s*do|TODO|참고\s*로그)\s*:?\s*$",
            line,
            re.I,
        ):
            continue
        # "답변: ..." 같은 접두 제거
        line = re.sub(
            r"^\s*(\d+\)\s*)?(답변|근거|증거|Evidence|Next Action|다음\s*액션|다음\s*할\s*일|To\s*do|TODO|참고\s*로그)\s*:\s*",
            "",
            line,
            flags=re.I,
        )

        # 타임스탬프/로그 표기 제거
        line = re.sub(r"\[(20\d{2}[-./]\d{1,2}[-./]\d{1,2}[^\]]*)\]", "", line)
        line = re.sub(r"\[(\d{1,2}:\d{2}(?::\d{2})?)\]", "", line)

        # "- [2025-..] sender: ..." 또는 "- [12:34] sender: ..." 같은 로그 인용 라인은 제거
        if re.match(r"^\s*[-*]\s*\[(20\d{2}[-./]\d{1,2}[-./]\d{1,2}[^\]]*|\d{1,2}:\d{2}(?::\d{2})?)\]\s*[^:]+:\s*.+$", raw):
            continue

        # userId 노출 방지:
        # - 숫자만 닉네임(예: 296043063, 32079002)이 답변에 그대로 섞이면 보기/프라이버시가 나쁘므로 완곡하게 치환한다.
        # - 단, 금액/코드 등 "의미 있는 숫자"까지 뭉텅이로 바꾸면 답이 망가지므로 조사/호칭 패턴에만 한정한다.
        line = re.sub(r"\b\d{6,}\b\s*님", "어떤 분", line)
        line = re.sub(r"\b\d{6,}\b(?=(이|가|은|는|을|를|에게|한테|에서|도|만|과|와|랑|으로|로)\b)", "어떤 분", line)
        line = re.sub(r"@\s*\b\d{6,}\b", "@어떤 분", line)

        # 공백 정리
        line = re.sub(r"\s{2,}", " ", line).strip()
        out_lines.append(line)

    # 2) 빈 줄 정리(연속 빈 줄 최대 1개)
    normalized: list[str] = []
    prev_blank = False
    for line in out_lines:
        blank = not line.strip()
        if blank and prev_blank:
            continue
        normalized.append(line)
        prev_blank = blank

    out = "\n".join(normalized).strip()
    # "💡 요약 내용:" 처럼 콜론이 붙는 패턴은 줄바꿈으로 교정
    out = re.sub(r"(?m)^\s*(\*\*?💡\s*요약\s*내용\*\*?)\s*:\s*", r"\1\n", out)
    out = re.sub(r"(?m)^\s*(💡\s*요약\s*내용)\s*:\s*", r"\1\n", out)
    out = re.sub(r"(?m)^\s*(\*\*?🔗\s*관련\s*링크\*\*?)\s*:\s*", r"\1\n", out)
    out = re.sub(r"(?m)^\s*(🔗\s*관련\s*링크)\s*:\s*", r"\1\n", out)
    return out.strip()


def _rerank_posts(query: str, posts: List[Dict[str, Any]], limit: int = 5) -> List[Dict[str, Any]]:
    if not posts:
        return []

    candidates = posts[: max(limit * 3, 20)]

    # 강한 의도 키워드가 있는 질의는 해당 키워드가 실제로 포함된 후보만 남긴다.
    # (예: "유튜브 수익창출 기준" → 수익창출/수익화/YPP/파트너 프로그램 등의 키워드가 없으면 카페 글과 무관할 가능성이 큼)
    q_lower = query.lower()
    required_keywords: list[str] = []
    if (
        re.search(r"수익창출|수익화|\bypp\b|monetization|youtube\s+partner\s+program", q_lower)
        or "파트너 프로그램" in query
    ):
        required_keywords = ["수익창출", "수익화", "ypp", "파트너 프로그램", "youtube partner program", "monetization"]

    if required_keywords:
        reqs = [k.lower() for k in required_keywords]
        filtered: list[Dict[str, Any]] = []
        for c in candidates:
            text = ((c.get("title") or "") + " " + (c.get("norm_text") or "")).lower()
            if any(k in text for k in reqs):
                filtered.append(c)
        candidates = filtered
        if not candidates:
            return []

    # 후보 수가 limit 이하이면 굳이 LLM을 호출하지 않고 기존 순서를 그대로 사용
    if len(candidates) <= limit:
        return candidates

    model = os.getenv("KB_RERANK_MODEL") or os.getenv("KB_LLM_MODEL") or "gpt-4.1-mini"

    prompt_lines = [
        "아래는 사용자의 질문과 후보 게시글 목록입니다.",
        "각 후보는 id, title, 본문요약, dist(벡터 거리) 정보를 포함합니다.",
        f"질문과 가장 관련 있는 후보를 최대 {limit}개 선택해 id만 JSON 배열로 반환하세요.",
        "규칙:",
        "1) 주어진 후보 id만 사용하고 새로 생성하지 않는다.",
        "2) 질문에 날짜·강의·다시보기 키워드가 포함되면 같은 키워드/날짜가 제목이나 본문요약에 있는 후보만 선택한다.",
        "3) '다시보기', '링크', '녹화' 키워드가 질문에 있으면 해당 키워드가 제목/본문에 있는 후보를 우선 선택한다.",
        "4) 관련도가 낮으면 0~3개만 반환해도 된다.",
        "5) JSON 외 불필요한 텍스트를 붙이지 않는다.",
        "",
        f"질문: {query}",
        "후보 목록:",
    ]
    # 질문 기반 키워드(다시보기/링크/녹화 등)를 본문 발췌에 활용
    boost_keywords = ["다시보기", "링크", "녹화", "보너스", "실습"]
    matched_keywords = [kw for kw in boost_keywords if kw in q_lower]

    for c in candidates:
        body = (c.get("norm_text") or "").replace("\n", " ")
        body = re.sub(r"\s+", " ", body).strip()

        body_preview = ""
        if body:
            # 키워드가 있는 경우, 첫 번째 키워드 주변을 중심으로 발췌
            match_idx = None
            for kw in matched_keywords:
                idx = body.find(kw)
                if idx != -1:
                    match_idx = idx
                    break
            if match_idx is None:
                body_preview = body[:300]
            else:
                start = max(0, match_idx - 150)
                end = start + 300
                body_preview = body[start:end]

        prompt_lines.append(
            f"- id:{c.get('post_id')} title:{(c.get('title') or '').strip()}"
        )
        if body_preview:
            prompt_lines.append(f"  본문요약: {body_preview}")
    prompt = "\n".join(prompt_lines)

    try:
        text = _openai_generate_text(prompt, model=model, temperature=0.0, max_output_tokens=200)
        # LLM이 마크다운 코드 블록으로 감쌀 수 있으므로 제거
        text = text.strip()
        if text.startswith("```"):
            # ```json\n[...]\n``` 형태 처리
            lines = text.split("\n")
            # 첫 줄(```json)과 마지막 줄(```) 제거
            json_lines = [l for l in lines if not l.startswith("```")]
            text = "\n".join(json_lines).strip()
        ids = json.loads(text)
        if not isinstance(ids, list):
            raise ValueError("rerank result not list")

        # 빈 배열은 "관련 후보 없음"을 의미하므로 dist 폴백하지 않는다.
        if not ids:
            log.info("[ask_llm] rerank returned empty list (no relevant candidates)", {"model": model})
            return []

        ids_int: list[int] = []
        for x in ids:
            try:
                ids_int.append(int(x))
            except Exception:
                continue
        ids_int = ids_int[:limit]
        if not ids_int:
            log.info("[ask_llm] rerank returned no valid ids", {"model": model})
            return []

        selected = [c for c in candidates if c.get("post_id") in ids_int]
        if not selected and candidates:
            log.warning("[ask_llm] rerank ids not matched to candidates, fallback to dist sort")
            return sorted(candidates, key=lambda x: x.get("dist", 1.0))[:limit]
        log.info("[ask_llm] rerank success", {"selected": ids_int, "model": model})
        return selected
    except Exception as e:
        log.warning(f"[ask_llm] rerank failed: {e}, fallback to dist sort")
        return sorted(candidates, key=lambda x: x.get("dist", 1.0))[:limit]


def _is_course_price_query(query: str, entity_keywords: list[str]) -> bool:
    """특정 강의(기수/정규/특강) 가격 질문인지 판별한다.

    목적:
    - 강의 신청 글(메뉴 23/42)은 제목에 '가격/수강료'가 없고, 이미지에만 가격이 있을 수 있다(OCR 필요).
    - 이 경우 (고유명 AND 가격 마커)로만 후보를 줄이면 '후기/다시보기'가 우선되어 오답이 난다.
    """
    q = (query or "").strip().lower()
    if not q or not entity_keywords:
        return False
    # 기수/신청/정규/특강/수강 등 강의 맥락
    if re.search(r"\d+\s*기", q):
        return True
    if any(k in q for k in ["정규", "정규강의", "정규 강의", "특강", "무료특강", "무료 특강", "강의", "수강", "신청", "사전신청", "커리큘럼", "커리"]):
        return True
    return False


def _pick_price_posts(
    posts: List[Dict[str, Any]],
    entity_keywords: list[str],
    query: str,
    limit: int = 5,
) -> List[Dict[str, Any]]:
    """가격/유료/할인 질문에서 후보 글을 휴리스틱으로 선정한다.

    목적:
    - '캡컷 유료버전 얼마야?'처럼 질문은 가격인데, 임베딩/LLM rerank가
      다시보기/보너스프로그램 글을 선택해버리는 케이스를 방지한다.
    """
    if not posts:
        return []

    q_lower = (query or "").strip().lower()
    want_replay = any(k in q_lower for k in ["다시보기", "녹화", "vod", "무료보기", "무료 보기"])
    want_regular = any(k in q_lower for k in ["정규", "정규강의", "정규 강의", "신청", "사전신청", "사전 신청"])
    has_cohort = bool(re.search(r"\d+\s*기", q_lower))

    primary = (entity_keywords[0].lower() if entity_keywords else "").strip()
    strong_title = ["가격", "할인", "정품", "구독", "블랙프라이데이", "블프", "쿠폰", "프로", "pro"]
    replay_markers = ["다시보기", "보너스프로그램", "보너스 프로그램", "vod", "녹화"]
    review_markers = ["후기", "리뷰", "체험기", "수강후기", "수강 후기"]

    def score(p: Dict[str, Any]) -> int:
        title = (p.get("title") or "").lower()
        body = (p.get("norm_text") or "").lower()
        text = f"{title} {body}"
        s = 0

        # 강의 신청 글(23/42)은 가격이 이미지에만 있을 수 있어, 메뉴 자체를 강하게 부스트한다.
        try:
            mid = int(p.get("menu_id") or 0)
        except Exception:
            mid = 0
        if mid in (42, 23):
            s += 7 if (want_regular or has_cohort) else 4
        # 무료특강 후기(32)는 가격 질문에서 오답 비중이 매우 높다.
        if mid == 32:
            s -= 7

        if primary and primary in text:
            s += 5
        # 제목에 가격 맥락이 있으면 강하게 부스트
        for kw in strong_title:
            if kw in title:
                s += 4
        # 가격 질문인데 '후기/리뷰' 글이면 감점 (가격이 빠진 사례가 많음)
        if any(k in title for k in review_markers):
            s -= 5
        # 질문이 '정규/가격'인데 '다시보기/보너스프로그램' 글이면 감점
        if (not want_replay) and any(k in title for k in replay_markers):
            s -= 7
        # 반대로 질문이 다시보기 가격이면 다시보기 글을 부스트
        if want_replay and any(k in title for k in replay_markers):
            s += 4
        # 숫자/금액 패턴 부스트
        if re.search(r"\\d{1,3}(,\\d{3})+\\s*원|\\d+\\s*만\\s*원", text):
            s += 3
        if any(k in text for k in ["연간", "월간", "구독료", "정가", "할인가"]):
            s += 1

        # 정규/기수 질문인데 신청/정규 문구가 제목에 있으면 추가 부스트
        if (want_regular or has_cohort) and any(k in title for k in ["정규", "정규강의", "정규 강의", "신청", "사전신청", "사전 신청"]):
            s += 3
        return s

    dedup: dict[int, Dict[str, Any]] = {}
    for p in posts:
        try:
            pid = int(p.get("post_id")) if p.get("post_id") is not None else None
        except Exception:
            pid = None
        if pid is None:
            continue
        if pid not in dedup:
            dedup[pid] = p

    ranked = sorted(dedup.values(), key=score, reverse=True)
    return ranked[:limit]


def _load_manuals(ids: List[int]) -> List[Dict[str, Any]]:
    if not ids:
        return []
    with db_session() as s:
        rows = s.execute(text(
            "SELECT doc_id, title, summary, body_md, level, status, updated_at "
            "FROM manual_doc WHERE doc_id = ANY(:ids)"
        ), {"ids": ids}).mappings().all()
    return [dict(r) for r in rows]


def _fix_cafe_url(url: str | None, post_id: int) -> str:
    """카페 URL 형식을 수정한다.

    잘못된 형식: https://cafe.naver.com/142685
    올바른 형식: https://cafe.naver.com/dinohighclass/142685
    """
    if not url:
        return f"https://cafe.naver.com/dinohighclass/{post_id}"

    # 이미 올바른 형식이면 그대로 반환
    if "/dinohighclass/" in url:
        return url

    # cafe.naver.com/ 뒤에 바로 숫자가 오는 경우 수정
    if re.match(r'^https?://cafe\.naver\.com/\d+$', url):
        return f"https://cafe.naver.com/dinohighclass/{post_id}"

    return url


def _load_posts(ids: List[int]) -> List[Dict[str, Any]]:
    if not ids:
        return []
    with db_session() as s:
        rows = s.execute(text(
            "SELECT post_id, menu_id, title, url, norm_text, author, created_at, status "
            "FROM sources_post WHERE post_id = ANY(:ids)"
        ), {"ids": ids}).mappings().all()

    # URL 형식 수정
    posts = []
    for r in rows:
        p = dict(r)
        p["url"] = _fix_cafe_url(p.get("url"), p.get("post_id"))
        posts.append(p)
    return posts


def _shorten(txt: Optional[str], limit: int = 400) -> str:
    if not txt:
        return ""
    if len(txt) <= limit:
        return txt
    return txt[:limit] + "…"


def _manual_preview_for_query(
    query: str, manual: Dict[str, Any], limit: int = 1200
) -> str:
    """질문과 매뉴얼 내용을 함께 고려해 LLM에 보여줄 발췌를 생성한다.

    - 기본은 summary/body_md 전체에서 공백을 정규화한 뒤 앞에서부터 limit까지 사용
    - 가격/포인트/비용 관련 질문일 때는 해당 키워드 주변을 중심으로 limit 길이만큼 잘라낸다.
      (매뉴얼 상단이 길어도 실제 숫자 정보가 잘리지 않도록 하기 위함)
    """
    # 본문(body_md)에 보다 상세한 정책/숫자 정보가 들어가는 경우가 많으므로
    # summary 보다 body_md를 우선 사용한다.
    body = (manual.get("body_md") or manual.get("summary") or "") or ""
    body = re.sub(r"\s+", " ", body).strip()
    if not body:
        return ""

    q_lower = query.lower()
    price_keywords = []
    if any(k in q_lower for k in ["가격", "수강료", "비용", "얼마", "금액"]):
        price_keywords.extend(["가격", "수강료", "비용", "얼마", "금액"])
    if "포인트" in q_lower:
        price_keywords.append("포인트")

    if not price_keywords:
        return _shorten(body, limit)

    # 질문에 나온 키워드들 중 처음으로 매뉴얼 본문에서 발견되는 위치를 기준으로 발췌
    match_idx = None
    for kw in price_keywords:
        idx = body.find(kw)
        if idx != -1:
            match_idx = idx
            break
    if match_idx is None:
        return _shorten(body, limit)

    half = max(200, limit // 2)
    start = max(0, match_idx - half)
    end = start + limit
    return body[start:end]


def _is_price_or_point_question(query: str) -> bool:
    """가격/수강료/포인트 등 수치 정책을 묻는 질문인지 판별한다."""
    if not query:
        return False
    lowered = query.lower()
    base_keywords = ["가격", "수강료", "비용", "얼마", "금액", "포인트", "무이자", "얼리버드"]
    if any(k in lowered for k in base_keywords):
        return True
    # '할인' 단독은 재수강/재등록 등과 섞여 오탐이 잦아서, 금액/수강료/포인트/무이자 등과 함께 있을 때만 가격 질문으로 본다.
    if "할인" in lowered:
        return any(k in lowered for k in ["가격", "수강료", "비용", "금액", "포인트", "무이자", "얼리버드"]) or bool(re.search(r"\\d", lowered))
    return False


def _is_course_tier_price_policy_question(query: str) -> bool:
    """일반반/비지니스반(비즈니스반) 가격·포인트 정책 질문인지 판별한다.

    NOTE:
    - price_policy(결정적 템플릿)는 특정 강의(일반반/비지니스반) 정책 숫자를 다루는 전용 경로다.
    - '다시보기 가격'처럼 다른 '가격' 질문에 오답으로 붙으면 치명적이므로, 조건을 좁게 잡는다.
    """
    if not query:
        return False
    q = query.lower()
    if not _is_price_or_point_question(query):
        return False
    # 다시보기/녹화/링크 가격은 별도 처리(추측 금지)
    if ("다시보기" in q) or ("녹화" in q):
        return False
    # 반/과정이 명시된 경우에만 policy 경로를 탄다.
    if any(k in q for k in ["일반반", "비지니스반", "비즈니스반"]):
        return True
    if ("일반" in q) and (("비지니스" in q) or ("비즈니스" in q)):
        return True
    return False


def _collect_price_point_snippets(
    manuals: List[Dict[str, Any]], max_items: int = 8
) -> List[str]:
    """매뉴얼들에서 가격·포인트와 직접 관련된 문장/라인을 수집한다.

    - 특정 숫자(예: 177, 255 등)를 하드코딩하지 않고, 매뉴얼 본문에 있는 문장을 그대로 사용한다.
    - LLM이 숫자를 쉽게 볼 수 있도록 '수강료/가격/포인트/무이자/할인/얼리버드' 등의 키워드가 포함된 라인만 모은다.
    """
    snippets: List[str] = []
    keywords = ["수강료", "가격", "포인트", "무이자", "할인", "얼리버드"]
    for m in manuals:
        body = (m.get("body_md") or m.get("summary") or "") or ""
        if not body:
            continue
        for raw_line in body.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            if any(kw in line for kw in keywords):
                snippets.append(line)
                if len(snippets) >= max_items:
                    return snippets
    return snippets


def _extract_price_point_policy_from_manuals(
    manuals: List[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """매뉴얼 본문에서 일반반/비지니스반 가격·포인트 정책 숫자를 추출한다.

    - 특정 값(177, 255 등)을 코드에 하드코딩하지 않고, 매뉴얼 텍스트에서 정규식으로 추출한다.
    - 형식이 크게 바뀌면 None을 반환하여 LLM이 기존 규칙대로 처리하게 둔다.
    """
    body_all = "\n".join(
        (m.get("body_md") or m.get("summary") or "") or "" for m in manuals
    )
    if not body_all.strip():
        return None

    # 수강료: **177만 원**, 수강료: **255만 원** 형태
    price_matches = re.findall(r"수강료:\s*\*\*(\d+)\s*만\s*원\*\*", body_all)
    # 포인트 50만 원, 포인트 100만 원 등
    point_matches = re.findall(r"포인트[^0-9]*?(\d+)\s*만\s*원", body_all)

    # 얼리버드: 라인 단위로만 검사하여 50만/100만과 섞이지 않게 한다.
    bonus_val: Optional[str] = None
    for line in body_all.splitlines():
        line = line.strip()
        if not line:
            continue
        m = re.search(r"포인트\s*(\d+)\s*만\s*원\s*추가", line)
        if m:
            bonus_val = m.group(1)
            break
        m = re.search(r"추가로\s*(\d+)\s*만\s*원\s*포인트", line)
        if m:
            bonus_val = m.group(1)
            break

    # 무이자 12개월 월 납부액 (예: "무이자 12개월, 월 14만 원" / "무이자 12개월, 월 21만 원")
    monthly_vals: list[int] = []
    for line in body_all.splitlines():
        line = line.strip()
        if not line:
            continue
        if "무이자" not in line:
            continue
        m = re.search(r"월\s*(\d+)\s*만\s*원", line)
        if m:
            try:
                monthly_vals.append(int(m.group(1)))
            except Exception:
                pass

    if len(price_matches) < 2 or len(point_matches) < 2:
        return None

    general_price, business_price = price_matches[:2]
    general_point, business_point = point_matches[:2]
    policy: Dict[str, Any] = {
        "general_price": general_price,
        "business_price": business_price,
        "general_point": general_point,
        "business_point": business_point,
    }
    if bonus_val:
        policy["bonus_point"] = bonus_val

    monthly_unique = sorted(set(monthly_vals))
    if len(monthly_unique) >= 2:
        policy["general_monthly_12"] = str(monthly_unique[0])
        policy["business_monthly_12"] = str(monthly_unique[-1])
    return policy


def _find_price_policy_manual_ids(limit: int = 6) -> list[int]:
    """가격/포인트 정책 매뉴얼을 DB에서 키워드로 찾는다.

    벡터 검색(임베딩) 결과에서 정책 매뉴얼이 상위로 안 올라오는 경우가 있어,
    가격 질문에서는 한 번 더 DB 키워드 검색으로 보강한다.
    """
    lim = max(1, min(int(limit or 6), 20))
    try:
        with db_session() as s:
            rows = s.execute(
                text(
                    """
                    SELECT doc_id
                    FROM manual_doc
                    WHERE status IN ('clean','published')
                      AND (
                        (title ILIKE '%%가격%%' AND title ILIKE '%%포인트%%')
                        OR (summary ILIKE '%%가격%%' AND summary ILIKE '%%포인트%%')
                        OR (body_md ILIKE '%%수강료%%' AND body_md ILIKE '%%포인트%%')
                        OR (body_md ILIKE '%%일반반%%' AND (body_md ILIKE '%%비지니스%%' OR body_md ILIKE '%%비즈니스%%'))
                      )
                    ORDER BY updated_at DESC NULLS LAST, doc_id DESC
                    LIMIT :lim
                    """
                ),
                {"lim": lim},
            ).scalars().all()
        out: list[int] = []
        for x in rows or []:
            try:
                if x is not None:
                    out.append(int(x))
            except Exception:
                continue
        return out
    except Exception:
        return []


# 강의 일정 질문 감지 (후기 제외하고 신청 게시판만 검색)
# Menu IDs: 23=무료특강신청, 32=무료특강후기, 42=정규강의신청
SCHEDULE_MENU_IDS = [23, 42]  # 신청 게시판만
REVIEW_MENU_IDS = [32]  # 후기 게시판
# 일정/후기 쿼리는 거리 임계값 완화 (일반 0.42 → 완화 0.8)
SCHEDULE_DIST_THRESHOLD = 0.8
# 강의 관련 모든 게시판 (신청 + 후기)
LECTURE_ALL_MENU_IDS = [23, 32, 42]


def _is_recent_posts_query(query: str) -> bool:
    """'최근/최신 글/링크 하나만' 류 요청인지 감지."""
    q = (query or "").lower()
    if not q:
        return False
    # 너무 일반적인 "최근" 단독은 제외하고, 글/게시글/링크 같은 의도 단서가 있어야 True
    return bool(re.search(r"(최근|최신)", q) and re.search(r"(글|게시글|게시물|링크|추천|하나)", q))


def _recent_posts_limit(query: str) -> int:
    q = (query or "").lower()
    # 명시적으로 "N개"를 지정하면 그 값을 우선(과도한 스팸 방지로 상한 5)
    m = re.search(r"(\d+)\s*개", q)
    if m:
        try:
            n = int(m.group(1))
            if n >= 1:
                return max(1, min(5, n))
        except Exception:
            pass
    if re.search(r"(하나만|1개|한\s*개|1\s*개|한\s*가지만)", q):
        return 1
    # "목록/리스트/여러개" 류만 3개까지 노출, 기본은 1개(가독성)
    if re.search(r"(목록|리스트|여러\s*개|몇\s*개|전부|전체|모두|쭉)", q):
        return 3
    return 1


def _is_schedule_list_request(query: str) -> bool:
    """일정/신청 관련 질문 중에서도 '링크/공지/일정 리스트'를 요청하는지 감지."""
    q = (query or "").lower()
    if not q:
        return False

    # '신청하려면/조건/준비물/확인' 류는 리스트 요청이 아님
    if re.search(r"(조건|준비물|확인|필수|요건|자격|문의|질문)", q):
        # 단, '신청 링크/공지'처럼 명시적으로 링크를 요구하면 예외로 True
        if re.search(r"(링크|공지|신청\s*글|신청글|url)", q):
            return True
        return False

    return bool(
        re.search(r"(링크|공지|신청\s*글|신청글|일정|언제|몇\s*시|마감|어디서\s*신청|신청\s*방법)", q)
    )


def _detect_board_menu_target(query: str) -> tuple[list[int], str] | None:
    """질문에서 특정 게시판(메뉴) 의도를 추출한다."""
    q = (query or "").lower()
    if not q:
        return None

    # 카페 이용/규칙/필독/공지 (강의 신청/일정 공지와 혼동 방지)
    # - 강의/특강/신청 맥락이 있으면 schedule 경로가 더 적합하므로 여기서 잡지 않는다.
    if not re.search(r"(강의|특강|무강|정규\s*강의|정규강의|무료\s*특강|무료특강|신청)", q):
        if re.search(r"(이용\s*가이드|이용가이드|카페\s*이용)", q):
            return [192], "카페 이용 가이드"
        # "이벤트 공지"는 이벤트 게시판(47)을 우선한다.
        if "이벤트" in q and re.search(r"(공지사항|공지)", q):
            return [47], "디하클 이벤트 공지"
        # "회원 대상 전체 공지"는 공지 게시판(1)을 우선한다.
        if re.search(r"(회원\s*대상|전체\s*공지)", q) and re.search(r"(공지사항|공지|전체\s*공지)", q):
            return [1], "회원 대상 전체 공지"
        if re.search(r"(필독|규칙|공지사항|공지)", q):
            return [1, 47], "카페 공지"

    # 가입/등업 안내
    if "등업" in q or re.search(r"(가입\s*인사|가입인사)", q):
        return [31], "가입/등업 안내"

    # 게시판별 최근 글
    if re.search(r"(성장\s*일기|성장일기)", q):
        return [62], "디하클 성장 일기"
    if re.search(r"(자유\s*게시판|자유게시판)", q):
        return [33], "자유 게시판"

    # 우선순위: 더 구체적인 의도부터
    if "인터뷰" in q:
        return [245], "수강생 인터뷰"
    if ("수익" in q and "인증" in q) or "수익인증" in q:
        return [206], "개인 수익 인증"
    if "하이라이트" in q:
        return [48], "주차별 하이라이트"
    if ("운영자" in q or "운영자의" in q) and ("꿀팁" in q or "팁" in q):
        return [51], "카페 운영자의 꿀팁"
    if ("회원" in q or "회원의" in q) and ("꿀팁" in q or "팁" in q):
        return [136], "디하클 회원의 꿀팁"
    return None


def _detect_disabled_board(query: str) -> tuple[int, str] | None:
    """수집/조회에서 제외한 게시판 의도를 탐지한다."""
    q = (query or "").lower()
    if not q:
        return None

    # 강사들의 꿀팁(172)은 현재 글이 비어 있어 KB 수집/조회 대상에서 제외한다.
    if re.search(r"강사(들|들의)?\s*(의)?\s*(꿀팁|팁)", q):
        return 172, "강사들의 꿀팁"

    return None


def _format_posts_as_list(posts: list[dict[str, Any]], header: str | None = None) -> str:
    lines: list[str] = []
    if header:
        lines.append(header)
    for p in posts or []:
        title = (p.get("title") or "").strip() or f"post {p.get('post_id')}"
        created_at = p.get("created_at")
        if hasattr(created_at, "strftime"):
            date_str = created_at.strftime("%Y-%m-%d")
        else:
            date_str = str(created_at)[:10] if created_at else ""
        post_id = p.get("post_id")
        try:
            pid_int = int(post_id) if post_id is not None else None
        except Exception:
            pid_int = None
        url = p.get("url") or ""
        if pid_int is not None:
            url = _fix_cafe_url(url, pid_int)
        item = f"- {title}"
        if date_str:
            item += f" ({date_str})"
        if url:
            item += f"\n  {url}"
        lines.append(item)
    return "\n".join(lines).strip()


def _extract_date_keys(text: str) -> list[str]:
    """문자열에서 월/일 조합을 추출해 MMDD 형태의 키로 반환한다.

    예:
      - '12월 3일', '12월3일'   → '1203'
      - '12/3', '12.03', '12-3' → '1203'
    연도는 무시하고 월·일 조합만 비교한다.
    """
    keys: set[str] = set()
    if not text:
        return []

    # 12월 3일 / 12월3일 / 12월 03일
    for m in re.finditer(r"(\d{1,2})\s*월\s*(\d{1,2})\s*일?", text):
        month = int(m.group(1))
        day = int(m.group(2))
        if 1 <= month <= 12 and 1 <= day <= 31:
            keys.add(f"{month:02d}{day:02d}")

    # 12/3, 12.03, 12-03
    for m in re.finditer(r"(\d{1,2})[./-](\d{1,2})", text):
        month = int(m.group(1))
        day = int(m.group(2))
        if 1 <= month <= 12 and 1 <= day <= 31:
            keys.add(f"{month:02d}{day:02d}")

    return list(keys)


def _date_key_variants(mmdd: str) -> list[str]:
    """MMDD 키를 실제 게시글에서 자주 쓰는 날짜 표기 문자열로 확장한다."""
    try:
        mmdd_s = str(mmdd or "").strip()
        if len(mmdd_s) != 4 or not mmdd_s.isdigit():
            return []
        month = int(mmdd_s[:2])
        day = int(mmdd_s[2:])
        if not (1 <= month <= 12 and 1 <= day <= 31):
            return []
    except Exception:
        return []

    # NOTE: 연도는 비교하지 않는다. 실제 글에서 자주 보이는 표기만 확장.
    return [
        f"{month}월 {day}일",
        f"{month}월{day}일",
        f"{month}/{day}",
        f"{month}/{day:02d}",
        f"{month}.{day}",
        f"{month}.{day:02d}",
        f"{month}-{day}",
        f"{month}-{day:02d}",
    ]


def _search_posts_by_date_keys(menu_ids: list[int], date_keys: list[str], limit: int = 60) -> list[dict[str, Any]]:
    """특정 날짜 키(MMDD)가 포함된 게시글을 DB에서 결정적으로 조회한다."""
    if not menu_ids or not date_keys:
        return []
    variants: list[str] = []
    for k in date_keys:
        variants.extend(_date_key_variants(k))
    # 중복 제거 + 공백 제거
    variants = list(dict.fromkeys([v for v in variants if v and v.strip()]))
    if not variants:
        return []

    # 1) 날짜 문자열 후보로 최근 글을 넓게 가져오고,
    # 2) _extract_date_keys로 최종 MMDD 키가 실제 포함되는지 확인해 오탐을 줄인다.
    candidates = _get_recent_posts_filtered(menu_ids, limit=min(200, max(10, int(limit))), keywords_any=variants, title_only=False)
    q_keys = set([k for k in date_keys if k])
    out: list[dict[str, Any]] = []
    for p in candidates:
        post_text = (p.get("title") or "") + " " + (p.get("norm_text") or "")
        p_keys = set(_extract_date_keys(post_text))
        if q_keys & p_keys:
            out.append(p)
    return out

def _parse_date_keywords(query: str) -> Optional[tuple]:
    import datetime
    today = datetime.date.today()
    q = query.lower()
    if re.search(r'오늘|금일', q):
        return (today, today)
    if re.search(r'어제', q):
        return (today - datetime.timedelta(days=1), today - datetime.timedelta(days=1))
    if re.search(r'이번\s*주|금주', q):
        start = today - datetime.timedelta(days=today.weekday())
        return (start, start + datetime.timedelta(days=6))
    if re.search(r'지난\s*주|저번\s*주|전주', q):
        start = today - datetime.timedelta(days=today.weekday() + 7)
        return (start, start + datetime.timedelta(days=6))
    if re.search(r'다음\s*주|차주|내주', q):
        start = today + datetime.timedelta(days=(7 - today.weekday()))
        return (start, start + datetime.timedelta(days=6))
    m = re.search(r'최근\s*(\d+)\s*일', q)
    if m:
        return (today - datetime.timedelta(days=int(m.group(1))), today)
    if re.search(r'최근', q):
        return (today - datetime.timedelta(days=7), today)
    return None


def _get_query_date_keys(query: str) -> list[str]:
    """질문에서 날짜 키(MMDD)를 추출한다.

    - 숫자 형식(12월 3일, 12/3 등)은 _extract_date_keys로 처리
    - '어제', '오늘', '이번 주' 같은 상대 표현은 _parse_date_keywords로
      실제 날짜 범위로 변환한 뒤 MMDD 키를 생성한다.
    """
    keys: set[str] = set(_extract_date_keys(query))
    dr = _parse_date_keywords(query)
    if dr:
        start_date, end_date = dr
        cur = start_date
        while cur <= end_date:
            keys.add(f"{cur.month:02d}{cur.day:02d}")
            cur += _dt.timedelta(days=1)
    return list(keys)


def _get_recent_posts(menu_ids, limit=5, date_range=None):
    if DISABLED_MENU_IDS:
        menu_ids = [m for m in (menu_ids or []) if m not in DISABLED_MENU_IDS]
    if not menu_ids:
        return []
    with db_session() as s:
        if date_range:
            start_date, end_date = date_range
            rows = s.execute(text(
                """SELECT post_id, menu_id, title, url, norm_text, author, created_at, status
                FROM sources_post WHERE menu_id = ANY(:menu_ids) AND status = 'clean'
                AND created_at::date >= :start_date AND created_at::date <= :end_date
                ORDER BY created_at DESC NULLS LAST, post_id DESC LIMIT :lim"""
            ), {"menu_ids": menu_ids, "start_date": start_date, "end_date": end_date, "lim": limit}).mappings().all()
        else:
            rows = s.execute(text(
                """SELECT post_id, menu_id, title, url, norm_text, author, created_at, status
                FROM sources_post WHERE menu_id = ANY(:menu_ids) AND status = 'clean'
                ORDER BY created_at DESC NULLS LAST, post_id DESC LIMIT :lim"""
            ), {"menu_ids": menu_ids, "lim": limit}).mappings().all()
    # URL 형식 수정
    return [
        {**dict(r), "url": _fix_cafe_url(r["url"], r["post_id"])}
        for r in rows
    ]


def _get_recent_posts_filtered(
    menu_ids: list[int],
    limit: int = 5,
    date_range=None,
    keywords_any: Optional[list[str]] = None,
    keywords_all: Optional[list[str]] = None,
    title_only: bool = False,
):
    """최근 글을 조회하되 제목/본문에 특정 키워드가 포함된 것만 반환한다.

    - keywords_any: 하나라도 포함되면 통과 (OR)
    - keywords_all: 모두 포함되어야 통과 (AND)
    """
    if DISABLED_MENU_IDS:
        menu_ids = [m for m in (menu_ids or []) if m not in DISABLED_MENU_IDS]
    if not menu_ids:
        return []
    keywords_any = [k for k in (keywords_any or []) if k and str(k).strip()]
    keywords_all = [k for k in (keywords_all or []) if k and str(k).strip()]

    params: dict[str, Any] = {"menu_ids": menu_ids, "lim": limit}
    where_parts: list[str] = ["menu_id = ANY(:menu_ids)", "status = 'clean'"]

    if date_range:
        start_date, end_date = date_range
        where_parts.append("created_at::date >= :start_date")
        where_parts.append("created_at::date <= :end_date")
        params.update({"start_date": start_date, "end_date": end_date})

    field_expr = "title ILIKE :{key}" if title_only else "(title ILIKE :{key} OR norm_text ILIKE :{key})"

    if keywords_all:
        for i, kw in enumerate(keywords_all):
            key = f"kw_all_{i}"
            params[key] = f"%{kw}%"
            where_parts.append(field_expr.format(key=key))

    if keywords_any:
        ors: list[str] = []
        for i, kw in enumerate(keywords_any):
            key = f"kw_any_{i}"
            params[key] = f"%{kw}%"
            ors.append(field_expr.format(key=key))
        where_parts.append("(" + " OR ".join(ors) + ")")

    where_sql = " AND ".join(where_parts)
    sql = f"""SELECT post_id, menu_id, title, url, norm_text, author, created_at, status
              FROM sources_post
              WHERE {where_sql}
              ORDER BY created_at DESC NULLS LAST, post_id DESC
              LIMIT :lim"""

    with db_session() as s:
        rows = s.execute(text(sql), params).mappings().all()

    return [{**dict(r), "url": _fix_cafe_url(r["url"], r["post_id"])} for r in rows]


def _keyword_search_posts(query: str, limit: int = 5):
    # 간단한 키워드 부분일치 검색 (fallback 아님: 동일 DB에서 정 deterministically 조회)
    q = f"%{query}%"
    with db_session() as s:
        rows = s.execute(text(
            """SELECT post_id, menu_id, title, url, norm_text, author, created_at, status
               FROM sources_post
               WHERE status = 'clean' AND (title ILIKE :q OR norm_text ILIKE :q)
               ORDER BY created_at DESC NULLS LAST, post_id DESC
               LIMIT :lim"""
        ), {"q": q, "lim": limit}).mappings().all()
    # URL 형식 수정
    return [
        {**dict(r), "url": _fix_cafe_url(r["url"], r["post_id"])}
        for r in rows
    ]


def _is_lecture_query(query: str) -> bool:
    return bool(re.search(r'강의|무강|특강|수업|레슨|클래스', query.lower()))


def _is_latest_lecture_question(query: str) -> bool:
    """'가장 최근 강의/특강' 류 질문 감지."""
    q = query.lower()
    return bool(
        re.search(
            # NOTE: '가장 최근' 단독은 공지/게시판 최신 글 요청과 혼동되므로
            # 강의/특강 문맥이 함께 있는 경우에만 True로 본다.
            r"(가장\s*최근(?:에)?\s*(?:진행(?:한|했던|된)?\s*)?(?:강의|특강|무강|무료\s*특강|무료특강|정규\s*강의|정규강의)|"
            r"최근(?:에)?\s*(?:진행(?:한|했던|된)?\s*)?(?:강의|특강|무강|무료\s*특강|무료특강|정규\s*강의|정규강의)|"
            r"이번\s*(?:강의|특강|무강|무료\s*특강|무료특강|정규\s*강의|정규강의)|"
            r"마지막\s*(?:강의|특강|무강|무료\s*특강|무료특강|정규\s*강의|정규강의))",
            q,
        )
    )




def _is_schedule_query(query: str) -> bool:
    """강의 일정/신청 관련 질문인지 감지 (후기 제외)"""
    q = query.lower()
    # 후기 관련 키워드가 있으면 False
    if re.search(r'후기|리뷰|평가|어땠|어때', q):
        return False
    # 일정/신청 관련 패턴
    schedule_patterns = [
        r'(오늘|내일|이번주|다음주|이번달|다음달|금주|차주).*?(강의|무강|특강)',
        r'(강의|무강|특강).*?(있나|있어|있니|언제|일정|신청)',
        r'\d+월.*?(강의|무강|특강)',
        r'(강의|무강|특강).*?\d+월',
    ]
    for pattern in schedule_patterns:
        if re.search(pattern, q):
            return True
    return False


def _is_review_query(query: str) -> bool:
    """강의 후기/리뷰 관련 질문인지 감지"""
    q = query.lower()
    if re.search(r'후기|리뷰|평가|어땠|어때|소감|느낌|수강.*(후|평)', q):
        return True
    return False


def _is_membership_policy_query(query: str) -> bool:
    """가입/등업/승인 등 '정책/절차' 질문인지 감지한다.

    - 이런 질문은 LLM이 잘못된 규칙을 단정적으로 생성(환각)하기 쉬워서,
      최대한 결정적 근거(SSOT 메뉴명/공지글 링크)만으로 답하도록 분기한다.
    """
    q = (query or "").lower()
    if not q:
        return False
    # '필독/규칙/공지' 요청은 공지 라우팅이 우선 (가입 키워드에 끌려가면 오답이 나옴)
    if re.search(r"(필독|규칙|공지사항|공지)", q) and not re.search(r"(등업|승인|등급|회원\\s*등급)", q):
        return False
    if "등업" in q:
        return True
    if re.search(r"(승인|등급|회원\\s*등급)", q) and re.search(r"(조건|방법|어떻게|절차|필요|신청)", q):
        return True
    # '가입' 단독은 너무 넓어서, 등업/승인/등급 맥락이 같이 있을 때만 정책 질문으로 취급한다.
    if "가입" in q and re.search(r"(등업|승인|등급)", q):
        return True
    # '가입 인사' 작성 위치/규칙 문의는 자주 나오며, LLM 환각 위험이 높아 결정적 답변으로 처리한다.
    if re.search(r"(가입\s*인사|가입인사)", q) and re.search(r"(어디|어디서|메뉴|게시판|작성|쓰|올리)", q):
        return True
    return False


def _is_cafe_member_count_query(query: str, *, has_domain_context: bool = False) -> bool:
    """'디하클 카페 회원수/멤버수' 질문인지 감지한다.

    NOTE:
    - 숫자는 카페 홈(카페정보 > 멤버수)에서 실시간 파싱해야 하므로 LLM/RAG로 답하면 안 된다.
    - '?디하클' 접두어/ context_tags 가 붙는 요청은 도메인 컨텍스트로 취급한다.
    """
    q = (query or "").strip().lower()
    if not q:
        return False

    # 등급/등업/승인 정책 질문과 섞이지 않게 방어
    if re.search(r"(등업|등급|승인)", q) and not re.search(r"(회원수|멤버수|가입자수)", q):
        return False

    # 멤버수/회원수/가입자수 직접 표현
    if re.search(r"(회원수|멤버수|가입자수)", q):
        return True if ("카페" in q or "네이버" in q or "dinohighclass" in q or "디하클" in q or has_domain_context) else False

    # '회원 몇 명/몇명/인원/규모' 간접 표현
    if re.search(r"(회원|멤버|가입자)", q) and re.search(r"(몇\s*명|몇명|인원|규모)", q):
        return True if ("카페" in q or "네이버" in q or "dinohighclass" in q or "디하클" in q or has_domain_context) else False

    # '총 몇 명'만 있는 경우는 오탐 위험이 커서, 카페/디하클 표지어가 있을 때만 잡는다.
    if re.search(r"(총|현재|지금).*(몇\s*명|몇명)", q) and re.search(r"(카페|네이버|dinohighclass|디하클)", q):
        return True

    return False


def _is_cafe_profile_query(query: str, *, has_domain_context: bool = False) -> bool:
    """디하클 카페 '기본 정보/주소/ID' 질문인지 감지한다."""
    q = (query or "").strip().lower()
    if not q:
        return False
    # 회원수는 별도 결정적 경로로 처리한다.
    if _is_cafe_member_count_query(query, has_domain_context=has_domain_context):
        return False

    if not (("카페" in q) or ("dinohighclass" in q) or ("디하클" in q) or has_domain_context):
        return False

    if re.search(r"(카페|cafe).*(정보|소개|주소|url|링크|어디|무슨|뭐야)", q):
        return True
    if re.search(r"(clubid|cafe[_\\s-]*id|cafeid)", q):
        return True
    if ("카페" in q) and re.search(r"(기본\\s*정보|기본정보|프로필|홈|홈페이지)", q):
        return True
    return False


def _is_instructors_list_query(query: str, *, has_domain_context: bool = False) -> bool:
    """강사진/강사 목록 요청인지 감지한다 (신청 게시판 기반으로 결정적 응답)."""
    q = (query or "").strip().lower()
    if not q:
        return False
    if not (("디하클" in q) or ("dinohighclass" in q) or has_domain_context):
        return False

    return bool(
        re.search(
            r"(강사진|강사\\s*(목록|리스트|명단|소개)|강사들\\s*(누구|누구야|목록|리스트)?)",
            q,
        )
    )


def _extract_notice_required_keywords(query: str) -> list[str]:
    """'필독/규칙 공지'처럼 특정 키워드를 반드시 포함해야 하는 공지 요청을 정규화한다."""
    q = (query or "").lower()
    kws: list[str] = []
    if "필독" in q or "규칙" in q:
        # 사용자가 '필독'만 말해도 '규칙'을 함께 찾는 것이 실사용에 유리
        kws.extend(["필독", "규칙"])
    return list(dict.fromkeys([k for k in kws if k]))


def _looks_like_policy_post(post: Dict[str, Any]) -> bool:
    """'공지/안내/규칙' 성격의 글처럼 보이는지 휴리스틱으로 판정한다.

    가입인사/등업신청 같은 짧은 글이 정책 질문의 근거로 섞이는 것을 방지하기 위함.
    """
    title = str(post.get("title") or "")
    body = str(post.get("norm_text") or "")
    text_ = (title + " " + body).lower()
    if re.search(r"(필독|규칙|공지|안내|가이드|이용\s*가이드)", text_):
        return True
    # 정책 안내 글은 보통 본문이 어느 정도 길다 (가입인사는 매우 짧은 경우가 많음)
    return len(body.strip()) >= 400


def _looks_like_membership_policy_post(post: Dict[str, Any]) -> bool:
    """등업/가입/승인 관련 '안내/규칙' 글처럼 보이는지 판정한다.

    - 단순 가입인사/등업신청 글(개인 글)은 제외해야 한다.
    """
    title = str(post.get("title") or "")
    body = str(post.get("norm_text") or "")
    text_ = (title + " " + body).lower()
    if not re.search(r"(등업|승인|자동\\s*등업|자동등업)", text_):
        return False
    return bool(re.search(r"(필독|규칙|공지|안내|가이드|이용\\s*가이드)", text_))


def _get_menu_name(menu_id: int) -> Optional[str]:
    try:
        for m in get_all_menus():
            try:
                if int(m.get("menu_id")) == int(menu_id):
                    name = m.get("name")
                    return str(name).strip() if name else None
            except Exception:
                continue
    except Exception:
        return None
    return None


def _build_membership_policy_answer(query: str) -> tuple[str, list[dict[str, Any]]]:
    """가입/등업/승인 류 질문에 대해 '추측 없는' 결정적 답변을 만든다."""
    q = (query or "").strip()
    q_lower = q.lower()

    lines: list[str] = []
    selected_posts: list[dict[str, Any]] = []

    # 1) 승인/처리 기간은 자료/공지에 없으면 추측하지 않는다.
    if re.search(r"(얼마나|몇\s*분|몇\s*시간|몇\s*일|기간|소요|걸려|걸리|바로|즉시)", q_lower):
        lines.append("등업 승인/처리 기간은 자료 기준으로 확인 불가합니다.")
    else:
        # 2) 기본 등업 방식은 SSOT 메뉴명(게시판 라벨)에서 확인 가능한 범위만 제공
        menu_name = _get_menu_name(31)  # "가입 인사 (글 + 댓글 3개 자동 등업)"
        if menu_name:
            menu_title = (menu_name.split("(")[0] or "").strip() if "(" in menu_name else menu_name.strip()
            if menu_title and re.search(r"(어디|어디서|게시판|신청)", q_lower):
                lines.append("신청 위치(메뉴명 기준):")
                lines.append(f"- {menu_title}")

            m = re.search(r"\(([^)]+)\)", menu_name)
            rule = (m.group(1).strip() if m else menu_name).strip()
            if rule:
                lines.append("기본 등업 조건(메뉴명 기준):")
                lines.append(f"- {rule}")

    # 3) 공지/안내 글이 실제로 수집돼 있으면 1개만 근거로 제공 (가입인사 글은 제외)
    #    - 링크는 '실제 게시글 URL'만 사용 (추측 금지)
    try:
        # NOTE: 가입인사(menu 31)는 개인 글이 대부분이라 정책 근거로 쓰기 위험하다.
        #       공지/가이드 메뉴에서만 근거를 찾는다.
        candidates = _get_recent_posts_filtered(
            [1, 47, 192],
            limit=30,
            keywords_any=["등업", "자동등업", "승인"],
            title_only=True,
        )
        # 정책 근거는 제목에 '등업/승인'이 명시된 공지/안내 글만 사용한다 (개인 글/후기 오염 방지).
        policy_posts = []
        for p in candidates:
            title_l = str(p.get("title") or "").lower()
            if not re.search(r"(등업|승인|자동\\s*등업|자동등업)", title_l):
                continue
            if not re.search(r"(필독|규칙|공지|안내|가이드)", title_l):
                continue
            policy_posts.append(p)
        if policy_posts:
            p = policy_posts[0]
            selected_posts = [p]
            title = str(p.get("title") or "").strip() or f"post {p.get('post_id')}"
            url = str(p.get("url") or "").strip()
            created_at = p.get("created_at")
            if hasattr(created_at, "strftime"):
                date_str = created_at.strftime("%Y-%m-%d")
            else:
                date_str = str(created_at)[:10] if created_at else ""

            lines.append("근거(있을 때만):")
            lines.append(f"- {title}{f' ({date_str})' if date_str else ''}")
            if url:
                lines.append(f"  {url}")
    except Exception as e:
        log.info(f"[membership_policy] skip candidate posts: {e}")

    answer = "\n".join([ln for ln in lines if ln is not None]).strip()
    if not answer:
        answer = "자료 기준으로 확인 불가합니다."
    return answer, selected_posts


def _keyword_boost_filter(query: str, posts: List[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """질문에 특정 키워드가 있으면 해당 키워드 포함 게시글을 우선 반환.

    '다시보기', '링크', '녹화' 등의 키워드가 질문에 있을 때,
    제목/본문에 해당 키워드가 있는 게시글을 상위로 부스팅한다.
    주제 키워드(예: 사알못, 카라반)도 함께 고려하여 둘 다 있는 게시글을 최우선으로 배치.
    매칭되는 게시글이 없으면 원본 리스트를 그대로 반환한다.

    Returns:
        (정렬된 전체 리스트, topic_only 게시글 리스트) - topic_only는 rerank 후 강제 포함용
    """
    boost_keywords = ["다시보기", "링크", "녹화", "보너스", "실습"]
    q_lower = query.lower()

    # 질문에 포함된 부스트 키워드 추출
    matched_keywords = [kw for kw in boost_keywords if kw in q_lower]
    if not matched_keywords:
        return posts, []

    # 주제 키워드 추출 (부스트 키워드와 일반 조사/접속사 제외)
    stopwords = set(boost_keywords + ["디하클", "링크", "알려줘", "있나", "뭐야", "줘", "해줘", "뭐", "좀", "의", "에서", "을", "를", "이", "가", "은", "는"])
    topic_keywords = [w for w in re.split(r'\s+', q_lower) if w and len(w) >= 2 and w not in stopwords]

    boosted_both = []  # 주제 + 부스트 키워드 모두 있음
    topic_only = []    # 주제 키워드만 있음
    boosted_only = []  # 부스트 키워드만 있음
    others = []
    for p in posts:
        text = ((p.get('title') or '') + ' ' + (p.get('norm_text') or '')).lower()
        has_boost = any(kw in text for kw in matched_keywords)
        has_topic = any(tk in text for tk in topic_keywords) if topic_keywords else True
        if has_boost and has_topic:
            boosted_both.append(p)
        elif has_topic and topic_keywords:
            topic_only.append(p)
        elif has_boost:
            boosted_only.append(p)
        else:
            others.append(p)

    # 주제+부스트 > 주제만 > 부스트만 > 나머지 순서로 반환
    # 주제가 가장 중요: 사용자가 "사알못 다시보기"를 물으면 사알못 관련 글이 우선
    if boosted_both:
        log.info(f"[keyword_boost] topics={topic_keywords}, keywords={matched_keywords}, boosted_both={len(boosted_both)}")
        return boosted_both + topic_only + boosted_only + others, topic_only
    if topic_only:
        log.info(f"[keyword_boost] topics={topic_keywords}, keywords={matched_keywords}, topic_only={len(topic_only)} (no boost match)")
        return topic_only + boosted_only + others, topic_only
    if boosted_only:
        log.info(f"[keyword_boost] topics={topic_keywords}, keywords={matched_keywords}, boosted_only={len(boosted_only)}")
        return boosted_only + others, []
    return posts, []


def _has_query_keyword_overlap(query: str, posts: List[Dict[str, Any]]) -> bool:
    """질문 토큰과 게시글(제목+본문) 사이에 유의미한 부분 문자열 겹침이 있는지 확인한다.

    - 토큰: 공백 기준으로 나눈 뒤, 길이 2자 이상인 한글/영문/숫자 시퀀스만 사용
    - 하나라도 겹치면 True, 전혀 없으면 False
    """
    if not posts:
        return False
    q = query.lower()
    raw_tokens = [t for t in re.split(r"\s+", q) if len(t) >= 2]
    # 너무 일반적인 표현은 제외 (질문형/동사/추상어 등)
    stopwords = {
        "알려줘",
        "알려주",
        "알려",
        "만드는",
        "만들기",
        "하는",
        "방법",
        "정보",
        "있나",
        "있어",
        "있니",
        "해줘",
        "해주세요",
        "주세요",
        "최근",
        "최신",
        "관련",
    }
    tokens = [t for t in raw_tokens if t not in stopwords]
    if not tokens:
        return True  # 토큰이 없으면 판정 보류 → KB 후보가 있으면 그대로 사용
    for p in posts:
        text = ((p.get("title") or "") + " " + (p.get("norm_text") or "")).lower()
        if any(tok in text for tok in tokens):
            return True
    return False


def _has_manual_keyword_overlap(query: str, manuals: List[Dict[str, Any]]) -> bool:
    """질문 토큰과 매뉴얼(제목+요약/본문) 사이에 부분 문자열 겹침이 있는지 확인한다."""
    if not manuals:
        return False
    q = query.lower()
    raw_tokens = [t for t in re.split(r"\s+", q) if len(t) >= 2]
    stopwords = {
        "알려줘",
        "알려주",
        "알려",
        "만드는",
        "만들기",
        "하는",
        "방법",
        "정보",
        "있나",
        "있어",
        "있니",
        "해줘",
        "해주세요",
        "주세요",
        "최근",
        "최신",
        "관련",
    }
    tokens = [t for t in raw_tokens if t not in stopwords]
    if not tokens:
        return True
    for m in manuals:
        text = (
            (m.get("title") or "")
            + " "
            + (m.get("summary") or "")
            + " "
            + (m.get("body_md") or "")
        ).lower()
        if any(tok in text for tok in tokens):
            return True
    return False


# 디하클/강의/사알못 도메인과 직접 관련된 질의인지 여부 판정용 키워드
# - node-iris 쪽에서 들어오는 '?디하클 ...' 질의는 askKb.ts에서 context_tags를 붙여주므로
#   여기 키워드는 /ask_llm 직접 호출(테스트/툴) 시에만 주로 사용된다.
DOMAIN_KEYWORDS = [
    "디하클",
    "디지털 하이클래스",
    "오픈채팅",
    "공지",
    "공지사항",
    "이벤트",
    "필독",
    "닉네임",
    "채널톡",
    "현금영수증",
    "세금계산서",
    "등업",
    "가입인사",
    "가입 인사",
    "재수강",
    "재등록",
    "강의",
    "특강",
    "무료특강",
    "무료 강의",
    "정규강의",
    "정규 강의",
    "무강",
    "다시보기",
    "녹화",
    "강좌",
    "수업",
    "클래스",
    "사알못",
    "사주",
    "사주 자동화",
    "일반반",
    "비지니스반",
    "비즈니스반",
    "포인트",
    "포인트 적립",
    "수강생",
    "수강생 인터뷰",
    "인터뷰",
    "하이라이트",
    "꿀팁",
    "운영자의 꿀팁",
    "회원의 꿀팁",
    "수익 인증",
    "수익인증",
    "수강 신청",
    "자유게시판",
    "성장 일기",
    "성장일기",
    "이용 가이드",
    "이용가이드",
]


def _strip_dihacl_prefix(query: str) -> str:
    """'?디하클 ...' 같은 봇/명령 접두어를 제거한 질의 본문을 반환한다.

    - node-iris 쪽에서 이미 제거된 상태로 들어오는 경우도 많지만,
      /ask_llm 직접 호출(툴/테스트)에서 접두어가 포함될 수 있어 방어적으로 처리한다.
    """
    if not query:
        return ""
    q = str(query).strip()
    # 1) '?디하클' 형태 (대소문자/공백 변형 허용)
    q = re.sub(r"^\s*\?\s*디하클\s*", "", q, flags=re.IGNORECASE)
    # 2) '디하클'로 시작하는 경우 (명령어처럼 쓰인 케이스)
    q = re.sub(r"^\s*디하클\s*", "", q, flags=re.IGNORECASE)
    return q.strip()


def _is_platform_usage_query(query: str) -> bool:
    """플랫폼(네이버/카카오톡/오픈채팅 등) 사용법 질문을 휴리스틱으로 감지한다.

    목적:
    - 카페 SSOT(게시글/매뉴얼)와 무관한 '앱 사용법' 질문은 RAG로는 답할 근거가 없어서,
      일반 상식(웹 검색) 경로로 보내기 위함.
    - 단, 강의/등업/포인트처럼 카페 정책/강의와 직접 연관된 질문은 제외한다.
    """
    q = (query or "").strip().lower()
    if not q:
        return False

    # 플랫폼/환경 힌트
    platform_hints = [
        "네이버",
        "naver",
        "카카오톡",
        "kakao",
        "오픈채팅",
        "openchat",
        "open chat",
        "유튜브",
        "youtube",
        "스레드",
        "쓰레드",
        "threads",
        "윈도우",
        "windows",
        "안드로이드",
        "android",
        "ios",
        "아이폰",
        "iphone",
    ]
    # 사용법/문제 해결 힌트
    usage_hints = [
        "설정",
        "방법",
        "어떻게",
        "알림",
        "검색",
        "복사",
        "링크",
        "url",
        "공유",
        "다운로드",
        "업로드",
        "하루",
        "많이",
        "몇",
        "제한",
        "상관",
        "스팸",
        "정지",
        "차단",
        "제재",
        "끄",
        "켜",
        "해제",
        "안됨",
        "안 돼",
        "안돼",
        "오류",
        "에러",
        "문제",
    ]
    # 강한 도메인 힌트(이 단어가 있으면 플랫폼 사용법으로 보지 않는다)
    strong_domain_hints = [
        "사알못",
        "강의",
        "특강",
        "정규강의",
        "정규 강의",
        "무료특강",
        "무료 특강",
        "포인트",
        "등업",
        "수강",
        "sajulab",
        "사주랩",
        "사주",
    ]
    if any(h.lower() in q for h in strong_domain_hints):
        return False

    return any(h in q for h in platform_hints) and any(h in q for h in usage_hints)


def _is_domain_query(query: str) -> bool:
    q = query.lower()
    return any(kw in q for kw in DOMAIN_KEYWORDS)


def _is_general_knowledge_query(query: str) -> bool:
    """카페 SSOT와 무관한 일반 상식 질문을 휴리스틱으로 감지한다.

    NOTE:
    - context_tags가 붙어 들어와도, '유튜브 수익창출 기준'처럼 카페 자료로 답하면
      부정확/혼동(임의 링크/정책 추측) 위험이 큰 질문은 일반 상식 경로로 보낸다.
    - 이 함수는 너무 넓게 잡지 않는다(오탐 방지).
    """
    q = (query or "").strip().lower()
    if not q:
        return False

    # 유튜브 수익창출/YPP 기준·조건 등은 일반 정책이므로 일반 상식(웹 검색) 경로가 더 안전하다.
    if re.search(r"(유튜브|youtube).*(수익창출|수익\s*창출|\bypp\b|파트너\s*프로그램|monetization|youtube\s+partner\s+program)", q):
        if re.search(r"(기준|조건|요건|충족|가능|되려면|하려면)", q):
            return True

    # 파이썬 가상환경/venv 생성 같은 일반 개발 질문
    if re.search(r"\bvenv\b|가상\s*환경|virtualenv", q):
        return True

    # 리눅스/네트워크 명령어 일반 질문 (예: hostname -I)
    if re.search(r"\bhostname\s+-i\b", q) or re.search(r"\bip\s+addr\b|\bip\s+route\b|\bifconfig\b", q):
        return True

    # 연예/뉴스성 질문(열애설/단독/속보 등)은 카페 SSOT와 무관하므로 일반 상식(웹 검색) 경로로 보낸다.
    # - 단, 디하클 도메인 힌트가 함께 있으면 오탐이 될 수 있어 여기서는 "열애설" 등 강한 표지어 위주로만 잡는다.
    if re.search(r"(열애설|결별설|결혼설|스캔들|루머|단독|속보)", q):
        return True

    # Threads(스레드/쓰레드) 업로드 빈도/제한/제재 같은 '외부 플랫폼 정책' 질문은 카페 SSOT로 답할 근거가 없으므로 일반 상식(웹 검색) 경로로 보낸다.
    if re.search(r"(스레드|쓰레드|threads)", q) and re.search(r"(하루|몇|많이|제한|상관|스팸|정지|차단|제재|limit|spam|ban)", q):
        return True

    return False


def _extract_entity_keywords(query: str) -> list[str]:
    """질문에서 '고유명/주제 키워드' 후보를 추출한다.

    - 임베딩 검색이 약한 고유명(닉네임/툴명/브랜드명) 질문에서
      키워드 포함(제목/본문) 필터 및 DB 키워드 검색 폴백에 사용한다.
    """
    q = (query or "").strip()
    if not q:
        return []

    # 0) SSOT 엔티티(인물/고유명) 우선 매칭:
    # - "마케터 제이"처럼 공백으로 분리되어도, config/entities_dinohighclass.json의
    #   name/aliases를 기준으로 먼저 인식해 primary_entity가 흔들리지 않게 한다.
    q_lower = q.lower()
    q_nospace = re.sub(r"\s+", "", q_lower)
    known_entities: list[tuple[int, int, str]] = []  # (pos, -len, canonical_name)
    try:
        for e in _load_entity_overrides():
            canonical = str(e.get("name") or "").strip()
            if not canonical:
                continue
            terms = [canonical] + [str(a or "").strip() for a in (e.get("aliases") or []) if str(a or "").strip()]
            best_pos: int | None = None
            best_len = 0
            for t in terms:
                tl = t.lower()
                if tl and tl in q_lower:
                    pos = q_lower.find(tl)
                    if best_pos is None or pos < best_pos or (pos == best_pos and len(tl) > best_len):
                        best_pos = pos
                        best_len = len(tl)
                    continue
                tns = re.sub(r"\s+", "", tl)
                if tns and tns in q_nospace:
                    pos = q_nospace.find(tns)
                    if best_pos is None or pos < best_pos or (pos == best_pos and len(tl) > best_len):
                        best_pos = pos
                        best_len = len(tl)
            if best_pos is not None:
                known_entities.append((int(best_pos), -int(best_len), canonical))
    except Exception:
        # 엔티티 SSOT 로딩 실패 시에도, 아래 일반 토큰 추출 로직으로 계속 진행한다.
        known_entities = []

    raw_tokens = re.findall(r"[A-Za-z0-9가-힣]{2,}", q)
    if not raw_tokens:
        # 그래도 known_entities가 있다면 반환
        if known_entities:
            out_known: list[str] = []
            seen_known: set[str] = set()
            for _, _, name in sorted(known_entities, key=lambda x: (x[0], x[1])):
                k = name.lower()
                if k in seen_known:
                    continue
                seen_known.add(k)
                out_known.append(name)
            return out_known[:6]
        return []

    def _strip_particle(tok: str) -> str:
        # 흔한 조사/어미(1~2자)만 보수적으로 제거 (오탐 방지)
        if not tok or len(tok) < 3:
            return tok
        # NOTE:
        # - '...이가'는 대부분 '...이' + '가' 형태(예: '고양이가', '마케터제이가')로,
        #   '이가'를 통째로 제거하면 고유명 끝 글자('이')가 잘려 오탐이 발생한다.
        # - 주격 조사로는 '가'만 제거하고, '이'는 고유명/명사 끝글자와 충돌이 잦아 여기서는 제거하지 않는다.
        return re.sub(r"(가|은|는|을|를|의|과|와|도|만|에|에서|으로|로|야|요|이랑|랑)$", "", tok)

    stop = {
        # 질문형/기능어
        "누구",
        "누구야",
        "뭐",
        "뭐야",
        "무엇",
        "어떤",
        "왜",
        "어디",
        "어떻게",
        "방법",
        "알려줘",
        "알려주",
        "설명",
        "설명해줘",
        "정리",
        "정리해줘",
        "좀",
        "대해",
        "대해서",
        "관련",
        # 게시판/링크류
        "게시판",
        "공지",
        "공지사항",
        "링크",
        "url",
        "최근",
        "최신",
        "가장",
        "있어",
        "있나",
        "있나요",
        "있어?",
        "있나?",
        # 강의/카페 일반어
        "디하클",
        "강의",
        "특강",
        "무료특강",
        "정규강의",
        "정규",
        "무료",
        "후기",
        "신청",
        "일정",
        # 가격/조건 일반어
        "얼마",
        "얼마야",
        "가격",
        "수강료",
        "비용",
        "유료",
        "무료",
        "기준",
        "조건",
        "요건",
        "무이자",
        "개월",
        "12개월",
        "월",
        "월얼마",
        "하면",
        # 외부 플랫폼 키워드(질문에 섞여도 고유명 추출에서 제외)
        "인스타",
        "인스타그램",
        "instagram",
        "스레드",
        "threads",
        "버전",
        "프로",
        "pro",
        # 반/과정 일반어 (고유명 추출 오탐 방지)
        "일반반",
        "일반",
        "비지니스반",
        "비즈니스반",
        "비지니스",
        "비즈니스",
    }

    out: list[str] = []
    # known_entities를 먼저 앞에 붙인다 (primary_entity 안정화)
    if known_entities:
        seen_known: set[str] = set()
        for _, _, name in sorted(known_entities, key=lambda x: (x[0], x[1])):
            k = name.lower()
            if k in seen_known:
                continue
            seen_known.add(k)
            out.append(name)
    # out에 이미 담긴 known_entities와 중복 토큰이 추가되지 않도록 seen을 초기화한다.
    seen: set[str] = set([str(x).lower() for x in out if x])
    for tok in raw_tokens:
        t = _strip_particle(tok.strip())
        if not t:
            continue
        t_lower = t.lower()
        if t_lower in seen:
            continue
        if t in stop or t_lower in stop:
            continue
        # 숫자만으로 된 토큰은 제외
        if re.fullmatch(r"\d{2,}", t):
            continue
        seen.add(t_lower)
        out.append(t)

    return out[:6]


def _is_person_intro_query(query: str) -> bool:
    q = (query or "").strip().lower()
    if not q:
        return False
    return bool(
        re.search(
            r"(누구야|누구임|누구\b|정체|뭐하는\s*사람|어떤\s*사람|소개(해|해줘)?|프로필)",
            q,
        )
    )


def _is_entity_lecture_intro_query(query: str) -> bool:
    """'OO(강사)가 어떤 강의/수업을 하냐' 류를 보수적으로 감지한다.

    - entity_keywords가 함께 있을 때만 사용하도록 설계(오탐 방지).
    - LLM 호출 없이, 신청 게시판(무료특강/정규강의)에서 해당 고유명이 포함된 글을 우선 제시한다.
    """
    q = (query or "").strip().lower()
    if not q:
        return False
    # 예: "룰루랄라릴리는 어떤 강의 해?", "마케터제이 어떤 강의 했어?"
    return bool(re.search(r"(어떤|무슨|어느)\s*(강의|수업)|강의\s*(뭐|어떤|무슨|하는|했어)", q))


def _is_entity_soft_intro_query(query: str, entity_override: dict[str, Any] | None) -> bool:
    """'OO 말이야', 'OO 알아?'처럼 소개 의도는 있지만 패턴이 약한 질의를 감지한다.

    - entity_override(SSOT 엔티티)에서만 동작하도록 제한해 오탐을 줄인다.
    - 이 경로는 LLM 환각을 피하기 위한 결정적(entity_intro) 응답으로 연결된다.
    """
    if not entity_override:
        return False
    q = (query or "").strip().lower()
    if not q:
        return False

    # 명시적 소개 의도 표지어
    if re.search(r"(말이야|알아\??$|아냐\??$|맞아\??$|누군지|정체|뭐하는\s*사람|어떤\s*사람|소개|프로필)", q):
        return True

    # 엔티티 이름/별칭을 제거했을 때 남는 텍스트가 매우 짧으면(조사/감탄사 수준) 소개로 취급
    q_flat = re.sub(r"\s+", "", q)
    remain = q_flat
    terms = [entity_override.get("name")] + list(entity_override.get("aliases") or [])
    for t in terms:
        t_flat = re.sub(r"\s+", "", str(t or "").strip().lower())
        if not t_flat:
            continue
        remain = remain.replace(t_flat, "")
    remain = re.sub(r"[\?\!\.\,~…'\"\\-_/\\(\\)\\[\\]{}:;]+", "", remain).strip()

    return len(remain) <= 4


def _is_bot_memory_meta_query(query: str) -> bool:
    """'왜 기억 못해/왜 까먹어' 류의 메타 질문을 감지한다."""
    q = (query or "").strip().lower()
    if not q:
        return False
    if not re.search(r"(기억|까먹|잊|remember|리멤버)", q):
        return False
    # 원인/반복 불만 표지어(최소 1개)
    return bool(re.search(r"(왜|자꾸|매번|또|계속|못\s*해|안\s*해|안됨|못함)", q))


def _build_entity_intro_answer(
    query: str,
    entity_keywords: list[str],
    posts: list[dict[str, Any]],
    is_external_link_q: bool,
) -> tuple[str, list[dict[str, Any]]]:
    primary = (entity_keywords[0] if entity_keywords else "").strip()
    primary_lower = primary.lower()

    override = _match_entity_override(primary) if primary else None
    display_name = str((override or {}).get("name") or primary).strip() or primary or "대상"
    role = str((override or {}).get("role") or "").strip() or None

    # 매칭 키워드(표기 흔들림/별칭 포함)
    match_terms: list[str] = []
    if primary:
        match_terms.append(primary_lower)
    if override:
        oname = str(override.get("name") or "").strip()
        if oname:
            match_terms.append(oname.lower())
        for a in (override.get("aliases") or []):
            a2 = str(a or "").strip()
            if a2:
                match_terms.append(a2.lower())
    match_terms = list(dict.fromkeys([t for t in match_terms if t]))

    lines: list[str] = []
    if role:
        lines.append(f"{display_name}는 {role}입니다.")
    else:
        lines.append(f"'{display_name}' 관련 카페 글을 기준으로 정리합니다.")

    if is_external_link_q:
        lines.append("요청한 외부 플랫폼 링크(URL)는 카페 자료에 포함되어 있지 않아 제공할 수 없습니다.")

    matched: list[dict[str, Any]] = []
    for p in posts or []:
        t = ((p.get("title") or "") + " " + (p.get("norm_text") or "")).lower()
        if match_terms and any(k in t for k in match_terms):
            matched.append(p)
    if not matched:
        matched = list(posts or [])

    def _ts(p: dict[str, Any]):
        v = p.get("created_at")
        if isinstance(v, _dt.datetime):
            return v
        return _dt.datetime.min

    def _score(p: dict[str, Any]) -> int:
        title = str(p.get("title") or "").lower()
        body = str(p.get("norm_text") or "").lower()
        body_head = body[:600]
        score = 0
        for k in match_terms:
            if not k:
                continue
            if k in title:
                score += 3
            if k in body_head:
                score += 1
        # 역할 힌트가 본문/제목에 있는 글을 조금 더 선호
        if role:
            r = role.lower()
            if ("운영자" in r) or ("대표" in r):
                if ("운영자" in title) or ("대표" in title):
                    score += 1
                if ("운영자" in body_head) or ("대표" in body_head):
                    score += 1
            if "강사" in r:
                if "강사" in title:
                    score += 1
                if "강사" in body_head:
                    score += 1
        return score

    selected = sorted(matched, key=lambda p: (_score(p), _ts(p)), reverse=True)[:3]
    if selected:
        lines.append("")
        lines.append("근거(카페 글):")
        lines.append(_format_posts_as_list(selected))

    return "\n".join([ln for ln in lines if ln is not None]).strip(), selected


def _build_prompt(query: str, manuals: List[Dict[str, Any]], posts: List[Dict[str, Any]]) -> str:
    lines = [
        "너는 디하클(디지털 하이클래스) 카페 운영/강의 정보를 알려주는 조력자야.",
        "아래 자료는 내부 카페 글과 매뉴얼 요약이다. 출처 번호나 괄호를 표시하지 말고, 한국어로 간결하게 답해.",
        "자료가 부족하면 모른다고 답하고 추측하지 마.",
        f"질문: {query}",
        "--- 자료 ---",
    ]
    idx = 1
    for m in manuals:
        lines.append(f"{idx}) [매뉴얼] {m.get('title','(제목없음)')}")
        # 가격/포인트·정책처럼 숫자 정보가 많은 매뉴얼의 경우,
        # 질문에 나온 키워드 주변을 중심으로 발췌해 LLM이 실제 숫자 정보를 놓치지 않도록 한다.
        lines.append(_manual_preview_for_query(query, m, 1200))
        idx += 1
    for p in posts:
        title = p.get("title") or "(제목없음)"
        url = p.get("url") or ""
        lines.append(f"{idx}) [게시글] {title}{' ' + url if url else ''}")
        lines.append(_shorten(p.get("norm_text") or "", 700))
        idx += 1

    price_question = _is_price_or_point_question(query)
    if price_question:
        price_snippets = _collect_price_point_snippets(manuals)
        if price_snippets:
            lines.extend(
                [
                    "",
                    "=== 가격·포인트 관련 발췌 (숫자는 그대로 사용하라) ===",
                    "아래 문장들은 강의 가격/수강료/포인트/무이자/얼리버드 정책을 그대로 옮긴 것이다.",
                    "답변을 작성할 때 이 문장들에 있는 숫자(예: 177만 원, 255만 원, 50만/100만 포인트, 30만 포인트 추가 등)를 그대로 사용해라.",
                ]
            )
            lines.extend(f"- {s}" for s in price_snippets)
    lines.extend([
        "--- 답변 지침 ---",
        "1) 머리말/헤더 없이 질문에 바로 답한다.",
        "2) 한국어로 3~8문장 또는 불릿 3~6개 이내로 간결하게 정리한다.",
        "3) 질문이 여러 요구를 포함하면, 자료로 답할 수 있는 부분과 '자료 기준으로 확인 불가'한 부분을 구분해서 답한다.",
        "4) 제공된 자료(매뉴얼/게시글)에 있는 내용만 사용한다. 자료에 없는 사실/수치/해석은 절대 추측하지 말고 '자료 기준으로 확인 불가'라고 명시한다.",
        "5) 날짜·가격·포인트 등 숫자는 자료의 값을 그대로 사용한다. 차이를 묻는 질문이면 (비지니스반-일반반)처럼 명시적으로 계산한 값만 추가한다.",
        "6) URL은 자료에 포함된 것만 사용하고, 없으면 링크를 출력하지 않는다.",
        "7) 같은 URL을 반복 출력하지 않는다.",
        "8) 안내/사용법/추가 질문 유도/광고 문구는 금지한다.",
        "",
        "출력 형식 예시(형식만 참고, 내용은 질문에 맞게):",
        "- 핵심 답변 1~3줄",
        "- 필요한 경우 추가 설명 불릿",
        "근거(있을 때만):",
        "- {제목} {URL}",
    ])
    return "\n".join(lines)


GENERAL_PREFIX = "가이드라인에는 없지만, 일반 상식으로 답변드립니다."


def _build_general_answer(query: str, model_override: str | None = None) -> tuple[str, str, dict[str, Any]]:
    """카페 자료가 전혀 없을 때 일반 상식 기반 답변을 생성한다.

    - 첫 문장은 항상 '가이드라인에는 없지만, 일반 상식으로 답변드립니다.' 로 시작
    - 카페 내부 자료/강의명/다시보기 링크처럼 보이게 꾸미지 않는다.
    - 외부 사이트 URL을 포함하지 않는다.
    """
    model = model_override or os.getenv("KB_GENERAL_MODEL") or os.getenv("KB_LLM_MODEL") or "gpt-4.1-mini"
    today_iso = _dt.date.today().isoformat()
    q_lower = (query or "").strip().lower()
    is_rumor_news = bool(re.search(r"(열애설|결별설|결혼설|스캔들|루머|단독|속보)", q_lower))
    is_youtube_monetization = bool(
        re.search(
            r"(유튜브|youtube).*(수익창출|수익\s*창출|\bypp\b|파트너\s*프로그램|monetization|youtube\s+partner\s+program)",
            q_lower,
        )
    )
    is_threads_policy = bool(re.search(r"(스레드|쓰레드|threads)", q_lower)) and bool(
        re.search(r"(하루|몇|많이|제한|상관|스팸|정지|차단|제재|limit|spam|ban)", q_lower)
    )

    lines = [
        "너는 디하클 카페 운영자를 돕는 조력자지만, 지금 질문은 카페 지식베이스와 직접 관련된 자료가 없다.",
        "그렇더라도 일반 상식과 공개적으로 잘 알려진 정보를 바탕으로 성의 있게 답변해라.",
        "반드시 웹 검색 도구를 사용해 최신/정확한 정보를 확인한 뒤 답해라.",
        "특히 '뉴스/루머/열애설/속보/단독'처럼 시점에 민감한 질문은, 웹 검색으로 확인된 사실만 말하고 추측/단정은 금지한다.",
        "",
        "규칙:",
        "1) 반드시 첫 문장은 정확히 다음 문장으로 시작한다:",
        "   '가이드라인에는 없지만, 일반 상식으로 답변드립니다.'",
        "2) 질문이 외부 플랫폼 정책/일반 상식이면, 디하클 카페 정책/운영 규정처럼 답하지 말 것(주어를 플랫폼으로 둔다).",
        "3) 디하클 카페 내부 자료나 특정 강의/다시보기 링크가 있는 것처럼 꾸미지 말 것.",
        "4) 외부 웹사이트 URL(https:// 등)은 어떤 것도 넣지 말 것.",
        "5) 한국어로 3~6문장 정도로, 질문자가 이해하기 쉽게 설명할 것.",
        "6) 출력 형식(반드시 지킬 것):",
        "   - 1줄: '가이드라인에는 없지만, 일반 상식으로 답변드립니다.'",
        "   - 2~5줄: 핵심 답변(문장 또는 불릿)",
        "   - 1줄: '근거: (출처명 YYYY-MM-DD), (출처명 YYYY-MM-DD)' (URL 금지)",
        f"7) 답변의 마지막 줄에 반드시 다음 문장을 그대로 포함해라: '(검색 기준일: {today_iso})'",
        "8) 모르는 부분은 솔직하게 모른다고 말하고, 추측은 '추측입니다'라고 명시할 것.",
    ]

    # 뉴스/루머성 질문은 오정보/명예훼손 위험이 크므로 규칙을 더 강하게 건다.
    if is_rumor_news:
        lines.extend(
            [
                "",
                "추가 규칙(뉴스/루머/열애설):",
                "- 상대방 이름/세부 내용은 당사자/소속사의 공식 발표(또는 공식 입장을 인용한 주요 언론 보도)에서 명시된 경우에만 1회 언급할 것. 공식 확인이 없으면 언급 금지.",
                "- '교제 중/결혼 전제/확정' 같은 단정 표현 금지. 항상 '일부 보도/루머'로 표현할 것.",
                "- 당사자/소속사 공식 발표가 확인되지 않으면 '공식 확인된 사실 없음'으로만 답할 것.",
                f"- 웹 검색은 '{query} 공식 입장' 또는 '{query} 소속사 입장' 키워드도 함께 확인해 최신 발표 여부를 점검할 것.",
                "- 인물/브랜드 동명이인 가능성이 있으면 한글/영문 표기(예: Tiffany Young)도 함께 검색해라.",
                "- 웹 검색은 한국어 키워드와 영문 키워드를 각각 최소 1회씩 수행해라(총 2회).",
                "",
                "출력 형식(반드시):",
                "1) 첫 줄: '가이드라인에는 없지만, 일반 상식으로 답변드립니다.'",
                "2) 다음 줄: '공식 입장 요약: {인정/부인/확인 중/공식 확인된 사실 없음}' 중 하나로만 작성",
                "3) 다음 줄: '근거: (출처명 YYYY-MM-DD) 1~2개' (URL 금지)",
                "4) 마지막 줄: '(검색 기준일: YYYY-MM-DD)'",
                f"5) 근거로 쓰는 날짜는 가능하면 최근 30일 이내만 선택하고, 최근 30일 내 근거를 못 찾으면 '최근 30일 내 공식 발표/공식 입장 근거를 찾지 못했다'고 말할 것.",
            ]
        )

    # 유튜브 수익창출(YPP) 기준은 단계(팬 펀딩/광고 수익/쇼츠)에 따라 조건이 달라 자주 오답이 나므로,
    # 웹 검색 결과를 기준으로 "트랙별"로 나눠 설명하도록 강제한다.
    if is_youtube_monetization and not is_rumor_news:
        lines.extend(
            [
                "",
                "추가 규칙(유튜브 수익창출/YPP):",
                "- '광고 수익(전체 YPP)'과 '팬 펀딩(슈퍼챗/멤버십 등)'의 조건이 다를 수 있으니, 최신 공식 정책을 기준으로 트랙별로 구분해 설명한다.",
                "- '쇼츠(Shorts) 조회수 기준'이 있는지 반드시 함께 확인하고, 있으면 숫자/기간을 포함해 같이 제시한다.",
                "- 숫자(구독자/시청시간/조회수/기간)는 웹 검색으로 확인된 값만 사용한다.",
                "- 웹 검색 쿼리에는 가능하면 'site:support.google.com' 또는 'site:youtube.com'을 포함해 공식 도움말이 상단에 오게 한다.",
                "- 블로그/커뮤니티/카페 글은 근거로 쓰지 않는다.",
            ]
        )

    # Threads 업로드/제재 같은 정책 질문은 "게시판 쓰레드"가 아니라 Meta의 소셜앱 Threads로 해석해야 한다.
    if is_threads_policy and not is_rumor_news:
        lines.extend(
            [
                "",
                "추가 규칙(Threads/스레드 정책):",
                "- 여기서 '스레드/쓰레드/Threads'는 메타(Meta)의 소셜 앱 Threads를 의미한다(게시판의 thread로 해석 금지).",
                "- 공식적으로 '하루 N개' 같은 숫자 제한을 공개하지 않는 경우가 많다. 숫자 제한이 없다고 단정하지 말고, 공식 문서에 숫자가 없으면 '공식 문서에서 구체적인 숫자 제한을 찾지 못했다'고 말한다.",
                "- 근거는 Meta/Instagram 공식 도움말/정책 문서(예: help.instagram.com, help.meta.com, about.meta.com) 우선으로 잡고, 커뮤니티/블로그는 근거로 쓰지 않는다.",
            ]
        )

    lines.extend(
        [
        "",
        f"질문: {query}",
        ]
    )
    prompt = "\n".join(lines)

    use_web = str(os.getenv("KB_GENERAL_WEB_SEARCH", "1")).strip().lower() not in {"0", "false", "no", "off"}
    tools: Optional[list[dict[str, Any]]] = None
    if use_web:
        tool: dict[str, Any] = {"type": "web_search_preview", "search_context_size": "medium"}
        # NOTE: web_search tool의 도메인 필터는 환경/버전마다 지원이 달라 400을 유발할 수 있어,
        # 여기서는 web_search_preview만 사용하고(도구 실패 시 자동 폴백),
        # 프롬프트에서 "공식 안내 우선"을 강하게 요구한다.
        tools = [tool]

    diag: dict[str, Any] = {
        "web_search_required": bool(use_web),
        "web_search_used": False,
        "web_search_calls": 0,
        "web_search_results_preview": [],
        "web_search_error": "",
    }

    def _has_recent_evidence(text: str) -> bool:
        def _dates_from_blob(blob: str) -> list[_dt.date]:
            dates: list[_dt.date] = []
            # YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD
            for m in re.finditer(r"(20\d{2})[-./](\d{1,2})[-./](\d{1,2})", blob or ""):
                try:
                    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
                    dates.append(_dt.date(y, mo, d))
                except Exception:
                    continue
            # YYYY년 M월 D일
            for m in re.finditer(r"(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일", blob or ""):
                try:
                    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
                    dates.append(_dt.date(y, mo, d))
                except Exception:
                    continue
            return dates

        try:
            today = _dt.date.fromisoformat(today_iso)
            for m in re.finditer(r"\((?!검색 기준일:)[^)]*\)", text or ""):
                blob = m.group(0)
                for d in _dates_from_blob(blob):
                    if 0 <= (today - d).days <= 30:
                        return True
            # '근거:' 라인에 괄호가 없더라도 날짜가 있으면 인정한다.
            for line in (text or "").splitlines():
                if str(line).strip().startswith("근거:"):
                    for d in _dates_from_blob(line):
                        if 0 <= (today - d).days <= 30:
                            return True
        except Exception:
            return False
        return False

    def _merge_tool_diag(tool_diag: dict[str, Any]) -> None:
        if not isinstance(tool_diag, dict):
            return
        if "web_search_used" in tool_diag:
            diag["web_search_used"] = bool(diag.get("web_search_used")) or bool(tool_diag.get("web_search_used"))
        if "web_search_calls" in tool_diag:
            diag["web_search_calls"] = int(diag.get("web_search_calls") or 0) + int(tool_diag.get("web_search_calls") or 0)
        prev = tool_diag.get("web_search_results_preview")
        if isinstance(prev, list) and prev:
            target = diag.setdefault("web_search_results_preview", [])
            existing = {(str(p.get("source") or ""), str(p.get("published_date") or ""), str(p.get("title") or "")) for p in diag.get("web_search_results_preview") or [] if isinstance(p, dict)}
            for p in prev:
                if not isinstance(p, dict):
                    continue
                key = (str(p.get("source") or ""), str(p.get("published_date") or ""), str(p.get("title") or ""))
                if key in existing:
                    continue
                existing.add(key)
                target.append(p)

    try:
        if tools:
            max_out = 240 if is_rumor_news else 600
            if is_rumor_news:
                # 루머/뉴스성 질문은 "최신" + "동명이인(영문 표기)" 이슈가 잦아 2회로 나눠 확인한다.
                a0, td0 = _openai_generate_text_with_tool_diag(
                    prompt,
                    model=model,
                    temperature=0.0,
                    max_output_tokens=max_out,
                    tools=tools,
                    tool_choice={"type": "web_search_preview"},
                    max_tool_calls=1,
                    include=["web_search_call.action.sources"],
                )
                _merge_tool_diag(td0)

                # 1차 답변에 최근 근거가 있으면 그대로 사용
                if _has_recent_evidence(a0):
                    answer = a0
                else:
                    # 2차: 웹 검색용 영문 키워드를 먼저 생성한 뒤(상대방 이름 추가 금지),
                    # 그 키워드로 다시 검색해 최신 근거를 찾는다.
                    kw_prompt = "\n".join(
                        [
                            "너는 웹 검색 키워드 생성기다.",
                            "입력된 한국어 질문에서 핵심 인물/브랜드의 영문 표기(가능하면 고유명)를 추정해,",
                            "뉴스/루머 질문에 적합한 영문 검색 쿼리 1개를 만들어라.",
                            "- 가능하면 풀네임/활동명까지 포함해라(예: Tiffany Young).",
                            "",
                            "규칙:",
                            "- 상대방/제3자 이름은 절대 추가하지 말 것.",
                            "- 반드시 'official statement' 또는 'agency statement'를 포함할 것.",
                            "- URL/특수문자/따옴표 없이 영어로만 한 줄 출력.",
                            "",
                            f"입력: {query}",
                        ]
                    )
                    kw = _openai_generate_text(kw_prompt, model=model, temperature=0.0, max_output_tokens=48).strip()
                    kw = re.sub(r"[^A-Za-z0-9\\s\\-\\.,]", " ", kw)
                    kw = re.sub(r"\\s+", " ", kw).strip()[:120]
                    kw = re.sub(r"[-_,\\.]{2,}", " ", kw)
                    kw = kw.strip(" -_,.")
                    if not kw:
                        kw = "Translate the name to English and search: dating rumor official statement"
                    diag["rumor_kw"] = kw

                    # NOTE: web_search_preview는 프롬프트 언어의 영향을 크게 받는다.
                    # 영문 키워드로 최신 뉴스를 찾기 위해 2차 시도는 '영문 중심' 프롬프트로 별도 호출한다.
                    prompt_eng = "\n".join(
                        [
                            "Use web search to check the latest official statement about a dating rumor.",
                            f"Web search query (English, use this exact query): {kw}",
                            "",
                            "Now answer in Korean using this exact 4-line format (no extra lines, no URLs):",
                            f"{GENERAL_PREFIX}",
                            "공식 입장 요약: 인정/부인/확인 중/공식 확인된 사실 없음 중 하나",
                            "근거: (출처명 YYYY-MM-DD) 1~2개",
                            f"(검색 기준일: {today_iso})",
                        ]
                    )
                    a1, td1 = _openai_generate_text_with_tool_diag(
                        prompt_eng,
                        model=model,
                        temperature=0.0,
                        max_output_tokens=max_out,
                        tools=tools,
                        tool_choice={"type": "web_search_preview"},
                        max_tool_calls=1,
                        include=["web_search_call.action.sources"],
                    )
                    _merge_tool_diag(td1)
                    use_a1 = _has_recent_evidence(a1)
                    diag["rumor_selected"] = "eng" if use_a1 else "kor"
                    answer = a1 if use_a1 else a0
            else:
                answer, tool_diag = _openai_generate_text_with_tool_diag(
                    prompt,
                    model=model,
                    temperature=0.3,
                    max_output_tokens=max_out,
                    tools=tools,
                    tool_choice={"type": "web_search_preview"},
                    max_tool_calls=2,
                    include=["web_search_call.action.sources"],
                )
                _merge_tool_diag(tool_diag)
            if use_web and not diag.get("web_search_used"):
                raise RuntimeError("web_search_not_used")
        else:
            # 운영자가 웹 검색을 꺼 둔 경우에만 허용되는 경로
            answer = _openai_generate_text(prompt, model=model, temperature=0.3, max_output_tokens=600)
    except Exception as e:  # pragma: no cover - 외부 도구 실패 시 폴백
        log.warning(f"[general] web search/tool failed: {e}")
        diag["web_search_error"] = str(e)
        # 웹 검색이 필수인 경로에서는 '최신 확인'을 못 했으면 안전하게 중단한다(추측 금지).
        answer = (
            GENERAL_PREFIX
            + "\n\n"
            + "현재 웹 검색을 수행할 수 없어 최신 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요."
            + f"\n\n(검색 기준일: {today_iso})"
        )
    if not answer:
        raise HTTPException(status_code=502, detail="empty_llm_answer_general")

    # NOTE: (ADR-0018) 일반 상식 경로는 항상 동일한 프리픽스로 시작해야 한다.
    # LLM이 지침을 따르지 않더라도 여기서 강제로 보정한다.
    # 1) 코드/따옴표/공백 등 선행 장식을 제거
    cleaned = answer.lstrip()
    # 흔히 나오는 마크다운/따옴표 래퍼 제거
    for ch in ["`", "'", '"', "“", "”"]:
        while cleaned.startswith(ch):
            cleaned = cleaned[len(ch):].lstrip()
    # 2) 이미 프리픽스로 시작하면 그대로 사용
    if cleaned.startswith(GENERAL_PREFIX):
        answer = cleaned
    else:
        # 3) 아니라면 프리픽스를 맨 앞에 붙이고 한 줄 띄운 뒤 본문을 이어붙인다.
        answer = GENERAL_PREFIX
        if cleaned:
            answer += "\n\n" + cleaned

    # 프리픽스가 본문과 같은 줄에 붙어 있으면 가독성을 위해 줄바꿈을 강제한다.
    if answer.startswith(GENERAL_PREFIX) and not answer.startswith(GENERAL_PREFIX + "\n"):
        rest = answer[len(GENERAL_PREFIX) :].lstrip()
        if rest:
            answer = (GENERAL_PREFIX + "\n\n" + rest).strip()

    # 4) 외부 URL(http/https)은 방어적으로 모두 제거 (KB 링크 아님)
    # - 마크다운 링크([text](url))는 url을 제거하면 잔여가 남으므로 먼저 text만 남긴다.
    answer = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r"\1", answer)
    answer = re.sub(r"https?://\S+", "", answer)
    # url 제거로 남은 빈 괄호/링크 잔여물 정리
    answer = re.sub(r"\(\s*\)", "", answer)
    answer = answer.replace("](", "]").strip()

    # 5) 웹 검색 사용 경로에서는 "검색 기준일"을 강제로 포함해 운영자가 확인 가능하게 한다.
    #    (모델이 규칙을 누락하더라도 후처리에서 보정)
    if use_web and f"(검색 기준일: {today_iso})" not in answer:
        answer = (answer.rstrip() + f"\n\n(검색 기준일: {today_iso})").strip()

    # 5-2) 웹 검색을 사용했는데도 모델이 근거 줄을 누락하는 경우가 있어, 도메인+날짜 미리보기로 보강한다.
    # - URL은 정책상 금지이므로 "도메인 + 날짜"만 넣는다.
    # - '검색 기준일' 라인보다 앞에 삽입해 마지막 줄 규칙을 유지한다.
    if use_web and bool(diag.get("web_search_used")) and not is_rumor_news:
        if "근거:" not in answer:
            previews = diag.get("web_search_results_preview") or []
            items: list[str] = []
            allow_domains: tuple[str, ...] | None = None
            if is_youtube_monetization:
                # YPP/수익창출 기준은 공식 문서(YouTube/Google) 우선
                allow_domains = ("support.google.com", "youtube.com", "www.youtube.com", "google.com")

            def _is_bad_domain(d: str) -> bool:
                # 명백히 신뢰할 수 없는/불쾌한 도메인은 근거로 쓰지 않는다.
                return bool(re.search(r"(missav|porn|xxx|jav|torrent|adult|sex)", (d or "").lower()))

            for p in previews:
                if not isinstance(p, dict):
                    continue
                src = str(p.get("source") or "").strip()
                if not src:
                    continue
                src_lower = src.lower()
                if _is_bad_domain(src_lower):
                    continue
                if allow_domains and not any(a in src_lower for a in allow_domains):
                    continue
                d = str(p.get("published_date") or "").strip()
                if src and d:
                    items.append(f"{src} {d}")
                elif src:
                    items.append(src)
                if len(items) >= 2:
                    break
            if items:
                marker = f"(검색 기준일: {today_iso})"
                idx = answer.rfind(marker)
                if idx != -1:
                    head = answer[:idx].rstrip()
                    tail = answer[idx:].lstrip()
                    answer = (head + f"\n\n근거: ({', '.join(items)})\n\n" + tail).strip()
                else:
                    answer = (answer.rstrip() + f"\n\n근거: ({', '.join(items)})").strip()

    # 유튜브 수익창출(YPP) 기준은 자주 바뀌고, 블로그/커뮤니티 글로는 오답이 잦다.
    # 웹 검색을 사용했더라도 "YouTube/Google 공식 도메인" 근거를 확보하지 못하면
    # 구체 숫자/조건을 단정하지 않고 안전하게 보류한다(추측 금지).
    if is_youtube_monetization and use_web and bool(diag.get("web_search_used")):
        previews = diag.get("web_search_results_preview") or []
        allow_domains = ("support.google.com", "youtube.com", "www.youtube.com", "google.com")
        official_hits: list[str] = []
        for p in previews:
            if not isinstance(p, dict):
                continue
            src = str(p.get("source") or "").strip()
            if not src:
                continue
            src_lower = src.lower()
            if any(a in src_lower for a in allow_domains):
                official_hits.append(src_lower)
            if len(official_hits) >= 2:
                break
        diag["ypp_official_evidence"] = bool(official_hits)
        if not official_hits:
            answer = (
                GENERAL_PREFIX
                + "\n\n"
                + "유튜브 수익창출(YPP) 조건은 수시로 변경됩니다.\n"
                + "웹 검색 결과에서 YouTube/Google 공식 문서 근거를 확인하지 못해, 구체 기준(구독자/시청시간/쇼츠 조회수 등)을 단정할 수 없습니다.\n"
                + "YouTube/Google 공식 도움말(YouTube 파트너 프로그램)에서 최신 요건을 확인해 주세요."
                + f"\n\n(검색 기준일: {today_iso})"
            ).strip()

    # 뉴스/루머성 질문은 "최신"이 핵심이므로, 근거 날짜가 최신(최근 30일)이 아니면 안전하게 '최근 근거 없음'으로 처리한다.
    if is_rumor_news:
        if not _has_recent_evidence(answer):
            answer = (
                GENERAL_PREFIX
                + "\n\n"
                + f"최근 30일 내 '{query}' 관련 공식 발표/공식 입장 근거를 웹 검색에서 찾지 못했습니다.\n"
                + "따라서 현재로서는 확인된 사실을 단정할 수 없으며, 공식 발표가 나오기 전까지는 추측/확대 해석을 피하는 것이 안전합니다."
                + f"\n\n(검색 기준일: {today_iso})"
            ).strip()

    return answer, model, diag


def _build_price_point_answer(
    query: str,
    manuals: List[Dict[str, Any]],
    posts: List[Dict[str, Any]],
    policy: Dict[str, Any],
    link_hint: str,
) -> str:
    """가격·포인트 질문에 대해, 매뉴얼에서 추출한 숫자를 기반으로 결정적 답변을 생성한다.

    - LLM에 맡기지 않고 수강료/포인트/보너스/차이를 직접 계산·조립한다.
    - 링크는 근거 문서 URL이 있을 때만 1회 출력한다.
    """
    g_price = str(policy.get("general_price") or "").strip()
    b_price = str(policy.get("business_price") or "").strip()
    g_point = str(policy.get("general_point") or "").strip()
    b_point = str(policy.get("business_point") or "").strip()
    bonus = str(policy.get("bonus_point") or "").strip() or None
    g_monthly = str(policy.get("general_monthly_12") or "").strip() or None
    b_monthly = str(policy.get("business_monthly_12") or "").strip() or None

    def _to_int(x: str) -> Optional[int]:
        try:
            return int(re.sub(r"[^0-9]", "", x))
        except Exception:
            return None

    g_price_i = _to_int(g_price)
    b_price_i = _to_int(b_price)
    g_point_i = _to_int(g_point)
    b_point_i = _to_int(b_point)
    diff_price = (b_price_i - g_price_i) if (b_price_i is not None and g_price_i is not None) else None
    diff_point = (b_point_i - g_point_i) if (b_point_i is not None and g_point_i is not None) else None

    q_lower = query.lower()
    want_diff = bool(re.search(r"차이|difference|diff", q_lower))
    want_price = bool(re.search(r"가격|수강료|price", q_lower))
    want_point = bool(re.search(r"포인트|point", q_lower))
    want_monthly = bool(re.search(r"무이자|할부|월|납부", q_lower))
    want_link = bool(re.search(r"링크|출처|근거|원문", q_lower))

    lines: list[str] = []

    # 1) 질문의 1차 의도를 먼저 1문장으로 답한다.
    if want_diff:
        if (want_point or not want_price) and diff_point is not None:
            lines.append(f"비지니스반과 일반반 포인트 차이는 {diff_point}만 포인트입니다.")
        if (want_price or not want_point) and diff_price is not None:
            lines.append(f"비지니스반과 일반반 수강료 차이는 {diff_price}만 원입니다.")

    # 2) 근거 숫자(수강료/포인트)를 간단히 정리한다.
    lines.extend(
        [
            f"- 일반반: 수강료 {g_price}만 원 / 포인트 {g_point}만 포인트",
            f"- 비지니스반: 수강료 {b_price}만 원 / 포인트 {b_point}만 포인트",
        ]
    )

    if bonus:
        lines.append(f"- 추가 포인트: {bonus}만 포인트 (얼리버드/조건 충족 시)")

    if want_monthly:
        if g_monthly and b_monthly:
            lines.append(f"- 무이자 12개월 월 납부액: 일반반 {g_monthly}만 원 / 비지니스반 {b_monthly}만 원")
        else:
            lines.append("- 무이자 12개월 월 납부액은 자료에서 확인되지 않습니다.")

    # 링크는 요청이 있을 때만 제공한다(잘못된 링크/중복 링크 방지)
    if want_link:
        url = ""
        # 1) 매뉴얼 본문에 포함된 URL이 있으면 우선
        for m in manuals or []:
            raw = (m.get("body_md") or m.get("summary") or "")
            mm = re.search(r"https?://cafe\.naver\.com/dinohighclass/\d+", raw)
            if mm:
                url = mm.group(0)
                break
        # 2) 없으면 link_hint/게시글 URL 중 하나
        if not url:
            url = link_hint or ""
        if not url and posts:
            for p in posts:
                u = (p.get("url") or "").strip()
                if u:
                    url = u
                    break
        if url:
            lines.append("")
            lines.append(url)

    return "\n".join(lines).strip()


def _build_domain_fallback_answer(
    query: str,
    manuals: List[Dict[str, Any]],
    posts: List[Dict[str, Any]],
    link_hint: str,
) -> str:
    """Gemini/LLM이 없거나 실패했을 때 도메인 자료로만 구성하는 결정적 폴백 답변."""
    lines: list[str] = []

    if manuals:
        m = manuals[0]
        raw = (m.get("summary") or m.get("body_md") or "").strip()
        if raw:
            snippet = "\n".join([ln.strip() for ln in raw.splitlines() if ln.strip()][:3])
            if snippet:
                lines.append("관련 매뉴얼 요약:")
                lines.append(snippet)
                lines.append("")

    if posts:
        lines.append("관련 카페 글:")
        for p in posts[:3]:
            title = (p.get("title") or "").strip() or f"post {p.get('post_id')}"
            created_at = p.get("created_at")
            if hasattr(created_at, "strftime"):
                date_str = created_at.strftime("%Y-%m-%d")
            else:
                date_str = str(created_at)[:10] if created_at else ""
            post_id = p.get("post_id")
            try:
                pid_int = int(post_id) if post_id is not None else None
            except Exception:
                pid_int = None
            url = p.get("url") or ""
            if pid_int is not None:
                url = _fix_cafe_url(url, pid_int)
            item = f"- {title}"
            if date_str:
                item += f" ({date_str})"
            if url:
                item += f"\n  {url}"
            lines.append(item)

    if not lines:
        if link_hint:
            return (
                "관련 카페 자료를 찾지 못했습니다. 최신 공지를 확인해 주세요.\n\n"
                + link_hint
            )
        return "관련 카페 자료를 찾지 못했습니다. 최신 공지를 확인해 주세요."

    return "\n".join(lines).strip()


def _dedupe_urls_in_answer(answer: str) -> str:
    """답변 내 동일 URL 중복을 제거하고, 빈 라인을 정리한다."""
    if not answer:
        return ""

    url_re = re.compile(r"https?://\S+")
    matches = list(url_re.finditer(answer))
    if not matches:
        return answer.strip()

    seen: set[str] = set()
    parts: list[str] = []
    last = 0
    for m in matches:
        url = m.group(0)
        if url in seen:
            parts.append(answer[last:m.start()])
            last = m.end()
            continue
        seen.add(url)
    parts.append(answer[last:])
    out = "".join(parts)

    # "링크:" 라벨은 사용자가 싫어하므로 출력에서 배제한다.
    # - URL이 붙어 있으면 라벨만 제거/치환하고 URL은 남긴다.
    # - URL이 제거된 뒤 라벨만 남는 경우는 아래에서 라인 자체를 제거한다.
    out = re.sub(r"(근거|출처|링크)\s*:\s*(?=https?://)", "", out)
    out = re.sub(r"링크\s*:\s*", "주소: ", out)

    cleaned_lines: list[str] = []
    for line in out.splitlines():
        # URL만 제거된 라벨 라인 정리
        if re.match(r"^\s*(근거|출처|링크|주소)\s*:\s*$", line):
            continue
        # 예: "채널톡 주소:" 같이 접두어가 붙은 라벨만 남는 라인도 제거
        if re.match(r"^\s*.*(링크|주소)\s*:\s*$", line):
            continue
        # 빈 bullet 정리
        if re.match(r"^\s*[-*]\s*$", line):
            continue
        cleaned_lines.append(line.rstrip())

    out = "\n".join(cleaned_lines)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    return out


def _strip_disliked_boilerplate(answer: str) -> str:
    """운영자가 싫어하는 상투 문구/헤더를 제거한다(가독성 개선)."""
    if not answer:
        return ""

    bad_phrases = [
        "최근 카페에서의",
        "핵심 1가지를 요약해요",
        "디하클 최신 강의 소식",
    ]

    lines: list[str] = []
    for line in str(answer).splitlines():
        if any(p in line for p in bad_phrases):
            continue
        lines.append(line.rstrip())

    out = "\n".join(lines)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    return out


def _strip_unsupported_urls_in_answer(answer: str, manuals: list[dict[str, Any]], posts: list[dict[str, Any]]) -> str:
    """자료(매뉴얼/게시글)에 없는 URL이 답변에 포함되면 제거한다(환각 링크 방지)."""
    if not answer:
        return ""

    url_re = re.compile(r"https?://\S+")
    urls = url_re.findall(answer)
    if not urls:
        return answer.strip()

    # sources에서 허용되는 URL을 'scheme 제거 키'로 정규화해 canonical URL(https 우선)로 매핑한다.
    _TRAILING_URL_CHARS = ".,;:)]}»\"'`<>"

    def _key(u: str) -> str:
        u = (u or "").strip().rstrip(_TRAILING_URL_CHARS)
        u = re.sub(r"^https?://", "", u, flags=re.IGNORECASE)
        return u.rstrip("/").strip()

    canonical_by_key: dict[str, str] = {}

    def _register(u: str) -> None:
        u2 = (u or "").strip().rstrip(_TRAILING_URL_CHARS)
        if not u2:
            return
        k = _key(u2)
        if not k:
            return
        prev = canonical_by_key.get(k)
        if prev is None:
            canonical_by_key[k] = u2
            return
        # prefer https when both exist
        if prev.startswith("http://") and u2.startswith("https://"):
            canonical_by_key[k] = u2

    # posts: url 필드만 신뢰
    for p in posts or []:
        _register(str(p.get("url") or "").strip())

    # manuals: 텍스트에 포함된 URL만 허용(없으면 추가 링크 금지)
    manual_blobs: list[str] = []
    for m in manuals or []:
        manual_blobs.append(str(m.get("title") or ""))
        manual_blobs.append(str(m.get("summary") or ""))
        manual_blobs.append(str(m.get("body_md") or ""))
        manual_blobs.append(str(m.get("norm_text") or ""))
    blob = "\n".join(manual_blobs)
    for u in url_re.findall(blob):
        _register(u)

    out = answer
    for u in urls:
        u2 = u.rstrip(_TRAILING_URL_CHARS)
        if not u2:
            continue
        canonical = canonical_by_key.get(_key(u2))
        if canonical:
            if u2 != canonical:
                out = out.replace(u2, canonical)
            continue
        out = out.replace(u2, "")

    return out.strip()


def _strip_sensitive_numbers_in_answer(answer: str) -> str:
    """답변에서 계좌번호/전화번호 등 민감 숫자 패턴을 제거한다.

    NOTE: 강의 가격/포인트(177만/255만 등)는 유지해야 하므로, 하이픈 계좌/전화 패턴만 보수적으로 처리한다.
    """
    if not answer:
        return ""

    out = answer

    # 계좌번호(예: 110-392-670664) 형태
    bank_re = re.compile(r"(?<!\d)(\d{2,3}\s*-\s*\d{2,3}\s*-\s*\d{3,8})(?!\d)")
    out = bank_re.sub("[계좌번호 생략]", out)

    # 전화번호(예: 010-1234-5678) 형태
    phone_re = re.compile(r"(?<!\d)(0(?:10|11|16|17|18|19)\s*-\s*\d{3,4}\s*-\s*\d{4})(?!\d)")
    out = phone_re.sub("[전화번호 생략]", out)

    return out.strip()


def _sanitize_discount_language_for_price_answer(query: str, answer: str) -> str:
    """가격/할인 질문에서 '현재 할인 중' 같은 시점 민감 표현을 완화한다."""
    if not answer:
        return ""
    q = (query or "").lower()
    if not re.search(r"(가격|비용|금액|할인|정가|할인가|구독|결제|pro|유료|버전)", q):
        return answer.strip()
    if "할인" not in answer:
        return answer.strip()

    out = answer
    # "현재 33% 할인" 같은 문장은 시점이 바뀔 수 있으니 '현재'는 제거한다.
    out = re.sub(r"현재\s*(?=[\d(])", "", out)
    # "할인 중"은 "할인 안내"로 완화 (조사/어미 케이스 포함)
    out = re.sub(r"할인\s*중\s*이며", "할인 안내가 있으며", out)
    out = re.sub(r"할인\s*중\s*이고", "할인 안내가 있고", out)
    out = re.sub(r"할인\s*중\s*(입니다|이다|이에요|임)", "할인 안내가 있습니다", out)
    out = re.sub(r"할인\s*중", "할인 안내", out)
    # 흔한 어색한 결합(예: "할인 안내가 있습니다이며") 보정
    out = out.replace("할인 안내가 있습니다이며", "할인 안내가 있으며")
    out = out.replace("할인 안내가 있습니다이고", "할인 안내가 있고")
    # 구매/결제 유도 문구는 제거 (가독성/정책 드리프트 방지)
    cleaned_lines: list[str] = []
    for line in out.splitlines():
        l = line.strip()
        if not l:
            cleaned_lines.append(line.rstrip())
            continue
        if re.search(r"(빠르게|서둘러|지금).*(구매|결제).*(좋|추천)", l):
            continue
        cleaned_lines.append(line.rstrip())
    out = "\n".join(cleaned_lines)
    return out.strip()


def _strip_unsupported_handles_in_answer(
    answer: str, manuals: list[dict[str, Any]], posts: list[dict[str, Any]]
) -> str:
    """자료에 없는 외부 계정 핸들(@...)이 답변에 포함되면 제거한다(추측/환각 방지)."""
    if not answer:
        return ""

    handles = re.findall(r"@[A-Za-z0-9_.]{2,}", answer)
    if not handles:
        return answer.strip()

    blob_parts: list[str] = []
    for p in posts or []:
        blob_parts.append(str(p.get("title") or ""))
        blob_parts.append(str(p.get("norm_text") or ""))
    for m in manuals or []:
        blob_parts.append(str(m.get("title") or ""))
        blob_parts.append(str(m.get("summary") or ""))
        blob_parts.append(str(m.get("body_md") or ""))
        blob_parts.append(str(m.get("norm_text") or ""))
    blob = "\n".join(blob_parts).lower()

    out = answer
    for h in sorted(set(handles), key=len, reverse=True):
        if h.lower() in blob:
            continue
        out = out.replace(h, "")
    return out.strip()


def _sanitize_external_link_answer(
    query: str, answer: str, manuals: list[dict[str, Any]], posts: list[dict[str, Any]]
) -> str:
    """외부 플랫폼 링크 요청에서 '없는 링크를 주는 것처럼 보이는' 표현을 제거한다."""
    if not answer:
        return ""
    q = (query or "").lower()
    if not q:
        return answer.strip()

    # 외부 링크 의도 감지
    external_markers = ["인스타", "인스타그램", "instagram", "스레드", "threads", "유튜브", "youtube", "틱톡", "tiktok", "블로그"]
    if not (("링크" in q) or ("url" in q) or ("주소" in q)):
        return answer.strip()
    if not any(m in q for m in external_markers):
        return answer.strip()

    out = _strip_unsupported_handles_in_answer(answer, manuals, posts)

    # 외부 도메인 URL은 정책상 제거되므로, 최종 답변에 남아있지 않다면
    # "링크를 제공한다"처럼 보이는 문장을 정리하고 확인불가 문장으로 통일한다.
    external_domains = ["instagram.com", "threads.net", "threads.com", "youtube.com", "youtu.be", "tiktok.com"]
    has_external_url = any(d in out.lower() for d in external_domains)
    if has_external_url:
        return out.strip()

    cleaned: list[str] = []
    for line in out.splitlines():
        l = line.strip()
        if not l:
            continue
        l_lower = l.lower()
        # "인스타/스레드:" 같이 라벨만 남는 라인 제거
        if (l.endswith(":") or l.endswith("：")) and any(m in l_lower for m in external_markers):
            continue
        # "링크는 다음과 같습니다" 류 오해 유발 문장 제거
        if re.search(r"(링크는\s*다음|링크를\s*다음|다음과\s*같습니다)", l) and any(m in l_lower for m in external_markers):
            continue
        # 외부 링크/계정 제공처럼 보이는 문장 제거 (URL은 이미 제거되었으므로 문장만 남는 것을 방지)
        if any(m in l_lower for m in external_markers) and re.search(r"(링크|url|주소|프로필|계정|handle|@)", l_lower):
            continue
        if re.search(r"(링크만|링크\s*만)\s*(제공|있|드릴|줄)", l_lower) and any(m in q for m in external_markers):
            continue
        cleaned.append(line.rstrip())

    out2 = "\n".join(cleaned).strip()
    prefix = "카페 자료에는 요청한 외부 플랫폼 링크(URL)가 포함되어 있지 않아 자료 기준으로 확인 불가합니다."
    if not out2:
        out2 = prefix
    elif not out2.startswith(prefix):
        out2 = f"{prefix}\n{out2}".strip()

    # 외부 플랫폼 링크 요청에서는 URL을 출력하지 않는다(정책/오해 방지).
    out2 = re.sub(r"https?://\\S+", "", out2)
    out2 = "\n".join([l.rstrip() for l in out2.splitlines() if l.strip()]).strip()
    return out2.strip()


def _is_effectively_no_info_answer(answer: str) -> bool:
    """LLM 답변이 사실상 '자료 없음/확인 불가'만을 말하는지 판별한다.

    목적:
    - "A는 알 수 없지만, B는 자료로 답할 수 있음" 같은 부분 답변을
      통째로 '자료 기준으로 확인 불가.'로 덮어써버리는 것을 방지한다.
    """
    a = (answer or "").strip()
    if not a:
        return True

    pattern = re.compile(r"자료기준|확인불가|찾지못|관련카페자료를찾지못")
    flat = re.sub(r"\s+", "", a)
    if pattern.search(flat) and len(flat) <= 40:
        return True

    lines = [l.strip() for l in a.splitlines() if l and l.strip()]
    if not lines:
        return True

    no_info_lines = 0
    for l in lines:
        lflat = re.sub(r"\s+", "", l)
        if pattern.search(lflat):
            no_info_lines += 1

    # 짧은 답변(<=3줄)에서 모든 줄이 no-info면 no-info로 취급
    if len(lines) <= 3 and no_info_lines == len(lines):
        return True

    return False


@app.post("/ask_llm")
def ask_llm(req: AskLlmRequest):
    t0 = time.time()
    try:
        raw_query = req.query or ""
        clean_query = _strip_dihacl_prefix(raw_query)
        query_for_intent = clean_query or raw_query

        # 고유명(닉네임/인물명/툴명) 추출: 인물 소개/외부 링크 요청 등에서 LLM 호출을 피하기 위해 사용
        entity_keywords = _extract_entity_keywords(query_for_intent)
        primary_entity = entity_keywords[0] if entity_keywords else ""
        entity_override = _match_entity_override(primary_entity) if primary_entity else None

        # 검색 쿼리 확장: context_tags가 있으면 태그를 벡터 검색 쿼리에 포함
        search_query = query_for_intent
        if req.context_tags:
            # 태그들을 앞에 붙여서 도메인/매뉴얼을 더 잘 맞추도록 한다.
            tag_str = " ".join([str(t) for t in req.context_tags if t])
            if tag_str:
                search_query = f"{tag_str} {search_query}"

        # 카페 도메인과 무관한 일반 질문이면, 처음부터 일반 상식 답변 경로로 보낸다.
        # 원칙(ADR-0021):
        # - context_tags가 붙어 들어온 요청은 기본적으로 도메인 RAG 경로를 시도한다.
        # - 단, 플랫폼 사용법/일반 정책 질문은 혼동을 줄이기 위해 일반 상식 경로로 보낼 수 있다.
        has_context_tags = bool(req.context_tags)
        is_domain = _is_domain_query(query_for_intent) or has_context_tags or bool(entity_override)
        force_domain = False
        if req.context_tags:
            tags_lower = [str(t).lower() for t in (req.context_tags or []) if t]
            if any(t in tags_lower for t in ["sajulab", "sajulab.kr", "사주랩"]):
                force_domain = True
        if force_domain:
            is_domain = True
        # 플랫폼 사용법/일반 정책 질문은 웹 검색(일반 상식) 경로로 보낸다.
        # (단, Sajulab 등 강제 도메인 태그가 있으면 예외)
        if not force_domain and _is_platform_usage_query(query_for_intent):
            is_domain = False
        if not force_domain and _is_general_knowledge_query(query_for_intent):
            is_domain = False
        if not is_domain:
            general_answer, gen_model, gen_diag = _build_general_answer(query_for_intent, req.model)
            return {
                "ok": True,
                "query": req.query,
                "answer": general_answer,
                "model": gen_model,
                "manuals": [],
                "posts": [],
                "link_hint": "",
                "took": time.time() - t0,
                "diag": {
                    "mode": "general_out_of_scope",
                    **(gen_diag if isinstance(gen_diag, dict) else {}),
                },
            }

        q_lower = (query_for_intent or "").lower()
        external_link_markers = ["인스타", "인스타그램", "instagram", "스레드", "threads", "유튜브", "youtube", "블로그", "외부", "카페밖", "카페 밖"]
        is_external_link_q = ("링크" in q_lower or "url" in q_lower or "주소" in q_lower) and any(
            m in q_lower for m in external_link_markers
        )

        # 가입/등업/승인(규칙/절차) 질문은 환각 위험이 커서 LLM을 타지 않고 결정적으로 답한다.
        if _is_membership_policy_query(query_for_intent):
            answer, posts_sel = _build_membership_policy_answer(query_for_intent)
            selected_post_ids: list[int] = []
            for p in posts_sel or []:
                try:
                    if p.get("post_id") is not None:
                        selected_post_ids.append(int(p.get("post_id")))
                except Exception:
                    continue
            return {
                "ok": True,
                "query": req.query,
                "answer": answer,
                "model": None,
                "manuals": [],
                "posts": posts_sel,
                "link_hint": "",
                "took": time.time() - t0,
                "diag": {
                    "mode": "membership_policy",
                    "selected_posts": selected_post_ids,
                },
            }

        # 카페 멤버수(회원수)는 KB 수집 대상이 아니며, 최신값을 위해 카페 홈에서 실시간 파싱한다.
        # LLM/RAG를 타면 추측/오답 위험이 커서 결정적 경로로 처리한다.
        raw_stripped = str(raw_query or "").strip()
        has_dihacl_prefix = bool(raw_stripped and clean_query and clean_query != raw_stripped)
        has_domain_context = has_context_tags or has_dihacl_prefix
        if _is_cafe_member_count_query(query_for_intent, has_domain_context=has_domain_context):
            fetched_at = _dt.datetime.now(_dt.timezone.utc).astimezone().isoformat(timespec="minutes")
            cafe_url = get_cafe_url()
            try:
                cnt = fetch_member_count(cafe_url)
                return {
                    "ok": True,
                    "query": req.query,
                    "answer": f"현재 디하클 카페 멤버수는 {cnt:,}명입니다. (조회 시각: {fetched_at})",
                    "model": None,
                    "manuals": [],
                    "posts": [],
                    "link_hint": "",
                    "took": time.time() - t0,
                    "diag": {
                        "mode": "cafe_member_count",
                        "member_count": int(cnt),
                        "fetched_at": fetched_at,
                        "cafe_url": cafe_url,
                    },
                }
            except Exception as e:
                # 숫자를 추측/생성하지 않는다.
                return {
                    "ok": True,
                    "query": req.query,
                    "answer": (
                        "디하클 카페 멤버수(회원수) 자동 조회에 실패했습니다.\n"
                        f"(조회 시각: {fetched_at})\n"
                        f"사유: {type(e).__name__}: {e}"
                    ).strip(),
                    "model": None,
                    "manuals": [],
                    "posts": [],
                    "link_hint": "",
                    "took": time.time() - t0,
                    "diag": {
                        "mode": "cafe_member_count_error",
                        "fetched_at": fetched_at,
                        "cafe_url": cafe_url,
                        "error_type": type(e).__name__,
                        "error": str(e),
                    },
                }

        # 카페 기본 정보(주소/ID/신청 게시판) 요청은 LLM 없이 SSOT로 결정적으로 답한다.
        # 단, "디하클 카페 룰루랄라릴리 소개"처럼 문장에 '카페'가 섞여도
        # 실제 의도가 '인물 소개'이고 entity_override(SSOT 엔티티)가 잡히는 경우에는
        # cafe_profile로 오탐하지 않도록 막고 entity_intro 경로로 넘긴다.
        is_entity_intro_intent = bool(
            entity_override
            and (
                _is_person_intro_query(query_for_intent)
                or _is_entity_lecture_intro_query(query_for_intent)
                or _is_entity_soft_intro_query(query_for_intent, entity_override)
                or (is_external_link_q and entity_override)
            )
        )
        if _is_cafe_profile_query(query_for_intent, has_domain_context=has_domain_context) and not is_entity_intro_intent:
            fetched_at = _dt.datetime.now(_dt.timezone.utc).astimezone().isoformat(timespec="minutes")
            cafe_id = get_cafe_id()
            cafe_url = get_cafe_url()
            member_line = "- 카페 멤버수: (자동 조회 실패)"
            try:
                cnt = fetch_member_count(cafe_url)
                member_line = f"- 카페 멤버수: {cnt:,}명 (조회 시각: {fetched_at})"
            except Exception:
                # 멤버수는 별도 질문으로도 확인 가능하며, 여기서는 추측하지 않는다.
                member_line = f"- 카페 멤버수: (자동 조회 실패, 조회 시각: {fetched_at})"

            answer = "\n".join(
                [
                    "디하클 카페 기본 정보(SSOT)입니다.",
                    f"- 카페 URL: {cafe_url}",
                    f"- cafe_id(clubid): {cafe_id}",
                    "- 신청 게시판 SSOT: 무료특강 신청(23), 정규강의 신청(42)",
                    member_line,
                ]
            ).strip()
            return {
                "ok": True,
                "query": req.query,
                "answer": answer,
                "model": None,
                "manuals": [],
                "posts": [],
                "link_hint": "",
                "took": time.time() - t0,
                "diag": {
                    "mode": "cafe_profile",
                    "cafe_id": int(cafe_id),
                    "cafe_url": cafe_url,
                    "fetched_at": fetched_at,
                },
            }

        # 강사진/강사 목록 요청은 신청 게시판(23/42) 제목 끝 '(강사명)' 표기 기준으로 결정적으로 정리한다.
        if _is_instructors_list_query(query_for_intent, has_domain_context=has_domain_context):
            scan_total = int(os.getenv("KB_INSTRUCTORS_SCAN_TOTAL", "300"))
            list_limit = int(os.getenv("KB_INSTRUCTORS_LIST_LIMIT", "20"))

            def _extract_instructor(title: str) -> str:
                t = (title or "").strip()
                if not t:
                    return ""
                m = re.search(r"\(([^()]{2,30})\)\s*$", t)
                if not m:
                    return ""
                cand = (m.group(1) or "").strip()
                if not cand:
                    return ""
                if re.search(r"(실습|보너스|다시보기|vod|무료|정규|특강|신청)", cand, flags=re.IGNORECASE):
                    return ""
                if re.search(r"https?://", cand):
                    return ""
                return cand

            with db_session() as s:
                rows = s.execute(
                    text(
                        """
                        SELECT post_id, menu_id, title, url, created_at
                        FROM sources_post
                        WHERE status='clean' AND menu_id = ANY(:mids)
                        ORDER BY created_at DESC NULLS LAST, post_id DESC
                        LIMIT :lim
                        """
                    ),
                    {"mids": list(SCHEDULE_MENU_IDS), "lim": scan_total},
                ).fetchall()

            latest_by_name: dict[str, Any] = {}
            for r in rows or []:
                name = _extract_instructor(getattr(r, "title", "") or "")
                if not name:
                    continue
                prev = latest_by_name.get(name)
                if prev is None:
                    latest_by_name[name] = r
                    continue
                prev_ts = getattr(prev, "created_at", None)
                ts = getattr(r, "created_at", None)
                if isinstance(ts, _dt.datetime) and (not isinstance(prev_ts, _dt.datetime) or ts > prev_ts):
                    latest_by_name[name] = r

            def _ts(row) -> _dt.datetime:
                v = getattr(row, "created_at", None)
                if isinstance(v, _dt.datetime):
                    return v
                return _dt.datetime.min

            names_sorted = sorted(latest_by_name.keys(), key=lambda n: _ts(latest_by_name[n]), reverse=True)
            total_found = len(names_sorted)
            top_names = names_sorted[: max(0, list_limit)]

            lines: list[str] = []
            lines.append(
                f"신청 게시판(무료특강 23 / 정규강의 42) 최근 {scan_total}개 글의 제목 끝 '(강사명)' 표기 기준으로 정리합니다."
            )
            lines.append(f"- 확인된 강사: {total_found}명")
            if not top_names:
                lines.append("- (강사 표기 추출 결과 없음)")
            else:
                lines.append("")
                lines.append(f"최근 등장 강사 TOP {len(top_names)}:")
                for name in top_names:
                    r = latest_by_name.get(name)
                    if not r:
                        continue
                    d = getattr(r, "created_at", None)
                    d_str = d.date().isoformat() if isinstance(d, _dt.datetime) else ""
                    title = (getattr(r, "title", "") or "").strip() or "(제목 없음)"
                    url = (getattr(r, "url", "") or "").strip()
                    if url:
                        lines.append(f"- {name}: {title} ({d_str}) {url}".strip())
                    else:
                        lines.append(f"- {name}: {title} ({d_str})".strip())

            lines.append("")
            lines.append("팁: 특정 강사를 더 알고 싶으면 `?디하클 <닉네임> 누구야` 또는 `?디하클 <닉네임> 어떤 강의 해?`로 질문해 주세요.")

            answer = "\n".join([ln.rstrip() for ln in lines if ln is not None]).strip()
            return {
                "ok": True,
                "query": req.query,
                "answer": answer,
                "model": None,
                "manuals": [],
                "posts": [],
                "link_hint": "",
                "took": time.time() - t0,
                "diag": {
                    "mode": "instructors_list",
                    "scan_total": int(scan_total),
                    "total_found": int(total_found),
                    "top_names": top_names,
                },
            }

        # 특정 게시판은 운영 정책으로 수집/조회 제외(검색/LLM 호출도 하지 않음)
        disabled = _detect_disabled_board(query_for_intent)
        if disabled:
            menu_id, board_name = disabled
            return {
                "ok": True,
                "query": req.query,
                "answer": (
                    f"'{board_name}' 게시판은 현재 KB 수집/조회 대상에서 제외되어 자료 기반 링크/답변을 제공할 수 없습니다."
                ),
                "model": None,
                "manuals": [],
                "posts": [],
                "link_hint": "",
                "took": time.time() - t0,
                "diag": {
                    "mode": "disabled_board",
                    "board": board_name,
                    "menu_id": int(menu_id),
                },
            }

        # "왜 알려줘도 기억 못해?" 같은 메타 질문은 LLM이 자료 기반으로만 답하려다
        # '자료 기준 확인 불가'로 튕기는 경우가 많아, 시스템 동작을 결정적으로 안내한다.
        if _is_bot_memory_meta_query(query_for_intent):
            # 엔티티가 잡히는 경우(대표/강사 등)는 답도 같이 제공해 불만을 줄인다.
            if entity_keywords and entity_override:
                entity_posts: list[dict[str, Any]] = []
                selected_ids: list[int] = []
                try:
                    terms: list[str] = []
                    if primary_entity:
                        terms.append(primary_entity)
                    oname = str(entity_override.get("name") or "").strip()
                    if oname:
                        terms.append(oname)
                    for a in (entity_override.get("aliases") or []):
                        a2 = str(a or "").strip()
                        if a2:
                            terms.append(a2)
                    terms = list(dict.fromkeys([t for t in terms if t and t.strip()]))
                    search_menu_ids = [m["menu_id"] for m in get_all_menus() if m.get("collect")]
                    if search_menu_ids and terms:
                        entity_posts = _get_recent_posts_filtered(
                            search_menu_ids,
                            limit=90,
                            keywords_any=terms,
                            title_only=False,
                        )
                except Exception as e:
                    log.info(f"[ask_llm] bot memory entity search skipped: {e}")

                base, selected_posts = _build_entity_intro_answer(
                    query_for_intent, entity_keywords, entity_posts, is_external_link_q=False
                )
                for p in selected_posts or []:
                    try:
                        if p.get("post_id") is not None:
                            selected_ids.append(int(p.get("post_id")))
                    except Exception:
                        continue

                extra = (
                    "참고: 이 봇은 대화 내용을 '기억'해서 답하는 방식이 아니라, "
                    "매번 KB(카페 글/매뉴얼)에서 검색한 결과로 답합니다. "
                    "그래서 같은 질문을 다시 하면 매번 다시 검색하며, "
                    "키워드/표기가 달라 검색이 실패하면 '자료 기준으로 확인 불가'가 나올 수 있습니다."
                )
                answer = f"{base}\n\n{extra}".strip()
                return {
                    "ok": True,
                    "query": req.query,
                    "answer": answer,
                    "model": None,
                    "manuals": [],
                    "posts": selected_posts,
                    "link_hint": "",
                    "took": time.time() - t0,
                    "diag": {
                        "mode": "bot_memory",
                        "selected_posts": selected_ids,
                    },
                }

            return {
                "ok": True,
                "query": req.query,
                "answer": (
                    "이 봇은 대화 내용을 '기억'해서 답하는 방식이 아니라, "
                    "매번 KB(카페 글/매뉴얼)에서 검색한 결과로 답합니다. "
                    "그래서 같은 질문을 다시 하면 매번 다시 검색합니다.\n\n"
                    "원하는 내용이 흔들리거나 자주 빠지는 경우, "
                    "`docs/kb_glossary.md`(용어/인물 정의) 또는 "
                    "`config/entities_dinohighclass.json`(인물 역할 SSOT)에 반영해 두면 안정적으로 답할 수 있습니다."
                ),
                "model": None,
                "manuals": [],
                "posts": [],
                "link_hint": "",
                "took": time.time() - t0,
                "diag": {"mode": "bot_memory"},
            }

        # '누구야/정체/소개' 류 질문(및 인물 외부 링크 요청)은 LLM 환각 위험이 커서 결정적으로 답한다.
        # - 역할/직함은 config/entities_dinohighclass.json(SSOT)로 관리
        # - 근거는 SSOT collect=true 범위에서 DB 키워드 검색으로 보강
        if entity_keywords and (
            _is_person_intro_query(query_for_intent)
            or _is_entity_lecture_intro_query(query_for_intent)
            or _is_entity_soft_intro_query(query_for_intent, entity_override)
            or (is_external_link_q and entity_override)
        ):
            entity_posts: list[dict[str, Any]] = []
            try:
                terms: list[str] = []
                if primary_entity:
                    terms.append(primary_entity)
                if entity_override:
                    oname = str(entity_override.get("name") or "").strip()
                    if oname:
                        terms.append(oname)
                    for a in (entity_override.get("aliases") or []):
                        a2 = str(a or "").strip()
                        if a2:
                            terms.append(a2)
                terms = list(dict.fromkeys([t for t in terms if t and t.strip()]))

                # "어떤 강의 하냐" 류는 신청 게시판에서 먼저 찾는다(오탐 방지 + 속도).
                if _is_entity_lecture_intro_query(query_for_intent):
                    search_menu_ids = list(SCHEDULE_MENU_IDS)
                else:
                    search_menu_ids = [m["menu_id"] for m in get_all_menus() if m.get("collect")]
                if search_menu_ids and terms:
                    entity_posts = _get_recent_posts_filtered(
                        search_menu_ids,
                        limit=90,
                        keywords_any=terms,
                        title_only=False,
                    )
            except Exception as e:
                log.info(f"[ask_llm] entity intro DB search skipped: {e}")

            answer, selected_posts = _build_entity_intro_answer(
                query_for_intent, entity_keywords, entity_posts, is_external_link_q
            )
            selected_ids: list[int] = []
            for p in selected_posts or []:
                try:
                    if p.get("post_id") is not None:
                        selected_ids.append(int(p.get("post_id")))
                except Exception:
                    continue
            return {
                "ok": True,
                "query": req.query,
                "answer": answer,
                "model": None,
                "manuals": [],
                "posts": selected_posts,
                "link_hint": "",
                "took": time.time() - t0,
                "diag": {
                    "mode": "entity_intro",
                    "selected_posts": selected_ids,
                },
            }

        # 일정/후기 등 의도 기반 메뉴 필터 (벡터 컷오프 없이 넓게 뽑음)
        menu_ids = None
        is_lecture_q = _is_lecture_query(query_for_intent)
        date_range = _parse_date_keywords(query_for_intent) if is_lecture_q else None

        if _is_schedule_query(query_for_intent):
            # "무료특강"을 명시하면 신청(23)만, "정규강의"를 명시하면 정규(42)만 우선한다.
            # 그렇지 않으면 신청 게시판 전체(23, 42)를 사용한다.
            if re.search(r"무료\s*특강|무료특강", q_lower):
                menu_ids = [23]
            elif re.search(r"정규\s*강의|정규강의", q_lower):
                menu_ids = [42]
            else:
                menu_ids = SCHEDULE_MENU_IDS
            log.info(f"[ask_llm] schedule query detected, menu_ids={menu_ids}, date_range={date_range}")
        elif _is_review_query(query_for_intent):
            menu_ids = REVIEW_MENU_IDS
            log.info(f"[ask_llm] review query detected, menu_ids={menu_ids}")
        elif is_lecture_q:
            # 강의류 질문인데 일정 패턴이 아니어도 신청/후기 게시판만 우선 사용
            menu_ids = SCHEDULE_MENU_IDS

        # '가장 최근 강의/특강' 질문은 LLM 없이 DB 최신 공지로 결정적으로 답변
        if _is_latest_lecture_question(query_for_intent):
            with db_session() as s:
                row = s.execute(
                    text(
                        """
                        SELECT post_id, menu_id, title, url, created_at
                        FROM sources_post
                        WHERE status='clean' AND menu_id = ANY(:mids)
                        ORDER BY created_at DESC NULLS LAST, post_id DESC
                        LIMIT 1
                        """
                    ),
                    {"mids": SCHEDULE_MENU_IDS},
                ).mappings().first()
            if row:
                latest = dict(row)
                try:
                    pid_int = int(latest.get("post_id")) if latest.get("post_id") is not None else None
                except Exception:
                    pid_int = None
                created_at = latest.get("created_at")
                if hasattr(created_at, "strftime"):
                    date_str = created_at.strftime("%Y-%m-%d")
                else:
                    date_str = str(created_at)[:10] if created_at else ""
                title = (latest.get("title") or "").strip()
                url = latest.get("url") or ""
                if pid_int is not None:
                    url = _fix_cafe_url(url, pid_int)

                answer = f"가장 최근 강의 공지는 '{title}' 입니다." if title else "가장 최근 강의 공지를 찾았습니다."
                if date_str:
                    answer += f" ({date_str})"
                if url:
                    answer += f"\n\n{url}"

                return {
                    "ok": True,
                    "query": req.query,
                    "answer": answer,
                    "model": None,
                    "manuals": [],
                    "posts": [latest],
                    "link_hint": "",
                    "took": time.time() - t0,
                    "diag": {
                        "mode": "latest_lecture",
                        "selected_posts": [pid_int] if pid_int else [],
                    },
                }

        # 특정 게시판 "최근/최신 글/링크" 요청은 LLM 없이 DB에서 결정적으로 조회한다.
        board_target = _detect_board_menu_target(query_for_intent)
        if board_target:
            menu_ids = board_target[0]
            if _is_recent_posts_query(query_for_intent) or "링크" in q_lower:
                lim = _recent_posts_limit(query_for_intent)
                required_kws: list[str] = []
                if board_target[1] == "카페 공지":
                    required_kws = _extract_notice_required_keywords(query_for_intent)
                fallback_body = False
                if required_kws:
                    # 1) 제목에 '필독/규칙'이 있는 공지글 우선
                    recent = _get_recent_posts_filtered(menu_ids, limit=lim, keywords_any=required_kws, title_only=True)
                    # 2) 없으면 본문 매칭으로 폴백(그래도 키워드가 포함된 공지글만)
                    if not recent:
                        fallback_body = True
                        recent = _get_recent_posts_filtered(menu_ids, limit=lim, keywords_any=required_kws, title_only=False)
                else:
                    recent = _get_recent_posts(menu_ids, limit=lim)
                if recent:
                    header = f"{board_target[1]} 최근 글"
                    if board_target[1] == "카페 공지" and required_kws and fallback_body:
                        header = f"{board_target[1]} 최근 글(본문에 키워드 포함)"
                    answer = _format_posts_as_list(recent, header=header)
                    return {
                        "ok": True,
                        "query": req.query,
                        "answer": answer,
                        "model": None,
                        "manuals": [],
                        "posts": recent,
                        "link_hint": "",
                        "took": time.time() - t0,
                        "diag": {
                            "mode": "recent_posts",
                            "board": board_target[1],
                            "selected_posts": [int(p.get("post_id")) for p in recent if p.get("post_id")],
                            "fallback_body": bool(fallback_body),
                        },
                    }
                return {
                    "ok": True,
                    "query": req.query,
                    "answer": (
                        "필독/규칙 공지글을 찾지 못했습니다. 최신 공지를 확인해 주세요."
                        if (board_target[1] == "카페 공지" and required_kws)
                        else f"{board_target[1]} 관련 카페 글을 찾지 못했습니다. 최신 공지를 확인해 주세요."
                    ),
                    "model": None,
                    "manuals": [],
                    "posts": [],
                    "link_hint": "",
                    "took": time.time() - t0,
                    "diag": {"mode": "recent_posts_empty", "board": board_target[1]},
                }

        # 일정/후기에서 "링크/공지/일정 리스트" 류는 LLM 없이 최근 글 리스트로 답변
        # - 날짜(예: "12월 3일")가 명시된 질문은 아래의 vector_search + date_keys 필터 경로를 사용한다.
        # - '조건/준비물/확인' 같이 설명형 질문은 여기서 조기 종료하지 않는다.
        if (
            _is_schedule_query(query_for_intent)
            and menu_ids
            and _is_schedule_list_request(query_for_intent)
            and not _extract_date_keys(query_for_intent)
        ):
            lim = _recent_posts_limit(query_for_intent)
            recent = _get_recent_posts(menu_ids, limit=lim, date_range=date_range)
            if recent:
                answer = _format_posts_as_list(recent, header="무료특강/정규강의 신청 글")
                return {
                    "ok": True,
                    "query": req.query,
                    "answer": answer,
                    "model": None,
                    "manuals": [],
                    "posts": recent,
                    "link_hint": "",
                    "took": time.time() - t0,
                    "diag": {
                        "mode": "schedule_recent",
                        "selected_posts": [int(p.get("post_id")) for p in recent if p.get("post_id")],
                    },
                }

            # 기간 지정(이번 주/지난 주/최근 N일 등)으로 걸러서 결과가 0개가 되면,
            # "가장 최근" 신청 글을 함께 안내한다(자료가 있는데도 빈 응답이 나오는 체감 완화).
            if date_range:
                fb = _get_recent_posts(menu_ids, limit=lim, date_range=None)
                if fb:
                    start_date, end_date = date_range
                    range_str = f"{start_date:%Y-%m-%d}~{end_date:%Y-%m-%d}"
                    answer = _format_posts_as_list(
                        fb,
                        header=f"요청한 기간({range_str})에는 신청 글이 없습니다. 가장 최근 신청 글은 아래입니다.",
                    )
                    return {
                        "ok": True,
                        "query": req.query,
                        "answer": answer,
                        "model": None,
                        "manuals": [],
                        "posts": fb,
                        "link_hint": "",
                        "took": time.time() - t0,
                        "diag": {
                            "mode": "schedule_recent_fallback",
                            "date_range": range_str,
                            "selected_posts": [int(p.get("post_id")) for p in fb if p.get("post_id")],
                        },
                    }

            return {
                "ok": True,
                "query": req.query,
                "answer": "요청한 기간/조건에 맞는 강의 신청 글을 찾지 못했습니다. 최신 공지를 확인해 주세요.",
                "model": None,
                "manuals": [],
                "posts": [],
                "link_hint": "",
                "took": time.time() - t0,
                "diag": {"mode": "schedule_recent_empty"},
            }

        if _is_review_query(query_for_intent) and menu_ids == REVIEW_MENU_IDS and (
            _is_recent_posts_query(query_for_intent) or "링크" in q_lower
        ):
            lim = _recent_posts_limit(query_for_intent)
            recent = _get_recent_posts(menu_ids, limit=lim, date_range=date_range)
            if recent:
                answer = _format_posts_as_list(recent, header="무료특강 후기 글")
                return {
                    "ok": True,
                    "query": req.query,
                    "answer": answer,
                    "model": None,
                    "manuals": [],
                    "posts": recent,
                    "link_hint": "",
                    "took": time.time() - t0,
                    "diag": {
                        "mode": "review_recent",
                        "selected_posts": [int(p.get("post_id")) for p in recent if p.get("post_id")],
                    },
                }
            return {
                "ok": True,
                "query": req.query,
                "answer": "최근 무료특강 후기 글을 찾지 못했습니다. 최신 공지를 확인해 주세요.",
                "model": None,
                "manuals": [],
                "posts": [],
                "link_hint": "",
                "took": time.time() - t0,
                "diag": {"mode": "review_recent_empty"},
            }

        # 고유명(닉네임/툴명) 키워드는 임베딩 검색 실패 시에도 폴백/결정적 답변에 사용된다.
        # (상단에서 추출한 entity_keywords를 그대로 사용)
        is_price_q = _is_price_or_point_question(query_for_intent)

        # 검색은 search_query 기준으로 수행 (context_tags 포함)
        try:
            search_res = vector_search(search_query, top_k=max(req.top_k, 50), menu_ids=menu_ids)
        except Exception as e:
            # OpenAI 임베딩/DB 장애 등으로 벡터 검색이 실패해도 500으로 터지지 않고 폴백 경로로 내려가야 한다.
            log.warning(f"[ask_llm] vector_search failed: {e}")
            search_res = {"manuals": [], "posts": []}
        # 매뉴얼은 기본 상위 2개만 사용하되,
        # 가격/포인트/무이자처럼 정책 숫자가 필요한 질문은 정책 매뉴얼이 3~5위로 밀릴 수 있어 조금 더 넉넉히 로드한다.
        manual_keep = 5 if is_price_q else 2
        manuals_hit = search_res.get("manuals", [])[:manual_keep]
        posts_hit = search_res.get("posts", [])

        # 강한 의도 키워드(예: 유튜브 수익창출 기준)가 포함된 질의는
        # 해당 키워드가 제목/본문에 실제로 포함된 후보만 남긴다.
        req_lower = query_for_intent.lower()
        required_keywords: list[str] = []
        if (
            re.search(r"수익창출|수익화|\bypp\b|monetization|youtube\s+partner\s+program", req_lower)
            or "파트너 프로그램" in query_for_intent
        ):
            required_keywords = ["수익창출", "수익화", "ypp", "파트너 프로그램", "youtube partner program", "monetization"]

        # 정책/절차/조건 등 "추측 위험"이 큰 질문은 동일 키워드가 실제로 포함된 문서만 후보로 남긴다.
        # (없으면 '자료 없음'으로 답하고 링크/절차를 임의 생성하지 않는다)
        if "등업" in req_lower:
            # NOTE: '가입' 키워드로만 매칭되면 등업 질문에 엉뚱한 글이 섞이기 쉬워서,
            #       등업 질문은 등업 키워드가 있는 문서만 남긴다.
            required_keywords.extend(["등업"])
        elif re.search(r"(가입|승인|등급)", req_lower):
            required_keywords.extend(["가입", "승인", "등급"])
        if re.search(r"(준비물|준비\s*해야|필요한\s*것)", req_lower):
            required_keywords.extend(["준비물", "준비", "필요"])
        if re.search(r"(확인|완료|정상|조회)", req_lower):
            required_keywords.extend(["확인", "완료", "정상", "조회"])
        if re.search(r"(환불|취소|환불\s*규정|취소\s*규정)", req_lower):
            required_keywords.extend(["환불", "취소", "규정"])
        if re.search(r"(재수강|재등록)", req_lower):
            required_keywords.extend(["재수강", "재등록"])
        if re.search(r"(충전|추가\s*충전|추가\s*구매|추가구매|top\\s*up|topup)", req_lower):
            required_keywords.extend(["충전", "topup", "top up"])

        # 고유명(닉네임/툴명) 질문 폴백:
        # 임베딩 검색이 약한 고유명 질의는 "질문에 나온 키워드가 실제로 포함된 문서"만 후보로 남기고,
        # 0개가 되면 DB 키워드 검색으로 후보를 보충한다.
        if entity_keywords and re.search(r"(누구|정체|운영자|강사|얼마|가격|유료|프로|pro|버전|어떤)", req_lower):
            required_keywords.extend(entity_keywords)
        # "마케터제이 인스타/스레드 링크 있어?" 같은 케이스는
        # (외부 링크 자체는 자료에 없을 수 있어도) 인물/주제 정보는 카페 글로 답할 수 있다.
        # 이때 '스레드/인스타' 같은 플랫폼 키워드로 후보가 오염되지 않도록,
        # 최소한 "주요 고유명 1개"는 후보 필터에 포함한다.
        if entity_keywords and is_external_link_q:
            required_keywords.extend(entity_keywords[:1])

        if required_keywords:
            reqs = [k.lower() for k in required_keywords]
            manuals_hit = [
                m
                for m in manuals_hit
                if any(k in (((m.get("title") or "") + " " + (m.get("summary") or "")).lower()) for k in reqs)
            ]
            posts_hit = [
                p
                for p in posts_hit
                if any(k in (((p.get("title") or "") + " " + (p.get("norm_text") or "")).lower()) for k in reqs)
            ]

            # 툴/서비스 가격 질문(예: "캡컷 유료버전 얼마야?")은
            # 임베딩 검색이 다른 '다시보기/수익' 글로 흘러가기 쉬워서,
            # SSOT 수집 범위 내에서 (고유명) AND (가격/할인/구독/정품) 키워드로 DB 검색 결과를 우선 사용한다.
            if is_price_q and entity_keywords:
                try:
                    # 1) "강의 가격" 케이스: 신청 메뉴(23/42)에서 (고유명)만으로 먼저 찾는다.
                    #    (가격은 이미지에만 있을 수 있어 '가격/원' 마커가 제목에 없을 수 있음 → OCR 대상)
                    if _is_course_price_query(query_for_intent, entity_keywords):
                        course_posts = _get_recent_posts_filtered(
                            [23, 42],
                            limit=60,
                            keywords_all=[entity_keywords[0]],
                            keywords_any=None,
                            title_only=True,
                        )
                        if course_posts:
                            # vector_search 결과와 병합(중복 제거). dist는 없으므로 보수적으로 1.0 부여.
                            merged: dict[int, dict[str, Any]] = {}
                            for p in (course_posts + posts_hit):
                                try:
                                    pid = int(p.get("post_id")) if p.get("post_id") is not None else None
                                except Exception:
                                    pid = None
                                if pid is None:
                                    continue
                                if pid not in merged:
                                    merged[pid] = dict(p)
                                    merged[pid].setdefault("dist", 1.0)
                            posts_hit = list(merged.values())
                    else:
                        # 2) "툴/서비스 가격" 케이스: (고유명 AND 가격 마커)로 강하게 찾는다.
                        if menu_ids:
                            search_menu_ids = list(menu_ids)
                        else:
                            search_menu_ids = [m["menu_id"] for m in get_all_menus() if m.get("collect")]
                        if search_menu_ids:
                            price_markers = [
                                "가격",
                                "비용",
                                "금액",
                                "할인",
                                "정가",
                                "할인가",
                                "구독료",
                                "구독 가격",
                                "결제",
                                "정품",
                                "연간",
                                "월간",
                                "블랙프라이데이",
                                "블프",
                                "쿠폰",
                                "%",
                            ]
                            price_posts = _get_recent_posts_filtered(
                                search_menu_ids,
                                limit=60,
                                keywords_all=[entity_keywords[0]],
                                keywords_any=price_markers,
                                title_only=True,
                            )
                            if price_posts:
                                posts_hit = price_posts
                except Exception as e:
                    log.info(f"[ask_llm] price keyword search skipped: {e}")

            # 고유명 키워드까지 포함해 필터링했더니 후보가 0개가 된 경우,
            # 최신 글 기준으로 DB 키워드 검색으로 후보를 보충한다.
            if not manuals_hit and not posts_hit and entity_keywords:
                try:
                    # menu_ids가 지정된 경우에는 해당 범위 내에서만 검색 (예: schedule/review)
                    if menu_ids:
                        search_menu_ids = list(menu_ids)
                    else:
                        # SSOT collect=true 메뉴 전체
                        search_menu_ids = [m["menu_id"] for m in get_all_menus() if m.get("collect")]
                    if search_menu_ids:
                        # 가격 질문이면 (고유명) AND (가격/할인/구독) 조합으로 더 강하게 찾는다.
                        if is_price_q:
                            primary = entity_keywords[0]
                            price_markers = ["가격", "비용", "금액", "할인", "정가", "할인가", "구독료", "구독 가격", "결제", "정품", "연간", "월간", "블랙프라이데이", "블프", "쿠폰", "%"]
                            posts_hit = _get_recent_posts_filtered(
                                search_menu_ids,
                                limit=50,
                                keywords_all=[primary],
                                keywords_any=price_markers,
                                title_only=True,
                            )
                        else:
                            posts_hit = _get_recent_posts_filtered(
                                search_menu_ids,
                                limit=30,
                                keywords_any=entity_keywords,
                                title_only=False,
                            )
                except Exception as e:
                    log.info(f"[ask_llm] entity keyword fallback search skipped: {e}")

        # 날짜 키가 있는 강의 질문이면 해당 날짜 키가 제목/본문에 포함된 후보만 남김 (추측/폴백 없음)
        date_keys = _get_query_date_keys(query_for_intent) if is_lecture_q else []
        if date_keys:
            q_keys = set(date_keys)
            filtered = []
            for p in posts_hit:
                title = (p.get("title") or "")
                body = (p.get("norm_text") or "")  # vector_search에서 앞부분만 제공
                p_keys = set(_extract_date_keys(title + " " + body))
                if q_keys & p_keys:
                    filtered.append(p)
            posts_hit = filtered  # 필터 결과가 없으면 빈 리스트로 두어 바로 없음 처리

        # 키워드 부스트: '다시보기', '링크' 등 키워드가 질문에 있으면 해당 게시글 우선
        posts_hit, topic_only_posts = _keyword_boost_filter(query_for_intent, posts_hit)

        # LLM 재랭크 (후보 20개 내에서 상위 5개 선택)
        # - 가격/유료 질문은 LLM rerank가 다시보기 글을 집어오는 오탐이 있어 휴리스틱 우선 적용
        if is_price_q and entity_keywords:
            ranked_posts = _pick_price_posts(posts_hit, entity_keywords, query_for_intent, limit=5)
        else:
            ranked_posts = _rerank_posts(query_for_intent, posts_hit, limit=5)

        # rerank가 빈 배열을 반환하는 경우가 있다(예: "마케터제이 인스타 링크"처럼
        # 질문의 일부(외부 링크)는 자료에 없지만, 인물/주제 정보는 자료에 있는 케이스).
        # 이때 전체를 "자료 없음"으로 만들지 말고, 고유명 기반으로 최소 후보를 유지한다.
        if not ranked_posts and entity_keywords:
            primary = (entity_keywords[0] or "").lower().strip()
            if primary:
                fallback_posts = []
                for p in posts_hit:
                    text_ = ((p.get("title") or "") + " " + (p.get("norm_text") or "")).lower()
                    if primary in text_:
                        fallback_posts.append(p)
                if fallback_posts:
                    ranked_posts = fallback_posts[:5]
                    log.info("[ask_llm] rerank empty -> entity fallback", {"primary": primary, "fallback": len(ranked_posts)})

        # topic_only 게시글이 rerank 결과에 없으면 강제로 맨 앞에 추가
        # 예: "사알못 다시보기"를 물으면 사알못 관련 글이 반드시 포함되어야 함
        if topic_only_posts:
            ranked_ids = {p.get("post_id") for p in ranked_posts}
            missing_topics = [p for p in topic_only_posts if p.get("post_id") not in ranked_ids]
            if missing_topics:
                log.info(f"[ask_llm] adding {len(missing_topics)} topic_only posts to ranked results")
                ranked_posts = missing_topics[:2] + ranked_posts  # 최대 2개까지 강제 추가

        # link_hint 후보: rerank 상위 1개 중 거리 임계값 이내인 경우만 사용
        link_hint = ""
        if ranked_posts:
            best = ranked_posts[0]
            best_dist = best.get("dist")
            best_url = best.get("url")
            if best_url and best_dist is not None and best_dist <= KB_LINK_HINT_DIST_MAX:
                try:
                    best_post_id = int(best.get("post_id")) if best.get("post_id") is not None else None
                except (TypeError, ValueError):
                    best_post_id = None
                link_hint = _fix_cafe_url(best_url, best_post_id) if best_post_id is not None else best_url

        post_ids = [int(p["post_id"]) for p in ranked_posts if p.get("post_id")]
        manual_ids = [int(m["doc_id"]) for m in manuals_hit if m.get("doc_id")]

        # 가격/포인트 질문은 정책 매뉴얼이 벡터 상위에 안 걸릴 수 있어 DB 키워드 검색으로 보강한다.
        if is_price_q:
            for mid in _find_price_policy_manual_ids(limit=6):
                if mid not in manual_ids:
                    manual_ids.append(mid)

        manuals = _load_manuals(manual_ids)
        posts = _load_posts(post_ids)

        # 로드 후에도 날짜 키 미포함 글이면 최종 필터링 (없으면 바로 없음 응답)
        if date_keys:
            q_keys = set(date_keys)
            filtered_posts = []
            for p in posts:
                post_text = (p.get("title") or "") + " " + (p.get("norm_text") or "")
                p_keys = set(_extract_date_keys(post_text))
                if q_keys & p_keys:
                    filtered_posts.append(p)
            if filtered_posts:
                posts = filtered_posts
                post_ids = [int(p["post_id"]) for p in posts if p.get("post_id")]
            else:
                # 벡터 검색/rerank 후보가 날짜 표기를 포함하지 않아 누락될 수 있다.
                # 날짜 키 기반으로 DB에서 결정적 검색을 한 번 더 수행한다.
                fallback_menu_ids: list[int] = []
                try:
                    fallback_menu_ids = list(menu_ids) if menu_ids else [m["menu_id"] for m in get_all_menus() if m.get("collect")]
                except Exception:
                    fallback_menu_ids = []

                date_posts = _search_posts_by_date_keys(fallback_menu_ids, date_keys, limit=120) if fallback_menu_ids else []
                if entity_keywords and date_posts:
                    primary_lower = str(entity_keywords[0] or "").strip().lower()
                    if primary_lower:
                        exact = []
                        for p in date_posts:
                            text_ = ((p.get("title") or "") + " " + (p.get("norm_text") or "")).lower()
                            if primary_lower in text_:
                                exact.append(p)
                        if exact:
                            date_posts = exact

                if date_posts:
                    posts = date_posts[:5]
                    post_ids = [int(p["post_id"]) for p in posts if p.get("post_id")]
                    link_hint = ""  # 후보가 바뀌었으므로 기존 link_hint는 사용하지 않는다(오답 링크 방지)
                    log.info("[ask_llm] date filter empty -> DB date-key fallback", {"date_keys": date_keys, "fallback": len(posts)})
                else:
                    return {
                        "ok": True,
                        "query": req.query,
                        "answer": "질문한 날짜/강의에 맞는 카페 자료를 찾지 못했습니다. 최신 공지를 확인해 주세요.",
                        "model": None,
                        "manuals": manuals,
                        "posts": [],
                        "link_hint": "",
                        "took": time.time() - t0,
                        "diag": {"mode": "no_date_match", "rerank_candidates": len(posts_hit), "selected_posts": post_ids, "date_filter": "none"},
                    }

        # 강한 의도(다시보기/녹화)는 "로드된 본문" 기준으로 최종 필터링한다.
        # - vector_search의 norm_text는 일부만 포함될 수 있어, posts_hit 단계에서 강제 필터링하면 누락될 수 있음
        replay_required: list[str] = []
        if "다시보기" in q_lower:
            replay_required.append("다시보기")
        if "녹화" in q_lower:
            replay_required.append("녹화")
        if replay_required:
            reqs = [k.lower() for k in replay_required]
            filtered_posts = []
            for p in posts:
                text_ = ((p.get("title") or "") + " " + (p.get("norm_text") or "")).lower()
                if any(k in text_ for k in reqs):
                    filtered_posts.append(p)
            if filtered_posts:
                posts = filtered_posts
                post_ids = [int(p["post_id"]) for p in posts if p.get("post_id")]
            else:
                # 날짜가 포함된 질문에서 다시보기/녹화 공지가 아직 없을 수 있다.
                # 이 경우, 잘못된 링크를 추측해 주지 않고 "해당 날짜 글은 있으나 다시보기 공지는 못 찾음" 형태로 안내한다.
                if date_keys:
                    date_posts = posts[:3] if posts else []
                    if not date_posts and menu_ids:
                        try:
                            date_posts = _search_posts_by_date_keys(list(menu_ids), date_keys, limit=60)[:3]
                        except Exception:
                            date_posts = []
                    if date_posts:
                        answer_lines = [
                            "질문에 포함된 키워드(다시보기/녹화)에 해당하는 글은 찾지 못했습니다.",
                            "(참고: '다시보기'는 무료특강 라이브 이후 유료 VOD로 제공되는 것을 의미합니다.)",
                            "",
                            "질문에 포함된 날짜가 들어간 관련 글(신청/후기 등):",
                            _format_posts_as_list(date_posts),
                        ]
                        return {
                            "ok": True,
                            "query": req.query,
                            "answer": "\n".join([x for x in answer_lines if x]).strip(),
                            "model": None,
                            "manuals": manuals,
                            "posts": date_posts,
                            "link_hint": "",
                            "took": time.time() - t0,
                            "diag": {"mode": "keyword_filter_empty_with_date_posts", "required": replay_required, "date_keys": date_keys},
                        }
                return {
                    "ok": True,
                    "query": req.query,
                    "answer": "질문에 포함된 키워드(다시보기/녹화)에 해당하는 카페 자료를 찾지 못했습니다. (참고: '다시보기'는 무료특강 라이브 이후 유료 VOD로 제공되는 것을 의미합니다.)",
                    "model": None,
                    "manuals": manuals,
                    "posts": [],
                    "link_hint": "",
                    "took": time.time() - t0,
                    "diag": {"mode": "keyword_filter_empty", "required": replay_required},
                }

        # Sajulab: '포인트 추가 충전/추가 구매'는 수강생 매뉴얼 근거로만 답한다(추측 금지).
        tags_lower = [str(t).lower() for t in (req.context_tags or []) if t]
        is_sajulab = (
            ("sajulab" in tags_lower)
            or ("sajulab.kr" in tags_lower)
            or ("사주랩" in (query_for_intent or ""))
            or ("sajulab" in (query_for_intent or "").lower())
        )
        if is_sajulab and ("포인트" in (query_for_intent or "")) and re.search(
            r"(충전|추가\\s*충전|추가\\s*구매|추가구매|top\\s*up|topup)", q_lower
        ):
            sajulab_manual = None
            for m in manuals:
                title = str(m.get("title") or "").lower()
                if "sajulab" in title or "사주랩" in title:
                    sajulab_manual = m
                    break
            if sajulab_manual:
                body = (sajulab_manual.get("body_md") or sajulab_manual.get("summary") or "") or ""
                has_admin = ("운영자" in body) or ("관리자" in body)
                has_charge = "충전" in body
                has_point_menu = "포인트" in body

                lines = []
                if has_admin and has_charge:
                    lines.append("수강생용 매뉴얼에서는 '포인트 충전'을 운영자/관리자 설정 영역으로 언급하고 있습니다.")
                lines.append("수강생이 직접 포인트를 추가 충전/추가 구매하는 절차는 자료에 명시되어 있지 않아, 자료 기준으로 확인 불가합니다.")
                if has_point_menu:
                    lines.append("참고로 로그인 후 메뉴에 '포인트'가 있으며, 잔액/내역 등 포인트 관련 정보를 확인할 수 있습니다.")
                answer = "\n".join(f"- {x}" for x in lines if x).strip()
                return {
                    "ok": True,
                    "query": req.query,
                    "answer": answer,
                    "model": None,
                    "manuals": [sajulab_manual],
                    "posts": [],
                    "link_hint": "",
                    "took": time.time() - t0,
                    "diag": {"mode": "sajulab_points_topup"},
                }

        # Sajulab: 사용법/가이드 "링크/주소" 요청은 매뉴얼에 있는 URL만 결정적으로 제공한다.
        if is_sajulab and re.search(r"(링크|주소|url|접속)", q_lower) and re.search(r"(매뉴얼|가이드|사용법)", q_lower):
            sajulab_manual = None
            for m in manuals:
                title = str(m.get("title") or "").lower()
                if "sajulab" in title or "사주랩" in title:
                    sajulab_manual = m
                    break

            def _pick_url(text_: str) -> Optional[str]:
                if not text_:
                    return None
                for u in re.findall(r"https?://\S+", text_):
                    u2 = u.rstrip(".,;:)]}»\"'`<>")
                    if "sajulab.kr" in u2.lower():
                        return u2
                return None

            url = None
            if sajulab_manual:
                url = _pick_url(str(sajulab_manual.get("body_md") or "")) or _pick_url(str(sajulab_manual.get("summary") or ""))

            if url:
                answer = f"Sajulab 접속 주소:\n- {url}"
                return {
                    "ok": True,
                    "query": req.query,
                    "answer": answer,
                    "model": None,
                    "manuals": [sajulab_manual] if sajulab_manual else [],
                    "posts": [],
                    "link_hint": "",
                    "took": time.time() - t0,
                    "diag": {"mode": "sajulab_manual_link"},
                }

            return {
                "ok": True,
                "query": req.query,
                "answer": "사주랩 사용법 매뉴얼에서 링크/주소를 확인하지 못했습니다. 자료 기준으로 확인 불가합니다.",
                "model": None,
                "manuals": [sajulab_manual] if sajulab_manual else [],
                "posts": [],
                "link_hint": "",
                "took": time.time() - t0,
                "diag": {"mode": "sajulab_manual_link_empty"},
            }

        # 가격/포인트 질문이고, 매뉴얼에서 정책 숫자를 추출할 수 있는 경우에는
        # LLM 대신 결정적인 숫자 정보를 기반으로 템플릿 답변을 직접 생성한다.
        policy = None
        if _is_course_tier_price_policy_question(query_for_intent):
            policy = _extract_price_point_policy_from_manuals(manuals)
        if policy:
            # price_policy는 "정확한 숫자"가 핵심이라, 근거로 사용하지 않은 게시글/링크를 함께 반환하면
            # 사용자가 "엉뚱한 링크/중복 링크"로 오해할 수 있다. (운영자 피드백)
            #
            # - 답변은 정책 매뉴얼에서 추출한 숫자만으로 결정적으로 생성한다.
            # - 반환 posts/selected_posts는 비워 UI/로그에 불필요한 근거가 섞이지 않게 한다.
            # - link_hint도 벡터 검색 기반(무관한 글)일 수 있어, 기본은 사용하지 않는다.
            policy_manual_ids = set(_find_price_policy_manual_ids(limit=6))
            manuals_for_policy = manuals
            if policy_manual_ids:
                filtered = []
                for m in manuals or []:
                    try:
                        mid = int(m.get("doc_id")) if m.get("doc_id") is not None else None
                    except Exception:
                        mid = None
                    if mid is not None and mid in policy_manual_ids:
                        filtered.append(m)
                if filtered:
                    manuals_for_policy = filtered

            answer = _build_price_point_answer(query_for_intent, manuals_for_policy, [], policy, "")
            return {
                "ok": True,
                "query": req.query,
                "answer": answer,
                "model": None,
                "manuals": manuals_for_policy,
                "posts": [],
                "link_hint": "",
                "took": time.time() - t0,
                "diag": {
                    "mode": "price_policy",
                    "rerank_candidates": len(posts_hit),
                    "selected_posts": [],
                },
            }

        # 도메인 질의인데도 자료가 전혀 없으면: 일반 상식으로 내려가지 않고 "자료 없음"으로 응답한다.
        # 단, '누구야/정체/소개' 류는 entities(SSOT)만으로도 결정적 답변이 가능하므로 예외 처리한다.
        is_entity_intro = bool(
            entity_keywords
            and (
                _is_person_intro_query(query_for_intent)
                or (is_external_link_q and _match_entity_override(entity_keywords[0] if entity_keywords else ""))
            )
        )
        if not manuals and not posts and not is_entity_intro:
            return {
                "ok": True,
                "query": req.query,
                "answer": "관련 카페 자료를 찾지 못했습니다. 최신 공지를 확인해 주세요.",
                "model": None,
                "manuals": manuals,
                "posts": posts,
                "link_hint": "",
                "took": time.time() - t0,
                "diag": {
                    "mode": "no_docs",
                    "rerank_candidates": len(posts_hit),
                    "selected_posts": [],
                },
            }

        # NOTE: entity_intro(누구야/정체/소개/외부 링크 요청) 류는 상단에서 LLM 호출 없이 선처리한다.

        try:
            model = req.model or os.getenv("KB_LLM_MODEL") or "gpt-4.1-mini"
            prompt = _build_prompt(query_for_intent, manuals, posts)
            answer = _openai_generate_text(prompt, model=model, temperature=0.2, max_output_tokens=900)
            if not answer:
                raise HTTPException(status_code=502, detail="empty_llm_answer")

            # "자료 기준으로 확인 불가" 류 응답에는 링크를 붙이지 않는다(오답 링크/중복 링크 방지).
            _flat = re.sub(r"\s+", "", answer)
            if re.search(r"자료기준|확인불가|찾지못|관련카페자료를찾지못", _flat) and _is_effectively_no_info_answer(answer):
                return {
                    "ok": True,
                    "query": req.query,
                    "answer": "자료 기준으로 확인 불가.",
                    "model": model,
                    "manuals": [],
                    "posts": [],
                    "link_hint": "",
                    "took": time.time() - t0,
                    "diag": {
                        "mode": "no_docs_llm",
                        "rerank_candidates": len(posts_hit),
                        "selected_posts": [],
                    },
                }

            # 자료에 없는 URL 제거 + 중복 URL 제거 (환각 링크/중복 링크 방지)
            answer = _strip_unsupported_urls_in_answer(answer, manuals, posts)
            answer = _dedupe_urls_in_answer(answer)
            answer = _strip_disliked_boilerplate(answer)
            answer = _sanitize_external_link_answer(query_for_intent, answer, manuals, posts)
            answer = _strip_sensitive_numbers_in_answer(answer)
            if is_price_q:
                answer = _sanitize_discount_language_for_price_answer(query_for_intent, answer)
        except HTTPException as he:
            log.warning(f"[ask_llm] llm unavailable: {getattr(he, 'detail', he)}")
            fb = _dedupe_urls_in_answer(_build_domain_fallback_answer(query_for_intent, manuals, posts, link_hint))
            return {
                "ok": True,
                "query": req.query,
                "answer": fb,
                "model": None,
                "manuals": manuals,
                "posts": posts,
                "link_hint": link_hint,
                "took": time.time() - t0,
                "diag": {
                    "mode": "domain_fallback",
                    "reason": str(getattr(he, "detail", he)),
                    "rerank_candidates": len(posts_hit),
                    "selected_posts": post_ids,
                },
            }
        except Exception as e:
            log.exception(f"[ask_llm] llm failed: {e}")
            fb = _dedupe_urls_in_answer(_build_domain_fallback_answer(query_for_intent, manuals, posts, link_hint))
            return {
                "ok": True,
                "query": req.query,
                "answer": fb,
                "model": None,
                "manuals": manuals,
                "posts": posts,
                "link_hint": link_hint,
                "took": time.time() - t0,
                "diag": {
                    "mode": "domain_fallback",
                    "reason": str(e),
                    "rerank_candidates": len(posts_hit),
                    "selected_posts": post_ids,
                },
            }

        return {
            "ok": True,
            "query": req.query,
            "answer": answer,
            "model": model,
            "manuals": manuals,
            "posts": posts,
            "link_hint": link_hint,
            "took": time.time() - t0,
            "diag": {
                "rerank_candidates": len(posts_hit),
                "selected_posts": post_ids,
            },
        }
    except Exception as e:
        # ask_llm 전체는 "500으로 터지지 않고" 항상 안전한 응답을 반환해야 한다.
        # (node-iris 쪽에서는 이 응답을 그대로 사용자에게 보내므로, 내부 예외로 인해 무응답/오류가 나면 운영이 힘들다.)
        log.exception(f"/ask_llm failed: {e}")
        q = getattr(req, "query", "") or ""
        return {
            "ok": True,
            "query": q,
            "answer": "KB 응답 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
            "model": None,
            "manuals": [],
            "posts": [],
            "link_hint": "",
            "took": time.time() - t0,
            "diag": {"mode": "ask_llm_exception"},
        }
    finally:
        log.info(f"/ask_llm qlen={len(req.query)} took={time.time()-t0:.3f}s")


@app.get("/stats")
def stats():
    try:
        with db_session() as s:
            posts = s.execute(text("SELECT count(*) FROM sources_post")).scalar() or 0
            manuals = s.execute(text("SELECT count(*) FROM manual_doc")).scalar() or 0
            emb_posts = s.execute(text("SELECT count(*) FROM embeddings WHERE obj_type='post'" )).scalar() or 0
            emb_manuals = s.execute(text("SELECT count(*) FROM embeddings WHERE obj_type='manual'" )).scalar() or 0
            jobs = s.execute(text(
                "SELECT job_id, job_type, status, started_at, finished_at, payload, result FROM job_log ORDER BY started_at DESC LIMIT 50"
            )).mappings().all()
            cookie_row = s.execute(text("SELECT updated_at FROM secrets WHERE key='CAFE_COOKIES'" )).first()
        raw_jobs = [dict(r) for r in jobs]
        # API 계약: status는 running/success/failed/done 중 하나여야 한다.
        # 내부적으로 error 등의 값이 있을 수 있으나, 외부로는 failed로 정규화한다.
        norm_jobs: list[dict[str, Any]] = []
        allowed = {"running", "success", "failed", "done"}
        for j in raw_jobs:
            st = str(j.get("status") or "").lower()
            if st not in allowed:
                # error, unknown 등은 모두 failed로 취급
                j["status"] = "failed"
            norm_jobs.append(j)
        return {
            "ok": True,
            "counts": {"posts": posts, "manuals": manuals, "emb_posts": emb_posts, "emb_manuals": emb_manuals},
            "jobs": norm_jobs,
            "cookies": {"present": bool(cookie_row), "updated_at": (cookie_row[0].isoformat() if cookie_row else None)},
        }
    except Exception as e:
        log.exception(f"/stats failed: {e}")
        return JSONResponse(status_code=503, content={"ok": False, "error": "db_unavailable", "detail": str(e)})


class ReindexRequest(BaseModel):
    mode: str = "incremental"  # or full


@app.post("/reindex")
def reindex(_: ReindexRequest):
    return {"ok": True, "status": "queued"}


class RunTaskRequest(BaseModel):
    task: str  # collect|embed|manual|backfill
    pages: int | None = None


@app.post("/run")
def run_task(req: RunTaskRequest):
    task = req.task.lower()
    if task not in {"collect", "embed", "manual", "backfill"}:
        raise HTTPException(status_code=400, detail="invalid task")
    import sys
    root = os.path.dirname(os.path.dirname(__file__))
    ps_runner = os.path.join(root, "windows", "kb_task_runner.ps1")
    if platform.system() == "Windows" and os.path.exists(ps_runner):
        cmd = ["powershell", "-ExecutionPolicy", "Bypass", "-File", ps_runner, "-Task", task] + ([str(x) for x in (["-Pages", req.pages] if (req.pages or 0) > 0 else [])])
        log.info(f"spawn: {cmd}")
        subprocess.Popen(cmd, cwd=root, env=os.environ.copy())
        return {"ok": True, "status": "started", "via": "powershell", "task": task}
    mapping = {
        "collect": [sys.executable, os.path.join(root, "kb", "ingest.py")],
        "embed": [sys.executable, os.path.join(root, "kb", "update_embeddings.py")],
        "manual": [sys.executable, os.path.join(root, "kb", "manualize.py")],
        # 백필은 kb.backfill 모듈을 통해 프로필/메뉴 구성을 기준으로 실행한다.
        "backfill": [sys.executable, os.path.join(root, "kb", "backfill.py")],
    }
    log.info(f"spawn: {mapping[task]}")
    subprocess.Popen((mapping[task] + ([str(req.pages)] if False else [])), cwd=root, env=os.environ.copy())
    return {"ok": True, "status": "started", "via": "python", "task": task}


class CookiesIn(BaseModel):
    cookies: str


@app.post("/cookies")
def set_cookies(body: CookiesIn):
    ck = body.cookies.strip()
    if not ck:
        raise HTTPException(400, "empty cookies")
    with db_session() as s:
        s.execute(text(
            "INSERT INTO secrets(key,value,updated_at) VALUES('CAFE_COOKIES', :v, now())\n"
            "ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()"
        ), {"v": ck})
    os.environ["CAFE_COOKIES"] = ck
    log.info("cookies stored")
    return {"ok": True}


@app.post("/run_cookie")
def run_cookie():
    root = os.path.dirname(os.path.dirname(__file__))
    script = os.path.join(root, "scripts", "collect_cafe_cookies.js")
    if not os.path.exists(script):
        raise HTTPException(500, "collector script missing")
    log.info("launch cookie collector browser")
    env = os.environ.copy()
    env.setdefault("KB_URL", f"http://127.0.0.1:{os.getenv('PORT','8610')}")
    try:
        proc = subprocess.Popen(["node", script], cwd=root, env=env)
        log.info(f"cookie collector spawned pid={proc.pid}")
        return {"ok": True, "status": "started", "pid": proc.pid}
    except Exception as e:  # pragma: no cover
        log.exception(f"cookie collector spawn failed: {e}")
        return JSONResponse(status_code=500, content={"ok": False, "code": "spawn_failed", "detail": str(e)})


# --- Simple in-process scheduler (UI/ENV-togglable) ---
_SCHED: Dict[str, Dict[str, Any]] = {
    "collect": {"interval": 0, "next": None, "proc": None},
    "embed":   {"interval": 0, "next": None, "proc": None},
    "manual":  {"interval": 0, "next": None, "proc": None},
    "backfill": {"interval": 0, "next": None, "proc": None},
}

_SCHED_SECRET_KEY = "KB_SCHEDULE_JSON"


def _load_persisted_schedule() -> Dict[str, int]:
    """DB(secrets)에 저장된 스케줄을 로드한다. env가 비어 있을 때 fallback."""
    try:
        with db_session() as s:
            raw = s.execute(
                text("SELECT value FROM secrets WHERE key = :k"),
                {"k": _SCHED_SECRET_KEY},
            ).scalar()
        if not raw:
            return {}
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            return {}
        out: Dict[str, int] = {}
        for k, v in parsed.items():
            if k not in _SCHED:
                continue
            try:
                out[k] = max(0, int(v))
            except Exception:
                continue
        return out
    except Exception as e:
        log.warning(f"[sched] load persisted schedule failed: {e}")
        return {}


def _save_persisted_schedule(mapping: Dict[str, int]) -> None:
    """현재 스케줄을 DB에 저장한다."""
    try:
        raw = json.dumps(mapping, ensure_ascii=False)
        with db_session() as s:
            s.execute(
                text(
                    "INSERT INTO secrets(key, value, updated_at) VALUES(:k, :v, now())\n"
                    "ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()"
                ),
                {"k": _SCHED_SECRET_KEY, "v": raw},
            )
    except Exception as e:
        log.warning(f"[sched] persist schedule failed: {e}")


def _init_schedule_from_env(immediate: bool = False) -> None:
    """KB_SCHED_* env 또는 persisted schedule로 초기 스케줄 로드.

    - env가 설정돼 있으면 env 우선
    - env가 비어 있으면 DB에 저장된 스케줄 사용
    - immediate=True면 재시작 직후 즉시 1회 실행되도록 next를 now로 설정
    """

    persisted = _load_persisted_schedule()

    def _env_minutes(name: str) -> Optional[int]:
        raw = os.getenv(name)
        if raw is None:
            return None
        raw = raw.strip()
        if not raw:
            return None
        try:
            return max(0, int(raw))
        except Exception:
            return None

    env_map: Dict[str, Optional[int]] = {
        "collect": _env_minutes("KB_SCHED_COLLECT_MIN"),
        "embed": _env_minutes("KB_SCHED_EMBED_MIN"),
        "manual": _env_minutes("KB_SCHED_MANUAL_MIN"),
        "backfill": _env_minutes("KB_SCHED_BACKFILL_MIN"),
    }

    mapping: Dict[str, int] = {}
    for task, env_val in env_map.items():
        if env_val is not None:
            mapping[task] = env_val
        elif task in persisted:
            mapping[task] = persisted[task]
        else:
            mapping[task] = 0

    # env/persisted 모두 비어 있으면 운영 기본값으로 자동 설정
    if all(v == 0 for v in mapping.values()):
        mapping.update({"collect": 30, "embed": 30, "manual": 60, "backfill": 60})
        log.info("[sched] no env/persisted schedule; using defaults collect/embed=30m manual/backfill=60m")

    now = _dt.datetime.utcnow()
    for task, minutes in mapping.items():
        if task not in _SCHED:
            continue
        secs = max(0, minutes * 60)
        _SCHED[task]["interval"] = secs
        if secs > 0:
            _SCHED[task]["next"] = now if immediate else (now + _dt.timedelta(seconds=secs))
            log.info(f"[sched] init {task} every {minutes}m ({'immediate' if immediate else 'delayed'})")
        else:
            _SCHED[task]["next"] = None

def _spawn_task(task: str):
    try:
        # scheduler 내부에서 "최근 spawn" 힌트를 남겨, startup 직후 동시 실행/레이스(collect→embed)를 줄인다.
        try:
            if task in _SCHED:
                _SCHED[task]["proc"] = _dt.datetime.utcnow()
        except Exception:
            pass
        run_task(RunTaskRequest(task=task))
        log.info(f"[sched] spawned {task}")
    except Exception as e:  # pragma: no cover
        log.exception(f"[sched] spawn {task} failed: {e}")


def _task_lock_path(task: str) -> Path:
    root = Path(__file__).resolve().parent.parent
    return root / "logs" / f"kb_task_{task}.lock"


def _is_task_runner_process_alive(pid: int, task: str) -> bool:
    """kb_task_runner.ps1 프로세스가 실제로 살아있는지 확인한다.

    - scheduler가 lock 파일만 보고 '실행 중'으로 오판하면(서버 재시작/강제 종료 후)
      작업이 수 시간 동안 재개되지 않을 수 있다.
    - 반대로 살아있는 프로세스를 죽었다고 오판하면 중복 실행 위험이 있으므로,
      확인이 불가능한 경우에는 보수적으로 True(살아있음)로 취급한다.
    """
    if not pid or pid <= 0:
        return False
    if platform.system() == "Windows":
        try:
            # Get-CimInstance 결과가 없으면 프로세스가 없다는 의미다.
            ps = (
                "(Get-CimInstance Win32_Process -Filter "
                f"\\\"ProcessId={int(pid)}\\\").CommandLine"
            )
            cmd = subprocess.check_output(
                ["powershell", "-NoProfile", "-Command", ps],
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=2,
            ).strip()
            if not cmd:
                return False
            if "kb_task_runner.ps1" not in cmd:
                return False
            if not re.search(rf"-Task\\s+{re.escape(task)}\\b", cmd, flags=re.IGNORECASE):
                return False
            return True
        except subprocess.TimeoutExpired:
            # 확인이 애매하면 중복 실행 방지를 위해 살아있음으로 취급
            return True
        except Exception:
            # 확인 실패 시 '살아있음'으로 고정하면(예: 권한/일시 오류) 서버 재기동 후
            # 스케줄 작업이 영구적으로 멈춘 것처럼 보일 수 있다.
            #
            # 중복 실행은 kb_task_runner.ps1의 lock으로 2차 방어되므로,
            # 여기서는 보수적으로 False(미실행)로 처리해 "재개"를 우선한다.
            return False
    try:
        os.kill(int(pid), 0)
        return True
    except Exception:
        return False


def _task_lock_alive(task: str, max_age_sec: int = 6 * 60 * 60) -> bool:
    """kb_task_runner.ps1가 남긴 lock 파일이 '살아있다'고 볼지 판단한다."""
    p = _task_lock_path(task)
    if not p.exists():
        return False
    pid: int | None = None
    try:
        raw = (p.read_text(encoding="ascii", errors="ignore") or "").strip()
        if raw:
            pid = int(raw)
    except Exception:
        pid = None
    try:
        age = time.time() - p.stat().st_mtime
        if age > max_age_sec:
            return False
    except Exception:
        # stat 실패 시에는 보수적으로 running으로 취급
        return True

    # PID를 확인할 수 없으면(구 버전 lock 등) 보수적으로 running으로 취급
    if pid is None:
        return True

    alive = _is_task_runner_process_alive(pid, task)
    if alive:
        return True

    # 프로세스가 없거나 PID 재사용으로 보이면 stale lock: 삭제하고 '미실행'으로 처리
    try:
        p.unlink(missing_ok=True)
    except Exception:
        pass
    return False


def _task_recently_spawned(task: str, grace_sec: int = 30) -> bool:
    """lock 파일 생성 레이스를 피하기 위한 '최근 spawn' 힌트."""
    try:
        v = _SCHED.get(task, {}).get("proc")
        if isinstance(v, _dt.datetime):
            return (_dt.datetime.utcnow() - v).total_seconds() < grace_sec
    except Exception:
        return False
    return False


def _task_running_hint(task: str) -> bool:
    return _task_lock_alive(task) or _task_recently_spawned(task)


def _sched_loop():
    # 실행 순서/의존성: collect → manual → embed → backfill
    # - manualize가 새로운 manual_doc을 생성할 수 있으므로 embed는 manual 이후에 실행해야 누락이 없다.
    order = ["collect", "manual", "embed", "backfill"]
    while True:
        now = _dt.datetime.utcnow()
        for task in order:
            cfg = _SCHED.get(task) or {}
            itv = int(cfg.get("interval") or 0)
            if itv <= 0:
                continue
            nxt = cfg.get("next")
            if not nxt or now >= nxt:
                # 의존 작업이 돌고 있으면 다음 tick으로 미룬다(특히 startup 직후 동시 실행 방지).
                if task == "manual" and _task_running_hint("collect"):
                    continue
                if task == "embed" and (_task_running_hint("collect") or _task_running_hint("manual")):
                    continue
                if task == "backfill" and (
                    _task_running_hint("collect") or _task_running_hint("manual") or _task_running_hint("embed")
                ):
                    continue
                _spawn_task(task)
                cfg["next"] = now + _dt.timedelta(seconds=itv)
        time.sleep(15)


@app.on_event("startup")
def _start_scheduler():
    # 테스트(TestClient/pytest)에서는 in-process scheduler가 불필요하게 작업 프로세스를 spawn하며
    # 소켓/리소스 고갈(WinError 10055)을 유발할 수 있어 기본 비활성화한다.
    if os.getenv("KB_DISABLE_SCHEDULER") == "1" or os.getenv("PYTEST_CURRENT_TEST"):
        log.info("[sched] disabled for this process (KB_DISABLE_SCHEDULER/PYTEST_CURRENT_TEST)")
        return
    # 환경변수(KB_SCHED_*) 기반 초기 스케줄 반영
    _init_schedule_from_env(immediate=True)
    t = threading.Thread(target=_sched_loop, name="kb-scheduler", daemon=True)
    t.start()


@app.on_event("shutdown")
def _shutdown_cleanup():
    _close_openai_client()


class ScheduleIn(BaseModel):
    task: str
    interval_minutes: int  # 0 to disable


@app.get("/schedule")
def get_schedule():
    out = {}
    for k, v in _SCHED.items():
        n = v.get("next")
        out[k] = {
            "interval_minutes": int((v.get("interval") or 0) // 60),
            "next": (n.isoformat() + "Z") if n else None,
        }
    return {"ok": True, "schedule": out}


@app.post("/schedule")
def set_schedule(body: ScheduleIn):
    task = body.task.lower()
    if task not in _SCHED:
        raise HTTPException(400, "invalid task")
    minutes = max(0, int(body.interval_minutes))
    interval_secs = minutes * 60
    _SCHED[task]["interval"] = interval_secs
    _SCHED[task]["next"] = _dt.datetime.utcnow() + _dt.timedelta(seconds=interval_secs) if minutes else None
    log.info(f"[sched] set {task} every {minutes}m")
    # 재시작 후에도 유지되도록 전체 스케줄을 영속화한다.
    _save_persisted_schedule({k: int((v.get("interval") or 0) // 60) for k, v in _SCHED.items()})
    return {"ok": True, "task": task, "interval_minutes": minutes}


@app.get("/posts")
def list_posts(limit: int = 50):
    lim = max(1, min(int(limit or 50), 200))
    with db_session() as s:
        rows = s.execute(text(
            """
            SELECT post_id, menu_id, title, url, created_at, status
            FROM sources_post
            WHERE status='clean'
            ORDER BY created_at DESC NULLS LAST, post_id DESC
            LIMIT :lim
            """
        ), {"lim": lim}).mappings().all()
    return {"ok": True, "posts": [dict(r) for r in rows]}


@app.get("/manuals")
def list_manuals(limit: int = 50):
    lim = max(1, min(int(limit or 50), 200))
    with db_session() as s:
        rows = s.execute(text(
            """
            SELECT doc_id, title, status, summary, updated_at
            FROM manual_doc
            ORDER BY updated_at DESC NULLS LAST, doc_id DESC
            LIMIT :lim
            """
        ), {"lim": lim}).mappings().all()
    return {"ok": True, "manuals": [dict(r) for r in rows]}


@app.get("/menus")
def list_menus():
    """SSOT 메뉴 정보 반환 (ADR-0008)

    config/menus_dinohighclass.json의 메뉴 목록을 반환.
    UI에서 게시판별 수집 현황 표시에 사용.
    groups와 names 필드도 함께 반환하여 프론트엔드 호환성 확보.
    """
    try:
        menus = get_all_menus()
        cafe_id = get_cafe_id()

        # groups: { profile: { label, menuIds } } 형태로 변환
        profile_labels = {
            "free": "무료 특강",
            "paid": "정규 강의",
            "tips": "꿀팁",
            "community": "커뮤니티",
        }
        groups: Dict[str, Dict[str, Any]] = {}
        for profile, label in profile_labels.items():
            menu_ids = [m["menu_id"] for m in menus if m.get("profile") == profile]
            if menu_ids:
                groups[profile] = {"label": label, "menuIds": menu_ids}

        # names: { menuId: name } 형태로 변환
        names: Dict[str, str] = {}
        for m in menus:
            names[str(m["menu_id"])] = m.get("name", f"메뉴 {m['menu_id']}")

        return {
            "ok": True,
            "cafe_id": cafe_id,
            "menus": menus,
            "groups": groups,
            "names": names,
        }
    except FileNotFoundError as e:
        log.error(f"/menus SSOT not found: {e}")
        return JSONResponse(status_code=503, content={"ok": False, "code": "ssot_not_found", "detail": str(e)})
    except Exception as e:
        log.exception(f"/menus failed: {e}")
        return JSONResponse(status_code=500, content={"ok": False, "code": "internal_error", "detail": str(e)})


@app.get("/posts/by_menu")
def posts_by_menu():
    """게시판(menu_id)별 수집된 포스트 통계 반환

    UI에서 게시판별 수집 현황 표시에 사용.
    프론트엔드 기대 형식:
    { menus: { "23": { count, posts, oldest_at, newest_at }, ... } }
    """
    try:
        with db_session() as s:
            # 게시판별 포스트 수 및 날짜 범위 집계
            stats_rows = s.execute(text(
                """SELECT menu_id, COUNT(*) as count,
                          MIN(created_at) as oldest_at,
                          MAX(created_at) as newest_at
                FROM sources_post
                WHERE status = 'clean'
                GROUP BY menu_id"""
            )).mappings().all()

            stats_by_menu = {
                int(r["menu_id"]): {
                    "count": int(r["count"]),
                    "oldest_at": r["oldest_at"].isoformat() if r["oldest_at"] else None,
                    "newest_at": r["newest_at"].isoformat() if r["newest_at"] else None,
                }
                for r in stats_rows
            }

            # 각 게시판별 최근 5개 글
            recent_rows = s.execute(text(
                """SELECT menu_id, post_id, title, url, created_at
                FROM (
                    SELECT menu_id, post_id, title, url, created_at,
                           ROW_NUMBER() OVER (PARTITION BY menu_id ORDER BY created_at DESC) as rn
                    FROM sources_post
                    WHERE status = 'clean'
                ) sub
                WHERE rn <= 5
                ORDER BY menu_id, created_at DESC"""
            )).mappings().all()

            # menu_id별로 최근 글 그룹핑
            posts_by_menu: Dict[int, List[Dict[str, Any]]] = {}
            for r in recent_rows:
                mid = int(r["menu_id"])
                if mid not in posts_by_menu:
                    posts_by_menu[mid] = []
                posts_by_menu[mid].append({
                    "post_id": r["post_id"],
                    "menu_id": mid,
                    "title": r["title"],
                    "url": r["url"],
                    "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                })

            # 최종 결과 조합 (프론트엔드 형식: menus: { "23": { count, posts, oldest_at, newest_at } })
            menus_result: Dict[str, Dict[str, Any]] = {}
            for mid, stat in stats_by_menu.items():
                menus_result[str(mid)] = {
                    "count": stat["count"],
                    "oldest_at": stat["oldest_at"],
                    "newest_at": stat["newest_at"],
                    "posts": posts_by_menu.get(mid, []),
                }

        return {
            "ok": True,
            "menus": menus_result,
        }
    except Exception as e:
        log.exception(f"/posts/by_menu failed: {e}")
        return JSONResponse(status_code=500, content={"ok": False, "error": "internal_error", "detail": str(e)})


@app.get("/__whoami")
def whoami():
    return {"file": __file__}


@app.middleware("http")
async def log_requests(request: Request, call_next):
    req_id = str(uuid.uuid4())[:8]
    start = time.time()
    try:
        response = await call_next(request)
        return response
    except Exception as e:
        log.exception(f"req_id={req_id} path={request.url.path} error={e}")
        return JSONResponse(status_code=500, content={"error": "internal_error", "req_id": req_id})
    finally:
        dur = time.time() - start
        log.info(f"req_id={req_id} {request.method} {request.url.path} took={dur:.3f}s")


class LoginIn(BaseModel):
    id: str | None = None
    pw: str | None = None
    headless: bool | None = None
    channel: str | None = None


@app.post("/login")
def do_login(body: LoginIn):
    if body.id and body.pw:
        os.environ["NAVER_ID"] = body.id
        os.environ["NAVER_PW"] = body.pw
    # �⺻��: Windows������ â�� ���̵���(headless=false)
    if body.headless is not None:
        os.environ["KB_LOGIN_HEADLESS"] = "1" if body.headless else "0"
    else:
        os.environ["KB_LOGIN_HEADLESS"] = "0"
    if body.channel:
        os.environ["KB_LOGIN_CHANNEL"] = body.channel
    else:
        # �ý��� ũ�� �켱, ������ ��ũ��Ʈ���� ������ ����
        os.environ.setdefault("KB_LOGIN_CHANNEL", "chrome")
    ok = login_and_store()
    if not ok:
        raise HTTPException(500, "login_failed")
    return {"ok": True}


class CredsIn(BaseModel):
    id: str
    pw: str


@app.get("/creds")
def get_creds():
    return {"ok": True, **load_meta()}


@app.post("/creds")
def post_creds(body: CredsIn):
    try:
        save_creds(body.id, body.pw)
        return {"ok": True}
    except Exception as e:
        log.exception(f"save_creds failed: {e}")
        raise HTTPException(500, "save_failed")


# --- Backfill & Jobs Status Endpoints ---

@app.get("/backfill/status")
def backfill_status():
    """백필 상태 조회 (프론트엔드 폴링용)

    현재 백필 작업이 진행 중인지, 마지막 백필 결과를 반환.
    """
    try:
        with db_session() as s:
            # 진행 중인 백필 작업 조회
            running = s.execute(text(
                """SELECT job_id, job_type, status, started_at, payload
                FROM job_log
                WHERE job_type = 'backfill' AND status = 'running'
                ORDER BY started_at DESC
                LIMIT 1"""
            )).mappings().first()

            # 최근 완료된 백필 작업
            last_completed = s.execute(text(
                """SELECT job_id, job_type, status, started_at, finished_at, result
                FROM job_log
                WHERE job_type = 'backfill' AND status IN ('success', 'failed')
                ORDER BY finished_at DESC NULLS LAST
                LIMIT 1"""
            )).mappings().first()

        return {
            "ok": True,
            "running": dict(running) if running else None,
            "last_completed": dict(last_completed) if last_completed else None,
        }
    except Exception as e:
        log.exception(f"/backfill/status failed: {e}")
        return JSONResponse(status_code=500, content={"ok": False, "code": "db_error", "detail": str(e)})


@app.get("/jobs/running")
def jobs_running():
    """진행 중인 작업 목록 조회

    현재 실행 중인 모든 작업(collect, embed, manual, backfill 등)을 반환.
    """
    try:
        with db_session() as s:
            rows = s.execute(text(
                """SELECT job_id, job_type, status, started_at, payload
                FROM job_log
                WHERE status = 'running'
                ORDER BY started_at DESC"""
            )).mappings().all()

        return {
            "ok": True,
            "jobs": [dict(r) for r in rows],
            "count": len(rows),
        }
    except Exception as e:
        log.exception(f"/jobs/running failed: {e}")
        return JSONResponse(status_code=500, content={"ok": False, "code": "db_error", "detail": str(e)})
