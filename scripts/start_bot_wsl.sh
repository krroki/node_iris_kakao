#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/node-iris-app"
LOG_DIR="$ROOT_DIR/logs"
LOG_FILE="$LOG_DIR/bot_wsl.log"

mkdir -p "$LOG_DIR"

# Resolve Windows host IP for WSL2 (so WSL can reach Windows ADB forward at 127.0.0.1:3000)
# Prefer default gateway (Windows host), fallback to resolv.conf nameserver
WIN_IP=$(ip route | awk '/^default via /{print $3; exit}')
if [[ -z "$WIN_IP" ]]; then
  WIN_IP=$(awk '/^nameserver /{print $2; exit}' /etc/resolv.conf || true)
fi
if [[ -z "$WIN_IP" ]]; then
  echo "[bot] Failed to resolve Windows host IP from /etc/resolv.conf" | tee -a "$LOG_FILE"
  exit 1
fi

# Ensure .env has correct IRIS and SAFE_MODE (no send)
ENV_FILE="$APP_DIR/.env"
# Allow overriding local port (default: 5005 which proxies to device:3000)
IRIS_LOCAL_PORT="${IRIS_LOCAL_PORT:-5005}"
cat > "$ENV_FILE" <<EOF
IRIS_URL=${WIN_IP}:${IRIS_LOCAL_PORT}
IRIS_HOST=${WIN_IP}
MOCK_IRIS=false
COMMAND_PREFIX=!
SAVE_CHAT_LOGS=false
LOG_LEVEL=debug
MESSAGE_LOG_DIR=data/logs
BROADCAST_DB=data/broadcast-queue.json
ENABLE_REMINDERS=true
ENABLE_NOTIFICATIONS=true
BATCH_SIZE=100
SCHEDULE_INTERVAL=5000
KAKAOLINK_APP_KEY=
KAKAOLINK_ORIGIN=
SAFE_MODE=true
ALLOWED_ROOM_IDS=
EOF
echo "[bot] .env written (WSL): IRIS_URL=${WIN_IP}:${IRIS_LOCAL_PORT} SAFE_MODE=true" | tee -a "$LOG_FILE"

cd "$APP_DIR"

# Kill previous bot in case it's running
pkill -f "/node-iris-app/dist/index.js" 2>/dev/null || true

# Build and start
npm install --silent >> "$LOG_FILE" 2>&1 || true
npm run build >> "$LOG_FILE" 2>&1
nohup npm start >> "$LOG_FILE" 2>&1 &
disown || true
echo "[bot] started (WSL) with log: $LOG_FILE"

# Quick probe to help UI/debugging
sleep 1
PING_URL="http://${WIN_IP}:${IRIS_LOCAL_PORT}/config"
if command -v curl >/dev/null 2>&1; then
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "$PING_URL" || true)
  echo "[bot] probe ${PING_URL} -> HTTP ${status:-ERR}" | tee -a "$LOG_FILE"
fi
