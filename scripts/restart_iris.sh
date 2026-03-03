#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

echo "[restart] stopping node-iris-app (if running)"
pkill -f "node dist/index.js" >/dev/null 2>&1 || true
sleep 0.3

echo "[restart] building node-iris-app"
cd "$ROOT_DIR/node-iris-app"
npm run --silent build

echo "[restart] starting node-iris-app"
nohup npm start > /tmp/iris-bot.log 2>&1 &
sleep 0.7
pgrep -af "node dist/index.js" || echo "[restart] node-iris-app process not listed yet"

echo "[restart] restarting FastAPI (uvicorn :8600)"
pkill -f "uvicorn .*server\.app:app" >/dev/null 2>&1 || true
sleep 0.2

# Ensure venv with uvicorn/fastapi exists
VENV="$ROOT_DIR/dashboard/.venv_ui"
if [[ ! -x "$VENV/bin/python" ]]; then
  echo "[restart] creating venv for API: $VENV"
  python3 -m venv "$VENV"
fi
"$VENV/bin/python" - << 'PY'
import sys, subprocess
def ensure(pkg):
    try:
        __import__(pkg)
    except Exception:
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'fastapi', 'uvicorn', 'python-multipart'])
for m in ('fastapi','uvicorn'):
    ensure(m)
PY

UV="$VENV/bin/uvicorn"
IRIS_LOGS_DIR="$ROOT_DIR/node-iris-app/data/logs"
echo "[restart] starting uvicorn using $UV"
cd "$ROOT_DIR"
nohup env REALTIME_API_HOST=0.0.0.0 REALTIME_API_PORT=8600 IRIS_LOGS_DIR="$IRIS_LOGS_DIR" \
  "$UV" server.app:app --host 0.0.0.0 --port 8600 >> "$LOG_DIR/realtime_api.log" 2>&1 &

# Probe health with retries
echo "[restart] probing /health"
ok=0
for i in $(seq 1 15); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8600/health || true)
  if [[ "$code" == "200" ]]; then ok=1; break; fi
  sleep 0.5
done
if [[ "$ok" != "1" ]]; then
  echo "  /health: DOWN"
else
  echo "  /health: OK"
fi
echo -n "  /runtime: "; (curl -sS http://127.0.0.1:8600/runtime || true); echo

echo "[restart] tail iris-bot.log (last 60 lines)"
tail -n 60 /tmp/iris-bot.log || true

echo "[restart] tail realtime_api.log (last 60 lines)"
tail -n 60 "$LOG_DIR/realtime_api.log" || true

echo "[restart] done"
