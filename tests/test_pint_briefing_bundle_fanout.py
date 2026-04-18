import pytest
from fastapi.testclient import TestClient


def _client():
    from server.app import app

    return TestClient(app)


@pytest.mark.parametrize("target", ["prod", "pint", "production"])
def test_pint_briefing_bundle_blocks_ops_text_for_prod_targets(monkeypatch, target):
    from server import app as app_module

    monkeypatch.setattr(
        app_module,
        "load_runtime",
        lambda: {
            "safeMode": False,
            "pintBriefing": {
                "testRoomId": "18475752914588021",
                "roomId": "18475321871585649",
                "allowProdSend": True,
            },
        },
    )

    client = _client()
    resp = client.post(
        "/send/pint/briefing_bundle",
        json={
            "target": target,
            "text": "ops smoke test check",
            "imagesBase64": ["ZmFrZQ=="],
        },
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "OPS_TEXT_BLOCKED_FOR_PROD_BRIEFING"
