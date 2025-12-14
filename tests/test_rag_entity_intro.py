import os
import sys

import pytest
from fastapi.testclient import TestClient


# Add project root to path (kb.service import)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture(scope="module")
def client():
    # 최소한의 DB URL 기본값 (로컬 pgvector 컨테이너 매핑)
    os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://iris:iris@127.0.0.1:5433/iris")
    try:
        from kb.service import app
    except Exception as e:  # pragma: no cover - 환경 의존
        pytest.skip(f"KB service import failed: {e}")
    return TestClient(app)


def test_entity_intro_works_without_openai(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    # 엔티티 소개 경로는 LLM(OPENAI_API_KEY)이 없어도 동작해야 한다.
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_APIKEY", raising=False)

    payload = {
        "query": "마케터제이가 누구야?",
        "top_k": 4,
        "context_tags": ["dinohighclass", "?디하클"],
    }
    resp = client.post("/ask_llm", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    assert data.get("ok") is True
    assert (data.get("diag") or {}).get("mode") == "entity_intro"

    answer = (data.get("answer") or "").strip()
    assert "마케터제이" in answer


def test_entity_external_link_query_is_safe(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    # 외부 링크 요청은 '자료에 없음'으로만 처리하고, 임의 URL을 만들지 않는다.
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_APIKEY", raising=False)

    payload = {
        "query": "마케터제이 인스타 링크 있어?",
        "top_k": 4,
        "context_tags": ["dinohighclass", "?디하클"],
    }
    resp = client.post("/ask_llm", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    assert data.get("ok") is True
    assert (data.get("diag") or {}).get("mode") == "entity_intro"

    answer = (data.get("answer") or "").strip()
    assert "제공할 수 없습니다" in answer or "제공할수없습니다" in answer.replace(" ", "")
    # 외부 URL 출력 금지(카페 URL은 근거로 나올 수 있음)
    assert "instagram.com" not in answer.lower()

