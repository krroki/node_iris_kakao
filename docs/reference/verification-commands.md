# 검증 및 운영 명령어 레퍼런스

> **목적**: 12.kakao 저장소에서 사용되는 테스트/운영/스모크 명령을 한곳에 정리  
> **대상**: 변경 검증, 세션 종료 점검, 운영 스크립트 실행 전 참고  
> **업데이트 기준**: 스크립트/테스트 추가·삭제, 실행 경로 변경 시 즉시 갱신

---

## 1. 루트 레벨 기본 점검

| 목적 | 명령 | 비고 |
|------|------|------|
| Python 테스팅 | `pytest` | 루트에서 실행, `tests/` 전체 대상 |
| Python 문법 스모크 | `python -m compileall src` | 빠른 문법 검증 (선택) |
| Playwright 기반 스크립트 확인 | `npx playwright test` | `scripts/*.js`에서 사용하는 Playwright 의존성 검증 |
| 프로젝트 의존성 설치 | `pip install -r requirements.txt` | 루트 Python 환경 구성 |

> 문서 전용 변경(`docs/**`, `README*.md`, `**/*.md`)만 포함된 PR은 테스트 생략 가능.  
> 그렇지 않은 경우 최소 `pytest`는 실행해야 한다.

---

## 2. Python 자동화 계층 (`src/`, `scripts/`, `tests/`)

| 시나리오 | 명령 | 설명 |
|----------|------|------|
| LDPlayer/IRIS 봇 실행 (WSL) | `scripts/start_bot_wsl.sh` | `.env` 자동 생성 후 봇 기동 (`logs/bot_wsl.log` 확인) |
| 봇 중지 | `scripts/stop_bot_wsl.sh` | 프로세스 종료 및 로그 남김 |
| 로그 API 단독 실행 | `python scripts/log_api.py` | `http://127.0.0.1:8510/logs` 엔드포인트 확인 |
| 메시지 저장소 테스트 | `pytest tests/test_message_store.py` | 핵심 스토리지 로직 단위 테스트 |
| IRIS 연결 확인 | `pytest tests/test_iris_connection.py` | 연결/환경 변수 검증 |
| 실사용 시나리오 테스트 | `python scripts/test_room_registration.py` | 방 등록 스모크 |

실행 전 `pip install -r requirements.txt` 및 필요 시 `pip install -r dashboard/requirements.txt`를 통한 의존성 정비가 필요하다.

---

## 3. Node IRIS 어댑터 (`node-iris-app/`)

> 모든 명령은 `node-iris-app/` 디렉터리에서 실행한다.

| 목적 | 명령 | 설명 |
|------|------|------|
| 의존성 설치 | `npm install` | 첫 실행 또는 패키지 갱신 시 |
| 타입스크립트 빌드 | `npm run build` | `dist/` 산출 (TS → JS) |
| 개발 서버 | `npm run dev` | `ts-node` + nodemon |
| 프로덕션 실행 | `npm run start` | `dist/index.js` 실행 |
| Vitest 테스트 | `npm test` | 단위/통합 테스트 실행 |
| 환경 변수 점검 | `npm run check:env` | `.env` 필수 값 체크 |

`node-iris-app/.env.example`을 기반으로 로컬 환경 변수를 구성하고, 변경 시 `config/runtime.json`을 함께 확인한다.

---

## 4. Streamlit 대시보드 (`dashboard/`)

| 시나리오 | 명령 | 설명 |
|----------|------|------|
| 의존성 설치 | `pip install -r dashboard/requirements.txt` | Streamlit/데이터 처리 패키지 |
| 대시보드 실행 | `streamlit run dashboard/ui_node_iris.py` | `http://localhost:8501` |
| 로그 API 연동 실행 | `scripts/serve_ui.sh` | Streamlit + 로그 API 동시 실행 |
| 수동 로그 API 실행 | `python scripts/log_api.py` | 로그 엔드포인트만 기동 |

대시보드 UI는 SAFE_MODE에서 메시지 발송 차단 여부와 로그 깜빡임(1초 주기)을 확인해야 한다.

---

## 5. IRIS 서버 리소스 (`iris_server/`, `infra/iris/`)

| 목적 | 명령 | 설명 |
|------|------|------|
| 가상환경 의존성 설치 | `pip install -r iris_server/requirements.txt` | IRIS 헬퍼 스크립트 |
| IRIS DB 유틸 실행 | `python iris_server/irispy.py` | 로컬 DB, 인증 도우미 |
| 참고 README | `iris_server/README.MD` | 세부 설정/사용법 |

`infra/iris/`에는 추가 리소스와 예제 봇이 포함되어 있으므로, 동일 명령 패턴을 따른다.

---

## 6. Windows 운영 스크립트 (`windows/`)

| 목적 | 명령 (PowerShell 관리자) | 설명 |
|------|-------------------------|------|
| 포트프록시/ADB 설정 | `windows/setup_iris_port.ps1 -LocalPort 5050` | 기본 포트 5050, 필요 시 `_5005` 버전 사용 |
| 상태 점검 | `windows/probe_iris.ps1` | HTTP 200 여부 체크 |
| WSL 봇 로그 모니터링 | `windows/tail_wsl_bot.ps1` | 실시간 로그 tail |
| 포트프록시 해제/재설정 | `windows/tcp_proxy_iris.ps1` | 고급 네트워크 설정 |

모든 스크립트는 관리자 권한 PowerShell에서 실행해야 하며, 실행 전 `Set-ExecutionPolicy RemoteSigned` 상태를 확인한다.

---

## 7. 세션 종료 체크

1. 코드 변경이 있는 모든 언어/영역에 대해 위 명령으로 테스트 수행 (`pytest`, `npm test`, `npx playwright test` 등).
2. `scripts/log_api.py` 또는 UI 스모크를 통해 런타임 동작 스크린샷/로그 확보.
3. 결과를 PR 또는 `docs/sessions/<branch>.md`에 링크로 남긴다.
4. 필요 시 `docs/ssot.md`와 `docs/todo.md`를 업데이트하여 후속 조치 기록.

본 레퍼런스는 `agents.md`/`claude.md` 체크리스트와 함께 사용되며, 명령 추가 시 두 문서를 동기화해야 한다.
