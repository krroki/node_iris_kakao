# IRIS 봇 관리 대시보드 🤖

IRIS + 카카오 오픈채팅 연동 봇을 운영하기 위한 웹 대시보드입니다. 1초 주기의 실시간 로그(페이지 전체 깜빡임 없이 부분 갱신), 방 카드/썸네일, 기능 토글(환영/브로드캐스트/스케줄), 전역 설정을 제공합니다. 기본은 SAFE_MODE=true로 메시지 발송이 차단된 수신 전용 모드입니다.

## ✨ 주요 특징

### 🏠 **직관적인 방 관리**
- 등록된 방 목록을 한눈에 확인
- 각 방별 설정을 클릭 몇 번으로 관리
- 자동 방 감지 및 수동 등록 기능

### 📊 **실시간 모니터링**
- 시스템 상태를 실시간으로 확인
- 메시지 통계를 그래프로 시각화
- 활동 추이를 쉽게 파악

### ⚙️ **간편한 설정 관리**
- 환영 메시지 템플릿 선택
- 전역 시스템 설정
- 데이터 가져오기/내보내기 기능

### 📱 **모바일 친화적**
- 스마트폰에서도 완벽하게 작동
- 반응형 디자인으로 최적화

## 🚀 시작 방법 (Quick Start)

사전 조건(Windows + WSL2):
- 관리자 PowerShell에서 IRIS HTTP 포트를 프록시/열기 (예: 5050)
  ```powershell
  windows/setup_iris_port.ps1 -LocalPort 5050
  # 정상: Probe http://127.0.0.1:5050/config -> HTTP 200
  ```
- WSL에서 봇 실행(.env 자동 생성: `IRIS_URL=<Windows_IP>:5050`, `SAFE_MODE=true`)
  ```bash
  scripts/start_bot_wsl.sh
  # 로그: logs/bot_wsl.log
  ```

대시보드(UI) 실행(WSL):
- 권장: 스크립트 실행 (로그 API 8510 자동 기동)
  ```bash
  scripts/serve_ui.sh
  # 브라우저: http://localhost:8501
  ```
- 직접 실행(선택):
  ```bash
  export NODE_IRIS_APP_DIR="$(pwd)/node-iris-app"
  python -m streamlit run dashboard/ui_node_iris.py --server.address 0.0.0.0 --server.port 8501
  ```

## 🖥️ 주요 화면

### 🏠 방 관리 탭
- **방 목록**: 현재 등록된 모든 방의 상태 확인
- **방 설정**: 자동 환영 메시지, 로깅 등 설정 변경
- **실시간 업데이트**: 변경 즉시 반영

### 📊 모니터링 탭
- **시스템 상태**: 봇 상태, 활성 방 수, 가동 시간
- **메시지 통계**: 최근 7일간의 메시지 추이 그래프
- **성능 지표**: 일일 평균 메시지 수 등

### ⚙️ 설정 탭
- **전역 설정**: 자동 방 감지, 백업 등 시스템 설정
- **환영 메시지**: 다양한 템플릿 선택 및 커스텀
- **데이터 관리**: 설정 파일 가져오기/내보내기

### ❓ 도움말 탭
- **사용법**: 각 기능의 상세한 사용법
- **자주 묻는 질문**: 문제 해결 가이드
- **모바일 사용법**: 스마트폰에서 사용하는 방법

## 🌐 접속 주소

- 로컬: http://localhost:8501
  - 첫 진입 시 상단 카드에서 IRIS Connection이 “Connected”로 표시되면 정상
  - 연결이 안되면 아래 트러블슈팅 참고

## 📋 시스템 요구사항 / 설치

- Python 3.10+
- `scripts/serve_ui.sh`가 `dashboard/.venv_ui` 가상환경을 만들고 필요한 패키지(streamlit 등)를 자동 설치합니다.

## 🔧 트러블슈팅

### UI가 Disconnected로 뜰 때
1) Windows(Admin)에서 다시 프록시 설정: `windows/setup_iris_port.ps1 -LocalPort 5050`
2) `HTTP 200`이 확인되면 WSL에서 `scripts/start_bot_wsl.sh` 재실행
3) `logs/bot_wsl.log`에서 probe 결과 확인 (예: `probe http://<winIP>:5050/config -> HTTP 200`)

### 로그가 갱신되지 않을 때
- `node-iris-app/data/logs/<roomId>/*.log`가 생성/갱신되는지 확인
- 로그 API(8510) 헬스: `curl http://127.0.0.1:8510/logs?limit=5`

### 깜빡임/새로고침 느낌
- 이 대시보드는 내부 JS 위젯으로 부분 갱신(1초)합니다. 전체 리런(페이지 깜빡임)은 일어나지 않습니다.

## 💡 사용 팁

- 상단 카드: IRIS URL, 활성 방 수, Messages/sec, 오류 수(24h)를 빠르게 확인
- 각 방 카드: 최근 메시지 실시간(스크롤 영역), 기능 토글 후 “저장”
- Logs 탭: 필터(포함/제외), 최대 행 선택, 방별 상세 보기 가능

## 🆘 지원

문제가 발생하거나 도움이 필요하면:
- 도움말 탭을 참고하세요
- 시스템 로그를 확인해 보세요

---

**IRIS 봇 관리 대시보드** - 복잡한 봇 관리를 단순하고 친숙하게! 🎉

### 참고
- UI 엔트리: `dashboard/ui_node_iris.py`
- 로그 API: `scripts/log_api.py` (포트 8510, `scripts/serve_ui.sh`에서 자동 실행)
- 봇/런타임 설정: `node-iris-app/config/runtime.json`, `.env` (예시: `node-iris-app/.env.example`)
- UI 레퍼런스 이미지: `a3/1031/{1,2,3,4}.png`
