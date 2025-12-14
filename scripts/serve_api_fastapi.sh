#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${REALTIME_API_PORT:-8600}"
HOST="${REALTIME_API_HOST:-0.0.0.0}"

if ! command -v uvicorn >/dev/null 2>&1; then
  echo "[api] uvicorn not found. Install with: pip install fastapi uvicorn" >&2
  exit 1
fi

export IRIS_LOGS_DIR="${IRIS_LOGS_DIR:-$ROOT_DIR/node-iris-app/data/logs}"
echo "[api] starting FastAPI realtime server at $HOST:$PORT (IRIS_LOGS_DIR=$IRIS_LOGS_DIR)"
exec uvicorn server.app:app --host "$HOST" --port "$PORT"

