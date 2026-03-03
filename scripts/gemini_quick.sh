#!/usr/bin/env bash
set -euo pipefail

# Quick runner for Gemini responder using room IDs (auto-picks latest log)

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
KEY_FILE="$ROOT_DIR/config/gemini.key"

if [[ ! -f "$KEY_FILE" ]]; then
  echo "[오류] $KEY_FILE 가 없습니다. 첫 줄에 API 키를 넣어주세요." >&2
  exit 2
fi

export GEMINI_API_KEY="$(head -n1 "$KEY_FILE" | tr -d '\r')"

# Default model (new SDK name)
MODEL="models/gemini-1.5-flash"

# Room IDs (edit as needed)
RID1="18426993080683374"  # 숏천모 2번방
RID2="18455243186079943"  # 디하클 시크릿톡방

echo "[정보] 모델: $MODEL"

python3 "$ROOT_DIR/scripts/gemini_context_responder.py" \
  --room-id "$RID1" \
  --model "$MODEL" \
  --gate-mode smart \
  --min-answer-score 3 \
  --excerpt 18 \
  --window-seconds 1800 \
  --local-excerpt 24 \
  --min-gap-seconds 600 \
  --max-calls-per-room 1 \
  --execute \
  --max-calls 1

python3 "$ROOT_DIR/scripts/gemini_context_responder.py" \
  --room-id "$RID2" \
  --model "$MODEL" \
  --gate-mode smart \
  --min-answer-score 3 \
  --excerpt 18 \
  --window-seconds 1800 \
  --local-excerpt 24 \
  --min-gap-seconds 600 \
  --max-calls-per-room 1 \
  --execute \
  --max-calls 1

echo "[완료] gemini_quick 실행 종료"
