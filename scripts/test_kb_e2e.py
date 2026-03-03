#!/usr/bin/env python3
"""
KB/RAG/SAFE_MODE 통합 검증 스크립트.

실행 순서:
1) KB 계약 테스트: pytest tests/test_kb_contract.py
2) RAG 회귀 테스트: python scripts/verify_rag.py --base-url http://127.0.0.1:8610
3) SAFE_MODE 스모크 테스트: python scripts/test_safe_mode.py

전제:
- KB 서비스(FastAPI, kb/service.py)가 http://127.0.0.1:8610 에서 동작 중
- Realtime API(server.app:app)가 http://127.0.0.1:8650 에서 동작 중
- Node-IRIS 봇은 필요 시 별도 실행 (본 스크립트는 HTTP 기반 상태만 확인)
"""

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run(cmd, cwd: Path | None = None) -> int:
  print(f"\n[RUN] {' '.join(cmd)} (cwd={cwd or ROOT})")
  proc = subprocess.Popen(cmd, cwd=str(cwd or ROOT))
  proc.wait()
  if proc.returncode != 0:
    print(f"[FAIL] {' '.join(cmd)} (exit={proc.returncode})")
  else:
    print(f"[OK] {' '.join(cmd)}")
  return proc.returncode


def main() -> None:
  failures = 0

  # 1) KB 계약 테스트
  if (ROOT / "tests" / "test_kb_contract.py").exists():
    failures += run([sys.executable, "-m", "pytest", "tests/test_kb_contract.py", "-v"])
  else:
    print("[SKIP] tests/test_kb_contract.py 없음 – KB 계약 테스트 건너뜀")

  # 2) RAG 회귀 테스트
  if (ROOT / "scripts" / "verify_rag.py").exists():
    failures += run([sys.executable, "scripts/verify_rag.py", "--base-url", "http://127.0.0.1:8610"])
  else:
    print("[SKIP] scripts/verify_rag.py 없음 – RAG 회귀 테스트 건너뜀")

  # 3) SAFE_MODE 스모크 테스트
  if (ROOT / "scripts" / "test_safe_mode.py").exists():
    failures += run([sys.executable, "scripts/test_safe_mode.py"])
  else:
    print("[SKIP] scripts/test_safe_mode.py 없음 – SAFE_MODE 스모크 테스트 건너뜀")

  if failures:
    print(f"\n[E2E] 일부 테스트 실패 (failures={failures})")
    sys.exit(1)
  else:
    print("\n[E2E] 모든 테스트 통과")
    sys.exit(0)


if __name__ == "__main__":
  main()

