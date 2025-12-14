#!/usr/bin/env python3
"""
RAG 질문 품질 수동 점검 스크립트.

- 강의/다시보기/일정 질문
- 유튜브/쇼츠/수익화 관련 예상 질문

각 질문에 대해:
  - /ask_llm 응답 요약
  - 선택된 post_id / menu_id / title
  - 일반 상식 프리픽스 여부, URL 포함 여부
를 출력하여 사람이 직접 품질을 확인할 수 있게 한다.
"""

import json
import sys
import time
from dataclasses import dataclass
from typing import Optional

import requests
from sqlalchemy import text

from kb.db import db_session


BASE_URL = "http://127.0.0.1:8610"
GENERAL_PREFIX = "가이드라인에는 없지만, 일반 상식으로 답변드립니다."


@dataclass
class ProbeCase:
    name: str
    query: str
    note: Optional[str] = None


CASES = [
    # 강의/다시보기 계열
    ProbeCase(
        name="사알못 다시보기 링크",
        query="사알못 다시보기 링크",
        note="사알못 무료특강/후기/정규강의 관련 글들을 근거로 삼는지 확인",
    ),
    ProbeCase(
        name="12월 3일 강의 여부",
        query="12월 3일에 강의 했었어?",
        note="12월 3일 무료특강 공지 및 후기 글을 근거로 삼는지 확인",
    ),
    ProbeCase(
        name="다음 사알못 강의 일정",
        query="다음 사알못 강의 일정 알려줘",
    ),
    # 유튜브/쇼츠/수익화 계열
    ProbeCase(
        name="쇼츠 수익화 조건",
        query="유튜브 쇼츠 수익화 조건 알려줘",
        note="카페 글에 유튜브/쇼츠 수익화 언급이 있으면 그 글을, 없으면 일반 상식 경로로 가는지 확인",
    ),
    ProbeCase(
        name="쇼츠 조회수 안 나올 때",
        query="쇼츠 조회수 안 나올 때 디하클에서는 뭐라고 해?",
    ),
    ProbeCase(
        name="쇼츠로 월 천만원",
        query="유튜브 쇼츠로 월 천만원 벌려면 어떻게 해야 돼?",
    ),
]


def describe_posts(ids):
    if not ids:
        return []
    with db_session() as s:
        rows = s.execute(
            text(
                "SELECT post_id, menu_id, title FROM sources_post "
                "WHERE post_id = ANY(:ids) ORDER BY post_id"
            ),
            {"ids": list(ids)},
        ).mappings().all()
    out = []
    for r in rows:
        out.append(
            {
                "post_id": int(r["post_id"]),
                "menu_id": int(r["menu_id"]),
                "title": r["title"],
            }
        )
    return out


def probe(case: ProbeCase, timeout: int = 90) -> None:
    print(f"\n[CASE] {case.name}")
    print(f"  Q: {case.query}")
    if case.note:
        print(f"  NOTE: {case.note}")

    t0 = time.time()
    try:
        resp = requests.post(
            f"{BASE_URL}/ask_llm",
            json={"query": case.query, "top_k": 6},
            timeout=timeout,
        )
    except Exception as e:
        print(f"  ERROR: request failed: {e}")
        return
    took = time.time() - t0
    print(f"  HTTP: {resp.status_code} ({took:.2f}s)")
    try:
        data = resp.json()
    except Exception:
        print(f"  BODY: {resp.text[:200]}")
        return

    if not data.get("ok"):
        print(f"  ERROR: ok=false, body={json.dumps(data, ensure_ascii=False)[:200]}")
        return

    answer = (data.get("answer") or "").strip()
    posts = data.get("posts") or []
    diag = data.get("diag") or {}
    selected = diag.get("selected_posts") or []

    print(f"  model: {data.get('model')}  posts={len(posts)}  selected={selected}")

    # 선택된 post들의 요약 (DB에서 title/menu_id 가져오기)
    if selected:
        meta = describe_posts(selected)
        for m in meta:
            print(
                f"    - post_id={m['post_id']} menu_id={m['menu_id']} title={m['title']}"
            )

    # 일반 상식 프리픽스 & URL 포함 여부
    is_general = answer.startswith(GENERAL_PREFIX)
    has_url = ("http://" in answer) or ("https://" in answer)
    print(f"  general_prefix={is_general}  has_url={has_url}")
    print("  answer_preview:")
    print("    " + answer.replace("\n", " ")[:200])


def main():
    # KB 서비스 헬스체크
    try:
        r = requests.get(f"{BASE_URL}/health", timeout=5)
        if r.status_code != 200:
            print(f"[ERROR] KB 서비스 응답 없음: {BASE_URL}")
            sys.exit(1)
    except Exception as e:
        print(f"[ERROR] KB 서비스 연결 실패: {e}")
        sys.exit(1)

    print(f"=== RAG 질문 품질 프로빙 시작 ({BASE_URL}) ===")
    for c in CASES:
        probe(c)


if __name__ == "__main__":
    main()

