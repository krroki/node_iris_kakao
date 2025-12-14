# Realtime Quickstart (WSL + Windows, 레거시)

> ⚠️ **주의**  
> 이 문서는 과거 WSL + Streamlit + Next.js(dev) 조합을 기준으로 한 레거시 빠른 시작 가이드입니다.  
> 현재 공식 운영 스택은 **Windows 전용(ADR-0010)** + FastAPI(`/logs/stream`) + Next.js(`web/`)이며,  
> 실제 운영/개발 시에는 `windows/start_all.cmd`(내부적으로 `start_all.ps1` 호출) / `windows/start_web.ps1` / `windows/start_api.ps1`를 사용해야 합니다.  
> 최신 구조와 명령은 `docs/ARCHITECTURE.md`, `docs/ops/realtime_api.md`, `docs/runbook_windows_portproxy.md`를 우선 참고하세요.

## TL;DR
1) Windows(관리자 PowerShell) – **레거시 WSL 실험용** (현 운영 기본 아님)
```
powershell -ExecutionPolicy bypass -file "\\wsl$\ubuntu\home\glemfkcl\dev\12.kakao\windows\setup_iris_port.ps1"
```
→ 5050(IRIS), 8510(Log API), 8600(Realtime API) 포트프록시/방화벽 설정

2) WSL(Ubuntu) – 레거시 봇/대시보드 실행
```
IRIS_LOCAL_PORT=5050 ./scripts/start_bot_wsl.sh
PORT=8512 ./scripts/serve_ui.sh   # SSE 서버(8600) 자동 기동
./scripts/serve_web.sh            # Next.js 웹 UI (http://localhost:3100)
```

3) 브라우저: http://localhost:3100 (Next.js UI, 레거시 구성 기준)
   - VM/다른 기기에서 접속해야 하면 `windows/start_all.cmd -WebHostname 0.0.0.0`(또는 `windows/start_web.ps1 -Hostname 0.0.0.0`)로 바인딩을 열고, `localhost` 대신 **호스트 IP**로 접속한다.
→ 실시간(SSE) 연결 상태 배지 확인. 연결 실패 시 오류 배지 표시.

## 세부
### A. FastAPI 서버만 수동 실행 (레거시 포트 8600 기준)
```
python3 -m venv server/.venv_api
server/.venv_api/bin/pip install fastapi uvicorn
IRIS_LOGS_DIR=./node-iris-app/data/logs \
  server/.venv_api/bin/uvicorn server.app:app --host 0.0.0.0 --port 8600
```
- 확인: `curl http://127.0.0.1:8600/health`
- SSE: 브라우저에서 `http://127.0.0.1:8600/logs/stream?all=1&limit=20`

### B. Next.js UI 실행 (레거시 스크립트)
```
./scripts/serve_web.sh
```
또는:
```
cd web && npm install && npm run dev
```

### C. 트러블슈팅 (레거시 구성 한정)
- Windows 포트프록시 재설정: `windows/setup_iris_port.ps1` 재실행 후 `Invoke-WebRequest http://localhost:8510/logs` 및 `http://localhost:8600/health` 확인
- 로그 디렉터리 변경: `IRIS_LOGS_DIR` 환경변수로 지정
