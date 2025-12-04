# 12.kakao Agents Handbook

**언어 정책**: 모든 커뮤니케이션과 로그는 한국어로 작성한다.
**프로젝트 요약**: Redroid(Hyper‑V) + IRIS 기반 카카오톡 자동화(수신 전용 SAFE_MODE) 운영. Python 봇, TypeScript IRIS 어댑터, Next.js 대시보드(FastAPI+SSE), 운영 스크립트로 구성된다.
**주요 스택**: Python 3.10+, Node.js (TypeScript, Vitest), Streamlit, Playwright, PowerShell.

---

## ⚠️ 대상 카페 구분 (중요) - ADR-0009

이 프로젝트는 **두 개의 네이버 카페**를 다루며, **도메인이 완전히 분리**된다:

### 1. 디하클 카페 (서비스 도메인) - 모든 사용자 기능의 기준
- **URL**: https://cafe.naver.com/dinohighclass
- **cafe_id**: 30819883
- **역할**: KB 수집, RAG 챗봇, 사용자 대상 모든 기능
- **SSOT**: `config/menus_dinohighclass.json`
- **프로필**: main, free, paid, tips, community
- **주요 게시판**:
  - 무료 특강: 신청(23), 후기(32)
  - 정규 강의: 신청(42)
  - 꿀팁: 주차별 하이라이트(48), 회원 꿀팁(136), 운영자 꿀팁(51), 강사 꿀팁(172)
  - 커뮤니티: 자유 게시판(33), 수익 인증(206), 성장일기(62), 수강생 인터뷰(245)

### 2. nameyee 카페 (기술 레퍼런스 도메인)
- **URL**: https://cafe.naver.com/nameyee
- **역할**: IRIS/루팅/챗봇 개발 기술 문서 (운영자/개발자 참고용)
- **서비스 대상 아님**: KB 수집, UI 기능, RAG 답변에서 **절대 혼용 금지**

### 도메인 분리 원칙 (불변식)
1. **디하클 검색에 nameyee 혼입 금지**: dinohighclass 프로필 검색 시 nameyee 데이터가 절대 포함되지 않음
2. **기본값은 디하클**: profile 미지정 시 항상 dinohighclass만 검색
3. **명시적 요청 원칙**: nameyee 데이터는 명시적 요청 시에만 사용 (향후 구현)

**임의로 게시판 이름을 추측하지 말 것. 반드시 `config/menus_dinohighclass.json` 또는 실제 데이터를 확인할 것.**

---

## ⚠️ 프로세스 관리 금지사항 (치명적)

### 절대 금지: 전체 Node 프로세스 종료
```powershell
# ❌ 절대 사용 금지 - Codex/Claude Code 등 다른 Node 앱도 죽임
Stop-Process -Name node -Force
taskkill /F /IM node.exe
```

### 올바른 방법: node-iris-app만 종료
```powershell
# ✅ 봇 프로세스만 종료
powershell.exe -ExecutionPolicy Bypass -File "C:\Users\Public\stop_node_iris_bot.ps1"

# 또는 WMI로 특정 프로세스만
wmic process where "name='node.exe' and commandline like '%node-iris-app%'" call terminate
```

**이유**: Codex, Claude Code, 기타 개발 도구가 Node.js로 실행 중. 전체 kill 시 개발 환경 파괴.

---

## ⚠️ 봇 싱글톤 메커니즘 (ADR-0011)

### 불변식
**봇 프로세스는 항상 1개만 실행되어야 한다.**

### 근본 원인
IRIS WebSocket은 연결된 모든 클라이언트에 동일한 메시지를 브로드캐스트.
N개의 봇 프로세스 실행 → N번 중복 응답 발생.

### 해결 방안 (2단계 방어)
1. **PID 락 파일** (`node-iris-app/data/bot.lock`)
   - `index.ts`: 시작 시 기존 PID 확인 → 살아있으면 종료 시도 → 현재 PID 기록
   - `app.ts`: 추가 락 체크 (BOT_LOCK_EXISTS 시 즉시 종료)

2. **시작 스크립트** (`windows/start_bot.ps1`)
   - `dist\index.js` 패턴으로 기존 봇 프로세스 전량 종료 후 새로 시작
   - `smart_restart_bot.ps1` → `Start-Bot` → `start_bot.ps1` 체인

### 봇 재시작 명령어 (권장)
```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File windows\smart_restart_bot.ps1 -Force
```

### 프로세스 확인
```powershell
wmic process where "name='node.exe'" get processid,commandline | findstr "dist"
```

### AI 에이전트 지침 (중요)
**봇 재시작 시 반드시 `smart_restart_bot.ps1`을 사용**:
- `smart_restart_bot.ps1`: IRIS 연결 확인 → portproxy 검증 → 기존 봇 종료 → 새 봇 시작 (권장)
- `start_bot.ps1`: 직접 사용 금지 (IRIS 상태 미확인으로 연결 실패 가능)

---

## ⚠️ IRIS_URL SSOT (필수) - ADR-0010

### 표준값
```
IRIS_URL=http://127.0.0.1:5050
```

### 아키텍처
```
┌─────────────────────────────────────────────────────┐
│  Windows Host                                        │
│  node-iris-app → IRIS_URL=http://127.0.0.1:5050     │
│           ↓                                          │
│  Portproxy: 127.0.0.1:5050 → VM_IP:3000             │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌──────────────────────┴──────────────────────────────┐
│  Hyper-V VM "redroid" (≠ WSL, 완전히 별개)           │
│  Docker: IRIS Container (포트 3000)                  │
└─────────────────────────────────────────────────────┘
```

### 규칙
1. **단일 소스**: `node-iris-app/.env`의 IRIS_URL만 사용
2. **VM IP 직접 연결 금지**: 반드시 portproxy 경유 (127.0.0.1:5050 → VM_IP:3000)
3. **8765 포트 사용 금지**: 레거시 포트, 모든 .env에서 제거 완료
4. **.env 위치 주의**: 프로젝트에 .env가 여러 개 있음 (루트, node-iris-app, iris_server 등)
5. **Hyper-V VM ≠ WSL**: VM(redroid)과 WSL Ubuntu는 완전히 별개 환경

---

## ⚠️ Windows 전용 스택 (ADR-0010)

### 공식 운영 명령어 (Windows PowerShell)

**전체 스택 (API + 봇 + 웹)**
```powershell
cd C:\dev\12.kakao
powershell -NoProfile -ExecutionPolicy Bypass `
  -File windows\start_all.ps1 `
  -IrisUrl "http://127.0.0.1:5050" `
  -ApiPort 8650 -WebPort 3100
```

**웹만 재시작**
```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File windows\start_web.ps1 -Port 3100 -ForceKillPort
```

**봇만 재시작 (IRIS 살아있을 때)**
```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File windows\smart_restart_bot.ps1 -Force
```

### 폐기된 명령어 (사용 금지)
- ❌ `scripts/serve_web.sh` (WSL용)
- ❌ `C:\Users\Public\run_node_iris_bot.ps1` (레거시)
- ❌ 포트 8765 관련 모든 것

---

핵심 문서 링크
- `docs/workflow/solo-dev-epic-pr.md` – 브랜치·PR 운영 표준 (Epic Draft PR 프로세스)
- `docs/ssot.md`, `docs/prd.md`, `docs/roadmap.md` – 제품/기술 결정의 단일 출처
- `docs/adr/ADR-0010-windows-only-stack.md` – Windows 전용 스택 + IRIS_URL SSOT
- `docs/adr/ADR-0011-bot-singleton-mechanism.md` – 봇 싱글톤 메커니즘 (중복 응답 방지)
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
- **Python 봇 코어**: `src/`, `tests/`, `scripts/` – Redroid(Hyper‑V)/IRIS 이벤트 수신, 메시지 저장/조회, 운영 테스트 스크립트.  
  
UI 전환 지침
- 기본 UI는 `web/`(Next.js), SSE는 `server/`(FastAPI)에서 제공
- 레거시 Streamlit `dashboard/`는 보존만 하고 운영 기본에서 제외
- SAFE_MODE는 항상 ON이며 발신 UI/엔드포인트는 노출하지 않는다
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
- **ADR**: 아키텍처/기술 결정에 변화가 생기면 `docs/adr/ADR-<4자리>-<slug>.md` 작성 또는 갱신. 상세 지침은 아래 "ADR 관리 지침" 참조.
- **세션 로그**: `docs/sessions/<branch>.md` 파일은 브랜치 단위로 유지, 세션 시작/종료마다 업데이트.
- 문서 구조가 확장될 경우 `docs/reference/README.md`에 신규 레퍼런스를 추가하고, 관련 링크를 본 문서에 반영한다.

### ADR 관리 지침

**ADR(Architecture Decision Records)**은 프로젝트의 주요 기술/아키텍처 결정을 기록하여 향후 컨텍스트를 보존한다.

#### 파일명 규칙
```
docs/adr/ADR-<4자리 번호>-<주제-kebab>.md
```
예: `ADR-0003-fastapi-sse-migration.md`

#### 상태 전환
- **Draft** → **Proposed** → **Accepted** → **Deprecated** / **Superseded by ADR-XXXX**

#### 작성 트리거
1. **주요 아키텍처 변경**: 데이터 흐름, 폴더 구조, 핵심 라이브러리 교체
2. **기술적 이견 조율**: AI 제안 vs 사용자 선호 간 결정
3. **비기능적 요구사항**: 성능, 보안, 비용 관련 결정
4. **Workaround 적용**: 버그나 제약사항의 비표준 해결

#### 필수 섹션
- **Context**: 문제 배경, 제약 조건
- **Options Considered**: 고려한 대안들과 장단점
- **Decision**: 최종 결정과 그 이유, 불변식(Invariants)
- **Consequences**: 긍정/부정 효과, 후속 작업
- **Links**: 관련 PR, 문서, 코드 경로

#### 코드 연동
핵심 코드에 ADR 참조 주석을 남긴다:
```typescript
// NOTE: (ADR-0002) Hyper-V VM 내부 Docker에서 IRIS 실행
```

#### 템플릿
새 ADR 작성 시 `docs/adr/ADR-0000-template.md`를 복사하여 사용한다.

---

## 6. 운영 가드레일
- 기본 모드는 `SAFE_MODE=true` (발송 차단). UI/스크립트 모두 이 전제를 깨어서는 안 된다.
- 환경 변수/토큰은 Git에 커밋 금지. `.env`는 `config/env.example`를 복제하여 세션 범위에서만 사용한다.
- IRIS 포트프록시는 `windows/setup_iris_port.ps1`(관리자 PowerShell) → `scripts/probe_iris.sh` 순으로 점검한다.
- 데이터/로그 파일은 보관 목적일 경우 `data/`, `logs/` 하위에만 저장한다. 외부 경로에는 쓰지 않는다.
- 경로 추측 금지: 변경 전 `ls`, `cat`으로 파일 존재를 직접 확인한다.

### ⚠️ Hyper-V Docker 접근 (중요)
**IRIS/Redroid는 Hyper-V VM 내부의 Docker에서 실행된다. 로컬 Windows Docker가 아님!**
- VM 이름: `redroid`
- VM IP 확인: `powershell.exe -Command "(Get-VMNetworkAdapter -VMName redroid).IPAddresses"`
- SSH 접속: `ssh iris@<VM_IP>`
- Docker 상태 확인: `ssh iris@<VM_IP> 'docker ps'`
- IRIS API 호출: `curl http://<VM_IP>:3000/api/...`

**절대 로컬 Docker(`docker ps`)를 IRIS 환경으로 착각하지 말 것!**

---

---

## ⚠️ IRIS/node-iris-app 디버깅 필수 규칙 (강력 준수)

### 절대 원칙: 추측으로 해결 시도 금지
IRIS, node-iris-app은 외부 라이브러리 기반으로 문서화가 부족하다. **제한된 지식으로 추측해서 수정하지 말 것.**

모르면 먼저 탐색한다:
1. `node-iris-app/src/` 전체 구조 파악
2. 관련 키워드로 grep 검색
3. 데이터 흐름 전체 추적

### 버그 수정 전 필수 단계
1. **전체 데이터 흐름 추적**: 메시지가 어디서 생성되어 어디로 전달되는지 전체 경로 파악
   - IRIS WebSocket → node-iris-app → KB Service → LLM → 응답 조립 → KakaoTalk
2. **모든 레이어 grep**: 출력 관련 버그는 한 곳만 보지 말고 전체 프로젝트 grep
   ```bash
   grep -r "키워드" --include="*.ts" --include="*.py" .
   ```
3. **node-iris-app 코드 탐색 우선**: 익숙하지 않은 영역이면 먼저 읽고 이해한 후 수정

### 출력/메시지 형식 문제 체크리스트
메시지 출력 형식 버그 발생 시 아래 모든 레이어를 확인:
1. **KB Service** (`kb/service.py`) - LLM 프롬프트에서 생성
2. **node-iris-app utils** (`src/utils/askKb.ts`) - 후처리로 추가될 수 있음
3. **node-iris-app controllers** (`src/controllers/`) - 컨트롤러에서 변환될 수 있음
4. **sender utils** (`src/utils/sender.ts`) - 최종 발송 전 가공

### 금지 사항
- ❌ 눈에 보이는 한 곳만 고치고 완료 선언
- ❌ grep 없이 "아마 여기겠지" 추측 수정
- ❌ 테스트 없이 "고쳤다" 판단

## 7. 참고 리소스
- `README.md`, `README_DASHBOARD.md` – 빠른 실행/운영 가이드.
- `UI_VERIFICATION_CHECKLIST.md` – 대시보드 시각 검증 포인트.
- `docs/ops/`, `docs/setup/` – 운영, 설치, 복구 절차 모음.
- `scripts/` 내 README/주석 – 스크립트별 요구 조건과 사용법.
- 필요 시 `docs/reference/verification-commands.md`에 새 명령을 추가하고, 위 섹션들과 동기화한다.

본 핸드북과 동일한 내용은 `claude.md`에도 유지하여 AI/자동화 에이전트가 같은 지침을 따르도록 한다.
