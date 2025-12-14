#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   bash scripts/one_click_diagnose.sh fg   # build + bot(FG) + restart UI(8512)
#   bash scripts/one_click_diagnose.sh bg   # build + bot(BG) + restart UI(8512)

MODE="${1:-bg}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOT_DIR="$ROOT_DIR/node-iris-app"

echo "[diag] building bot..." >&2
cd "$BOT_DIR"
npm run build --silent
rg -n "JSON.stringify\\(m\\)" dist/services/messageStore.js || true

echo "[diag] stopping old bot..." >&2
pkill -f "node dist/index.js" >/dev/null 2>&1 || true

if [[ "$MODE" == "fg" ]]; then
  echo "[diag] starting bot in FG (CTRL+C to exit)..." >&2
  LOG_LEVEL=debug node dist/index.js
  exit 0
else
  echo "[diag] starting bot in BG..." >&2
  nohup npm start >/tmp/iris-bot.log 2>&1 &
  sleep 1
  pgrep -af "node dist/index.js" || true
fi

echo "[diag] restarting UI/Log API on :8512..." >&2
cd "$ROOT_DIR"
pkill -f "streamlit .*ui_node_iris.py" >/dev/null 2>&1 || true
pkill -f "scripts/log_api.py" >/dev/null 2>&1 || true
if command -v fuser >/dev/null 2>&1; then fuser -k 8512/tcp >/dev/null 2>&1 || true; fi
PORT=8512 ./scripts/serve_ui.sh

echo "[diag] BOT LOG (last 50)" >&2
tail -n 50 /tmp/iris-bot.log 2>/dev/null || true

echo "[diag] done." >&2

