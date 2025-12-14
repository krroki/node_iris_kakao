#!/usr/bin/env python3
"""
KB 스케줄러 설정 스크립트.

목적:
  - 현재 실행 중인 KB 서비스(kb/service.py)의 in-process 스케줄러에
    collect/embed/manual/backfill 주기를 설정한다.
  - windows/start_all.ps1 / kb_service.ps1의 KB_SCHED_* 기본값과 동일하게 맞춘다.

사용법:
  python scripts/set_kb_schedule.py
"""

import json
import sys
from typing import Dict

import requests


BASE_URL = "http://127.0.0.1:8610"


def set_schedule(task: str, minutes: int) -> None:
  payload: Dict[str, object] = {"task": task, "interval_minutes": minutes}
  r = requests.post(f"{BASE_URL}/schedule", json=payload, timeout=5)
  print(f"[schedule] {task} -> {minutes}m  HTTP {r.status_code} body={r.text.strip()[:200]}")
  r.raise_for_status()


def main() -> None:
  # KB 서비스 헬스 체크
  try:
    h = requests.get(f"{BASE_URL}/health", timeout=3)
  except Exception as e:
    print(f"[ERROR] KB service not reachable at {BASE_URL}: {e}")
    sys.exit(1)
  if h.status_code != 200:
    print(f"[ERROR] KB /health returned {h.status_code}: {h.text[:200]}")
    sys.exit(1)

  # 기본 주기: collect=30, embed=30, manual=60, backfill=60 (분)
  plan = {
    "collect": 30,
    "embed": 30,
    "manual": 60,
    "backfill": 60,
  }
  for task, minutes in plan.items():
    set_schedule(task, minutes)

  # 최종 상태 확인
  r = requests.get(f"{BASE_URL}/schedule", timeout=5)
  print("\n[/schedule]")
  print(json.dumps(r.json(), ensure_ascii=False, indent=2))


if __name__ == "__main__":
  main()

