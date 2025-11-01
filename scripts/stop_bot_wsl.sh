#!/usr/bin/env bash
set -euo pipefail
pkill -f "/node-iris-app/dist/index.js" 2>/dev/null || true
echo "[bot] stopped"

