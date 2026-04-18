from fastapi.testclient import TestClient


def _client():
    from server.app import app

    return TestClient(app)


def test_reply_text_blocks_ops_text_for_non_test_room(monkeypatch):
    from server import app as app_module

    monkeypatch.setattr(
        app_module,
        "load_runtime",
        lambda: {
            "safeMode": False,
            "pintBriefing": {"testRoomId": "18475752914588021"},
        },
    )

    client = _client()
    resp = client.post(
        "/send/iris/reply_text",
        json={"roomId": "18478604555076324", "text": "운영 발신 테스트 중 전송 점검"},
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "OPS_TEXT_BLOCKED_FOR_NON_TEST_ROOM"


def test_reply_text_allows_ops_text_for_test_room(monkeypatch):
    from server import app as app_module

    monkeypatch.setattr(
        app_module,
        "load_runtime",
        lambda: {
            "safeMode": False,
            "pintBriefing": {"testRoomId": "18475752914588021"},
        },
    )
    monkeypatch.setattr(app_module, "_http_post_json", lambda *args, **kwargs: (200, '{"success":true}'))
    monkeypatch.setattr(app_module, "_wait_for_iris_sending_log_cleared", _async_true)

    client = _client()
    resp = client.post(
        "/send/iris/reply_text",
        json={
            "roomId": "18475752914588021",
            "text": "ops smoke test check",
            "dbEchoTimeoutMs": 0,
        },
    )

    assert resp.status_code != 400


async def _async_true(*args, **kwargs):
    return True
