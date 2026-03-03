#!/usr/bin/env python3
"""
카페 회원이 실제로 물어볼 만한 "창의적/다양한" 질문 20개로 RAG 응답을 점검한다.

- base_url: 기본 `http://127.0.0.1:8610`
- 결과: `tmp/rag_eval_creative_20_v2.md` (마크다운)

자동 체크(보수적):
- 일반 상식 경로 답변에 URL이 포함되면 FAIL (정책상 금지)
- 중복 URL이 있으면 FAIL
- 사용자 불만이 컸던 상투 문구(“최근 카페에서의…”, “아래 버튼…”)가 있으면 FAIL

주의:
- 이 스크립트는 ‘정답’을 자동 채점하지 않는다. (의도 충족/정확성은 사람이 최종 확인)
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
OUT_PATH = Path("tmp/rag_eval_creative_20_v2.md")

GENERAL_PREFIX = "가이드라인에는 없지만, 일반 상식으로 답변드립니다."
URL_RE = re.compile(r"https?://\\S+")

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
        name="01) 이번 주말 무료특강 신청 2개",
        query="이번 주말에 하는 무료특강 신청 글 2개만 링크로 줘",
        context_tags=["dinohighclass"],
        expect_mode="schedule_recent",
    ),
    Case(
        name="02) 가장 최근 정규강의 신청 1개",
        query="정규강의 신청 글 중 가장 최근 글 1개만 링크",
        context_tags=["dinohighclass"],
        expect_mode="schedule_recent",
    ),
    Case(
        name="03) 가장 최근 무료특강 후기 1개",
        query="무료특강 후기 글 중 가장 최근 글 1개 링크",
        context_tags=["dinohighclass"],
        expect_mode="review_recent",
    ),
    Case(
        name="04) 가입인사 자동 등업 규칙",
        query="가입인사 쓰면 자동 등업되는 조건/규칙이 뭐야?",
        context_tags=["dinohighclass"],
        expect_mode="membership_policy",
    ),
    Case(
        name="05) 등업 승인까지 소요시간(자료 없으면 보류)",
        query="등업 승인까지 보통 얼마나 걸려?",
        context_tags=["dinohighclass"],
    ),
    Case(
        name="06) 마케터제이 소개",
        query="마케터제이가 누구야?",
        context_tags=["dinohighclass"],
        expect_mode="entity_intro",
    ),
    Case(
        name="07) 룰루랄라릴리 소개",
        query="룰루랄라릴리는 어떤 강의 하는 강사야?",
        context_tags=["dinohighclass"],
        expect_mode="entity_intro",
    ),
    Case(
        name="08) 강사들의 꿀팁 게시판은 제외",
        query="강사들의 꿀팁 게시판 글 있어?",
        context_tags=["dinohighclass"],
        expect_mode="disabled_board",
    ),
    Case(
        name="09) 캡컷 프로 가격/할인",
        query="캡컷 프로 가격/할인 정보 있나?",
        context_tags=["dinohighclass"],
    ),
    Case(
        name="10) 캡컷 자막 자동 생성",
        query="캡컷에서 자막 자동 생성하는 방법 글 있어?",
        context_tags=["dinohighclass"],
    ),
    Case(
        name="11) 유마고치가 뭐야(카페 맥락)",
        query="유마고치가 뭐야? 카페에서 왜 자주 나와?",
        context_tags=["dinohighclass"],
    ),
    Case(
        name="12) 일반반 vs 비지니스반 포인트 차이",
        query="사알못 강의 일반반이랑 비지니스반 포인트 차이가 얼마야?",
        context_tags=["dinohighclass"],
        expect_mode="price_policy",
    ),
    Case(
        name="13) 다시보기 의미/구조",
        query="무료특강 다시보기는 뭐고 어떻게 구매해?",
        context_tags=["dinohighclass"],
    ),
    Case(
        name="14) 12/3 무료특강 다시보기 링크",
        query="12/3 무료특강 다시보기 링크",
        context_tags=["dinohighclass"],
        expect_mode="keyword_filter_empty_with_date_posts",
    ),
    Case(
        name="15) Sajulab 결과 PDF 다운로드",
        query="Sajulab 결과 PDF 다운로드 방법 알려줘",
        context_tags=["dinohighclass", "sajulab", "sajulab.kr"],
    ),
    Case(
        name="16) Sajulab 로그인/인증 문제",
        query="Sajulab 로그인/인증이 안될 때 어떻게 해?",
        context_tags=["dinohighclass", "sajulab", "sajulab.kr"],
    ),
    Case(
        name="17) 일반 상식: 유튜브 수익창출 기준",
        query="유튜브 수익창출 기준 알려줘",
        context_tags=["dinohighclass"],
        expect_mode="general_out_of_scope",
    ),
    Case(
        name="18) 뉴스/루머: 열애설(최신 근거 없으면 보류)",
        query="티파니 열애설 공식 발표 났어?",
        context_tags=[],
        expect_mode="general_out_of_scope",
    ),
    Case(
        name="19) 일반 상식: hostname -I 의미",
        query="hostname -I 치면 여러 IP가 나오는데 각각 뭐야?",
        context_tags=[],
        expect_mode="general_out_of_scope",
    ),
    Case(
        name="20) 다음 강의(포괄 질문) -> 최신 공지",
        query="가장 최근에 진행한 강의가 뭐야?",
        context_tags=["dinohighclass"],
        expect_mode="latest_lecture",
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


def run_case(case: Case, timeout: int = 90) -> dict[str, Any]:
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
    expect_mode_ok = True if not case.expect_mode else (mode == case.expect_mode)
    auto_pass = bool(ok) and bool(expect_mode_ok) and not general_has_url and not disallowed and not url_dups

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
    }


def write_report(results: list[tuple[Case, dict[str, Any]]]) -> None:
    lines: list[str] = []
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    lines.append("# RAG 점검 결과 (creative 20 v2)")
    lines.append("")
    lines.append(f"- base_url: `{BASE_URL}`")
    lines.append(f"- 생성 시각: {now}")
    lines.append("")

    total = len(results)
    passed = sum(1 for _, r in results if r.get("auto_pass"))
    lines.append("## 요약")
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
        lines.append(f"- context_tags: `{', '.join(case.context_tags)}`" if case.context_tags else "- context_tags: (없음)")
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
            for u in urls:
                lines.append(f"- {u}")
        lines.append("")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
    print(f"[ok] wrote {OUT_PATH}")


def main() -> int:
    results: list[tuple[Case, dict[str, Any]]] = []
    for case in CASES:
        try:
            r = run_case(case)
        except Exception as e:
            r = {
                "http": 0,
                "took": 0.0,
                "ok": False,
                "mode": "",
                "answer": f"(ERROR) {e}",
                "urls": [],
                "url_dups": [],
                "disallowed": [],
                "auto_pass": False,
                "diag": {"error": str(e)},
            }
        results.append((case, r))
        time.sleep(0.1)
    write_report(results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
