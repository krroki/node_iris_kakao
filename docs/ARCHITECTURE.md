# Architecture Overview (Current → Target)

## Current (as of SAFE_MODE/RAG hardening, 2025-12-06)

- Runtime
  - Redroid (Hyper‑V) runs IRIS service on the guest: `tcp:3000` (ADB forward target)
  - Windows hosts the ADB forward + portproxy
    - `127.0.0.1:5050 → (ADB forward) → redroid:3000`
    - `127.0.0.1:8510 → <redroid_IP>:8510` (Log API, FastAPI 기반으로 점진 이전 중)
  - Windows Python:
    - KB/RAG 서비스: `kb.service:app` (FastAPI, :8610)
    - 실시간 서버: `server.app:app` (FastAPI, :8650 — `/logs`, `/logs/stream`, `/rooms`, `/runtime`, `/templates`)
  - Node service:
    - `node-iris-app` (TypeScript, dist/index.js, data/logs/room_avatars/templates/runtime.json은 모두 SSOT)
  - UI:
    - Next.js 대시보드: `web/` (포트 3100 dev, 빌드 후 start는 3000/지정 포트)
    - 레거시 Streamlit `dashboard/`는 보존용이며 운영 기본에서 제외
    - 템플릿 SSOT:
      - 공지/환영/브로드캐스트/스케줄 등에서 사용하는 메시지 템플릿은 **단일 소스**로 `node-iris-app/config/templates/<category>/*.json`을 사용한다.
      - FastAPI 실시간 서버(`server/log_utils.list_templates`)와 웹 UI(`/templates`, `/settings`)는 모두 이 경로를 기준으로 템플릿 목록을 읽고, runtime.json.templateByFeature에는 **파일명(name)**만 저장한다.
      - 과거 다른 경로(WSL/Streamlit용)에 있던 템플릿은 필요 시 이 SSOT 경로로 수동 마이그레이션 한다.
    - 상태/룸/아바타 SSOT:
      - 봇/로그/디바이스 상태 및 룸 목록은 FastAPI `server.app:app`이 제공하는 HTTP API를 단일 소스로 사용한다.
      - 상태 요약은 `/health` + `/status`에서 제공하며, 룸 목록은 `/rooms`에서 제공한다.
      - 로그 스냅샷/실시간 로그는 `/logs`, `/logs/bulk`, `/logs/stream`를 통해 제공되며, 이때 사용하는 `roomId` 우주는 `server/log_utils.list_rooms()`가 정의한 값과 동일하다.
      - 방 아바타(썸네일)는 `server/log_utils.find_avatar_path(roomId)`가 `node-iris-app/data/logs/room_avatars/<roomId>.*`에서 찾는 파일을 기반으로 하며, Next UI의 RoomCard는 `/api/rooms`와 아바타 경로를 함께 사용해 동일한 `roomId` 집합을 표시한다.
      - Next.js API 라우트(`/api/status`, `/api/rooms`, `/api/bulk`)는 파일 시스템을 직접 읽지 않고, 이 HTTP API들을 프록시하는 역할만 수행한다.

- UI/Logs Path (before)
  - Each room box polled `/logs?roomId=...` every second → N requests per tick
  - Streamlit iframes isolate JS scopes; per-room components injected scripts repeatedly

- Improvements (this branch)
  - Added `/logs/bulk` API to return many rooms in one response (limit, include/exclude, optional “all” feed)
  - Injected a single polling script per page that updates many placeholders by ID (1 request per tick)
  - Time formatting in JS set to `ko-KR` with `Asia/Seoul`
  - Windows setup script now also portproxies `8510` so the UI can reliably reach Log API via `localhost:8510`
  - SAFE_MODE 기본값은 `node-iris-app/config/runtime.json.safeMode = true` 이며, **발신(공지/브로드캐스트/AI/토크 API)은 이 값을 단일 소스로 삼아 제어**한다.
    - 웹 UI(`/settings`)에서 SAFE MODE를 토글하면 FastAPI `/runtime` → runtime.json.safeMode에 즉시 반영된다.
    - Node 봇은 컨트롤러 내부의 `isSafeMode()`를 통해 SAFE_MODE 여부를 확인하고, true일 때는 발신을 수행하지 않는다.
    - PowerShell 스크립트(`windows/start_bot.ps1`)는 더 이상 `SAFE_MODE=false`를 강제 설정하지 않으며, IRIS_URL/포트 등 실행에 필요한 값만 주입한다.

- Known pain points (still)
  - Pull model (polling) adds latency and load (albeit much reduced with bulk)
  - Split runtime across Windows + WSL + Hyper‑V still introduces multiple failure points

## Target (A-Plan)

- Web structure retained, real-time delivery upgraded to push (SSE/WS)
  - Server: FastAPI provides
    - `/logs/stream` (SSE) for incremental updates (tailer + dedup, since/offset support)
    - `/logs` (HTTP) for snapshots and troubleshooting
    - `/health` for liveness checks
  - Frontend: Streamlit(현행) → Next.js(목표) 구독. 현행도 `EventSource`로 1회 연결 (실패 시 `/logs/bulk`로 폴백)
  - Windows/WSL bridge kept minimal; local-only access preferred; avoid cross-subsystem hops when possible

- Benefits
  - Eliminate per-second polling → lower CPU/network, lower latency
  - One stable server entrypoint (API + stream) → simpler observability and recovery
  - UI decoupled from Streamlit limitations; predictable DOM lifecycle

## Migration Notes

- Keep `scripts/log_api.py` as reference for parsing/tailing/filtering semantics
- New server lives under `server/` (FastAPI) and exposes SSE and HTTP endpoints (default port 8600)
- New UI lives under `web/` (Next.js); Streamlit acts only as fallback until parity
- Windows `setup_iris_port.ps1` remains for `5050/8510` until ADB/portproxy can be simplified or removed
  - Updated to also proxy `8600` (Realtime API)
