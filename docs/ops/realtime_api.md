# Realtime API (FastAPI + SSE)

## Overview
- Purpose: Replace 1s polling with a single server‑push connection per client. UI는 Next.js 기준이며 Streamlit은 레거시로 보관.
- Server: FastAPI (`server/app.py`) exposes
  - `GET /health` → `{ ok: true, rooms: <count> }`
  - `GET /logs` → snapshot list (compatible with legacy semantics)
  - `GET /logs/stream` → text/event-stream (SSE) with snapshot + incremental appends
- Source of truth for log parsing/dedup/filter: `server/log_utils.py`

## Endpoints
- `GET /logs`
  - Query: `roomId`, `limit` (default 80, max 500), `include`, `exclude`
  - Response: `[{ts,roomId,roomName,sender,text,mid}, ...]`
- `GET /logs/stream`
  - Query:
    - `rooms`: comma‑separated roomIds (optional)
    - `all`: `1|true` to include global feed
    - `limit`: max items per feed (default 80, max 500)
    - `include`, `exclude`: space‑separated keywords (lowercase match)
    - `since`: ms epoch (optional; if omitted, starts from now)
    - `interval`: server scan interval in ms (default 1000)
  - Event payloads (SSE):
    - `{"type":"snapshot","rooms":{rid:[...]},"all":[...]}`
    - `{"type":"append","rooms":{rid:[...]},"all":[...]}`
  - Heartbeat: sends `: keep-alive` comments periodically when no data

## Configuration
- Env vars:
  - `REALTIME_API_HOST` (default `0.0.0.0`), `REALTIME_API_PORT` (default `8650`)
  - `IRIS_LOGS_DIR` (default `node-iris-app/data/logs`)
- Windows portproxy:
  - `windows/setup_iris_port.ps1`에서 IRIS 포트(5050/8510)만 설정한다.
  - Realtime API는 Windows 호스트에서 직접 8650 포트로 노출되며, 별도 WSL 포트프록시를 사용하지 않는다.  
    (자세한 구조는 `docs/adr/ADR-0010-windows-only-stack.md`, `docs/adr/ADR-0017-status-api-and-fs-decoupling.md` 참고)

## Run (dev)
- Pure server (Windows 또는 WSL 공통, 개발용)
  - `python -m venv server/.venv_api`
  - `server/.venv_api/Scripts/pip install fastapi uvicorn` (Windows 기준, WSL은 `bin/pip`)
  - `IRIS_LOGS_DIR=./node-iris-app/data/logs server/.venv_api/Scripts/uvicorn server.app:app --host 0.0.0.0 --port 8650`
- With UI (권장: Windows 전용 스택)
  - 전체 스택: `windows/start_all.cmd -IrisUrl "http://127.0.0.1:5050" -ApiPort 8650 -WebPort 3100`
  - 또는
    - API만: `windows/start_api.ps1 -Port 8650`
    - 웹만: `windows/start_web.ps1 -Port 3100 -ForceKillPort`
- 레거시(WLS + Streamlit/Next 조합, 사용 지양)
  - `./scripts/serve_web.sh` 와 `PORT=8512 ./scripts/serve_ui.sh`는 ADR-0010에서 **폐기된 명령어**로 분류된다.  
    새 운영 환경에서는 사용하지 말고 위 PowerShell 스크립트를 따른다.

## UI Integration
- `dashboard/ui_node_iris.py`
  - Uses `register_log_realtime(...)` to open `EventSource(/logs/stream)`
  - On failure, falls back to legacy `GET /logs/bulk` polling
  - Time zone: `ko-KR`, `Asia/Seoul`

## Verification
- `curl http://localhost:8600/health`
- Browser devtools → Network → `logs/stream` → EventStream frames
- DOM updates for many rooms occur once per tick without page reruns
