from __future__ import annotations

import os
import re
import time
from typing import Any, Optional

from kb.logging_util import get_logger

log = get_logger("kb.ocr")


def extract_image_urls_from_html(html: str) -> list[str]:
    if not html:
        return []
    # contentHtml에 포함된 img src 추출 (attachList가 비어있는 케이스 대응)
    urls = re.findall(r"<img[^>]+src=[\"']([^\"']+)[\"']", html, flags=re.IGNORECASE)
    out: list[str] = []
    seen: set[str] = set()
    for u in urls:
        u = (u or "").strip()
        if not u or u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out


def filter_ocr_candidate_urls(urls: list[str], limit: int = 8) -> list[str]:
    """OCR에 적합한 이미지 URL만 추려낸다.

    - 카페 본문 이미지가 들어가는 대표 도메인(cafeptthumb 등)을 우선 사용
    - 너무 작은 썸네일(ff120)·로고·외부 survey/광고 이미지는 제외
    """
    if not urls:
        return []
    out: list[str] = []
    for u in urls:
        ul = (u or "").lower()
        if not ul:
            continue
        # 작은 썸네일/외부 로고 제외
        if "dthumb-phinf.pstatic.net" in ul and "type=ff120" in ul:
            continue
        if "survey.pstatic.net" in ul:
            continue
        if "logo" in ul and ("pstatic.net" in ul):
            continue

        # 카페 본문/첨부 이미지 후보
        is_cafe_img = any(
            h in ul
            for h in [
                "cafeptthumb-phinf.pstatic.net",
                "cafept.pstatic.net",
                "postfiles.pstatic.net",
                "phinf.pstatic.net",
            ]
        )
        if not is_cafe_img:
            continue
        # 가능한 큰 타입 우선(글에 포함된 이미지 슬라이드/표)
        if ("type=w1600" in ul) or ("type=w800" in ul) or ("type=w" in ul):
            out.append(u)
        else:
            # type 파라미터가 없어도 본문 이미지일 수 있어 보수적으로 포함
            out.append(u)

        if len(out) >= max(1, int(limit)):
            break
    return out


def _env_truthy(name: str, default: str = "1") -> bool:
    v = str(os.getenv(name, default)).strip().lower()
    return v not in {"0", "false", "no", "off", ""}


def openai_ocr_images(
    image_urls: list[str],
    *,
    model: Optional[str] = None,
    max_output_tokens: int = 800,
    sleep_sec: float = 0.0,
) -> str:
    """OpenAI 멀티모달로 이미지 OCR 텍스트를 추출한다.

    출력은 "가격/수강료/포인트/할인/무이자/기간" 관련 텍스트 위주로 제한한다.
    """
    if not image_urls:
        return ""

    # OCR은 비용/지연이 커질 수 있어, 전역 토글로 끌 수 있게 한다.
    if not _env_truthy("KB_OCR_ENABLED", "1"):
        return ""

    key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
    if not key:
        return ""

    try:
        from openai import OpenAI  # type: ignore
    except Exception:
        return ""

    m = model or os.getenv("KB_OCR_MODEL") or os.getenv("KB_LLM_MODEL") or "gpt-4.1-mini"
    prompt = "\n".join(
        [
            "너는 이미지 속 텍스트를 읽는 OCR 보조자다.",
            "아래 이미지들에서 '가격/수강료/포인트/할인/무이자/결제/기간/기수/정규/특강'과 관련된 텍스트만 추출해라.",
            "규칙:",
            "1) 숫자와 단위(원/만원/포인트/%/개월 등)는 그대로 유지",
            "2) 불필요한 문장/감상/광고 문구는 제외",
            "3) 표/항목은 줄바꿈으로 나눠 사람이 읽기 좋게",
            "4) URL(https:// 등)은 출력하지 말 것",
            "5) 답은 텍스트만(머리말/헤더/불릿 기호 강제 없음)",
        ]
    ).strip()

    content: list[dict[str, Any]] = [{"type": "input_text", "text": prompt}]
    for u in image_urls:
        content.append({"type": "input_image", "image_url": u})

    client = OpenAI(
        api_key=key,
        max_retries=int(os.getenv("OPENAI_MAX_RETRIES", "0") or "0"),
        timeout=float(os.getenv("KB_LLM_HTTP_TIMEOUT", os.getenv("KB_HTTP_TIMEOUT", "20"))),
    )
    try:
        resp = client.responses.create(
            model=m,
            input=[{"role": "user", "content": content}],
            temperature=0.0,
            max_output_tokens=int(max_output_tokens),
        )
        txt = (getattr(resp, "output_text", None) or "").strip()
        # 과도한 공백 정리
        txt = re.sub(r"[ \t]+\n", "\n", txt)
        txt = re.sub(r"\n{3,}", "\n\n", txt).strip()
        if sleep_sec:
            time.sleep(float(sleep_sec))
        return txt
    except Exception as e:
        log.info(f"[ocr] openai ocr failed: {type(e).__name__}: {e}")
        return ""

