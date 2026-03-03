"""
KB Service API 계약 테스트

SSOT: docs/api-contract.md
이 테스트는 KB Service API 응답 형식이 계약과 일치하는지 검증합니다.
"""

import pytest
import os
import sys

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    """KB Service 테스트 클라이언트 생성"""
    # DB 연결 없이 테스트 가능한 엔드포인트만 테스트
    # 실제 DB 연동 테스트는 통합 테스트에서 수행
    os.environ.setdefault("DATABASE_URL", "postgresql://iris:iris@localhost:5433/iris")
    try:
        from kb.service import app
        return TestClient(app)
    except Exception as e:
        pytest.skip(f"KB service not available: {e}")


class TestHealthEndpoint:
    """GET /health 엔드포인트 테스트"""

    def test_health_returns_ok(self, client):
        """헬스 체크가 ok: true를 반환해야 함"""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") is True


class TestAskEndpoint:
    """POST /ask 엔드포인트 테스트"""

    def test_ask_returns_ok_field(self, client):
        """검색 응답에 ok 필드가 있어야 함"""
        response = client.post("/ask", json={"query": "테스트", "top_k": 1})
        # DB 연결 실패 시 503이지만 ok 필드는 있어야 함
        data = response.json()
        assert "ok" in data


class TestMenusEndpoint:
    """GET /menus 엔드포인트 테스트"""

    def test_menus_returns_required_fields(self, client):
        """/menus 응답에 ok, groups, names 필드가 있어야 함"""
        response = client.get("/menus")
        data = response.json()
        assert "ok" in data
        if data.get("ok"):
            assert "menus" in data
            assert "groups" in data
            assert "names" in data
            assert "cafe_id" in data


class TestScheduleEndpoint:
    """GET /schedule 엔드포인트 테스트"""

    def test_schedule_returns_ok(self, client):
        """스케줄 조회 응답에 ok 필드가 있어야 함"""
        response = client.get("/schedule")
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") is True
        assert "schedule" in data


class TestReindexEndpoint:
    """POST /reindex 엔드포인트 테스트"""

    def test_reindex_returns_ok(self, client):
        """reindex 응답에 ok, status 필드가 있어야 함"""
        response = client.post("/reindex", json={"mode": "incremental"})
        assert response.status_code == 200
        data = response.json()
        assert data.get("ok") is True
        assert data.get("status") == "queued"


class TestBackfillStatusEndpoint:
    """GET /backfill/status 엔드포인트 테스트"""

    def test_backfill_status_returns_ok(self, client):
        """백필 상태 조회 응답에 ok, running, last_completed 필드가 있어야 함"""
        response = client.get("/backfill/status")
        data = response.json()
        assert "ok" in data
        if data.get("ok"):
            assert "running" in data
            assert "last_completed" in data


class TestJobsRunningEndpoint:
    """GET /jobs/running 엔드포인트 테스트"""

    def test_jobs_running_returns_ok(self, client):
        """진행 중 작업 조회 응답에 ok, jobs, count 필드가 있어야 함"""
        response = client.get("/jobs/running")
        data = response.json()
        assert "ok" in data
        if data.get("ok"):
            assert "jobs" in data
            assert "count" in data
            assert isinstance(data["jobs"], list)
            assert isinstance(data["count"], int)


class TestStatsEndpoint:
    """GET /stats 엔드포인트 테스트"""

    def test_stats_returns_ok_field(self, client):
        """/stats 응답에 ok 필드가 있어야 함"""
        response = client.get("/stats")
        data = response.json()
        assert "ok" in data


class TestPostsByMenuEndpoint:
    """GET /posts/by_menu 엔드포인트 테스트"""

    def test_posts_by_menu_returns_ok_field(self, client):
        """/posts/by_menu 응답에 ok, menus 필드가 있어야 함"""
        response = client.get("/posts/by_menu")
        data = response.json()
        assert "ok" in data
        if data.get("ok"):
            assert "menus" in data
            assert isinstance(data["menus"], dict)


class TestRunEndpoint:
    """POST /run 엔드포인트 테스트"""

    def test_run_invalid_task_returns_400(self, client):
        """잘못된 task는 400 에러를 반환해야 함"""
        response = client.post("/run", json={"task": "invalid_task"})
        assert response.status_code == 400


class TestCredsEndpoint:
    """GET /creds 엔드포인트 테스트"""

    def test_creds_returns_ok_field(self, client):
        """/creds 응답에 ok 필드가 있어야 함"""
        response = client.get("/creds")
        data = response.json()
        assert "ok" in data


# 타입 검증 테스트
class TestResponseTypes:
    """응답 타입 검증 테스트"""

    def test_job_log_entry_type(self, client):
        """JobLogEntry 타입이 올바른 필드를 가지고 있어야 함"""
        response = client.get("/stats")
        data = response.json()
        if data.get("ok") and data.get("jobs"):
            job = data["jobs"][0]
            # 필수 필드 검증
            assert "job_id" in job
            assert "job_type" in job
            assert "status" in job
            assert "started_at" in job
            # status 값 검증 (done은 success의 레거시 값)
            assert job["status"] in ("running", "success", "failed", "done")

    def test_menu_item_type(self, client):
        """MenuItem 타입이 올바른 필드를 가지고 있어야 함"""
        response = client.get("/menus")
        data = response.json()
        if data.get("ok") and data.get("menus"):
            menu = data["menus"][0]
            assert "menu_id" in menu
            assert "name" in menu
            assert "profile" in menu
            assert isinstance(menu["menu_id"], int)
            assert isinstance(menu["name"], str)
