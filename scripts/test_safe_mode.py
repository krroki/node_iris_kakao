#!/usr/bin/env python3
"""
SAFE_MODE 회귀 스모크 테스트.

전제:
- FastAPI Realtime 서버 (`server.app:app`)가 http://127.0.0.1:8650 에서 동작 중이어야 한다.
- 이 스크립트는 /runtime 을 통해 safeMode 값을 토글하고,
  /send/talkapi/dispatch 가 safeMode=true 일 때 403을 반환하는지 확인한다.
- 테스트가 끝나면 최초 runtime.safeMode 값을 원래대로 복원한다.

주의:
- talkApi.enabled 가 false 이더라도, safeMode=false 상태에서는 403 이외의 다른 코드를 허용한다.
  (예: 400 talkApi disabled 등)
"""

import json
import sys
import os
from typing import Any, Dict

import requests


SERVER_BASE = "http://127.0.0.1:8650"
# 안전: SAFE_MODE 스모크의 payload는 반드시 테스트용 오픈채팅방으로 보낸다.
TEST_ROOM_ID = os.getenv("TEST_ROOM_ID", "18462226881291012")


def get_runtime() -> Dict[str, Any]:
  r = requests.get(f"{SERVER_BASE}/runtime", timeout=5)
  r.raise_for_status()
  return r.json()


def update_runtime_safe_mode(value: bool) -> Dict[str, Any]:
  body = {"safeMode": bool(value)}
  r = requests.post(f"{SERVER_BASE}/runtime", json=body, timeout=5)
  r.raise_for_status()
  return r.json()


def test_safe_mode() -> int:
  print(f"[SAFE_MODE] 서버: {SERVER_BASE}")
  try:
    cfg0 = get_runtime()
  except Exception as e:
    print(f"[ERROR] /runtime 호출 실패: {e}")
    return 1

  original_safe = bool(cfg0.get("safeMode", True))
  print(f"[SAFE_MODE] 초기 safeMode={original_safe}")

  try:
    # 1) safeMode=true 설정
    print("[SAFE_MODE] safeMode=true 로 설정 중...")
    cfg1 = update_runtime_safe_mode(True)
    if not cfg1.get("safeMode", False):
      print("[ERROR] safeMode=true 설정 실패 (runtime 응답에 safeMode!=true)")
      return 1

    # 1-1) /send/talkapi/dispatch 가 403 SAFE_MODE 를 반환하는지 확인
    print("[SAFE_MODE] safeMode=true 상태에서 /send/talkapi/dispatch 호출 테스트...")
    payload = {"roomId": TEST_ROOM_ID, "message": "[smoke] safe_mode test"}
    r = requests.post(f"{SERVER_BASE}/send/talkapi/dispatch", json=payload, timeout=5)
    if r.status_code != 403:
      print(f"[ERROR] safeMode=true 인데 /send/talkapi/dispatch status={r.status_code}, body={r.text[:200]}")
      return 1
    try:
      data = r.json()
      if data.get("detail") not in ("SAFE_MODE", "SAFE_MODE_ON", "SAFE_MODE enabled"):
        print(f"[WARN] /send/talkapi/dispatch 응답 detail={data.get('detail')} (SAFE_MODE 메시지 확인 필요)")
    except Exception:
      print("[WARN] /send/talkapi/dispatch 응답 JSON 파싱 실패 (status는 403)")

    # 2) safeMode=false 설정
    print("[SAFE_MODE] safeMode=false 로 설정 중...")
    cfg2 = update_runtime_safe_mode(False)
    if cfg2.get("safeMode", True):
      print("[ERROR] safeMode=false 설정 실패 (runtime 응답에 safeMode!=false)")
      return 1

    # 2-1) /send/talkapi/dispatch 가 더 이상 403 SAFE_MODE 를 반환하지 않는지 확인
    print("[SAFE_MODE] safeMode=false 상태에서 /send/talkapi/dispatch 호출 테스트...")
    r2 = requests.post(f"{SERVER_BASE}/send/talkapi/dispatch", json=payload, timeout=5)
    if r2.status_code == 403:
      print(f"[ERROR] safeMode=false 인데 /send/talkapi/dispatch status=403, body={r2.text[:200]}")
      return 1
    else:
      print(f"[SAFE_MODE] safeMode=false 상태에서 status={r2.status_code} (403 아님이면 OK)")

    print("[SAFE_MODE] 테스트 통과")
    return 0

  finally:
    # 원래 safeMode 값 복원
    try:
      print(f"[SAFE_MODE] 원래 safeMode={original_safe} 로 복원 중...")
      update_runtime_safe_mode(original_safe)
    except Exception as e:
      print(f"[WARN] safeMode 복원 실패: {e}")


def main() -> None:
  code = test_safe_mode()
  sys.exit(code)


if __name__ == "__main__":
  main()
