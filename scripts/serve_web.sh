#!/usr/bin/env bash
set -euo pipefail

# DEPRECATED: Windows 전용 스택(ADR-0010) 전환 이후에는
# Next.js 웹 UI는 PowerShell 스크립트로만 기동한다.
# - 권장: windows/start_all.ps1 또는 windows/start_web.ps1
# - 이 스크립트는 WSL 환경에서의 과거 실험용 구성만을 위해 남겨둔 레거시 자산이며,
#   agents.md / CLAUDE.md의 "폐기된 명령어(사용 금지)" 목록에 포함된다.
# 새 환경에서는 이 스크립트를 호출하지 말고, 최신 런북/Runbook 문서를 따른다.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/web"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"
API_LOG="$LOG_DIR/realtime_api.log"

start_realtime_api() {
  local py=""
  if command -v python3 >/dev/null 2>&1; then
    py="python3"
  elif command -v python >/dev/null 2>&1; then
    py="python"
  else
    echo "[web] python interpreter not found; skipping realtime API startup" >&2
    return
  fi

  if ! "$py" - <<'PY' >/dev/null 2>&1
import importlib.util, sys
need = any(importlib.util.find_spec(pkg) is None for pkg in ("uvicorn", "fastapi"))
sys.exit(1 if need else 0)
PY
  then
    echo "[web] installing fastapi/uvicorn for realtime API..." | tee -a "$API_LOG"
    if ! "$py" -m pip install --user fastapi uvicorn >/dev/null 2>&1; then
      "$py" -m pip install fastapi uvicorn >/dev/null 2>&1
    fi
  fi

  pkill -f "uvicorn .*server\.app:app" >/dev/null 2>&1 || true
  echo "[web] starting FastAPI realtime server on :8650" | tee -a "$API_LOG"
  nohup env REALTIME_API_HOST=0.0.0.0 REALTIME_API_PORT=8650 IRIS_LOGS_DIR="$ROOT_DIR/node-iris-app/data/logs" \
    "$py" -m uvicorn server.app:app --host 0.0.0.0 --port 8650 >> "$API_LOG" 2>&1 &
}

if [[ ! -d "$WEB_DIR" ]]; then
  echo "[web] not found: $WEB_DIR" >&2
  exit 1
fi

cd "$WEB_DIR"
if ! command -v npm >/dev/null 2>&1; then
  echo "[web] npm not found. Install Node.js first." >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "[web] installing dependencies..."
  npm install
fi

start_realtime_api

export NEXT_PUBLIC_REALTIME_BASE="${NEXT_PUBLIC_REALTIME_BASE:-http://localhost:8650}"
PORT="${PORT:-3100}"
echo "[web] starting Next.js dev on :${PORT} (SSE base: $NEXT_PUBLIC_REALTIME_BASE)"
PORT="$PORT" npm run dev -- --hostname 127.0.0.1 --port "$PORT"
