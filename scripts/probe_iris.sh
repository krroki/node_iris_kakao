#!/usr/bin/env bash
set -euo pipefail

# Simple probe for Iris HTTP and WS endpoints from WSL/Ubuntu
# Usage: scripts/probe_iris.sh [host:port]  (default: value from node-iris-app/.env IRIS_URL)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/node-iris-app"

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  if [[ -f "$APP_DIR/.env" ]]; then
    TARGET=$(grep -E '^IRIS_URL=' "$APP_DIR/.env" | sed 's/^IRIS_URL=//')
  fi
fi

if [[ -z "$TARGET" ]]; then
  echo "usage: $0 <iris-host:port>  # or ensure node-iris-app/.env has IRIS_URL" >&2
  exit 2
fi

HTTP_URL="http://${TARGET}/config"
echo "[probe] HTTP GET $HTTP_URL"
code=$(curl -s -S -o /dev/null -w '%{http_code}' --max-time 3 "$HTTP_URL" || true)
echo "[probe] HTTP status: ${code:-ERR}"

# Optional: WS probe using node if available and ws installed
if command -v node >/dev/null 2>&1; then
  if node -e "try{require('ws');process.exit(0)}catch(e){process.exit(42)}" 2>/dev/null; then
    node - "$TARGET" <<'NODE' || true
const WebSocket = require('ws');
const host = process.argv[2];
const url = 'ws://' + host + '/ws';
console.log('[probe] WS connect', url);
const ws = new WebSocket(url);
const timer = setTimeout(() => { console.log('[probe] WS timeout'); process.exit(0); }, 3000);
ws.on('open', () => { clearTimeout(timer); console.log('[probe] WS open OK'); process.exit(0); });
ws.on('error', (e) => { clearTimeout(timer); console.log('[probe] WS error', String(e && e.message || e)); process.exit(0); });
NODE
  else
    echo "[probe] WS check skipped (node 'ws' module not installed)"
  fi
fi

echo "[probe] done"
