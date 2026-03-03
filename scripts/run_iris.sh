#!/usr/bin/env bash
# LDPlayer + IRIS 봇 실행 스크립트 (UTF-8)

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_PATH="$PROJECT_ROOT/.venv"

if [ ! -d "$VENV_PATH" ]; then
  echo "[ERROR] 가상환경(.venv)을 찾을 수 없습니다. requirements.txt 설치를 먼저 진행하세요." >&2
  exit 1
fi

source "$VENV_PATH/bin/activate"
python -m src.bot.main "${IRIS_URL:-}" "$@"
