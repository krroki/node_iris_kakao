# 12.kakao Agents Handbook

**언어 정책**: 모든 커뮤니케이션과 로그는 한국어로 작성한다.
**프로젝트 요약**: Redroid(Hyper‑V) + IRIS 기반 카카오톡 자동화(수신 전용 SAFE_MODE) 운영. Python 봇, TypeScript IRIS 어댑터, Next.js 대시보드(FastAPI+SSE), 운영 스크립트로 구성된다.
**주요 스택**: Python 3.10+, Node.js (TypeScript, Vitest), FastAPI(+SSE), Next.js(React), Playwright, PowerShell.

---

## 🚨 제1원칙: FALLBACK 절대 금지 (최우선 준수)

### 불변식
**어줍잖은 fallback은 시스템을 망가뜨린다. 절대 사용 금지.**

### 원칙
1. **모든 코딩은 목적과 결과가 분명해야 한다**
   - 입력 → 처리 → 출력의 모든 경로가 명확해야 함
   - "혹시 모르니까" 식의 fallback 금지

2. **fallback이 필요해 보이는 상황 = 엣지케이스 분석 부족**
   - fallback을 넣고 싶다면, 그 상황이 왜 발생하는지 근본 원인을 먼저 파악
   - 모든 엣지케이스를 열거하고 각각에 대한 명시적 처리 로직 작성

3. **"일단 fallback으로 처리" 금지**
   - ❌ `catch (e) { return defaultValue }` - 에러 원인 은폐
   - ❌ `value ?? fallbackValue` - 왜 null인지 모르는 상태로 진행
   - ❌ `try { ... } catch { /* 무시 */ }` - 문제 숨기기

### 올바른 접근
```typescript
// ❌ 금지: 어줍잖은 fallback
const result = riskyOperation() ?? "default";

// ✅ 권장: 명시적 에러 처리
const result = riskyOperation();
if (result === null) {
  throw new Error("riskyOperation returned null: [구체적 원인 분석]");
}
```

### 예외 (명시적 승인 필요)
- 사용자가 "이 경우는 fallback 써도 된다"고 명시적으로 지시한 경우에만 허용
- 그 경우에도 로그에 fallback 발동 사실을 남겨야 함

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
  - 꿀팁: 주차별 하이라이트(48), 회원 꿀팁(136), 운영자 꿀팁(51)
    - **강사들의 꿀팁(172)은 수집/조회/노출에서 완전 제외** (자료 기반 답변 불가, `disabled_board`로 종료)
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

## 6. RAG / KB 설계 불변식

- **카페 자료 우선 + 폴백 금지**
  - RAG 답변은 디하클 카페 데이터베이스(`sources_post`, `manual_doc`, `embeddings`)를 단일 근거로 사용한다.
  - 검색/필터 결과가 0건이면 LLM을 호출하지 않고, “질문과 직접 관련된 카페 자료를 찾지 못했습니다.”와 같은 **명시적 없음 응답**만 반환한다.
  - “정보 없음” 답변에 임의로 URL/CTA/버튼을 붙이지 않는다. 링크는 항상 근거 게시글의 `url`만 사용한다.

- **도메인/일반 경로 분리 (ADR-0018, ADR-0021)**
  - `?디하클 ...` 형식으로 들어오는 카카오톡 질의는 node-iris `CustomMessageController`에서만 KB로 전달하며, `askKb.ts`에서 기본 컨텍스트 태그(예: `dinohighclass`, `디하클`)를 붙여 `/ask_llm`으로 보낸다.
  - `/ask_llm`에서 `context_tags`가 있으면 기본적으로 도메인(RAG) 경로를 시도한다. (node-iris는 접두어 제거 후 본문만 보내므로 태그가 사실상 “도메인 힌트” 역할을 함)
  - 단, Sajulab 강제 태그(`sajulab`, `sajulab.kr`, `사주랩`)가 있으면 도메인=True를 강제하고 일반상식 예외를 타지 않는다.
  - 일반 상식 경로 조건: Sajulab 강제 태그가 없고, `_is_general_knowledge_query` 또는 `_is_platform_usage_query`가 참인 경우에만 `_build_general_answer`를 사용한다.
  - 일반 상식 답변은 항상 `가이드라인에는 없지만, 일반 상식으로 답변드립니다.` 로 시작하며 URL을 출력하지 않는다.

- **카페 메타(회원수/멤버수)**
  - “디하클 카페 회원수/멤버수/가입자수” 질문은 KB 수집 데이터가 아니라 **카페 홈(카페정보) HTML에서 실시간 파싱**하여 결정적으로 답한다(`diag.mode=cafe_member_count`).
  - 파싱 실패 시 숫자를 추측/생성하지 말고 “자동 조회 실패”로 안내한다.

- **카페 기본 정보/강사진(운영 편의)**
  - `docs/cafe_profile.md`를 `[KB] 디하클 카페 기본 정보`로 upsert하여( `kb/manualize.py`) 카페 기본 정보(SSOT)를 RAG 근거로 제공한다.
  - 신청 게시판(무료특강 23 / 정규강의 42) 기반으로 `[KB] 강의/강사 인덱스 (신청 게시판)` 매뉴얼을 자동 생성해 신규 강의/강사 표기가 바로 검색되도록 한다.
  - “강사진/강사 목록” 질문은 LLM 없이 결정적으로 응답한다(`diag.mode=instructors_list`, 제목 끝 `(닉네임)` 표기 기준 — 누락 가능).

- **링크/CTA 정책**
  - 링크/CTA는 항상 실제 게시글/매뉴얼의 `url`에만 근거해야 한다. 임의로 URL을 구성하거나, 없는 링크를 “추측”해서는 안 된다.
  - “정보 없음/찾지 못했/관련 정보 없음/자료 부족/다시 시도” 류 답변에는 링크를 강제로 붙이지 않는다.
  - 일반 상식 경로에서는 링크를 절대 출력하지 않는다.

- **용어/인물 SSOT (중요)**
  - “다시보기”, “마케터제이J(대표/운영자)”, “룰루랄라릴리(강사)” 등 흔들리면 안 되는 정의는 `docs/kb_glossary.md`에 고정한다.
  - 디하클 강의/특강은 “프로그램명(고유명)” 관행이 강하다. 고유명이 포함된 질문은 해당 고유명이 **제목/본문에 실제 포함된 글**만 근거로 사용한다(하드코딩/추측 금지).
  - “누구야/정체/소개” 류 질문은 LLM 환각 위험이 커서 `config/entities_dinohighclass.json`(역할 정의) + 카페 글 URL 근거만으로 **결정적으로** 답한다(`diag.mode=entity_intro`).

- **날짜/키워드 정합성**
  - 일정/강의/다시보기·링크 관련 질문에서는, 제목+본문(norm_text)에 동일한 날짜·키워드가 포함된 문서만 최종 후보로 사용한다.
  - 날짜 표현(예: `12월 3일`, `12/3`, `12.3`)은 `_extract_date_keys`처럼 **MMDD 키**로 정규화해 비교한다.

- **LLM 역할 한정**
  - LLM은 “후보 중에서 정리/요약/선택”만 수행한다. 게시글 목록에 없는 새로운 강의/이벤트/링크를 지어내면 안 된다.
  - 재랭크 입력은 “제목 + 키워드 주변 본문 요약(최대 300자)”에 한정하며, 후보 수가 소수일 때는 LLM 재랭크를 생략한다.

- **검증 도구**
  - `scripts/verify_rag.py`와 `tests/test_rag_*.py`를 통해 대표 질문(예: “사알못 다시보기 링크”, “강의 날짜/가격/포인트”, “Sajulab 사용법”)과 완전히 무관한 일반 질문 케이스를 자동 검증한다.
  - RAG 관련 변경 후에는 이 스크립트를 우선 실행해 회귀 여부를 확인한다.

---

## 7. Windows 운영 엔트리포인트 (중요)

- **사용자 실행 권장**: `windows/start_all.cmd` (더블클릭/`cmd.exe` 편의용)
- **로직 SSOT(수정 기준)**: `windows/start_all.ps1` (실제 기동 로직은 여기만 유지)
- `start_all.cmd`는 **얇은 래퍼**로만 유지한다(항상 `start_all.ps1`를 호출, 로직 추가 금지).
- **PowerShell 자동변수 주의**: `$PID`는 읽기 전용 자동 변수이며 대소문자 구분이 없어 `$pid`도 동일하게 취급된다. 프로세스 ID 변수는 `$workerPid/$procPid/$listenPid`처럼 충돌 없는 이름을 사용한다.

### 6.1 예외적으로 허용되는 일반 상식 답변 (PM 지시 기반)

- **허용 조건**
  - 질문이 디하클/강의 도메인과 명백히 무관한 일반 상식(예: “피자 만드는 법 알려줘”, “피타고라스 정리 증명해줘”)이고,
  - 카페 자료와의 키워드/날짜 매칭이 전혀 없다고 판정된 경우에 한해,
  - PM이 명시적으로 요구한 형식으로 **“일반 상식 기반 답변” 경로**를 사용한다.
- **형식 불변식**
  - 첫 문장은 항상 정확히 다음 문장으로 시작해야 한다.  
    `가이드라인에는 없지만, 일반 상식으로 답변드립니다.`
  - 디하클 카페 내부 자료나 강의/다시보기 링크가 있는 것처럼 **절대 꾸미지 않는다.**
  - 어떤 외부 사이트 URL도 출력하지 않는다(https:// 포함 금지).
  - 3~6문장 정도의 짧은 한국어 설명으로 제한하며, 모르는 부분은 “모릅니다/추측입니다”를 명시한다.
- **로그/검증**
  - 일반 상식 경로가 사용되면 `diag.mode`에 `general_*` 플래그를 남겨야 한다.
  - `scripts/verify_rag.py`에서 일반 질문 케이스는 위 프리픽스와 링크 미포함 여부를 함께 검증한다.

---

## ⚠️ 프로세스 관리 금지사항 (치명적)

### 절대 금지: 전체 Node 프로세스 종료
- `Stop-Process -Name node -Force`, `taskkill /F /IM node.exe` 같은 **전체 종료는 절대 금지**  
  (Codex/Claude Code/기타 도구까지 함께 종료되어 환경이 깨짐)

### 올바른 방법: node-iris-app만 종료
- **권장(부분 재기동)**:
  - `pwsh windows/start_bot.ps1 -Restart`
  - `pwsh windows/start_welcome_worker.ps1 -Restart`
  - `pwsh windows/start_ai_worker.ps1 -Restart`
  - `pwsh windows/start_broadcast_worker.ps1 -Restart`
  - `pwsh windows/start_command_worker.ps1 -Restart`
  - `pwsh windows/start_image_worker.ps1 -Restart`
  - `pwsh windows/start_auto_faq_worker.ps1 -Restart`
  - `pwsh windows/start_roster_worker.ps1 -Restart` (선택 기능)
  - `pwsh windows/start_openchat_members_sheets_worker.ps1 -Restart` (선택 기능)
  - `pwsh windows/start_course_membership_audit_worker.ps1 -Restart` (선택 기능)
  - `pwsh windows/start_web.ps1 -Mode prod -Port 3100 -ForceKillPort`
- 콜드 부팅/전체 복구가 필요할 때만: `windows/start_all.cmd`

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
- `docs/reference/kakao-mentions-and-reply.md` – 오픈채팅 “실제 멘션(@)” / “답장(Reply)” 구현 레퍼런스(새 세션 온보딩용)
- `docs/reference/kakao-room-command-triggers.md` – 방별 명령어(FAQ) 트리거 레퍼런스
- `docs/reference/auto-faq-worker.md` – 무명령어 자동 FAQ(질문 트리거) 설계/가드레일
- `docs/adr/ADR-0037-auto-faq-worker.md` – 무명령어 자동 FAQ 워커 결정
- `docs/adr/ADR-0041-default-nickname-reminder-mentions.md` – 카카오 기본 닉네임 변경 요청(멘션) 워커(멤버 완전성 확인 후 발신)
- `docs/reference/chat-summary.md` – 채팅 요약(chatSummary) 출력 규칙
- `docs/adr/ADR-0038-chat-summary-solution-first.md` – 채팅요약 “해결책 우선” 결정
- `docs/reference/outbound-message-style.md` – 발신 메시지 템플릿(튜브렌즈 스타일) 지침
- `docs/reference/openchat-members-google-sheets.md` – 오픈채팅 멤버(닉네임/userId) Google Sheets 업서트(서비스 계정 OAuth)
- `docs/reference/course-roster-worker.md` – 강의 운영: 오픈채팅 입장자 카페 가입/닉네임 검증 워커(15분/24시간 안내 + Sheets 업서트)
- `docs/reference/course-roster-v2-membership-audit.md` – 강의 운영 v2: 등급 기반 톡방 참여 점검 + 통합 스프레드시트
- `docs/adr/ADR-0039-course-roster-v2-membership-audit.md` – 강의 운영 v2 결정(SSOT)

---

## 0.1) (중요) 이 워킹트리에서는 `main`만 사용

현재 `C:\\dev\\12.kakao` 워킹트리를 **여러 세션/프로세스가 동시에 공유**하고 있다.

따라서 다음을 **절대 하지 않는다**:

- `git checkout <branch>` / `git switch <branch>` (워킹트리 흔들림 → 다른 세션 작업 파손)
- 새 브랜치 생성 후 체크아웃(동일 이유)

이 워킹트리에서 허용되는 Git 작업은 아래뿐이다:

- `main`에서 변경 반영 → `git commit` (필요 시 여러 커밋)
- PR/Epic 워크플로가 필요하면 **별도 clone/worktree**에서 수행

운영 재기동 원칙: *부분 재기동 우선*. `windows/start_all.cmd`는 콜드 부팅/전체 복구 때만 사용한다. (상세: `docs/reference/verification-commands.md`)

---

## 0.2) (필수) 공유 워킹트리 멀티세션 규칙(4.pint 준용)

> 이 워킹트리는 **동일한 작업 디렉터리에서 여러 세션/프로세스가 동시에 작업**할 수 있다.  
> 따라서 “내 작업 범위 밖 파일”은 **절대 건드리지 않는다.**

- 다른 세션 작업물이 보이더라도:
  - “정리/원복/포맷/리네임/삭제” 같은 행동을 하지 말고 **그냥 냅둔다**.
  - 필요하면 담당자에게 알리고, 나는 **내 범위만** 진행한다.
- 공유 워킹트리에서 금지(치명적):
  - `git restore .`, `git reset --hard`, `git clean -fd` 같은 **전체 원복/삭제**
  - repo 전체 포맷/린트(예: `prettier --write .` 등)
  - `git add -A` (다른 세션 변경 파일이 섞일 수 있음)
- 커밋/포맷은 “내가 바꾼 파일만”:
  - 스테이징: `git add <내가 바꾼 파일 경로만>`
  - 포맷/린트: `<도구> <내가 바꾼 파일만>`

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
- **대시보드(신규, 기본)**: `web/` – Next.js/React UI, FastAPI SSE 구독. (Room ID/userId 클릭 시 클립보드 복사, **강의 운영 토글/강의톡방 배지**는 RoomCard의 **강의 운영** 섹션)  
- **기본닉 멘션(ADR-0041)**: 방 카드의 `기본닉 멘션` 토글이 방별 스위치이며, 2차/3차 안내 간격(24h/48h 등)은 **3100 홈 상단 카드**에서 변경해 `runtime.nicknameReminder.warningSchedule`에 저장한다.
- **실시간 서버**: `server/` – FastAPI + SSE(`/logs/stream`), 스냅샷(`/logs`), 상태(`/health`, `/rooms`, `/runtime`, `/templates`).  

## 3. KB/RAG 스케줄 및 신선도 불변식

- KB 서비스는 **반드시 Windows 스크립트로만** 기동한다.
  - 권장: `windows/start_all.ps1` (전체 스택), 또는 `windows/kb_service.ps1` (KB 단독).
  - `python -m uvicorn kb.service:app ...` 같은 수동 실행은 **금지** – 이 경우 `KB_SCHED_*`가 설정되지 않아 수집/임베딩 스케줄이 멈출 수 있다.
- 스케줄 SSOT:
  - `KB_SCHED_COLLECT_MIN`, `KB_SCHED_EMBED_MIN`, `KB_SCHED_MANUAL_MIN`, `KB_SCHED_BACKFILL_MIN` (분 단위)
  - `windows/start_all.ps1` 및 `windows/kb_service.ps1`는 값이 비어 있을 때만 기본값을 설정한다. (collect=30, embed=30, manual=60, backfill=60)
  - KB 기동 시 `kb.service._init_schedule_from_env()`가 이 값들을 읽어 `/schedule` 상태를 초기화한다.
- 신선도 체크:
  - 중요한 변경/배포 전에는 반드시 `python scripts/kb_status.py`를 실행해 메뉴별 최신 글 날짜를 확인한다.
  - 무료 특강(23), 정규 강의 신청(42) 등 핵심 메뉴의 최근 수집이 **2일 이상 오래되었으면** collect/embed 스케줄이나 KB 프로세스 상태를 먼저 조사한 뒤 RAG 튜닝을 진행한다.
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
- **기능 워커 분리(ADR-0027/0028/0029)**:
  - Welcome(ADR-0027): 코어(bot)는 신규 입장 이벤트를 `member_joined`로 로그에 기록하고, welcome/후속답장은 `welcome-worker`가 담당한다.
  - Welcome 이미지(ADR-0030): welcome 템플릿의 `images`는 welcome-worker가 `/templates/assets/...`에서 다운로드→base64 변환 후 Realtime API `/send/iris/reply_media` 경유로 IRIS `/reply`에 전달해 발신한다(SAFE_MODE 최종 차단 유지).
  - Welcome 오픈프로필 닫기 안내/확인(ADR-0045):
    - IRIS `db2.open_chat_member.nickname`는 평문이 아니라 base64-like 토큰으로 저장되는 케이스가 있어, **기본닉/비기본닉 분기는 DB nickname을 신뢰하지 않는다.**
    - 분기 SSOT: `feedType=2`(프로필 변경) 이벤트의 `member.nickName`을 우선 반영해 확인 멘트를 선택한다.
    - 비기본닉 확인 멘트는 `welcome.followUp.replies[0]`를 재사용할 수 있는데, 템플릿에 `@{entrance}`가 없으면 앞에 `@{entrance} 님`을 자동으로 붙여 **멘션 누락을 방지**한다.
  - 기본값: `WELCOME_DISPATCHER=worker` (레거시 롤백: `WELCOME_DISPATCHER=bot`)
  - AI(ADR-0028): 코어(bot)는 메시지를 로그에 기록하고, `?디하클` 응답은 `ai-worker`가 `/logs/stream` 구독 후 KB 호출/발신을 담당한다.
  - 기본값: `AI_DISPATCHER=worker` (레거시 롤백: `AI_DISPATCHER=bot`)
  - 공지/브로드캐스트(ADR-0029): 공지 복제/브로드캐스트 큐 발신은 `broadcast-worker`가 담당한다.
  - 기본값: `ANNOUNCEMENT_DISPATCHER=worker`, `BROADCAST_DISPATCHER=worker` (레거시 롤백: 각각 `...=bot`)
  - **재기동 원칙(필독)**: *부분 재기동 우선*. “항상 start_all”은 모듈화(코어/워커 분리) 취지에 반한다.
    - `windows/start_all.cmd`는 **콜드 부팅/전체 복구**(PC 재부팅 직후, 포트/프로세스 꼬임, web 404/산출물 파손, env 드리프트 등) 때만 사용한다.
    - 평소 배포/수정은 **변경한 컴포넌트만** 재기동한다(코어는 유지).
    - watchdog(`windows/watchdog.ps1`)가 살아있으면 대부분 자동 복구되므로, 수동 개입은 “죽은 컴포넌트만” 대상으로 한다.
    - **watchdog 자동 기동(중요)**: watchdog가 꺼져 있으면 자동 복구는 절대 동작하지 않는다.
      - Task Scheduler 등록(권장): `windows/register_watchdog_task.ps1` (기본 **1분 주기 + 로그인(ONLOGON)**)
      - 스케줄러는 `windows/run_ensure_watchdog.vbs`(`wscript.exe`)로 실행해 PowerShell 창 플래시를 방지한다.

    | 상황 | 권장 명령 |
    |---|---|
    | Welcome/후속 Reply(welcome-worker)만 반영 | `windows/start_welcome_worker.ps1 -Restart` |
    | AI 응답(`?디하클`, ai-worker)만 반영 | `windows/start_ai_worker.ps1 -Restart` |
    | 공지/브로드캐스트(broadcast-worker)만 반영 | `windows/start_broadcast_worker.ps1 -Restart` |
    | 코어(bot: 수신/로그)만 반영 | `windows/start_bot.ps1 -Restart` |
    | Realtime API(server)만 반영 | `windows/start_api.ps1 -Port 8650` |
    | Web(UI)만 반영 | `windows/start_web.ps1 -Mode prod -Port 3100 -ForceKillPort` |
    | 전체 부팅/대규모 복구 | `windows/start_all.cmd` |

  - **UI(3100) 남색 배경만 뜨는 증상(중요)**:
    - 증상: `http://localhost:3100` 접속 시 **배경만 보이고 UI가 비어있음**
    - 근본 원인(대부분): Next.js 정적 자산(`/_next/static/*`)이 404로 깨진 상태
      - 흔한 트리거: **실행 중인 web에 대해 `next build`/산출물 삭제가 겹치거나**, dev/prod 산출물이 충돌해 `.next(.next-prod)`가 부분 손상
    - 1차 조치(권장): `windows/start_web.ps1 -Mode prod -Port 3100 -ForceKillPort -CleanBuild`
    - 예방:
      - 운영 중에는 `cd web && npm run build`를 **UI 실행과 동시에** 돌리지 않는다(필요 시 `start_web.ps1`로 “정지→빌드→기동” 절차로 수행)
      - `web`의 `npm run build`는 이제 **운영 UI(next start) 실행 중이면 사전 차단**된다(`web/scripts/prebuild_guard.ps1`). (정말 필요할 때만 `npm run build:unsafe`)
      - watchdog는 이제 `/api/ping`뿐 아니라 **`/` + `/_next/static`**까지 체크해 빈 화면 상태를 자동 감지/복구한다.
      - `start_web.ps1`도 READY 전에 **정적 자산 1개를 추가로 검증**해(실패 시 CleanBuild로 1회 자가복구) 빈 화면 재발을 줄인다.
      - BRIDGE/LOG 상태(상단 StatusBar) 기준: `docs/reference/bridge-status.md` (LOG LAG 포함)
- **Talk-API Reply(type=26) payload 타입 주의(중요)**:
  - 오픈채팅 “답장(Reply)”은 텍스트 `@`로 구현되지 않으며, `type=26` + `attachment.src_*` 메타로 구현된다(ADR-0026).
  - Node는 64-bit userId(2^53 초과)가 많아 `src_userId/src_linkId/src_type`를 문자열로 전달한다.
  - Realtime API(`server/app.py:/send/talkapi/*_raw`)에서 `type=26`일 때 숫자형 문자열을 int로 강제 변환(coerce) 후 Talk-API로 전달한다. (미변환 시 `INVALID_ARGUMENT(-203)` 가능)
- **테스트 커맨드 방 제한(중요)**:
  - `!welcome test/!welcome:test`, `!reply test/!reply:test`는 **테스트용 오픈채팅방(18462226881291012)에서만** 수행한다.
  - 다른 방에서 실행되면 스킵 + 로그 기록(`*_test_dry_run`, reason=`NOT_TEST_ROOM`)으로 끝낸다(운영 방 오발신 방지).
- **운영 로그/진단 메시지 라우팅(중요)**:
  - 운영방(실제 톡방)에는 “권한 확인 실패 원인”, “DB 미로딩”, “자동 복구 트리거” 같은 진단/운영 로그를 절대 발신하지 않는다.
  - 진단/운영 로그는 **테스트용 오픈채팅방(`18462226881291012`)으로만** 발신해 알림 역할로 남긴다.
- 환경 변수/토큰은 Git에 커밋 금지. `.env`는 `config/env.example`를 복제하여 세션 범위에서만 사용한다.
- Google Sheets 업서트용 서비스 계정/시트 타겟은 **로컬 `data/`에서만** 관리한다(커밋 금지).
  - 서비스 계정 키: `data/gcp_service_account.json`
  - 시트 타겟(1회 등록): `data/openchat_members_sheets.json` (`python scripts/sync_openchat_members_to_sheets.py --init-config --spreadsheet-id <SHEET_ID_OR_URL>`)
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
- `docs/adr/ADR-0027-core-logstore-and-feature-workers.md` – 코어(LogStore) 상시 가동 + 기능(Feature) 워커 분리(Welcome 1차) 결정(SSOT)
- `docs/ops/core-feature-split-plan.md` – 코어/기능 워커 분리 구현계획서(Welcome 1차)
- `docs/reference/kakao-mentions-and-reply.md` – 오픈채팅 “실제 멘션(@)” / “답장(Reply)” 구현 레퍼런스(새 세션 온보딩용)
- 필요 시 `docs/reference/verification-commands.md`에 새 명령을 추가하고, 위 섹션들과 동기화한다.

본 핸드북과 동일한 내용은 `claude.md`에도 유지하여 AI/자동화 에이전트가 같은 지침을 따르도록 한다.
