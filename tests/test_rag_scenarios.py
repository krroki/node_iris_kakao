"""
RAG 품질 관련 시나리오 테스트

- /ask_llm 일반 상식 경로(out-of-domain) 동작 검증
  - 프리픽스 강제
  - 외부 URL 제거
"""

import os
import sys

import pytest
from fastapi.testclient import TestClient

# Add project root to path (kb.service import용)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture(scope="module")
def client():
  """KB Service 테스트 클라이언트 생성 (/ask_llm 용).

  NOTE: 이 테스트는 실제 DB + LLM 설정이 되어 있다는 전제에서 동작한다.
  DB/키가 없는 환경에서는 전체 모듈을 스킵한다.
  """
  # 최소한의 DB URL 기본값
  os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://iris:iris@127.0.0.1:5433/iris")
  try:
    from kb.service import app
  except Exception as e:  # pragma: no cover - 환경 의존
    pytest.skip(f"KB service import failed: {e}")
  return TestClient(app)


class TestOutOfDomainGeneralAnswer:
  """카페와 무관한 질문에 대한 일반 상식 경로 동작 테스트."""

  GENERAL_PREFIX = "가이드라인에는 없지만, 일반 상식으로 답변드립니다."

  def test_general_answer_prefix_and_no_url(self, client: TestClient):
    """
    - 완전히 무관한 질문일 때:
      - 응답이 GENERAL_PREFIX로 시작해야 한다.
      - http://, https:// 형태의 URL을 포함하지 않아야 한다.
    """
    payload = {"query": "피자 만드는 법 알려줘", "top_k": 4}
    resp = client.post("/ask_llm", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    # 구조적 ok 필드
    assert data.get("ok") is True
    answer = (data.get("answer") or "").strip()

    # 프리픽스 강제
    assert answer.startswith(self.GENERAL_PREFIX)

    # 일반 상식 경로에서는 외부 URL을 포함하지 않는다.
    lowered = answer.lower()
    assert "http://" not in lowered and "https://" not in lowered
