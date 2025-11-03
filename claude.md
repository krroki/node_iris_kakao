# 12.kakao Agents Handbook

**언어 정책**: 모든 커뮤니케이션과 로그는 한국어로 작성한다.  
**프로젝트 요약**: LDPlayer + IRIS 기반 카카오톡 자동화(수신 전용 SAFE_MODE) 운영. Python 봇, TypeScript IRIS 어댑터, Streamlit 대시보드, 운영 스크립트로 구성된다.  
**주요 스택**: Python 3.10+, Node.js (TypeScript, Vitest), Streamlit, Playwright, PowerShell.

핵심 문서 링크
- `docs/workflow/solo-dev-epic-pr.md` – 브랜치·PR 운영 표준 (Epic Draft PR 프로세스)
- `docs/ssot.md`, `docs/prd.md`, `docs/roadmap.md` – 제품/기술 결정의 단일 출처
- `docs/reference/project-structure.md` – 저장소 구조 및 책임 구분
- `docs/reference/verification-commands.md` – 테스트/스모크/운영 명령어 요약

---

## 1. 세션 부팅 시퀀스
1. **현재 위치/브랜치 확인**: `pwd`, `git status -sb`로 작업 디렉터리와 브랜치를 점검.  
2. **워크플로 재확인**: `docs/workflow/solo-dev-epic-pr.md`를 빠르게 훑고 Epic Draft PR 규칙을 상기한다.  
3. **컨텍스트 로딩**: `docs/ssot.md`, `docs/prd.md`, `docs/roadmap.md`, 최신 ADR(`docs/adr/*`)을 확인하여 진행 중인 결정과 범위를 머릿속에 로드한다.  
4. **구조 파악**: `docs/reference/project-structure.md`로 현재 디렉터리 책임을 재확인, 필요한 영역의 README/CLAUDE 문서를 찾아본다.  
5. **세션 로그 업데이트**: `docs/sessions/<branch>.md`에 세션 Goal/다음 행동을 기록하고, 완료 시에도 동일 파일을 갱신한다.  
6. **명령어 체크**: 예정된 작업에 맞춰 `docs/reference/verification-commands.md`에서 필요한 테스트/스모크 명령을 미리 확인한다.

---

## 2. 저장소 맵 & 책임
- **Python 봇 코어**: `src/`, `tests/`, `scripts/` – LDPlayer/IRIS 이벤트 수신, 메시지 저장/조회, 운영 테스트 스크립트.  
- **Node IRIS 어댑터**: `node-iris-app/` – TypeScript로 작성된 IRIS 연동 계층, `npm test`/`npm run build` 필수.  
- **Streamlit 대시보드**: `dashboard/`, `scripts/log_api.py` – 실시간 로그 UI와 API.  
- **IRIS 지원 리소스**: `iris_server/`, `infra/iris/`, `windows/` – IRIS DB, PowerShell 포트프록시, 운영 도구.  
- **문서 체계**: `docs/` – SSOT/PRD/로드맵, 세션 로그, 설정 가이드, 레퍼런스(본 핸드북 포함).  
구조 변경 시 `docs/reference/project-structure.md`를 우선 업데이트한 뒤, 본 문서와 관련 워크플로 문서의 링크를 동기화한다.

---

## 3. 브랜치 & PR 운영 원칙
- `main`은 직접 푸시 금지. 모든 작업은 `feat/*`, `fix/*`, `chore/*` 브랜치에서 시작한다.
- 브랜치를 생성한 즉시 Draft PR을 열어 **Goal / Scope / Invariants / Acceptance Criteria / Docs / Tasks / Decision Log** 섹션을 채운다.
- 세션 동안 내린 결정은 PR 코멘트 + `docs/sessions/<branch>.md` + `docs/ssot.md`에 모두 반영한다.
- 테스트/스크린샷/로그가 있는 경우 PR 코멘트나 첨부 링크로 남긴다.
- Merge 전략은 기본적으로 Merge commit. 필요 시 Rebase/Squash는 PR 성격에 맞게 선택한다.

---

## 4. 테스트 & 품질 게이트
- **Python 변경**: 최소 `pytest`; 구조 변경 시 `python -m compileall src`로 빠른 문법 체크.  
- **Node/TypeScript 변경**: `cd node-iris-app && npm install && npm test && npm run build`.  
- **Playwright 스크립트/JS 자동화 수정**: 루트에서 `npx playwright test`.  
- **대시보드/로그 API**: `scripts/serve_ui.sh` 혹은 `streamlit run dashboard/ui_node_iris.py` + `python scripts/log_api.py`로 스모크.
- 문서 전용 변경(`docs/**`, `README*.md`, `**/*.md`)만 포함된 경우 테스트 생략 가능. 그 외에는 `docs/reference/verification-commands.md` 기준으로 관련 영역 검증을 완료해야 한다.
- 실패한 테스트를 무시하거나 임시로 주석 처리하지 않는다. 원인을 해결하고 재실행한다.

---

## 5. 문서 & 기록 관리
- **SSOT(`docs/ssot.md`)**: 새로운 결정, 배포 결과, 미해결 항목을 즉시 기록.  
- **제품 문서**: 범위/요구 변경 시 `docs/prd.md`, `docs/roadmap.md`, 필요 시 `docs/todo.md`를 함께 수정.  
- **ADR**: 아키텍처/기술 결정에 변화가 생기면 `docs/adr/<id>-<slug>.md` 작성 또는 갱신.  
- **세션 로그**: `docs/sessions/<branch>.md` 파일은 브랜치 단위로 유지, 세션 시작/종료마다 업데이트.  
- 문서 구조가 확장될 경우 `docs/reference/README.md`에 신규 레퍼런스를 추가하고, 관련 링크를 본 문서에 반영한다.

---

## 6. 운영 가드레일
- 기본 모드는 `SAFE_MODE=true` (발송 차단). UI/스크립트 모두 이 전제를 깨어서는 안 된다.  
- 환경 변수/토큰은 Git에 커밋 금지. `.env`는 `config/env.example`를 복제하여 세션 범위에서만 사용한다.  
- IRIS 포트프록시는 `windows/setup_iris_port.ps1`(관리자 PowerShell) → `scripts/probe_iris.sh` 순으로 점검한다.  
- 데이터/로그 파일은 보관 목적일 경우 `data/`, `logs/` 하위에만 저장한다. 외부 경로에는 쓰지 않는다.
- 경로 추측 금지: 변경 전 `ls`, `cat`으로 파일 존재를 직접 확인한다.

---

## 7. 참고 리소스
- `README.md`, `README_DASHBOARD.md` – 빠른 실행/운영 가이드.
- `UI_VERIFICATION_CHECKLIST.md` – 대시보드 시각 검증 포인트.
- `docs/ops/`, `docs/setup/` – 운영, 설치, 복구 절차 모음.
- `scripts/` 내 README/주석 – 스크립트별 요구 조건과 사용법.
- 필요 시 `docs/reference/verification-commands.md`에 새 명령을 추가하고, 위 섹션들과 동기화한다.

본 핸드북과 동일한 내용은 `claude.md`에도 유지하여 AI/자동화 에이전트가 같은 지침을 따르도록 한다.
