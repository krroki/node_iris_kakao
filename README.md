# 14.kakao

LDPlayer + IRIS 기반 카카오톡 자동화(수신 전용 안전모드)의 코드/문서 저장소입니다. UI 대시보드, 실시간 로그(1초), 포트프록시/ADB 설정 스크립트를 포함합니다.

- 작업 전 `agents.md`의 지침을 먼저 확인하세요.
- 실행/운영 관련 빠른 가이드는 아래 Quick Start를 따르세요.

**중요: 기본은 SAFE_MODE=true로 “메시지 발송 차단” 상태입니다. 수신/로그만 동작합니다.**

**Quick Start**
- Windows(관리자 PowerShell)
  - IRIS HTTP 프록시/포트 열기: `windows/setup_iris_port.ps1 -LocalPort 5050`
  - 정상 확인: `Probe http://127.0.0.1:5050/config -> HTTP 200` 출력
- WSL(Ubuntu)
  - 봇 시작(WSL에서 실행): `scripts/start_bot_wsl.sh`
    - `.env` 자동 생성: `IRIS_URL=<Windows_IP>:5050`, `SAFE_MODE=true`
    - 봇 로그: `logs/bot_wsl.log`
  - 대시보드(UI): `scripts/serve_ui.sh` → 브라우저에서 `http://localhost:8501`
    - 실시간 로그 API 자동 기동: `127.0.0.1:8510/logs`

**검증 체크리스트**
- UI 상단 상태: IRIS Connection = “Connected”
- 로그 API: `curl http://127.0.0.1:8510/logs?limit=5` → 최근 이벤트 JSON 출력
- 방 카드: 최근 메시지 실시간 미깜빡임 업데이트(1초 주기)
- 메시지 발송 차단: SAFE_MODE=true 유지, 발송 컨트롤러 미등록(수신만)

**중요 경로**
- UI 엔트리: `dashboard/ui_node_iris.py`
- 봇 소스/설정: `node-iris-app`
  - 실행환경 파일: `node-iris-app/.env` (예시: `node-iris-app/.env.example`)
  - 런타임 기능 토글: `node-iris-app/config/runtime.json`
  - 수신 로그: `node-iris-app/data/logs/<roomId>/*.log`
- 실행 스크립트(WSL):
  - 봇 시작: `scripts/start_bot_wsl.sh`
  - UI 시작: `scripts/serve_ui.sh`
  - 로그 API 단독(선택): `python3 scripts/log_api.py`
- 실행 스크립트(Windows/Admin PowerShell):
  - 포트프록시/ADB: `windows/setup_iris_port.ps1 -LocalPort 5050`
  - 상태 점검: `windows/probe_iris.ps1`

**트러블슈팅**
- UI 연결 끊김(Disconnected)
  - Windows에서 `windows/setup_iris_port.ps1 -LocalPort 5050` 다시 실행 후 `HTTP 200` 확인
  - WSL 봇 `.env`의 `IRIS_URL`이 `<Windows_IP>:5050`인지 확인
  - `scripts/start_bot_wsl.sh` 재실행(로그: `logs/bot_wsl.log`)
- 로그 API 응답 없음
  - `scripts/serve_ui.sh`가 `8510`을 자동 기동합니다. 필요시 `python3 scripts/log_api.py` 수동 실행
- 깜빡임/새로고침 느낌
  - 대시보드는 내부 JS 위젯으로 1초 주기 부분 갱신(페이지 전체 리런 방지)로 구성되어 있습니다.

**디자인/레퍼런스**
- UI 참고 이미지: `a3/1031/1.png`, `a3/1031/2.png`, `a3/1031/3.png`, `a3/1031/4.png`

**안전모드(SAFE_MODE)**
- 기본값 `SAFE_MODE=true` 입니다. 발송 관련 컨트롤러는 등록되지 않으며, 수신/로그만 동작합니다.

자세한 내용은 `README_DASHBOARD.md`, `docs/runbook_windows_portproxy.md`, `docs/sessions/feat-node-iris.md`를 참고하세요.
