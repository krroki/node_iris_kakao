#!/usr/bin/env python3
"""
KB /ask_llm 단발 테스트용 헬퍼 스크립트.

사용:
  python scripts/quick_call_ask_llm.py "질문 내용"

옵션:
  --base-url   KB base URL (기본: http://127.0.0.1:8610)
  --tags       context_tags (콤마 구분, 기본: dinohighclass)
  --no-tags    context_tags 전송 안 함 (라우팅 디버그용)
  --model      LLM 모델 override (예: gpt-4.1)

NOTE:
- node-iris-app은 기본적으로 context_tags를 붙여 KB에 질의한다.
  이 스크립트도 기본 tags를 붙여 동일 조건으로 테스트한다.
"""

from __future__ import annotations

import argparse
import sys
import time
from typing import Any

import requests

DEFAULT_BASE_URL = "http://127.0.0.1:8610"


def _split_tags(raw: str) -> list[str]:
    items = [t.strip() for t in (raw or "").split(",")]
    return [t for t in items if t]


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL)
    ap.add_argument("--tags", default="dinohighclass", help="context_tags (콤마 구분)")
    ap.add_argument("--no-tags", action="store_true")
    ap.add_argument("--model", default="", help="LLM 모델 override (예: gpt-4.1)")
    ap.add_argument("query", nargs="+")
    args = ap.parse_args(argv)

    query = " ".join(args.query).strip()
    if not query:
        print('Usage: python scripts/quick_call_ask_llm.py "질문 내용"')
        return 1

    payload: dict[str, Any] = {"query": query, "top_k": 6}
    if not args.no_tags:
        tags = _split_tags(args.tags)
        if tags:
            payload["context_tags"] = tags
    if args.model.strip():
        payload["model"] = args.model.strip()

    print(f"[QUERY] {query}")
    if payload.get("context_tags"):
        print(f"[TAGS] {payload['context_tags']}")
    if payload.get("model"):
        print(f"[MODEL] {payload['model']}")

    t0 = time.time()
    try:
        resp = requests.post(f"{args.base_url}/ask_llm", json=payload, timeout=120)
    except Exception as e:
        print(f"[ERROR] request failed: {e}")
        return 1

    took = time.time() - t0
    print(f"[HTTP] {resp.status_code} ({took:.2f}s)")

    try:
        data = resp.json()
    except Exception:
        print(resp.text[:500])
        return 1

    print(f"[ok] {data.get('ok')}  model={data.get('model')}")

    answer = (data.get("answer") or "").strip()
    print("\n[ANSWER]")
    print(answer)

    diag = data.get("diag") or {}
    mode = ""
    if isinstance(diag, dict):
        mode = str(diag.get("mode") or "")
    if mode:
        print("\n[MODE]", mode)

    # general_out_of_scope 경로에서 웹 검색 수행 여부를 확인할 수 있도록 diag를 일부 출력한다.
    if isinstance(diag, dict):
        ws_required = diag.get("web_search_required")
        ws_used = diag.get("web_search_used")
        ws_calls = diag.get("web_search_calls")
        ws_err = str(diag.get("web_search_error") or "").strip()
        ws_prev = diag.get("web_search_results_preview") or []
        if ws_required is not None or ws_used is not None or ws_calls is not None:
            print("\n[WEB_SEARCH]", {"required": ws_required, "used": ws_used, "calls": ws_calls})
        if ws_prev:
            print("\n[WEB_SEARCH_RESULTS_PREVIEW]")
            for r in ws_prev[:3]:
                if isinstance(r, dict):
                    print(
                        f"- {str(r.get('source') or '').strip()} {str(r.get('published_date') or '').strip()} | {str(r.get('title') or '').strip()}"
                    )
        if ws_err:
            print("\n[WEB_SEARCH_ERROR]")
            print(ws_err)
    selected = diag.get("selected_posts") or []
    print("\n[SELECTED_POSTS]", selected)

    posts = data.get("posts") or []
    by_id = {p.get("post_id"): p for p in posts if p.get("post_id") is not None}
    if selected:
        print("\n[POST META]")
        for pid in selected:
            p = by_id.get(pid)
            if not p:
                continue
            print(f"- post_id={pid} menu_id={p.get('menu_id')} title={p.get('title')}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
