# Session: refactor/fastapi-sse (2025-11-04)

## Goal
- Replace per-room polling with single SSE connection per client
- Keep legacy bulk endpoint as fallback
- Add template image attachments in UI

## Changes
- Server
  - `server/app.py`: FastAPI app with `/health`, `/logs`, `/logs/stream`
  - `server/log_utils.py`: log tail/parse/filter/dedup helpers
  - `scripts/serve_api_fastapi.sh`: uvicorn launcher
- UI
  - `dashboard/ui_node_iris.py`: add `register_log_realtime(...)` (SSE + polling fallback)
  - Replace Rooms/Logs usage to realtime function
  - Template editor: image attachments (assets folder per template, preview)
- Windows
  - `windows/setup_iris_port.ps1`: add portproxy 8600 (Realtime API) in addition to 8510

## How to use
1) Windows(Admin): `windows/setup_iris_port.ps1` Ąć sets 5050/8510/8600
2) WSL: `IRIS_LOCAL_PORT=5050 ./scripts/start_bot_wsl.sh`
3) WSL: `PORT=8512 ./scripts/serve_ui.sh` (auto starts uvicorn if available)
4) Browser: `http://localhost:8512` Ąć realtime updates; fallback if SSE unavailable

## Next
- Auto?install uvicorn in UI script (optional)
- Status badges for SSE connection/fallback in UI
- E2E test: append log lines Ąć verify DOM updates in 10s

## 2025-11-25
- Goal: 온보딩(문맥 로드) 후 대기.
- Status: AGENTS 핸드북 필수 문서 빠른 스캔 완료(Workflow/Architecture/REFAC_PLAN/SSOT/PRD/Roadmap/구조참조).
- Added: `scripts/live_roster.py`(로그 스트림 기반), `scripts/live_roster_full.py`(IRIS DB 스냅샷 기반), `docs/CHANGELOG.md` 기록.
- Cleanup: talkapi 캡처/토큰 스크립트 일체 삭제.
- Next: 추가 지시 수신 시 진행.

## 2025-11-27
- Goal: 봇 상태 점검 후 대시보드 가동.
- Status: 문맥 로드(Architecture/Project Structure/Verification Commands) 및 SAFE_MODE 확인.
- Actions: `scripts/start_bot_wsl.sh`로 봇 재기동(SAFE_MODE=true 유지, IRIS 5005 응답 없음으로 socket hang up 재시도 중), `nohup ./scripts/serve_web.sh` 백그라운드 실행 → Next.js(3100) 가동, FastAPI `/health` OK(`rooms=65`, bot pid 표시).
- Next: IRIS 포트프록시/서비스 정상화 후 연결 상태 재확인.
