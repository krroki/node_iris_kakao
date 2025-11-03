#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$ROOT_DIR/dashboard/.venv_ui"
PY="$VENV/bin/python"
APP="$ROOT_DIR/dashboard/ui_node_iris.py"
LOG_DIR="$ROOT_DIR/logs"
LOG_FILE="$LOG_DIR/ui_node_iris.log"

mkdir -p "$LOG_DIR"

# Start lightweight log API (8510) if not running
if ! pgrep -f "scripts/log_api.py" >/dev/null 2>&1; then
  nohup python3 "$ROOT_DIR/scripts/log_api.py" >> "$LOG_DIR/ui_node_iris.log" 2>&1 &
fi

if [[ ! -x "$PY" ]]; then
  echo "[ui] venv not found; creating..." | tee -a "$LOG_FILE"
  python3 -m venv "$VENV"
  "$PY" -m pip install --upgrade pip wheel setuptools
  "$PY" -m pip install streamlit pandas plotly
fi

# Ensure UI reads repo app path (overrides autodetect)
export NODE_IRIS_APP_DIR="$ROOT_DIR/node-iris-app"

echo "[ui] starting streamlit at 0.0.0.0:8501 (NODE_IRIS_APP_DIR=$NODE_IRIS_APP_DIR)" | tee -a "$LOG_FILE"
nohup env NODE_IRIS_APP_DIR="$NODE_IRIS_APP_DIR" \
  "$PY" -m streamlit run "$APP" \
  --server.address 0.0.0.0 \
  --server.port 8501 \
  --server.headless true \
  --browser.gatherUsageStats false \
  >> "$LOG_FILE" 2>&1 &
disown || true
echo "[ui] started. tail -f $LOG_FILE" | tee -a "$LOG_FILE"
