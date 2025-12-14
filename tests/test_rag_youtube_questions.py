"""
유튜브 수익화/수익창출(플랫폼 정책) 질문은 디하클 카페 SSOT가 아닌 일반 상식(웹 검색) 경로로 처리한다.

- 질문 예: "유튜브 쇼츠 수익화 조건 알려줘"
- 기대:
  - GENERAL_PREFIX로 시작
  - 링크(URL) 출력 금지
  - diag.mode == "general_out_of_scope"
  - selected_posts 비어 있음 (posts/manuals 모두 0)
"""

import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kb.service import GENERAL_PREFIX, app  # noqa: E402


@pytest.fixture(scope="module")
def client() -> TestClient:
    os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://iris:iris@127.0.0.1:5433/iris")
    return TestClient(app)


def _assert_general_out_of_scope(data: dict) -> None:
    answer = (data.get("answer") or "").strip()
    diag = data.get("diag") or {}

    assert diag.get("mode") == "general_out_of_scope"
    assert answer.startswith(GENERAL_PREFIX)
    assert "http://" not in answer.lower()
    assert "https://" not in answer.lower()
    assert (data.get("manuals") or []) == []
    assert (data.get("posts") or []) == []
    assert (data.get("link_hint") or "") == ""


class TestYoutubeGeneralScenarios:
    def test_shorts_monetization_conditions(self, client: TestClient):
        resp = client.post("/ask_llm", json={"query": "유튜브 쇼츠 수익화 조건 알려줘", "top_k": 6})
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("ok") is True
        _assert_general_out_of_scope(data)

    def test_shorts_views_low(self, client: TestClient):
        resp = client.post("/ask_llm", json={"query": "쇼츠 조회수가 낮을 때 어떻게 해야 해?", "top_k": 6})
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("ok") is True
        _assert_general_out_of_scope(data)

    def test_shorts_monthly_income(self, client: TestClient):
        resp = client.post("/ask_llm", json={"query": "유튜브 쇼츠로 월 천만원 벌려면 어떻게 해야 돼?", "top_k": 6})
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("ok") is True
        _assert_general_out_of_scope(data)
