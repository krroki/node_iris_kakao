# 12.kakao 프로젝트 구조 레퍼런스

> **목적**: 저장소 전역 구조와 책임 구분을 빠르게 파악할 수 있는 참고 자료  
> **대상**: 새로 온 AI/개발자가 파일 위치, 모듈 경계를 확인할 때  
> **업데이트 기준**: 디렉터리 추가·삭제, 책임 분리/통합이 발생할 때 즉시 갱신

---

## 1. 상위 레이아웃 개요

```
12.kakao/
├─ README.md
├─ agents.md
├─ claude.md
├─ docs/
│  ├─ analysis/           # 카페 데이터 분석 아카이브
│  ├─ ops/                # 운영 가이드 및 체크리스트
│  ├─ sessions/           # 브랜치별 세션 로그
│  ├─ setup/              # 환경 구성 절차
│  ├─ workflow/           # 워크플로/PR 규칙
│  ├─ reference/          # (신규) 구조·명령어 레퍼런스
│  └─ *.md                # PRD, SSOT, Roadmap 등 핵심 문서
├─ src/                   # Python 자동화/서비스 엔트리
│  ├─ bot/                # LDPlayer/IRIS 이벤트 수신 진입점
│  ├─ bots/               # 봇 시나리오 구현
│  ├─ services/           # 공용 서비스/도메인 로직
│  └─ utils/              # 범용 유틸리티
├─ node-iris-app/         # Node.js 기반 IRIS 연동 서비스 (TypeScript)
├─ dashboard/             # Streamlit UI 및 실시간 로그 API
├─ iris_server/           # IRIS 연동 서버 샘플/도구 (Python)
├─ scripts/               # 운영 및 데이터 수집 스크립트
├─ infra/                 # IRIS 관련 배포/설치 자료
├─ windows/               # Windows PowerShell 스크립트 (포트프록시/ADB)
├─ tests/                 # Python 테스트 (pytest)
├─ config/                # 환경 변수 예시 및 설정 가이드
├─ data/, cafe_data/, logs/, research_results.json ...  # 분석/운영 산출물
└─ external/, a3/, board_*.png ...                      # 참고 자료 및 캡쳐 자산
```

---

## 2. 핵심 레이어 책임

| 영역 | 주요 경로 | 역할 | 관련 실행/문서 |
|------|-----------|------|----------------|
| **Python Bot Core** | `src/`, `scripts/`, `tests/` | IRIS 이벤트 처리, 메시지 저장, 운영 스크립트 | `pytest`, `python -m compileall src`, `scripts/start_bot_wsl.sh` |
| **Node IRIS Adapter** | `node-iris-app/` | TypeScript 기반 IRIS 연동, Vitest 테스트 | `npm install`, `npm run build`, `npm test` |
| **Realtime Dashboard** | `dashboard/`, `scripts/log_api.py` | Streamlit UI + 로그 API | `scripts/serve_ui.sh`, `streamlit run dashboard/ui_node_iris.py` |
| **IRIS Helper Server** | `iris_server/`, `infra/iris/` | 로컬 IRIS 리소스, DB, 헬퍼 스크립트 | `pip install -r iris_server/requirements.txt` |
| **Ops & Documentation** | `docs/`, `README.md`, `agents.md` | 제품/기술 SSOT, 워크플로, 운영 체크리스트 | `docs/reference/project-structure.md`, `docs/reference/verification-commands.md` |

---

## 3. 상세 디렉터리 설명

### 3.1 `src/` – Python 자동화 본체
- `bot/main.py`: LDPlayer + IRIS 기반 메시지 수신 진입점.
- `bots/`: 대화방별 시나리오 및 제어 로직.
- `services/`: 데이터 접근, 메시지 저장/조회, 상태 관리.
- `utils/`: 공통 헬퍼 (시간, 포맷, 로깅 등).
- 테스트는 `tests/`에서 pytest로 수행하며, 통합/단위 테스트가 혼재되어 있다.

### 3.2 `node-iris-app/` – TypeScript IRIS 어댑터
- `src/`: IRIS SDK(`@tsuki-chat/node-iris`)를 활용한 이벤트 핸들러.
- `config/`: 런타임 토글(`runtime.json`)과 `.env.example`.
- `scripts/`: 환경 체크(`checkEnv.ts`) 및 운영 유틸리티.
- `tests/`: Vitest 기반 자동화.
- 루트와 분리된 npm 프로젝트이므로, 명령 실행 전 `npm install` 필요.

### 3.3 `dashboard/` – 실시간 UI 대시보드
- `ui_node_iris.py`: Streamlit UI 엔트리.
- `streamlit_dashboard.py`: 별도 레이아웃/구성 요소.
- `requirements.txt`: Streamlit 및 시각화 의존성.
- `scripts/serve_ui.sh`는 로그 API까지 함께 기동한다 (`http://localhost:8501`, `http://127.0.0.1:8510/logs`).

### 3.4 `scripts/` – 운영 및 데이터 수집 툴킷
- **운영 스크립트**: `start_bot_wsl.sh`, `stop_bot_wsl.sh`, `serve_ui.sh`, `probe_iris.sh`.
- **데이터 수집**: `cafe_crawler.py`, `iris_board_collector.py`, `simple_cafe_collector.js`.
- **검증/테스트**: `test_room_registration.py`, `test_real_kakao_integration.py`, `verify_safe_mode_wsl.sh`.
- 스크립트마다 의존성이 다르므로 실행 전 README/주석과 `docs/op` 자료를 확인한다.

### 3.5 `docs/` – 운영 문서 및 레퍼런스
- `ssot.md`: 제품/기술 결정의 단일 출처.
- `prd.md`, `roadmap.md`, `todo.md`: 제품 방향성, 일정.
- `ops/`, `setup/`, `workflow/`: 운영 프로세스, 설치 가이드, 브랜치/PR 규칙.
- `reference/`: (이 문서 포함) 구조 및 검증 명령어 레퍼런스. 신규 자료 추가 시 `docs/README.md` 또는 섹션 링크 업데이트.
- `sessions/`: 브랜치별 세션 로그 (워크플로 문서에 템플릿 정의).

### 3.6 환경/플랫폼별 지원 자산
- `windows/`: PowerShell 스크립트 (`setup_iris_port.ps1` 등)로 포트프록시, 로그 확인.
- `infra/` & `iris_server/`: IRIS 서버 구성, 로컬 데이터베이스(`iris.db`), 예제 봇.
- `config/env.example`: WSL 봇 실행을 위한 환경 변수 템플릿.

### 3.7 데이터/분석 아카이브
- `data/`, `cafe_data/`, `research_results.json`: 카페 수집 데이터, 분석 결과.
- `logs/`, `test_logs/`: 실행 로그 및 테스트 아웃풋.
- 이미지/HTML 캡쳐(`board_*.png`, `article_*.html` 등)는 참고용 자료.

---

## 4. 변경 시 체크리스트

- 신규 디렉터리 추가 시 본 문서에 트리/역할 업데이트.
- 책임 영역이 이동하면 표(Section 2)와 상세 설명(Section 3)을 동시에 수정.
- 문서/스크립트 이름이 변경되면 `agents.md` 및 관련 워크플로 문서 링크도 함께 갱신.
- 대규모 구조 변경 전후로 `docs/reference/verification-commands.md`에 영향 여부 확인.

본 문서는 세션 시작 체크리스트(agents/claude)와 연동되어 있으므로 항상 최신 상태를 유지한다.
