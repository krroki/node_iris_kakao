#!/usr/bin/env bash
set -euo pipefail

# Gemini log test runner
# - Reads API key from config/gemini.key (1st line)
# - Exports GEMINI_API_KEY only for this process
# - Runs two sample tests with limited calls

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
KEY_FILE="${ROOT_DIR}/config/gemini.key"

if [[ ! -f "$KEY_FILE" ]]; then
  echo "[오류] $KEY_FILE 파일이 없습니다. 아래 명령으로 생성하세요:" >&2
  echo "    echo '<YOUR_GEMINI_API_KEY>' > $KEY_FILE" >&2
  exit 2
fi

API_KEY="$(head -n1 "$KEY_FILE" | tr -d '\r')"
export GEMINI_API_KEY="$API_KEY"

echo "[정보] GEMINI_API_KEY 로드 완료. 테스트를 진행합니다."
# 고정 모델(요청): Gemini 1.5 Flash
MODEL="models/gemini-1.5-flash"
echo "[정보] 모델(고정): $MODEL"

# 최신 로그 파일 자동 선택 (node-iris-app/data/logs)
NODE_LOG_DIR="$ROOT_DIR/node-iris-app/data/logs"
# 실방 ID: 숏천모 2번방, 디하클 시크릿톡방
RID1="18426993080683374"
RID2="18455243186079943"
LOG1=$(ls -1t "$NODE_LOG_DIR/$RID1/"*.log 2>/dev/null | head -n1)
LOG2=$(ls -1t "$NODE_LOG_DIR/$RID2/"*.log 2>/dev/null | head -n1)
if [[ -z "$LOG1" ]]; then
  echo "[오류] $NODE_LOG_DIR/$RID1 디렉터리에 로그 파일이 없습니다." >&2
  exit 2
fi
if [[ -z "$LOG2" ]]; then
  echo "[오류] $NODE_LOG_DIR/$RID2 디렉터리에 로그 파일이 없습니다." >&2
  exit 2
fi

python3 "$ROOT_DIR/scripts/gemini_context_responder.py" \
  --log "$LOG1" \
  --room-name "숏천모 2번방" \
  --model "$MODEL" \
  --min-gap-seconds 600 \
  --max-calls-per-room 2 \
  --execute \
  --max-calls 2

python3 "$ROOT_DIR/scripts/gemini_context_responder.py" \
  --log "$LOG2" \
  --room-name "디하클 시크릿톡방" \
  --plain-every 3 \
  --model "$MODEL" \
  --min-gap-seconds 600 \
  --max-calls-per-room 2 \
  --execute \
  --max-calls 2

echo "[완료] 두 로그에 대한 호출을 마쳤습니다."
