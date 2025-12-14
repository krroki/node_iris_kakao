import os
import sys

import pytest
from fastapi.testclient import TestClient


# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_parse_member_count_from_cafe_home_html():
    from kb.cafe_api import parse_member_count

    html = """
    <li class="mem-cnt-info" style="cursor:pointer;">
      <strong class="d-none">카페멤버수</strong>
      <a href="#">
        <img src="https://ssl.pstatic.net/static/cafe/cafe_pc/svg/ico_member.svg" alt="멤버수">
        <em>56282<span class="ico_lock2">비공개</span></em>
      </a>
    </li>
    """
    assert parse_member_count(html) == 56282


@pytest.fixture(scope="module")
def client():
    os.environ.setdefault("DATABASE_URL", "postgresql://iris:iris@localhost:5433/iris")
    try:
        from kb.service import app

        return TestClient(app)
    except Exception as e:
        pytest.skip(f"KB service not available: {e}")


def test_ask_llm_routes_cafe_member_count_without_llm(client, monkeypatch):
    import kb.service as svc

    monkeypatch.setattr(svc, "fetch_member_count", lambda _url, force_refresh=False: 123)
    monkeypatch.setattr(svc, "get_cafe_url", lambda: "https://cafe.naver.com/dinohighclass")

    resp = client.post(
        "/ask_llm",
        json={
            "query": "?디하클 카페 회원수 몇명이야",
            "context_tags": ["dinohighclass"],
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("ok") is True
    assert data.get("model") is None
    assert data.get("diag", {}).get("mode") == "cafe_member_count"
    assert "123명" in (data.get("answer") or "")
    assert "가이드라인에는 없지만" not in (data.get("answer") or "")
