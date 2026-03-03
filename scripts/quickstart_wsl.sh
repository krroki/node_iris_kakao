#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/node-iris-app"

IRIS_LOCAL_PORT="${IRIS_LOCAL_PORT:-5050}"

echo "=== Quick Start (WSL, SAFE MODE, port ${IRIS_LOCAL_PORT}) ==="

if [[ ! -d "$APP_DIR" ]]; then
  echo "[quickstart] node-iris-app not found at $APP_DIR" >&2
  exit 1
fi

echo "[1/3] Starting SAFE bot (IRIS_LOCAL_PORT=${IRIS_LOCAL_PORT})"
IRIS_LOCAL_PORT="$IRIS_LOCAL_PORT" bash "$ROOT_DIR/scripts/start_bot_wsl.sh"

echo "[2/3] Starting dashboard UI"
bash "$ROOT_DIR/scripts/serve_ui.sh"

IRIS_URL=""
if [[ -f "$APP_DIR/.env" ]]; then
  IRIS_URL=$(grep -E '^IRIS_URL=' "$APP_DIR/.env" | sed 's/^IRIS_URL=//') || true
fi
if [[ -z "$IRIS_URL" ]]; then
  IRIS_URL="127.0.0.1:${IRIS_LOCAL_PORT}"
fi

echo "[3/3] Probing IRIS at ${IRIS_URL}/config"
bash "$ROOT_DIR/scripts/probe_iris.sh" "$IRIS_URL"

echo "=== Done. Open http://localhost:8501 to view the dashboard. ==="
