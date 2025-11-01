#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/node-iris-app"
LOG_FILE="$ROOT_DIR/logs/bot_wsl.log"
ENV_FILE="$APP_DIR/.env"

SAFE_ENV=$(grep -E '^SAFE_MODE=' "$ENV_FILE" || true)
echo "ENV: ${SAFE_ENV:-SAFE_MODE=unset}"

if [[ -f "$LOG_FILE" ]]; then
  echo "Controllers (last seen):"
  tail -n 200 "$LOG_FILE" | grep -F 'Registered controller' | tail -n 10 || true
  if tail -n 500 "$LOG_FILE" | grep -E 'Custom(NewMember|Message|Batch|Bootstrap)Controller' -q; then
    echo "WARN: unsafe controllers present"
    exit 2
  else
    echo "OK: no sending controllers registered"
  fi
else
  echo "log not found: $LOG_FILE"
fi

