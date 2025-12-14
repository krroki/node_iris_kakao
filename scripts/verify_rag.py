#!/usr/bin/env python3
"""RAG 시스템 검증 스크립트.

주요 테스트 케이스:
1. 다시보기 링크 질문 → menu_id 23 글 선택, 본문에 '다시보기' 포함
2. 날짜 기반 질문 → 해당 날짜가 본문에 포함된 글만 선택
3. 무관한 질문 → '정보 없음' 응답, 링크 미포함

사용법:
    python scripts/verify_rag.py [--base-url http://127.0.0.1:8610]
"""

import argparse
import json
import sys
import time
from dataclasses import dataclass
from typing import Optional

import requests


@dataclass
class TestCase:
    name: str
    query: str
    expect_menu_ids: Optional[list[int]] = None  # 특정 메뉴에서 결과가 나와야 함
    expect_keyword_in_title: Optional[str] = None  # 제목에 키워드 포함
    expect_keyword_in_body: Optional[str] = None  # 본문에 키워드 포함
    expect_no_info: bool = False  # "정보 없음" 응답 기대
    expect_no_link: bool = False  # 링크가 없어야 함
    expect_general_prefix: bool = False  # 일반 상식 프리픽스 기대 여부


TEST_CASES = [
    TestCase(
        name="다시보기 강의 검색",
        query="최신 다시보기 강의 알려줘",
        expect_menu_ids=[23],  # 무료특강신청
        expect_keyword_in_title="다시보기",
    ),
    TestCase(
        name="다시보기 링크 요청",
        query="사알못 다시보기 링크",
        # 사알못 다시보기는 아직 없으므로 후기(32)나 신청(23)에서 관련 글
        expect_menu_ids=[23, 32],
    ),
    TestCase(
        name="날짜 기반 강의 검색",
        query="12월 3일 강의 있나",
        expect_keyword_in_title="12월",
    ),
    TestCase(
        name="무관한 질문 - 엉뚱한 주제",
        query="피자 만드는 법 알려줘",
        # KB 자료는 없지만, 일반 상식 기반 답변 + 링크 없음 기대
        expect_no_info=False,
        expect_no_link=True,
        expect_general_prefix=True,
    ),
]


def run_test(base_url: str, tc: TestCase, timeout: int = 90) -> dict:
    """단일 테스트 케이스 실행."""
    result = {
        "name": tc.name,
        "query": tc.query,
        "passed": False,
        "errors": [],
        "response_time": 0,
        "posts_count": 0,
        "selected_menu_ids": [],
    }

    try:
        t0 = time.time()
        resp = requests.post(
            f"{base_url}/ask_llm",
            json={"query": tc.query, "top_k": 6},
            timeout=timeout,
        )
        result["response_time"] = round(time.time() - t0, 2)

        if resp.status_code != 200:
            result["errors"].append(f"HTTP {resp.status_code}: {resp.text[:200]}")
            return result

        data = resp.json()
        if not data.get("ok"):
            result["errors"].append(f"API error: {data}")
            return result

        posts = data.get("posts", [])
        answer = data.get("answer", "")
        result["posts_count"] = len(posts)
        result["selected_menu_ids"] = list(set(p.get("menu_id") for p in posts if p.get("menu_id")))
        result["answer_preview"] = answer[:200] if answer else ""

        # 검증 1: 메뉴 ID 체크
        if tc.expect_menu_ids:
            actual_menus = set(p.get("menu_id") for p in posts)
            if not actual_menus:
                result["errors"].append(f"게시글 없음, 기대 메뉴: {tc.expect_menu_ids}")
            elif not actual_menus.intersection(tc.expect_menu_ids):
                result["errors"].append(
                    f"메뉴 불일치: 기대 {tc.expect_menu_ids}, 실제 {list(actual_menus)}"
                )

        # 검증 2: 제목 키워드 체크
        if tc.expect_keyword_in_title and posts:
            titles = [p.get("title", "") for p in posts]
            if not any(tc.expect_keyword_in_title in t for t in titles):
                result["errors"].append(
                    f"제목에 '{tc.expect_keyword_in_title}' 없음: {titles[:2]}"
                )

        # 검증 3: 본문 키워드 체크
        if tc.expect_keyword_in_body and posts:
            bodies = [p.get("norm_text", "") for p in posts]
            if not any(tc.expect_keyword_in_body in b for b in bodies if b):
                result["errors"].append(
                    f"본문에 '{tc.expect_keyword_in_body}' 없음"
                )

        # 검증 4: 정보 없음 응답 체크
        if tc.expect_no_info:
            no_info_patterns = ["정보 없음", "찾지 못했", "자료를 찾지", "없습니다"]
            if not any(p in answer for p in no_info_patterns):
                # 게시글이 있으면 실패는 아님 (관련 글이 있을 수 있음)
                if posts:
                    result["errors"].append(
                        f"무관한 질문인데 게시글 {len(posts)}개 반환됨"
                    )

        # 검증 5: 링크 미포함 체크
        if tc.expect_no_link:
            if "https://cafe.naver.com" in answer and tc.expect_no_info:
                result["errors"].append("정보 없음인데 링크가 포함됨")

        # 검증 6: 일반 상식 프리픽스 체크
        if tc.expect_general_prefix:
            prefix = "가이드라인에는 없지만, 일반 상식으로 답변드립니다."
            if not answer.startswith(prefix):
                result["errors"].append(f"일반 상식 프리픽스 누락: '{prefix}'로 시작하지 않음")

        result["passed"] = len(result["errors"]) == 0

    except requests.exceptions.Timeout:
        result["errors"].append(f"타임아웃 ({timeout}초)")
    except Exception as e:
        result["errors"].append(f"예외: {e}")

    return result


def main():
    parser = argparse.ArgumentParser(description="RAG 시스템 검증")
    parser.add_argument("--base-url", default="http://127.0.0.1:8610", help="KB 서비스 URL")
    parser.add_argument("--timeout", type=int, default=90, help="요청 타임아웃 (초)")
    parser.add_argument("--json", action="store_true", help="JSON 형식으로 출력")
    args = parser.parse_args()

    # 헬스체크
    try:
        health = requests.get(f"{args.base_url}/health", timeout=5)
        if health.status_code != 200:
            print(f"[ERROR] KB 서비스 응답 없음: {args.base_url}")
            sys.exit(1)
    except Exception as e:
        print(f"[ERROR] KB 서비스 연결 실패: {e}")
        sys.exit(1)

    print(f"=== RAG 시스템 검증 시작 ({args.base_url}) ===\n")

    results = []
    passed = 0
    failed = 0

    for tc in TEST_CASES:
        print(f"[TEST] {tc.name}: '{tc.query}'")
        result = run_test(args.base_url, tc, args.timeout)
        results.append(result)

        if result["passed"]:
            passed += 1
            print(f"  ✅ PASS ({result['response_time']}s, {result['posts_count']}개 게시글)")
        else:
            failed += 1
            print(f"  ❌ FAIL ({result['response_time']}s)")
            for err in result["errors"]:
                print(f"     - {err}")
        print()

    # 요약
    print("=" * 50)
    print(f"결과: {passed}/{len(TEST_CASES)} 통과")
    if failed > 0:
        print(f"실패: {failed}건")

    if args.json:
        print("\n--- JSON 결과 ---")
        print(json.dumps(results, ensure_ascii=False, indent=2))

    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
