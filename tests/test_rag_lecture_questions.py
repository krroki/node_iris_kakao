"""
강의/다시보기 관련 RAG 시나리오 테스트

- '사알못 다시보기 링크' 질문 시, 사알못 후기/다시보기 글들 중에서
  벡터 검색/재랭크 결과가 선택되는지 검증
- '12월 3일에 강의 있나?' 질문 시, 12월 3일 무료특강 공지(예: post_id=141215)가
  후보/선택 결과에 포함되는지 확인
"""

import os
import sys
from typing import List

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kb.db import db_session  # noqa: E402


@pytest.fixture(scope="module")
def client():
    """KB Service 테스트 클라이언트 생성 (/ask_llm 용)."""
    os.environ.setdefault(
        "DATABASE_URL", "postgresql+psycopg2://iris:iris@127.0.0.1:5433/iris"
    )
    try:
        from kb.service import app
    except Exception as e:  # pragma: no cover - 환경 의존
        pytest.skip(f"KB service import failed: {e}")
    return TestClient(app)


def _fetch_post_ids(sql: str) -> List[int]:
    with db_session() as s:
        rows = s.execute(text(sql)).all()
        return [int(r[0]) for r in rows]


class TestLectureRagScenarios:
    def test_saalmot_replay_links_selected(self, client: TestClient):
        """
        '사알못 다시보기 링크' 질문 시,
        사알못/다시보기 관련 게시글(post_id 집합) 중 적어도 하나가
        /ask_llm diag.selected_posts에 포함되어야 한다.
        """
        resp = client.post(
            "/ask_llm", json={"query": "사알못 다시보기 링크", "top_k": 6}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("ok") is True

        diag = data.get("diag") or {}
        selected: List[int] = diag.get("selected_posts") or []
        assert selected, "selected_posts 가 비어 있습니다."

        # selected_posts에 포함된 글들 중 최소 하나는
        # 사알못 강의 관련 게시글(메뉴 23/32/42 + 제목에 '사알못') 이어야 한다.
        if selected:
            with db_session() as s:
                rows = s.execute(
                    text(
                        """
                        SELECT post_id, menu_id, title
                        FROM sources_post
                        WHERE post_id = ANY(:ids)
                        """
                    ),
                    {"ids": selected},
                ).mappings().all()
            assert any(
                int(r["menu_id"]) in (23, 32, 42)
                and "사알못" in (r["title"] or "")
                for r in rows
            ), f"사알못 강의 관련 글이 선택되지 않았습니다: {rows}"

    def test_dec_3rd_lecture_question_hits_dec3_post(self, client: TestClient):
        """
        '12월 3일에 강의 있나?' 질문 시,
        12월 3일 무료특강 공지(post_id=141215)를 포함한 12/3 강의 관련 글 중
        최소 하나가 selected_posts에 포함되어야 한다.
        """
        # 12월 3일 강의 안내/후기 글들 post_id 집합
        expected_ids = _fetch_post_ids(
            """
            SELECT post_id
            FROM sources_post
            WHERE status='clean'
              AND (
                title ILIKE '%12월 3일%' OR norm_text ILIKE '%12월 3일%'
                OR (menu_id = 23 AND title ILIKE '%무료특강%' AND title ILIKE '%사알못%')
              )
            ORDER BY created_at DESC
            LIMIT 50
            """
        )
        if not expected_ids:
            pytest.skip("12월 3일 강의 관련 게시글이 없어 테스트를 건너뜁니다.")

        resp = client.post(
            "/ask_llm", json={"query": "12월 3일에 강의 있나?", "top_k": 6}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("ok") is True

        diag = data.get("diag") or {}
        selected: List[int] = diag.get("selected_posts") or []
        assert any(pid in expected_ids for pid in selected), (
            f"expected one of {expected_ids}, got selected_posts={selected}"
        )

    def test_price_question_includes_prices(self, client: TestClient):
        """
        '사알못 일반반, 비지니스반 가격 알려줘' 질문 시,
        RAG 경로를 타면서 답변 문자열 안에 실제 수강료 숫자(177만, 255만)가 포함되어야 한다.
        """
        resp = client.post(
            "/ask_llm", json={"query": "사알못 일반반, 비지니스반 가격 알려줘", "top_k": 12}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("ok") is True

        answer = data.get("answer") or ""
        # 가격 숫자(177만/255만)가 포함되어야 한다.
        assert "177만" in answer, f"answer 에 일반반 수강료(177만)가 없습니다: {answer}"
        assert "255만" in answer, f"answer 에 비지니스반 수강료(255만)가 없습니다: {answer}"

        diag = data.get("diag") or {}
        mode = (diag.get("mode") or "").lower()
        # 일반 상식 경로가 아니라 RAG 경로여야 한다.
        assert not mode.startswith(
            "general"
        ), f"가격 질문이 general 경로로 처리되었습니다: mode={mode}"

    def test_point_question_includes_points(self, client: TestClient):
        """
        '일반반, 비지니스반 포인트 얼마나 주는거야?' 질문 시,
        포인트 정책(50만/100만/30만 포인트)이 답변에 포함되어야 한다.
        """
        resp = client.post(
            "/ask_llm",
            json={"query": "일반반, 비지니스반 포인트 얼마나 주는거야?", "top_k": 12},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("ok") is True

        answer = data.get("answer") or ""
        # 기본 포인트 50만/100만은 반드시 포함
        assert "50만" in answer, f"answer 에 일반반 포인트(50만)가 없습니다: {answer}"
        assert "100만" in answer, f"answer 에 비지니스반 포인트(100만)가 없습니다: {answer}"
        # 얼리버드 30만 포인트는 가능하면 포함되도록 하지만, 없으면 경고 수준이므로 강제하지 않는다.
