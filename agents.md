# 12.kakao Agents Handbook

**언어 정책**: 모든 커뮤니케이션과 로그는 한국어로 작성한다.  
**프로젝트 요약**: Redroid(Hyper‑V) + IRIS 기반 카카오톡 자동화(수신 전용 SAFE_MODE) 운영. Python 봇, TypeScript IRIS 어댑터, Next.js 대시보드(FastAPI+SSE), 운영 스크립트로 구성된다.  
**주요 스택**: Python 3.10+, Node.js (TypeScript, Vitest), FastAPI(+SSE), Next.js(React), Playwright, PowerShell.

---

## (중요) 발신 메시지 UX 가드레일(전 기능 공통)

- **userId(숫자) 노출 금지**: `296043063`, `32079002` 같은 숫자 식별자는 유저에게 절대 보여주지 않는다.
  - 출력에는 **닉네임(표시 이름)**만 사용한다.
  - 닉네임을 모르면 숫자를 그대로 쓰지 말고 **“어떤 분”** 같은 완곡한 표현으로 처리한다.
- **튜브렌즈 스타일(필수)**:
  - 첫 줄은 **두괄식 결론 + 공감**으로 시작한다(😊/😥).
    - “찾아봤어요!” 같은 **서두만 단독**으로 시작하는 건 금지(첫 줄에 결론이 있어야 함).
  - 본문은 **번호(1. 2. 3.)** 또는 **불릿(-)**로 구조화한다(줄글 금지).
  - 모바일 가독성을 위해 **한 문장/포인트마다 줄바꿈**을 넣는다.
  - 링크/공지/참고 자료는 본문에 섞지 않고 **푸터로 분리**한다(아래 구분선 규칙).
- **답변 포맷(가독성)**:
  - “~요약해 드릴게요” 문장 뒤에는 **빈 줄 1개**를 넣는다.
  - 섹션 헤더는 **콜론(`:`) 없이** 단독 라인으로 출력한다.
    - 예: `💡 요약 내용` (다음 줄부터 본문)
    - 예: `🔗 관련 링크` (다음 줄부터 URL만)
- **푸터(footer) 규칙**:
  - 링크가 있으면 본문과 분리해 **맨 아래**에 붙인다.
  - 푸터 시작은 반드시 구분선 `---` 한 줄을 출력한다.
  - 그 아래 `🔗 관련 링크`를 출력하고, 다음 줄부터 URL만 나열한다.
  - 링크가 없으면 **푸터 자체를 출력하지 않는다**(“없음/없어요” 플레이스홀더 금지).
- **금지**: `근거(Evidence)`, `다음 액션(Next Action)`, 타임스탬프/로그 원문 인용(예: `[2025-…]`)을 사용자에게 노출하지 않는다.
  - 관련 SSOT: `docs/reference/outbound-message-style.md`
  - 추가 금지: 캡처/첨부 메타 라인(예: `[2025-..png 352x476]`)
- **채팅 요약(chatSummary) 내용 규칙(중요)**:
  - 토픽 나열(“~에 대해 이야기했어요/조언이 오갔어요/논의했어요”) 금지
  - **문제/질문(Q) → 해결책/결론(A)** 형태로, 구체적인 방법/단축키/메뉴/기간을 우선 요약
  - 관련 문서: `docs/reference/chat-summary.md`, `docs/adr/ADR-0038-chat-summary-solution-first.md`
- **장애/오류 시(필수)**:
  - 기능이 안 되면 사용자에게는 아래 문구로만 답한다(원인/디버깅 금지):

    ```
    앗, 지금 기능이 잠깐 멈췄어요 😅
    관리자님께 바로 전달했으니 금방 복구될 거예요!
    조금만 기다려주세요 🙏
    ```

  - 동시에 **테스트용 오픈채팅방(18462226881291012)**에만 운영 알림을 보낸다.
    - 운영 알림에는 **roomId/userId 금지**(방 이름 + 기능 + 사유만)
    - “500/internal_error/req_id” 같은 **디버깅 용어 금지**

핵심 문서 링크
- `docs/ops/core-feature-split-plan.md` - 코어/기능 워커 분리 구현계획서(Welcome 1차)
- `docs/adr/ADR-0027-core-logstore-and-feature-workers.md` - 코어(LogStore) 상시 가동 + 기능(Feature) 워커 분리(Welcome 1차) 결정(SSOT)
- `docs/workflow/solo-dev-epic-pr.md` – 브랜치·PR 운영 표준 (Epic Draft PR 프로세스)
- `docs/ssot.md`, `docs/prd.md`, `docs/roadmap.md` – 제품/기술 결정의 단일 출처
- `docs/reference/project-structure.md` – 저장소 구조 및 책임 구분
- `docs/reference/verification-commands.md` – 테스트/스모크/운영 명령어 요약
- `docs/reference/kakao-mentions-and-reply.md` – 오픈채팅 “실제 멘션(@)” / “답장(Reply)” 구현 레퍼런스(새 세션 온보딩용)
- `docs/reference/kakao-room-command-triggers.md` – 방별 명령어(FAQ) `!등록/!삭제/!명령어/!키` 기능/권한/Reply payload 레퍼런스
- `docs/adr/ADR-0041-default-nickname-reminder-mentions.md` – 카카오 기본 닉네임 변경 요청(멘션) 워커(멤버 완전성 확인 후 발신)
- `docs/reference/auto-faq-worker.md` – 무명령어 자동 FAQ(질문 트리거) 설계/가드레일(후보 추출→승인→자동응답, 강의ID/글로벌 스코프, 링크/일정 “추측 금지”)
- `docs/reference/outbound-message-style.md` – 발신 메시지 템플릿 지침(튜브렌즈 스타일, userId 금지, 푸터 링크)
- `docs/adr/ADR-0037-auto-faq-worker.md` – 무명령어 자동 FAQ 워커(스코프/Reply/이미지/KB 최근글) 결정
- `docs/reference/openchat-members-google-sheets.md` – 오픈채팅 멤버(닉네임/userId) Google Sheets 업서트(서비스 계정 OAuth)
- `docs/reference/course-roster-worker.md` – 강의 운영: 오픈채팅 입장자 카페 가입/닉네임 검증 워커(15분/24시간 안내 + Sheets 업서트)
- `docs/adr/ADR-0039-course-roster-v2-membership-audit.md` – 강의 운영 v2(카페 자동 갱신 + 등급 기반 참여 점검 + 통합 시트) 결정
- `docs/reference/course-roster-v2-membership-audit.md` – 강의 운영 v2: 코스 단위 RAW→VIEW(AUDIT_VIEW) + 변경 이력(AUDIT_LOG), key 기반 upsert(no clear) + OVERVIEW/ACTIONS는 현업용 “결과/할 일”만(사용 방법 문장 금지)

---

## 0.1) (중요) 이 워킹트리에서는 `main`만 사용

현재 `C:\\dev\\12.kakao` 워킹트리를 **여러 세션/프로세스가 동시에 공유**하고 있다.

따라서 다음을 **절대 하지 않는다**:

- `git checkout <branch>` / `git switch <branch>` (워킹트리 흔들림 → 다른 세션 작업 파손)
- 새 브랜치 생성 후 체크아웃(동일 이유)
- `git switch -c ...` / `git checkout -b ...` 같은 **브랜치 생성 자체**
- detached HEAD(특정 커밋 체크아웃) 상태로 작업/커밋

이 워킹트리에서 허용되는 Git 작업은 아래뿐이다:

- `main`에서 변경 반영 → `git commit` (필요 시 여러 커밋)
- (외부에서) PR/Epic 워크플로가 필요하면 **별도 clone/worktree**에서 수행

### (중요) 이 워킹트리에서는 `git pull` 금지

이 PC는 “로컬에서 상시 운영되는 실행 환경”이며, `git pull`은 워킹트리를 바꿔 **운영 중인 상태를 흔들 수 있다.**

- **금지**: `git pull`, `git pull --rebase`, `git merge`, `git rebase`
- **허용(읽기/비교 목적)**: `git fetch` + `git log origin/main..main` 같은 비교만
- 원격 변경을 반영해야 하는 상황이면:
  - **반드시 별도 clone/worktree**에서 pull/merge/rebase를 수행하고,
  - 이 워킹트리에는 “검증된 변경”만 커밋/푸시로 옮긴다.

### (중요) 기술적 가드(실수 방지)

이 저장소는 main-only 운영을 강제하기 위해 Git 훅을 사용한다.

- 훅 위치: `.githooks/`
- 적용: `core.hooksPath=.githooks` (이 워킹트리 기준)
- 효과:
  - `main`이 아닌 브랜치에서는 **커밋/푸시가 차단**된다.
  - `git pull/merge/rebase`는 **차단**된다(운영 환경 보호).
  - 단, Git 특성상 “체크아웃/브랜치 생성” 자체를 100% 막지는 못하므로, 위의 **절대 금지 규칙을 사람이 지키는 것이 SSOT**다.

### 실수 복구(즉시)

브랜치가 `main`이 아니게 된 것을 발견하면, **파일을 건드리지 않고** 아래로 즉시 복구한다.

- 복구:
  - `git symbolic-ref HEAD refs/heads/main`
- 확인:
  - `git status -sb` 가 `## main`인지 확인
  - 필요 시: `powershell -NoProfile -ExecutionPolicy Bypass -File windows/enforce_main_only_git.ps1`

세션 로그는 기본적으로 `docs/sessions/main.md`에 누적 기록한다. (기존 브랜치별 세션 로그는 역사 기록으로 유지)

**운영 재기동 원칙(최우선)**: *부분 재기동 우선*. `windows/start_all.cmd`는 콜드 부팅/전체 복구 때만 사용한다. (상세: `docs/reference/verification-commands.md`)

- 부분 재기동(권장):
  - bot: `windows/start_bot.ps1 -Restart`
  - welcome-worker: `windows/start_welcome_worker.ps1 -Restart`
  - ai-worker: `windows/start_ai_worker.ps1 -Restart`
  - broadcast-worker: `windows/start_broadcast_worker.ps1 -Restart`
  - command-worker: `windows/start_command_worker.ps1 -Restart`
  - roster-worker(선택 기능): `windows/start_roster_worker.ps1 -Restart`
  - openchat-members-sheets-worker(선택 기능): `windows/start_openchat_members_sheets_worker.ps1 -Restart`
  - course-membership-audit-worker(선택 기능): `windows/start_course_membership_audit_worker.ps1 -Restart`
    - **중복 실행 금지**: 네이버 카페 창이 여러 개 뜨거나(크롤링 2~3회 반복) 업서트가 과도하게 자주 돌면 워커가 중복 실행 중일 수 있다.  
      반드시 위 재기동 스크립트로만 관리하고, `python scripts/course_membership_audit_worker.py` 직접 실행은 피한다.
    - **결제 SSOT 권한(중요)**: 결제 SSOT 시트는 Viewer 공유로 “읽기”만 하면 되고, 업서트 대상(코스) 시트는 Editor 공유가 필요하다. (상세: `docs/reference/payment-ssot-google-sheets.md`)
    - **ACTIONS 탭(운영)**: 코스 스프레드시트 `ACTIONS`는 `지금/오늘/확인/정리` 섹션형 “할 일 큐”다.  
      `요청 닉네임`이 `<이름마스킹>(카페닉)`이면, 이름 마스킹 규칙(첫 글자 + @ 반복 + 마지막 글자)을 적용해 완성하면 된다.
    - **운영 원칙(중요)**: 재발 시 운영자가 수동으로 “정리/재기동”을 하지 않아도 되게 만든다.
      - watchdog가 **중복 실행(프로세스 2개 이상)** 을 감지하면 자동으로 재기동해 1개만 남긴다.
      - 즉, 카페 창이 여러 개 뜨는 문제가 보이면 **잠시 기다리면 자동 복구**되는 것이 정상이다.
      - 예외: watchdog가 꺼져 있으면 자동 복구가 동작하지 않는다. 이때만 `windows/ensure_watchdog.ps1 -Restart`로 watchdog를 먼저 살린다.
  - web(UI): `windows/start_web.ps1 -Mode prod -Port 3100 -ForceKillPort`

- **UI(3100) 남색 배경만 뜨는 증상(중요)**:
  - 증상: `http://localhost:3100` 접속 시 **배경만 보이고 UI가 비어있음**
  - 근본 원인(대부분): Next.js 정적 자산(`/_next/static/*`)이 404로 깨진 상태
    - 흔한 트리거: **실행 중인 web에 대해 `next build`/산출물 삭제가 겹치거나**, dev/prod 산출물이 충돌해 `.next(.next-prod)`가 부분 손상
  - 1차 조치(권장): `windows/start_web.ps1 -Mode prod -Port 3100 -ForceKillPort -CleanBuild`
    - `-CleanBuild`는 `.next-prod`를 지우고 재빌드 후 기동한다(산출물 파손 복구)
  - 예방:
    - 운영 중에는 `cd web && npm run build`를 **UI 실행과 동시에** 돌리지 않는다(필요 시 `start_web.ps1`로 “정지→빌드→기동” 절차로 수행)
    - `web`의 `npm run build`는 이제 **운영 UI(next start) 실행 중이면 사전 차단**된다(`web/scripts/prebuild_guard.ps1`). (정말 필요할 때만 `npm run build:unsafe`)
    - BRIDGE/LOG 상태(상단 StatusBar) 기준: `docs/reference/bridge-status.md` (LOG LAG 포함)
    - watchdog는 이제 `/api/ping`뿐 아니라 **`/` + `/_next/static`**까지 체크해 빈 화면 상태를 자동 감지/복구한다.
    - `start_web.ps1`도 READY 전에 **정적 자산 1개를 추가로 검증**해(실패 시 CleanBuild로 1회 자가복구) 빈 화면 재발을 줄인다.

- **오픈채팅 멤버 Sheets 자동 동기화(선택 기능, UI 숨김)**:
  - 강의 운영 UI 단순화를 위해 현재 대시보드 UI에서는 노출하지 않는다(혼선 방지).
  - 설정/운영은 파일 기반으로 수행한다:
    - 설정(SSOT): `data/openchat_members_sheets.json`
    - 워커 재기동: `windows/start_openchat_members_sheets_worker.ps1 -Restart`
    - 상세: `docs/reference/openchat-members-google-sheets.md`
  - 스케줄:
    - **ON이면 10분마다 업서트(고정)** (`intervalSec` 설정으로 변경 불가)
    - 방/워커를 켜도 **즉시 실행하지 않고 다음 주기(10분 후)** 부터 실행
    - 즉시 1회 실행은 **`지금 업서트`(수동)** 버튼으로만 수행
    - **재시도 없음**: 실패해도 즉시 재시도하지 않고 다음 주기로 넘어감
    - 실패/스킵 발생 시 테스트용 오픈채팅방(`18462226881291012`)으로 1회 알림 발신(전제: `safeMode=false`, `talkApi.enabled=true`)
  - 상태 파일: `node-iris-app/data/openchat_members_sheets_worker_status.json`, `node-iris-app/data/openchat_members_sheets_worker_state.json`

- **절대 금지(중요)**: `taskkill /im node.exe`, `Stop-Process -Name node` 같이 **node 전체를 종료**하는 조치는 금지한다.  
  - 또한 `dist\\index.js` 같은 **범용 패턴 매칭으로 node를 정리하는 방식은 다른 프로젝트까지 종료**할 수 있어 금지한다.  
  - 재기동/중복 정리는 **status.json PID 기반**으로만 수행한다(예: `windows/start_bot.ps1 -Restart`, `windows/smart_restart_bot.ps1`).

- **Welcome 미발송 디버깅(자주 발생)**:
  - **중복 welcome-worker 금지**: `welcome-worker`는 1개만 떠 있어야 한다. (락 파일: `node-iris-app/data/locks/welcome_worker.lock`)
  - **중복 ai-worker 금지**: `ai-worker`는 1개만 떠 있어야 한다. (락 파일: `node-iris-app/data/locks/ai_worker.lock`)
  - **중복 broadcast-worker 금지**: `broadcast-worker`는 1개만 떠 있어야 한다. (락 파일: `node-iris-app/data/locks/broadcast_worker.lock`)
  - `/status`에서 `bot.ok/logStore.ok`가 `false`이면 welcome-worker가 `/logs/stream` 트리거를 못 받아 “토글 ON인데 미발송”처럼 보일 수 있다.
    - 특히 `extra.emfile=true` 또는 `node-iris-app/data/bot_health.json`이 있으면 EMFILE로 파일 로그 기록이 중단된 상태일 수 있으니 우선 `windows/start_bot.ps1 -Restart`(또는 `windows/start_all.cmd`)로 복구한다. (watchdog가 살아있으면 대개 자동 복구)
    - 재기동 후에도 EMFILE가 빠르게 재발하거나 `Get-Process -Id <PID> | Select HandleCount`가 수천 단위로 치솟으면 **node-iris Logger 파일 핸들 누수**(ADR-0042)를 의심한다.
      - 조치: `windows/start_bot.ps1 -Restart`로 즉시 복구 후,
        - `node-iris-app/package.json`에서 `@tsuki-chat/node-iris=1.6.41` 고정 여부 확인
        - `cd node-iris-app && npx patch-package --error-on-fail`로 패치 강제 재적용
        - SSOT: `docs/adr/ADR-0042-node-iris-logger-handle-leak-emfile-hotfix.md`
  - `runtime.json.features[roomId].welcome === true`가 아니면 welcome은 발신되지 않는다(로그에 `reason=WELCOME_DISABLED`로 표시).
  - `windows/logs/welcome_worker.out.log`에서 `[welcome] 스킵` 사유(`ROOM_NOT_ALLOWED|WELCOME_DISABLED`)를 먼저 확인한다.
- `allowedRoomIds`/토글 변경은 welcome-worker가 **최대 60초 내 재연결로 자동 반영**된다(환경변수 `WELCOME_WORKER_STREAM_TTL_MS`). 즉시 반영이 필요하면 `windows/start_welcome_worker.ps1 -Restart`.

---

## 0.2) (필수) 공유 워킹트리 멀티세션 규칙(4.pint 준용)

> 이 워킹트리는 **동일한 작업 디렉터리에서 여러 세션/프로세스가 동시에 작업**할 수 있다.  
> 따라서 “내 작업 범위 밖 파일”은 **절대 건드리지 않는다.**

- 다른 세션 작업물이 보이더라도:
  - “정리/원복/포맷/리네임/삭제” 같은 행동을 하지 말고 **그냥 냅둔다**.
  - 필요하면 담당자에게 알리고, 나는 **내 범위만** 진행한다.
- 공유 워킹트리에서 금지(치명적):
  - `git restore .`, `git reset --hard`, `git clean -fd` 같은 **전체 원복/삭제**
  - repo 전체 포맷/린트(예: `npx biome check --write src/`, `prettier --write .` 등)
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
- **Node IRIS 어댑터**: `node-iris-app/` – TypeScript로 작성된 IRIS 연동 계층, `npm test`/`npm run build` 필수.  
- **대시보드(신규, 기본)**: `web/` – Next.js/React UI, FastAPI SSE 구독. (Room ID/userId 클릭 시 클립보드 복사, **강의 운영(카페/등급/Sheets)**은 `/course`에서 코스 단위로 관리하며, RoomCard에서는 링크/배지만 노출)  
- **기본닉 멘션(ADR-0041)**: 방 카드의 `기본닉 멘션` 토글이 방별 스위치이며, 2차/3차 안내 간격(24h/48h 등)은 **3100 홈 상단 카드**에서 변경해 `runtime.nicknameReminder.warningSchedule`에 저장한다.
- **실시간 서버**: `server/` – FastAPI + SSE(`/logs/stream`), 스냅샷(`/logs`), 상태(`/health`, `/rooms`, `/runtime`, `/templates`).  
- **구(스트림릿) 대시보드**: `dashboard/` – 임시/레거시로 보관(운영 기본에서 제외).  
- **IRIS 지원 리소스**: `iris_server/`, `infra/iris/`, `windows/` – IRIS DB, PowerShell 포트프록시, 운영 도구.  
- **문서 체계**: `docs/` – SSOT/PRD/로드맵, 세션 로그, 설정 가이드, 레퍼런스(본 핸드북 포함).  
구조 변경 시 `docs/reference/project-structure.md`를 우선 업데이트한 뒤, 본 문서와 관련 워크플로 문서의 링크를 동기화한다.

---

## 3. 브랜치 & PR 운영 원칙
- (원칙) `main`은 직접 푸시 금지. 모든 작업은 `feat/*`, `fix/*`, `chore/*` 브랜치에서 시작한다.
- (현재 워킹트리 예외 - 중요) 하지만 **이 워킹트리(`C:\dev\12.kakao`)는 여러 세션이 동시에 공유**하므로,
  브랜치 체크아웃/생성으로 워킹트리를 흔들면 안 된다. 이 워킹트리에서는 **`main`만 사용**한다.
  - PR/Epic Draft PR이 필요하면 **별도 clone/worktree**에서 브랜치 워크플로를 수행한다.
- 브랜치를 생성한 즉시 Draft PR을 열어 **Goal / Scope / Invariants / Acceptance Criteria / Docs / Tasks / Decision Log** 섹션을 채운다. (별도 clone/worktree에서 적용)
- 세션 동안 내린 결정은 PR 코멘트 + `docs/sessions/<branch>.md` + `docs/ssot.md`에 모두 반영한다.
- 테스트/스크린샷/로그가 있는 경우 PR 코멘트나 첨부 링크로 남긴다.
- Merge 전략은 기본적으로 Merge commit. 필요 시 Rebase/Squash는 PR 성격에 맞게 선택한다.

---

## 4. 테스트 & 품질 게이트
- **Python 변경**: 최소 `pytest`; 구조 변경 시 `python -m compileall src`로 빠른 문법 체크.  
- **Node/TypeScript 변경**: `cd node-iris-app && npm install && npm test && npm run build`.  
- **Playwright 스크립트/JS 자동화 수정**: 루트에서 `npx playwright test`.  
- **대시보드/로그 API**: `scripts/serve_ui.sh` 혹은 `streamlit run dashboard/ui_node_iris.py` + `python scripts/log_api.py`로 스모크.
- **KB/RAG**:
  - 서비스 기동 후 `python scripts/kb_status.py`로 **수집 최신일/임베딩 개수/스케줄 상태**를 점검한다. 무료 특강(23), 정규 강의(42) 등 핵심 메뉴의 최근 수집이 2일 이상 비어 있으면 collect/embed 스케줄을 반드시 확인한다.
  - 중요 변경 시 `python scripts/verify_rag.py --base-url http://127.0.0.1:8610`와 RAG 관련 pytest 스위트(`tests/test_rag_*.py`)를 함께 실행한다.
- 문서 전용 변경(`docs/**`, `README*.md`, `**/*.md`)만 포함된 경우 테스트 생략 가능. 그 외에는 `docs/reference/verification-commands.md` 기준으로 관련 영역 검증을 완료해야 한다.
- 실패한 테스트를 무시하거나 임시로 주석 처리하지 않는다. 원인을 해결하고 재실행한다.

---

## 5. 문서 & 기록 관리
- **SSOT(`docs/ssot.md`)**: 새로운 결정, 배포 결과, 미해결 항목을 즉시 기록.  
- **제품 문서**: 범위/요구 변경 시 `docs/prd.md`, `docs/roadmap.md`, 필요 시 `docs/todo.md`를 함께 수정.  
- **ADR**: 아키텍처/기술 결정에 변화가 생기면 `docs/adr/<id>-<slug>.md` 작성 또는 갱신.  
- **세션 로그**:
  - 공유 워킹트리: `docs/sessions/main.md`에 누적 기록
  - PR/브랜치 워크플로(별도 clone/worktree): `docs/sessions/<branch>.md` 유지
- 문서 구조가 확장될 경우 `docs/reference/README.md`에 신규 레퍼런스를 추가하고, 관련 링크를 본 문서에 반영한다.

---

## 6. 운영 가드레일
- 기능 워커 분리(ADR-0027/0028/0029):
  - Welcome(ADR-0027): 코어(bot)는 신규 입장 이벤트를 `member_joined`로 로그에 기록하고, welcome/후속답장은 `welcome-worker`가 담당한다.
  - Welcome 이미지(ADR-0030): welcome 템플릿의 `images`는 welcome-worker가 `/templates/assets/...`에서 다운로드→base64 변환 후 Realtime API `/send/iris/reply_media` 경유로 IRIS `/reply`에 전달해 발신한다(SAFE_MODE 최종 차단 유지).
  - Talk-API 장애 폴백(ADR-0034): Talk-API 발신이 502로 실패할 때(`talkStatus != 0`) welcome-worker는 텍스트를 Realtime API `/send/iris/reply_text`로 **대체 발신**한다(멘션/Reply는 불가, 일반 텍스트만).
    - 혼란 방지를 위해 폴백 텍스트에서는 `@닉네임`을 `닉네임`으로 치환한다(가짜 멘션 금지).
    - 최근 실패/성공 상태: `node-iris-app/data/talkapi_status.json` (UI: 3100 `봇/워커 프로세스` 카드의 Talk-API 태그)
    - authHeader 운영(캡처는 수동, 반영은 자동):
      - 스냅샷: `scripts/snapshot_talkapi_auth.ps1` → `data/talkapi_auth_snapshots/`
      - 런타임 반영: `scripts/ensure_talkapi_auth_applied.ps1` (상태 파일: `node-iris-app/data/talkapi_auth_apply_status.json`)
      - 자동 실행: `windows/start_all.ps1`(부팅 시 1회) + `windows/watchdog.ps1`(기본 30분 주기)
    - UI(3100)에는 `auth: 적용됨/실패` 태그도 함께 노출된다(`node-iris-app/data/talkapi_auth_apply_status.json`).
      - `Talk-API: 실패`가 보여도 `auth: 적용됨`이 더 최신이면, “실패로 확정”이 아니라 **테스트 방에서 1회 재검증**이 필요한 상태일 수 있다. (런북: `docs/reference/kakao-mentions-and-reply.md`의 “빠른 복구 절차”)
  - Welcome 오픈프로필 닫기 안내/확인(ADR-0045):
    - IRIS `db2.open_chat_member.nickname`는 평문이 아니라 base64-like 토큰으로 저장되는 케이스가 있어, **기본닉/비기본닉 분기는 DB nickname을 신뢰하지 않는다.**
    - 분기 SSOT: `feedType=2`(프로필 변경) 이벤트의 `member.nickName`을 우선 반영해 확인 멘트를 선택한다(레이스 대비: 최근 닉네임 캐시 + pending 즉시 갱신).
    - 오픈프로필 안내 dedup 키: `roomId:userId` → `roomId:userId:joinedAt` (동일 유저 재입장 시 안내 스킵 방지).
    - 안내/확인 템플릿에 멘션 placeholder가 없으면 `@{entrance} 님`을 자동 prefix해 **멘션 누락을 방지**한다.
  - 기본값: `WELCOME_DISPATCHER=worker` (레거시 롤백: `WELCOME_DISPATCHER=bot`)
  - AI(ADR-0028): 코어(bot)는 메시지를 로그에 기록하고, `?디하클` 응답은 `ai-worker`가 `/logs/stream` 구독 후 KB 호출/발신을 담당한다.
    - `ai-worker`는 `runtime.json.features[roomId].ai=true`인 방만 `/logs/stream?rooms=...`로 구독한다.
      방에서 AI를 새로 켜거나/끄면 `AI_ROOMS_REFRESH_SEC`(기본 1초, 최소 250ms) 폴링으로 `runtime.json` 변경을 감지해 **즉시 재연결**하여 목록을 갱신한다(재시작 불필요).
    - Talk-API 장애 폴백(ADR-0034): Talk-API 502 시 AI 응답 텍스트는 `/send/iris/reply_text`로 대체 발신한다.
  - 기본값: `AI_DISPATCHER=worker` (레거시 롤백: `AI_DISPATCHER=bot`)
  - 채팅요약(chatSummary): 코어(bot)가 방 로그를 MessageStore(`data/logs/<roomId>/<YYYY-MM-DD>.log`)로 기록해두고,
    `!채팅요약`/`!요약`이 오면 KB(`/chat/summary`)로 최근 메시지를 보내 요약 결과를 답장한다.
    - 기본 범위: **오늘(자정~현재)** + 최근 300개
    - 롤링 범위: `!요약 24시간`, `!채팅요약 6시간`, `!채팅요약 2일` (최대 7일, 최근 300개)
  - 공지/브로드캐스트(ADR-0029): 공지 복제/브로드캐스트 큐 발신은 `broadcast-worker`가 담당한다.
    - 공지(미러링)는 `runtime.json.announcement.routes`로 source/targets를 관리하며, UI는 `http://127.0.0.1:3100/announcement`를 사용한다.
    - 공지 전파가 끝나면 소스 방에 **1회** `[공지 전파 결과]` 요약 메시지를 남긴다(이 결과 메시지는 타겟으로 재전파되지 않도록 prefix 기반으로 스킵).
    - 동일 공지를 여러 방에 한 번에 뿌릴 때는 route 옵션 `appendTargetIndex=true`(+ `targetIndexStart`)로 끝 번호를 붙여 중복/스팸 판정 리스크를 낮춘다.
    - 공지가 안 나가면 `windows/logs/broadcast_worker.out.log`에서 `[announce] completed`/`[talkapi] dispatch*`를 확인하고, 실패한 `roomId`/`talkStatus`를 근거로 타겟/allowlist 설정을 점검한다.
    - Talk-API 장애 폴백(ADR-0034): Talk-API 502 시 공지/브로드캐스트 텍스트는 `/send/iris/reply_text`, 이미지 발신은(가능하면) URL→base64 후 `/send/iris/reply_media`로 대체 발신한다.
    - (2025-12-20) 공지 이미지 전파(IRIS `/reply_media`)는 HTTP 200이어도 실제 UI 발신이 지연/누락될 수 있어,
      Realtime API `/send/iris/reply_media`에서 **MessageStore 이미지 echo 확인**까지 완료되어야만 `ok=true`를 반환하도록 보강했다. (결과 프리픽스: `📣 공지 전송 결과`)
      - IRIS UI automation 경합 방지를 위해 server에서 `_IRIS_REPLY_LOCK`으로 호출을 직렬화한다.
      - broadcast-worker는 “이미지 base64 1회 캐시 + 방별 전송”만 수행하고, 성공 판정은 `/send/iris/reply_media` 응답 `ok`를 SSOT로 사용한다.
      - 전송 순서는 `node-iris-app/data/iris_media_health.json` 이력(최근 실패는 뒤로)을 참고해 정렬한다.
    - **중복 실행 방지(중요)**: `broadcast-worker`는 `node-iris-app/data/locks/broadcast_worker.lock` 싱글톤 락으로 1개만 동작한다. watchdog도 중복 실행 감지 시 자동 재기동으로 정리한다.
  - 기본값: `ANNOUNCEMENT_DISPATCHER=worker`, `BROADCAST_DISPATCHER=worker` (레거시 롤백: 각각 `...=bot`)
  - **중복 실행 방지(코어/bot)**: bot은 `node-iris-app/data/bot.lock` 싱글톤 락으로 1개만 동작한다(잘못된 cwd로 `node dist/index.js`를 실행해도 즉시 종료).
  - **/logs/stream 스냅샷 주의(중요)**:
    - Realtime API `GET /logs/stream`은 연결 직후 `type=snapshot`을 1회 보낸다(대시보드 UI용).
    - feature workers(welcome/ai/broadcast/command)는 **`type=append`(증분)만 처리**해야 하며, snapshot을 처리하면 TTL reconnect/재기동 시 과거 이벤트를 다시 실행해 “테스트방에 이전 메시지가 주기적으로 반복 발송”되는 문제가 생긴다.
  - **재기동 원칙(필독)**: *부분 재기동 우선*. “항상 start_all”은 모듈화(코어/워커 분리) 취지에 반한다.
    - `windows/start_all.cmd`는 **콜드 부팅/전체 복구**(PC 재부팅 직후, 포트/프로세스 꼬임, web 404/산출물 파손, env 드리프트 등) 때만 사용한다.
    - 평소 배포/수정은 **변경한 컴포넌트만** 재기동한다(코어는 유지).
    - watchdog(`windows/watchdog.ps1`)가 살아있으면 대부분 자동 복구되므로, 수동 개입은 “죽은 컴포넌트만” 대상으로 한다.
      - 재발 방지: watchdog가 파이프라인 복구를 위해 `start_all.ps1`를 호출할 때,
        `start_all.ps1`의 pre-clean이 watchdog를 죽여 “자가복구 루프가 중단”되는 문제가 있었다.
        현재는 `watchdog.ps1` → `start_all.ps1 -NoWatchdog -PreserveWatchdog`로 호출해
        watchdog 자기 자신을 종료시키지 않도록 고정했다.
      - (2025-12-19) watchdog는 `start_all.ps1`을 **동기 호출하지 않고** 별도 PowerShell 프로세스로 spawn해(로그: `windows/logs/start_all.from_watchdog.*`) watchdog 루프 블록을 방지한다.
      - (2025-12-19) `windows/ensure_watchdog.ps1`는 watchdog 프로세스가 살아있어도 `windows/watchdog.log` 갱신이 오래 멈추면(hung) 자동 재기동한다(`-MaxLogAgeSec`, 기본 900s). UI(3100) 홈 `Watchdog` 카드의 **Watchdog 재시작** 버튼으로도 동일 동작 수행 가능.
      - **watchdog 자동 기동(중요)**: watchdog가 꺼져 있으면 자동 복구는 절대 동작하지 않는다.
        - **운영 원칙(중요)**: 운영 중 장애 감지/복구는 watchdog(+ Task Scheduler ensure)가 자동으로 수행한다. 운영자가 매번 수동 명령을 치는 운영은 금지한다(예외: 초기 설치/개발 디버깅).
        - Task Scheduler 등록(권장): `windows/register_watchdog_task.ps1` (기본 **1분 주기 + 로그인(ONLOGON)**, watchdog 미실행 시 자동 기동)
          - 주기적으로 파란 PowerShell 창이 뜨면 스케줄러 작업이 콘솔로 실행 중인 것이므로,
            `windows/register_watchdog_task.ps1`로 다시 등록해 `wscript.exe` 래퍼(`windows/run_ensure_watchdog.vbs`)를 사용한다(창 플래시 방지).
        - 부팅/로그온 자동 기동(선택): `windows/register_start_all_task.ps1` (콜드 부팅 시 파이프라인 전체 기동)
      - **KB Postgres(pgvector) 자동 복구(중요)**:
        - KB DB는 Docker Compose(`docker-compose.yml`, 컨테이너 `iris_pg`, 포트 `5433`)로 운영한다.
        - `windows/start_all.ps1`는 KB 서비스 기동 전에 `windows/ensure_postgres.ps1`로 Docker Desktop/컨테이너를 **선행 보장**한다.
        - `windows/watchdog.ps1`는 Realtime API `/status`의 `kbPostgres` stage(TCP 5433)를 감지해,
          Postgres를 자동 복구(`ensure_postgres.ps1`)한 뒤 KB를 재시작해 연결을 정상화한다.
        - 임시 비활성화(권장 X): `setx KB_POSTGRES_ENSURE_DISABLE 1`
      - **IRIS(:5050) 복구가 안 될 때(중요)**: PortProxy가 `0.0.0.0:5050 -> 127.0.0.1:5050` 루프백으로 잡혀 있으면(iphlpsvc가 포트 점유)
        ADB forward가 `access denied(10013)`로 실패하며 IRIS가 장시간 다운될 수 있다.
        - `windows/repair_redroid_iris.ps1 -Fix`는 이제 이 루프백 PortProxy를 자동 정리하고 재시도한다.
      - **Hyper-V IP 변경(중요)**: Redroid VM의 IP가 바뀌면 ADB 대상(`<ip>:5555`)도 바뀐다.
        - 복구 스크립트는 마지막 성공 값을 `data/redroid_device.json`에 캐시한다.
        - 대시보드(`http://localhost:3100`)의 **IRIS 연결 (Hyper-V IP/ADB)** 섹션에서
          현재 캐시 값(앱이 찾는 IP) 확인 + 새 IP 저장 + IRIS 복구 실행이 가능하다.
        - VM 내부에서 `hostname -I`로 IP를 확인했다면, 보통 첫 번째 `172.*` IP를 사용한다(예: `172.192.204.123:5555`).
        - `windows/setup_iris_port.ps1`는 기본적으로 PortProxy를 $LocalPort에 직접 걸지 않으며, 필요 시 `-ExposePort <포트>`로만 노출한다(충돌 방지).

    | 상황 | 권장 명령 |
    |---|---|
    | Welcome/후속 Reply(welcome-worker)만 반영 | `windows/start_welcome_worker.ps1 -Restart` |
    | AI 응답(`?디하클`, ai-worker)만 반영 | `windows/start_ai_worker.ps1 -Restart` |
    | 공지/브로드캐스트(broadcast-worker)만 반영 | `windows/start_broadcast_worker.ps1 -Restart` |
    | 방별 명령어(FAQ, command-worker)만 반영 | `windows/start_command_worker.ps1 -Restart` |
    | 코어(bot: 수신/로그)만 반영 | `windows/start_bot.ps1 -Restart` |
    | Realtime API(server)만 반영 | `windows/start_api.ps1 -Port 8650` |
    | Web(UI)만 반영 | `windows/start_web.ps1 -Mode prod -Port 3100 -ForceKillPort` |
    | 전체 부팅/대규모 복구 | `windows/start_all.cmd` |
  - **절대 금지**: `taskkill /im node.exe /f`, “작업관리자에서 node 전부 종료” 같은 전역 종료는 다른 서비스까지 같이 죽여 장애를 키운다. 필요한 컴포넌트만 위 표대로 재기동한다.
- 기본 모드는 `SAFE_MODE=true` (발신 차단).  
  - 단일 소스: `node-iris-app/config/runtime.json.safeMode`  
  - 웹 UI(`/settings`)에서 safeMode를 토글하면 즉시 runtime.json에 반영된다.  
  - Node 봇은 컨트롤러 내부의 `isSafeMode()`를 통해 **모든 발신을 차단**한다(허용 방이어도 예외 없음).  
  - `windows/start_bot.ps1`는 더 이상 `SAFE_MODE=false`를 강제로 설정하지 않는다.  
- **Talk-API Reply(type=26) payload 타입 주의(중요)**:
  - 오픈채팅 “답장(Reply)”은 텍스트 `@`로 구현되지 않으며, `type=26` + `attachment.src_*` 메타로 구현된다(ADR-0026).
  - Node는 64-bit userId(2^53 초과)가 많아 `src_userId/src_linkId/src_type`를 문자열로 전달한다.
  - Realtime API(`server/app.py:/send/talkapi/*_raw`)에서 `type=26`일 때 숫자형 문자열을 int로 강제 변환(coerce) 후 Talk-API로 전달한다. (미변환 시 `INVALID_ARGUMENT(-203)` 가능)
- **테스트 커맨드 방 제한(중요)**:
  - `!welcome test/!welcome:test`, `!reply test/!reply:test`는 **테스트용 오픈채팅방(18462226881291012)에서만** 수행한다.
  - 다른 방에서 실행되면 “조용히 발신”하지 않고 **스킵 + 로그 기록(`*_test_dry_run`, reason=`NOT_TEST_ROOM`)**으로 끝낸다(운영 방 오발신 방지).
- **폴백(Fallback) 절대 금지(중요)**:
  - “대충 기본값으로 진행”, “에러 무시하고 계속”, “임의의 템플릿/문구로 대체” 같은 어줍잖은 폴백은 금지한다.
  - 설정/파일/데이터가 불완전하면 **조용히 넘어가지 말고** 원인을 로그/문서(SSOT/세션 로그/ADR)로 남긴 뒤, 명시적으로 스킵/에러 처리한다.
  - 상세 원칙은 `docs/agents.md`의 “🚨 제1원칙: FALLBACK 절대 금지”를 따른다.
- 환경 변수/토큰은 Git에 커밋 금지. `.env`는 `config/env.example`를 복제하여 세션 범위에서만 사용한다.  
- Google Sheets 업서트용 서비스 계정/시트 타겟은 **로컬 `data/`에서만** 관리한다(커밋 금지).
  - 서비스 계정 키: `data/gcp_service_account.json`
  - 시트 타겟(1회 등록): `data/openchat_members_sheets.json` (`python scripts/sync_openchat_members_to_sheets.py --init-config --spreadsheet-id <SHEET_ID_OR_URL>`)
- IRIS(ADB forward + 로컬 포트) 점검/복구:
  - 포트/ADB forward 설정: `windows/setup_iris_port.ps1 -LocalPort 5050 -Device '<REDROID_IP>:5555'`
  - 상태 점검: `windows/probe_iris.ps1 -Port 5050`
  - IRIS 프로세스가 죽었으면(HTTP 0/Empty reply 등): `windows/repair_redroid_iris.ps1 -Fix` (ADB로 Iris.apk `app_process` 재기동)
- 데이터/로그 파일은 보관 목적일 경우 `data/`, `logs/` 하위에만 저장한다. 외부 경로에는 쓰지 않는다.
- 경로 추측 금지: 변경 전 `ls`, `cat`으로 파일 존재를 직접 확인한다.

### 6.1) (중요) 운영 로그/진단 메시지 라우팅
- **운영방(실제 톡방)에는 진단/운영 로그를 절대 발신하지 않는다.**
  - 예: “권한 확인 실패 원인”, “멤버 DB 미로딩”, “IRIS /query 타임아웃”, “자동 복구 트리거” 같은 디버그/상태 정보
- 진단/운영 로그는 **항상 테스트용 오픈채팅방**(`18462226881291012`)으로만 발신한다(고정).
  - 공지 미러링(broadcast-worker)은 IRIS 계정(senderId=434886784)을 무시하므로, 테스트방에 남긴 ops 로그가 타겟 방으로 전파되지 않도록 유지한다.
- 예외(정상 동작):
  - 비권한자가 `!등록/!삭제` 등 관리 명령을 시도했을 때의 “권한 없음” 안내는 해당 방에 발신한다(사용자 피드백).

### 6.2) command-worker 권한 판별/멤버 DB 자동 갱신
- `command-worker`는 `open_chat_member.link_member_type`로 방장/관리자 여부를 판별한다.
- 관측된 역할 값(보수적):
  - `8` → 방장(호스트)
  - `4` → 부방장/운영진
  - `1` → 일부 방에서 운영진/특수 role로 관측(보수적으로 admin 취급)
- 멤버 DB가 비어 권한 판별이 불가능한 경우:
  - 대상: `!등록/!수정/!삭제` 같은 **관리 명령에서 권한 판별이 필요한 시점**
  - `scripts/openchat_load_members.ps1`를 **자동 트리거**해(송신 없이) 단말에서 멤버 목록을 스크롤 로딩하여 DB를 채운다.
  - 레이트리밋:
    - roomId 기준 15분 쿨다운
    - 전역 2분 쿨다운(동시 실행/ADB 충돌 방지)
  - 운영 알림:
    - 상세 로그는 테스트용 오픈채팅방으로만 발신한다(운영방 오염 금지).
    - 알림이 연속으로 발생하면 **여러 건을 1채팅으로 묶어서** 보낸다(스팸 방지).
- 방장(Host)은 멤버 DB가 비어 있어도 `chat_rooms ↔ db2.open_link` 조인으로 owner user_id를 판별해 **즉시 권한을 허용**한다(멤버 로딩 실패/드리프트 대비).
- 방장/부방장 스냅샷은 `node-iris-app/data/room_admins.json`에 저장된다.
  - 신규 방은 Realtime `/rooms` 기반으로 자동 발견되며, `command-worker`가 `/runtime`의 `allowedRoomIds`에 자동 병합한다(수동 편집 불필요).
  - 제외가 필요하면 `excludedRoomIds`를 사용한다(자동 병합에서도 제외됨).
  - 최근 활동 방은 `commands=true`를 기본으로 자동 부여한다(운영자가 명시적으로 off한 방은 존중).
  - 스냅샷 갱신은 `command-worker`가 주기적으로 시도하되, **성공 알림은 발신하지 않는다**(스팸 방지).
  - 멤버 로딩(ADB 스크롤)은 주기 갱신에서 연쇄 실행하지 않는다(ADB 충돌/운영 알림 폭주 방지).
- UI(3100) 방 카드에는 **운영진(방장/부방장)** 이 표시된다.
  - “미확인”으로 나오면 `open_chat_member`가 비어있을 가능성이 높다.
  - 방 카드의 `갱신` 버튼은 **Redroid(단말)** 에서 해당 방 진입/멤버 목록 스크롤을 수행해 `open_chat_member` 로딩을 시도한다(발신 없음, 레이트리밋 적용).
- **Windows 기동 엔트리포인트(중요)**:
  - **사용자 실행 권장**: `windows/start_all.cmd` (더블클릭/`cmd.exe` 편의용).
  - **로직 SSOT(수정 기준)**: `windows/start_all.ps1` (실제 기동 로직은 여기만 유지).
  - `start_all.cmd`는 **얇은 래퍼**로만 유지한다(항상 `start_all.ps1`를 호출, 로직 추가 금지).
- **PowerShell 자동변수 주의(중요)**:
  - `$PID`는 읽기 전용 자동 변수이며 대소문자 구분이 없어 `$pid`도 동일하게 취급되어 대입 시 에러가 난다.
  - 프로세스 ID 변수는 `$workerPid`, `$procPid`, `$listenPid`처럼 충돌 없는 이름을 사용한다.
- **Web 운영 모드(중요)**:
  - 운영 상주(Web)는 `windows/start_web.ps1 -Mode prod`(=`next start`)를 기준으로 한다. `next dev`는 개발용이며 운영에서 사용하지 않는다.
  - prod 산출물은 `.next-prod`이며, 산출물 파손/모듈 누락이 의심되면 `windows/start_web.ps1 -CleanBuild` 또는 watchdog의 자동 복구를 사용한다.
  - watchdog는 `http://127.0.0.1:3100/api/ping`뿐 아니라 **`/` + `/_next/static`**까지 헬스체크해(빈 화면/정적자산 404 포함) web만 재시작하고, 반복 실패 시 CleanBuild로 단계적 복구를 시도한다.

---

## 7. 참고 리소스
- `docs/ops/core-feature-split-plan.md` - 코어/기능 워커 분리 구현계획서(Welcome 1차)
- `README.md`, `README_DASHBOARD.md` – 빠른 실행/운영 가이드.
- `UI_VERIFICATION_CHECKLIST.md` – 대시보드 시각 검증 포인트.
- `docs/ops/`, `docs/setup/` – 운영, 설치, 복구 절차 모음.
- `scripts/` 내 README/주석 – 스크립트별 요구 조건과 사용법.
- 필요 시 `docs/reference/verification-commands.md`에 새 명령을 추가하고, 위 섹션들과 동기화한다.

본 핸드북과 동일한 내용은 `claude.md`에도 유지하여 AI/자동화 에이전트가 같은 지침을 따르도록 한다.

---

## 8. RAG / KB 운영 가드레일
- **카페 SSOT 우선**: RAG 답변은 항상 디하클 카페 데이터(embeddings + `sources_post`, `manual_doc`)를 우선 사용한다. LLM은 “정리/요약/선택” 역할만 수행하며, 카페에 없는 사실(강의 일정/가격/포인트/링크 등)을 단정적으로 생성해서는 안 된다.
- **도메인/일반 경로 분리(ADR-0018, ADR-0021)**:
  - node-iris는 `?디하클` 접두어를 제거한 “질문 본문”만 KB에 전달하므로, KB는 `context_tags`가 있으면 **기본적으로 도메인(RAG) 경로를 시도**한다.
  - 단, Sajulab 강제 태그(`sajulab`, `sajulab.kr`, `사주랩`)가 있으면 도메인=True를 강제하고 일반상식 예외를 타지 않는다.
  - 일반 상식 경로(`_build_general_answer`)는 다음 경우에만 사용한다:
    - Sajulab 강제 태그가 없고, `_is_general_knowledge_query(query)` 또는 `_is_platform_usage_query(query)`가 `True`인 경우
  - 일반 상식 경로의 첫 문장은 반드시 `가이드라인에는 없지만, 일반 상식으로 답변드립니다.` 로 시작하고 URL을 출력하지 않는다.
- **수집/조회 제외 게시판(중요)**:
  - “강사들의 꿀팁(172)”은 수집/조회/노출에서 완전 제외한다(자료 기반 답변 불가, `disabled_board`로 종료).
- **카페 메타(회원수/멤버수)**:
  - “디하클 카페 회원수/멤버수/가입자수” 질문은 KB 수집 데이터가 아니라 **카페 홈(카페정보) HTML에서 실시간 파싱**하여 결정적으로 답한다(`diag.mode=cafe_member_count`).
  - 파싱 실패 시 숫자를 추측/생성하지 말고 “자동 조회 실패”로 안내한다.
- **카페 기본 정보/강사진(운영 편의)**:
  - `docs/cafe_profile.md`를 `[KB] 디하클 카페 기본 정보`로 upsert하여( `kb/manualize.py`) 카페 기본 정보(SSOT)를 RAG 근거로 제공한다.
  - 신청 게시판(무료특강 23 / 정규강의 42) 기반으로 `[KB] 강의/강사 인덱스 (신청 게시판)` 매뉴얼을 자동 생성해 신규 강의/강사 표기가 바로 검색되도록 한다.
  - “강사진/강사 목록” 질문은 LLM 없이 결정적으로 응답한다(`diag.mode=instructors_list`, 제목 끝 `(닉네임)` 표기 기준 — 누락 가능).
- **용어/인물 SSOT(중요)**:
  - “다시보기”, “마케터제이J(대표/운영자)”, “룰루랄라릴리(강사)” 등 흔들리면 안 되는 정의는 `docs/kb_glossary.md`에 고정한다.
  - “가장 최근 강의/다음 강의/최근 신청글” 류는 **신청 게시판 SSOT**만 사용한다: 무료특강 신청(23), 정규강의 신청(42). (단일 소스: `config/menus_dinohighclass.json`)
  - 디하클 강의/특강은 “프로그램명(고유명)” 관행이 강하다(예: 쇼츠투벤츠, AI 마스터즈 등). 고유명이 포함된 질문은 해당 고유명이 **제목/본문에 실제 포함된 글**만 근거로 사용한다(하드코딩/추측 금지).
  - “누구야/정체/소개” 류 질문은 LLM 환각 위험이 커서 `config/entities_dinohighclass.json`(역할 정의) + 카페 글 URL 근거만으로 **결정적으로** 답한다.
- **링크/CTA 정책**:
  - 링크/CTA는 항상 실제 게시글/매뉴얼의 `url`에만 근거해야 한다. 임의로 URL을 구성하거나, 없는 링크를 “추측”해서는 안 된다.
  - “정보 없음/찾지 못했/관련 정보 없음/자료 부족/다시 시도” 류 답변에는 링크를 강제로 붙이지 않는다.
  - 일반 상식 경로에서는 링크를 절대 출력하지 않는다.
- **날짜/키워드 일치 필수**:
  - 일정/다시보기/녹화/링크 등 강한 의도가 있는 질문에서는, 제목+본문(norm_text)에 동일한 날짜/키워드가 포함된 문서만 최종 후보에 남긴다.
  - 날짜는 `12월 3일` / `12/3` / `12.3` 등 다양한 표기를 `_extract_date_keys`로 정규화해 비교한다.
- **LLM 재랭크 범위 제한**:
  - 벡터 검색 상위 50개 중에서 키워드·날짜 필터를 통과한 후보만 LLM 재랭크에 전달한다.
  - 후보 수가 소수(예: 5개 이하)면, LLM 재랭크 없이 기존 순서를 사용해 토큰/비용을 절약한다.
- **검증 스크립트 / 테스트 사용**:
  - `scripts/verify_rag.py`와 `tests/test_rag_*.py`를 통해 “사알못 다시보기 링크”, “강의 날짜/가격/포인트”, “Sajulab 사용법”, “완전히 무관한 일반 질문” 등 핵심 시나리오를 주기적으로 검증한다.
