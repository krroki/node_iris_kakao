#!/usr/bin/env python3
"""
카페 회원이 실제로 물어볼 법한 "창의적" 질문 20개를 골라 RAG 응답을 빠르게 점검한다.

- base_url: 기본 `http://127.0.0.1:8610`
- 결과: `tmp/rag_eval_creative_20.md` (마크다운)

주의:
- 이 스크립트는 '정답'을 자동 채점하지 않는다. 대신 운영 가드레일 위반(중복 URL, 금지 문구, 일반상식 경로 URL 출력)을
  기계적으로 체크하고, 최종 확인은 사람이 한다.
"""

from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import requests


BASE_URL = os.getenv("KB_URL", "http://127.0.0.1:8610").rstrip("/")
OUT_PATH = Path("tmp/rag_eval_creative_20.md")

GENERAL_PREFIX = "가이드라인에는 없지만, 일반 상식으로 답변드립니다."

URL_RE = re.compile(r"https?://\S+")

# 운영자가 싫어하는 출력 패턴(LLM이 종종 붙이는 문구)
DISALLOWED_PHRASES = [
    "최근 카페에서의",
    "핵심 1가지를 요약",
    "더 자세한 내용은",
    "아래 버튼",
    "눌러 확인",
]


@dataclass(frozen=True)
class Case:
    name: str
    query: str
    context_tags: list[str]
    expect_mode: Optional[str] = None
    note: Optional[str] = None


CASES: list[Case] = [
    Case(
        name="01) 이번 주 무료특강 신청 2개",
        query="이번 주 무료특강 신청 글 2개만 링크",
        context_tags=["dinohighclass", "?디하클"],
        expect_mode="schedule_recent",
    ),
    Case(
        name="02) 정규강의 신청(키워드 포함)",
        query="정규 강의 신청 글 중에서 'AI 마스터즈' 관련 최근 글 링크 1개만",
        context_tags=["dinohighclass", "?디하클"],
    ),
    Case(
        name="03) 무료특강 후기(키워드 포함)",
        query="무료특강 후기 중 'AI 영상' 관련 최근 글 1개만",
        context_tags=["dinohighclass", "?디하클"],
    ),
    Case(
        name="04) 가입 인사 자동 등업 규칙",
        query="가입 인사 글 작성하면 자동 등업이 되는 조건/규칙이 뭐야?",
        context_tags=["dinohighclass", "?디하클"],
        expect_mode="membership_policy",
    ),
    Case(
        name="05) 등업 승인 소요시간(자료 없을 수 있음)",
        query="등업 승인까지 보통 얼마나 걸려?",
        context_tags=["dinohighclass", "?디하클"],
    ),
    Case(
        name="06) 수익 인증 게시판 글 작성 규칙",
        query="개인 수익 인증 게시판에 글 올릴 때 주의사항/규칙 있어?",
        context_tags=["dinohighclass", "?디하클"],
    ),
    Case(
        name="07) 운영자의 꿀팁 최근 글",
        query="카페 운영자의 꿀팁 게시판에서 최근 글 1개 링크",
        context_tags=["dinohighclass", "?디하클"],
        expect_mode="recent_posts",
    ),
    Case(
        name="08) 강사들의 꿀팁(수집/조회 제외)",
        query="강사들의 꿀팁 최근 글 있어?",
        context_tags=["dinohighclass", "?디하클"],
        expect_mode="disabled_board",
    ),
    Case(
        name="09) 강사 소개(룰루랄라릴리)",
        query="룰루랄라릴리가 누구야? 어떤 강의 했어?",
        context_tags=["dinohighclass", "?디하클"],
        expect_mode="entity_intro",
    ),
    Case(
        name="10) 운영자 소개(마케터제이)",
        query="마케터제이가 누구야?",
        context_tags=["dinohighclass", "?디하클"],
        expect_mode="entity_intro",
    ),
    Case(
        name="11) 외부 링크 요청(SSOT 기반 차단)",
        query="마케터제이 인스타 링크 있어?",
        context_tags=["dinohighclass", "?디하클"],
        expect_mode="entity_intro",
    ),
    Case(
        name="12) Sajulab 포인트 추가 충전",
        query="사주랩 포인트 추가 충전/추가 구매는 어디서 해?",
        context_tags=["dinohighclass", "sajulab", "sajulab.kr"],
    ),
    Case(
        name="13) Sajulab 결과 PDF 다운로드",
        query="사주랩 결과 pdf 다운로드 방법 알려줘",
        context_tags=["dinohighclass", "sajulab", "sajulab.kr"],
    ),
    Case(
        name="14) 다시보기 의미/공지(일반)",
        query="무료특강 다시보기는 보통 언제/어디에 공지돼?",
        context_tags=["dinohighclass", "?디하클"],
        note="자료가 없으면 '자료 기준으로 확인 불가'가 나와야 함(추측/링크 생성 금지)",
    ),
    Case(
        name="15) 특정 날짜(미래) 다시보기",
        query="12/31 무료특강 다시보기 링크",
        context_tags=["dinohighclass", "?디하클"],
    ),
    Case(
        name="16) 캡컷 할인/구독 질문",
        query="캡컷 프로 할인/구독료 관련 카페 글 있어?",
        context_tags=["dinohighclass", "?디하클"],
    ),
    Case(
        name="17) 공지: 링크 공유 정책",
        query="카페/단톡방에서 레퍼런스 링크 공유해도 돼? 관련 공지 있으면 요약해줘",
        context_tags=["dinohighclass", "?디하클"],
    ),
    Case(
        name="18) 비지니스반 vs 일반반 차이(정책 숫자)",
        query="비지니스반이랑 일반반 포인트 차이 얼마야?",
        context_tags=["dinohighclass", "?디하클"],
        expect_mode="price_policy",
    ),
    Case(
        name="19) 다시보기 가격 질문(추측 금지)",
        query="무료특강 다시보기 가격은 보통 얼마야?",
        context_tags=["dinohighclass", "?디하클"],
        note="자료가 없으면 금액 추측 금지",
    ),
    Case(
        name="20) 일반 상식(웹검색) - 유튜브 수익창출",
        query="디하클이랑 무관한데, 유튜브 수익창출 기준 알려줘",
        context_tags=["dinohighclass", "?디하클"],
        expect_mode="general_out_of_scope",
    ),
]


def _extract_urls(text: str) -> list[str]:
    return URL_RE.findall(text or "")


def _has_disallowed_phrase(text: str) -> list[str]:
    out: list[str] = []
    t = text or ""
    for p in DISALLOWED_PHRASES:
        if p and p in t:
            out.append(p)
    return out


def run_case(case: Case, timeout: int = 60) -> dict[str, Any]:
    payload: dict[str, Any] = {"query": case.query, "top_k": 6}
    if case.context_tags:
        payload["context_tags"] = case.context_tags
    t0 = time.time()
    r = requests.post(f"{BASE_URL}/ask_llm", json=payload, timeout=timeout)
    took = time.time() - t0
    data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    answer = str(data.get("answer") or "")
    diag = data.get("diag") or {}
    mode = str(diag.get("mode") or "")

    urls = _extract_urls(answer)
    url_dups = sorted({u for u in urls if urls.count(u) > 1})
    disallowed = _has_disallowed_phrase(answer)

    is_general = answer.strip().startswith(GENERAL_PREFIX)
    general_has_url = is_general and bool(urls)

    ok = bool(data.get("ok") is True) and (r.status_code == 200)
    expect_ok = True
    expect_mode_ok = True if not case.expect_mode else (mode == case.expect_mode)

    # 자동 PASS 기준(보수적): HTTP/ok + (기대 mode 있으면 일치) + 일반상식 경로 URL 금지 + 금지 문구 없음 + URL 중복 없음
    auto_pass = bool(ok == expect_ok) and bool(expect_mode_ok) and not general_has_url and not disallowed and not url_dups

    return {
        "http": r.status_code,
        "took": took,
        "ok": ok,
        "mode": mode,
        "answer": answer.strip(),
        "urls": urls,
        "url_dups": url_dups,
        "disallowed": disallowed,
        "auto_pass": auto_pass,
        "diag": diag,
        "raw": data,
    }


def write_report(results: list[tuple[Case, dict[str, Any]]]) -> None:
    lines: list[str] = []
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    lines.append("# RAG 점검 결과 (creative 20)")
    lines.append("")
    lines.append(f"- base_url: `{BASE_URL}`")
    lines.append(f"- 생성 시각: {now}")
    lines.append("")

    total = len(results)
    passed = sum(1 for _, r in results if r.get("auto_pass"))
    lines.append(f"## 요약")
    lines.append(f"- 자동 PASS: {passed}/{total}")
    lines.append("")

    for idx, (case, r) in enumerate(results, 1):
        urls = r.get("urls") or []
        mode = r.get("mode") or ""
        took = float(r.get("took") or 0)
        http = r.get("http")
        auto = "PASS" if r.get("auto_pass") else "FAIL"
        disallowed = r.get("disallowed") or []
        dups = r.get("url_dups") or []
        lines.append(f"## {idx:02d}. {case.name}")
        lines.append(f"- 질문: {case.query}")
        lines.append(f"- context_tags: `{', '.join(case.context_tags)}`")
        if case.note:
            lines.append(f"- note: {case.note}")
        lines.append(f"- HTTP: {http} / took: {took:.2f}s / mode: `{mode}` / urls: {len(urls)}")
        lines.append(f"- 판정(자동): {auto}")
        if case.expect_mode:
            lines.append(f"- 기대 mode: `{case.expect_mode}`")
        if disallowed:
            lines.append(f"- 금지 문구 감지: {', '.join(disallowed)}")
        if dups:
            lines.append(f"- URL 중복: {', '.join(dups)}")
        if (r.get("answer") or "").strip():
            lines.append("")
            lines.append("### 답변")
            lines.append("```")
            lines.append((r.get("answer") or "").strip())
            lines.append("```")
        if urls:
            lines.append("### URL")
            for u in sorted(set(urls)):
                lines.append(f"- {u}")
        lines.append("")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def main() -> int:
    # health check
    try:
        h = requests.get(f"{BASE_URL}/health", timeout=5)
        if h.status_code != 200:
            print(f"[ERROR] KB health not ok: {BASE_URL}")
            return 2
    except Exception as e:
        print(f"[ERROR] KB not reachable: {e}")
        return 2

    results: list[tuple[Case, dict[str, Any]]] = []
    for c in CASES:
        try:
            r = run_case(c)
        except Exception as e:
            r = {"http": 0, "took": 0.0, "ok": False, "mode": "", "answer": f"REQUEST ERROR: {e}", "urls": [], "auto_pass": False}
        results.append((c, r))
        # 작은 딜레이로 웹검색/LLM 연속 호출 부하 완화
        time.sleep(0.2)

    write_report(results)
    print(f"[OK] wrote: {OUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

