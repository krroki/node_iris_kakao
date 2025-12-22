# 세션 로그: main

> 이 파일은 `C:\dev\12.kakao` 단일 워킹트리를 여러 세션이 공유하는 운영 환경을 전제로 한다.  
> 따라서 이 워킹트리에서는 **브랜치 체크아웃/생성 없이 `main`에서만 작업**하고, 변경은 `main`에 커밋으로 누적한다.

---

## 2025-12-14

- 결론: “node 전체 종료” 사고의 근본 원인(범용 패턴 매칭 kill)을 제거하고, bot/worker 재기동은 **status.json PID 기반 + 절대경로 엔트리 확인**으로만 수행하도록 정렬.
- 문서: `agents.md`에 main-only 워킹트리 규칙과 운영 재기동(부분 재기동 우선) 원칙을 명시.

---

## 2025-12-15

- 오픈채팅 멤버(전체) Google Sheets **자동 동기화 워커** 도입:
  - 워커: `scripts/openchat_members_sheets_worker.py`
  - 기동: `windows/start_openchat_members_sheets_worker.ps1`, `windows/start_all.ps1` 조건부 자동 기동
  - watchdog 자동 복구: `windows/watchdog.ps1`에 stage 추가(단, `worker.enabled=false`면 스킵)
  - UI(3100): `/course` 탭 “톡방 멤버 Sheets(선택)” 카드 + (강의) 코스 카드 “톡방 멤버 Sheets”로 roomId별 설정/상태 확인
    - 강의톡방이 아닌 일반 방은 RoomCard “멤버 Sheets 자동” UI 유지(레거시)
  - 결정 문서: `docs/adr/ADR-0033-openchat-members-sheets-worker.md`
  - 스케줄 정책:
    - ON이면 **10분마다 업서트(고정)**, enable 직후 즉시 실행하지 않고 **다음 주기부터** 실행
    - 실패/스킵 시 테스트 방(`18462226881291012`)으로 1회 알림(전제: `safeMode=false`, `talkApi.enabled=true`)
    - 재시도 없음(다음 주기에서만 재시도)
    - 즉시 1회 실행은 UI의 `지금 업서트`(수동) 버튼으로 수행
- 완전성 원칙 유지: `loadedMembersCount < activeMembersCount`이면 폴백 없이 스킵/실패(스크롤 로딩 필요)로 기록.
- 검증: `cd web && npm run build` PASS, Python 스크립트 문법 체크(`py_compile`) PASS.
- Web(UI, 3100) 안정화:
  - 원인: Next.js 정적 자산(`/_next/static/*`) 404 상태에서 브라우저가 “남색 배경만” 보이는 케이스가 반복 발생.
  - 조치:
    - `windows/start_web.ps1`: READY 체크에 `/` + `/_next/static` 검증을 추가(실패 시 CleanBuild로 1회 자가복구).
    - `windows/watchdog.ps1`: web 헬스체크를 `/api/ping` 단독에서 `/` + `/_next/static`까지 확장해 빈 화면 상태를 자동 감지/복구.
- Talk-API 발신 장애(talkStatus=-500)로 welcome/ai/broadcast 워커가 발신을 못하는 문제를 확인하고, 운영 연속성 확보를 위해 IRIS `/reply` 기반 대체 경로를 추가.
  - Realtime API: `POST /send/iris/reply_text` 추가(`server/app.py`)
  - 워커: Talk-API 실패 시 `ai-worker`/`welcome-worker`/`broadcast-worker`가 텍스트는 `/send/iris/reply_text`, 이미지는 `/send/iris/reply_media`(URL→base64)로 대체 발신(멘션/Reply는 불가)
  - bot 컨텍스트: `safeReplyWithMentions`는 멘션 API 부재 시 예외로 종료하지 않고 일반 텍스트로 degrade, `safeReplyImageUrls`는 이미지 API 부재 시 `/send/iris/reply_media`로 대체 발신
  - 중복 실행 근본 차단: bot/워커의 경로 기준점을 `process.cwd()`가 아닌 node-iris-app 기준(APP_ROOT)으로 고정하고, bot 자체에 `data/bot.lock` 기반 싱글톤을 추가(잘못된 cwd로 실행해도 중복 기동 방지).
  - 검증: `windows/logs/api.out.log`에서 `Talk-API 502 → /send/iris/reply_text 200 → /send/iris/reply_media 200` 흐름 확인, `windows/list_bots.ps1`에서 bot/welcome/ai/broadcast 각 1개 실행 확인.
  - 문서/SSOT: `docs/adr/ADR-0034-worker-send-fallback-iris-reply-text.md`, `docs/adr/README.md`, `docs/ssot.md` 업데이트
- Web(UI) 무응답/빈 화면 감지 보강:
  - watchdog가 기존 `/api/ping(200)`만으로는 “정적 자산 404로 인한 빈 화면”을 놓치는 케이스가 있어, `/` HTML에서 참조하는 `/_next/static/*.(css|js)` 1개가 200인지까지 확인 후 비정상 시 web만 재기동하도록 개선(`windows/watchdog.ps1`).

- 방별 명령어(FAQ) 트리거 워커(command-worker) 추가:
  - 워커: `node-iris-app/src/workers/command_worker.ts` (SSE `/logs/stream` 구독)
  - UI: 방 카드 “명령어(FAQ)” 토글 → `runtime.features[roomId].commands=true`
  - 기능: `!등록/!삭제/!명령어/!전체등록/!키` (덮어쓰기 금지, 삭제 후 재등록)
  - 권한: 등록/삭제는 방장/관리자만, 전체등록은 iris 계정만
  - 발신: 기본은 Talk-API Reply(type=26)로 응답(attachment `src_*` 포함), Talk-API 실패 시 텍스트는 IRIS `/reply_text`로 명시적 폴백(Reply 아님, prefix 포함)
  - 운영: `windows/start_command_worker.ps1`, `windows/start_all.ps1`, `windows/watchdog.ps1` 연동 + 프로세스 UI(`/api/bot/processes`)에 `command-worker` 추가
  - 문서: `docs/adr/ADR-0035-room-command-triggers-worker.md`, `docs/reference/kakao-room-command-triggers.md`

- 멘션(@)이 “텍스트(@닉네임)”로만 보이는 혼란 대응:
  - 원인: Talk-API dispatch 실패(`talkStatus=-500`) → (허용된) 텍스트 폴백 경로로 degrade
  - 조치: `tryServerTalkApiDispatch*`가 최근 전송 상태를 `node-iris-app/data/talkapi_status.json`에 기록하고, UI(3100) `봇/워커 프로세스` 카드에 Talk-API 태그로 노출
- 폴백 텍스트: “가짜 멘션”을 만들지 않도록 `@닉네임` → `닉네임` 치환(`node-iris-app/src/utils/mentions.ts`)
- 운영 편의: authHeader 파일(`data/talkapi_auth.txt`)이 갱신되면 스냅샷(`data/talkapi_auth_snapshots/`)을 남기고, watchdog/start_all이 `/runtime`에 자동 반영해 드리프트를 줄임(`scripts/ensure_talkapi_auth_applied.ps1`)

- IRIS(5050)가 “응답 없음/Empty reply”로 죽어 `/query` 기반 기능(command-worker 등)이 멈추는 케이스를 확인.
  - 원인: Redroid 단말에서 IRIS 프로세스(`party.qwer.iris.Main`, Iris.apk)가 내려간 상태
  - 조치:
    - `windows/setup_iris_port.ps1`로 ADB forward(5050→device:3000) 재설정
    - `windows/repair_redroid_iris.ps1 -Fix`를 **SSH 의존 없이 ADB 기반**으로 개편해, watchdog가 IRIS를 자동 재기동할 수 있도록 수정
  - 검증: `http://127.0.0.1:5050/config` 200 복구 + Node fetch `/query` 정상화 확인

- “웰컴 후 첫 이미지 답장”이 간헐적으로 미발동하는 케이스를 확인(근본 원인: `src_linkId` 조회용 IRIS `/query` 타임아웃 → Reply(type=26) 스킵).
  - 조치: `welcome-worker`에서 `src_linkId`를 **최근 room 로그로 우선 추론 → IRIS `/query` 2회 재시도(타임아웃 증가)**로 강화하고,
    끝내 link_id가 없으면 Reply 대신 **일반 텍스트 안내로 degrade** 하도록 수정(침묵/무반응 방지).
  - 결정/문서: `docs/adr/ADR-0026-welcome-followup-first-image-reply.md` 업데이트

---

## 2025-12-16

- 장애: Realtime API(:8650) 다운 + watchdog 미기동으로 자동 복구가 동작하지 않아, bot/worker가 “무반응”처럼 보이는 케이스 발생.
- 근본 원인:
  - Task Scheduler에 watchdog 보장 작업이 없으면, watchdog가 죽는 순간부터 “자동 복구”는 0%가 된다.
  - PortProxy `0.0.0.0:5050 -> 127.0.0.1:5050` 루프백이 iphlpsvc로 5050을 점유해, `repair_redroid_iris.ps1`의 ADB forward가 `access denied(10013)`로 실패하며 IRIS 복구가 막혔다.
- 조치:
  - watchdog 보장: `windows/ensure_watchdog.ps1` + `windows/register_watchdog_task.ps1` 추가(1분 주기)
    - UX: 스케줄러 작업이 1분마다 파란 PowerShell 창을 띄우는 현상을 방지하기 위해,
      Task Action을 `wscript.exe` 래퍼(`windows/run_ensure_watchdog.vbs`)로 변경해 콘솔 창 플래시 없이 실행되도록 수정.
  - IRIS 복구 신뢰성: `windows/repair_redroid_iris.ps1`에서 루프백 PortProxy 자동 정리 + 디바이스 캐시(`data/redroid_device.json`) 도입
  - watchdog 로그 품질: IRIS 복구 스크립트의 `exitCode`와 실제 `IRIS /config`(200) 여부를 함께 기록하도록 보강

---

## 2025-12-17

- 온보딩(문서/결정 숙지):
  - 운영 가드레일: `agents.md`, `docs/ops/send-guardrails.md`
  - SSOT/요구/로드맵: `docs/ssot.md`, `docs/prd.md`, `docs/roadmap.md`
  - 구현 계획: `docs/ops/core-feature-split-plan.md`
  - 워커 분리/발신/Reply 핵심 ADR: ADR-0022/0026/0027/0028/0029/0030/0031/0034/0035
  - 레퍼런스: `docs/reference/project-structure.md`, `docs/reference/verification-commands.md`, `docs/reference/kakao-mentions-and-reply.md`, `docs/reference/kakao-room-command-triggers.md`, `docs/reference/openchat-members-google-sheets.md`
- 확인한 불변식(요약):
  - SAFE_MODE 최종 차단 SSOT는 `node-iris-app/config/runtime.json.safeMode`이며, 발신 경로는 서버(Realtime API)가 최종적으로 403으로 차단해야 한다.
  - feature-worker는 `/logs/stream`의 `type=snapshot`을 처리하지 않고 `type=append`만 처리한다(과거 이벤트 재실행 방지).
  - 운영 진단/로그 발신은 테스트방(`18462226881291012`)으로만 라우팅한다(운영방 오염 금지).
  - Talk-API 실패 시 폴백은 “명시적”으로만 수행하며(IRIS `/reply_text`/`/reply_media`), 폴백 텍스트에서는 `@`를 제거해 가짜 멘션을 만들지 않는다.
  - 재기동은 “부분 재기동 우선”, `taskkill /im node.exe` 등 node 전체 종료는 금지(PID 기반 재기동만).
- 주의(공유 워킹트리 정책): 이 워킹트리는 `main` 고정이며 브랜치 생성/체크아웃은 금지. PR/브랜치 워크플로가 필요하면 별도 clone/worktree에서 수행한다.
- 기동/복구:
  - `windows/start_all.ps1`로 전체 스택(API:8650 / KB:8610 / bot+workers / web:3100 / watchdog) 기동 완료.
  - 초기 증상: Realtime API는 떠있지만 `/health`/`/status` 및 web의 `/api/status`가 타임아웃(원인: IRIS 경로 드리프트).
  - 원인: `netsh interface portproxy`에 stale 규칙 `127.0.0.1:5050 -> 172.30.29.157:3000`이 남아 있고, redroid IP가 변경되어 IRIS `/config`가 타임아웃.
  - 복구:
    - Hyper-V `redroid` Running 확인 후, VM MAC(`00-15-5D-00-24-01`) 기반 `Get-NetNeighbor`로 신규 IP(`172.20.33.191`) 확인
    - `adb connect 172.20.33.191:5555` 성공
    - stale PortProxy 삭제: `netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=5050`
    - ADB forward 설정: `adb forward tcp:5050 tcp:3000` 후 `http://127.0.0.1:5050/config` 200 확인
    - Realtime API 재기동: `windows/start_api.ps1 -Port 8650` 후 `http://127.0.0.1:8650/health` 200 및 `http://127.0.0.1:3100/api/status` 200 확인
- 다음: 요청 대기(필요 시 “부분 재기동 우선” 원칙으로 대상 컴포넌트만 점검/재기동).
- 강의 운영 v2(카페 등급 기반 톡방 참여 점검 + 통합 스프레드시트) 요구사항 문서화:
  - ADR: `docs/adr/ADR-0039-course-roster-v2-membership-audit.md`
  - 레퍼런스: `docs/reference/course-roster-v2-membership-audit.md`
  - 기존 v1 문서에 v2 링크 추가: `docs/reference/course-roster-worker.md`
  - 레퍼런스 인덱스 갱신: `docs/reference/README.md`

---

## 2025-12-17 (추가) — `!요약` Q&A/장애 대응 개선

- `!요약 <질문>`(chat/qa)에서 **바로 위 메시지(링크/키워드)**를 놓쳐 “확인 불가”가 나오는 케이스를 줄이기 위해, MessageStore가 **디스크 로그 + 인메모리 버퍼를 병합**하도록 개선함.
- KB가 `/health`는 OK인데 `/chat/qa`만 500을 내는 **부분 고장**을 watchdog가 놓치지 않도록:
  - KB에 `GET /health/selfcheck` 추가
  - Realtime API `/status`의 KB stage가 `/health` + `/health/selfcheck`를 함께 검사하도록 강화
- `!요약` 실패 시 사용자에게는 **고정 3줄 문구**로만 응답하고(원인/디버깅 금지), 테스트방으로만 **방이름+기능+사유** 운영 알림 발신하도록 변경.
- KB 스케줄러(backfill) 작업이 PowerShell 자동변수 `$Args` 충돌로 **python을 인자 없이 실행**하던 근본 원인을 수정(→ pyrepl WinError 6 로그/작업 실패 제거).

- `!요약`(chatSummary) 요약 품질 개선:
  - 토픽 나열/메타 설명을 금지하고, **문제(Q) → 해결책(A)** 중심으로 상위 3~5개만 요약하도록 KB 프롬프트를 개편(`kb/service.py`).
  - 문서/SSOT: `docs/reference/chat-summary.md`, `docs/adr/ADR-0038-chat-summary-solution-first.md`.

---

## 2025-12-17 (추가) — 무명령어 자동 FAQ(auto-faq-worker) 운영 연동

- KB 최근 글 조회 경량 API 추가: `kb/service.py` `GET /posts/recent` (menu_ids/limit/keywords/include_norm_text)
- auto-faq-worker 기동/감시 연동:
  - `windows/start_auto_faq_worker.ps1` 추가
  - `windows/start_all.ps1`, `windows/watchdog.ps1`, `windows/list_bots.ps1`에 `auto-faq-worker` 포함
  - web 프로세스 UI(`/api/bot/processes`) expectedKinds에 `auto-faq-worker` 포함
- UI 내비게이션에 “자동 FAQ” 페이지(`/auto-faq`) 링크 추가
- 결정 문서: `docs/adr/ADR-0037-auto-faq-worker.md`

---

## 2025-12-17 (추가) — Welcome 환영/후속 답장 문구 고정

- 환영 인사(Welcome):
  - 닉네임 정상(커스텀 닉네임): `@{entrance} 어서오세요~ 하트스샷 부탁드립니닷`
  - 기본 닉네임(카카오 기본닉): `@{entrance} 어서오세요~ 소통편한걸로 닉네임변경이랑 하트스샷 부탁드립니다!`
  - 템플릿(세트 모드) 파일을 고정 문구로 통일:
    - `node-iris-app/config/templates/welcome/welcome_custom_*.json`
    - `node-iris-app/config/templates/welcome/welcome_kakao_default_*.json`
- 하트스샷(첫 이미지) 확인 후 후속 답장(Reply) 문구 고정:
  - `감사합니다~ 편하게 소통해주시면 됩니다!`
  - `node-iris-app/config/runtime.json` `welcome.followUp.replies` 를 단일 문구로 설정

---

## 2025-12-17 (추가) — auto-faq(무명령어 자동 FAQ) 정밀도/운영성 개선

- 매칭 정밀도:
  - `exact_norm`은 **완전 일치**만 허용(부분일치 필요 시 `regex` 사용)
  - `exact_norm` 정규화는 문장 끝의 `?`/`!`/`.` 구두점을 제거해, 사용자가 물음표를 붙여도 동일 문장으로 매칭되도록 개선
  - 명령어(`!`) 및 AI 접두어(`?디하클`/`?사주랩`)는 auto-faq가 무시(기능 충돌 방지)
- 우선순위 처리:
  - 2개 이상 매칭 시 기본 무응답(ambiguous)
  - 단, 스코프(방>강의ID>전역) 또는 같은 스코프 내 `priority`로 “명확한 1개”가 결정되면 발신
- 이미지 안전장치:
  - auto-faq 이미지 경로는 `assets/auto_faq/` 하위만 허용(외부 URL/경로 탈출 차단)
  - 설정 저장(`/api/auto-faq/config`)에서도 동일 정책으로 정규화
- 상태 가시화:
  - `node-iris-app/data/auto_faq_worker_status.json`에 lastMatch/lastFire(성공/실패/사유) 기록
  - ambiguous(모호 매치) / dedup(중복 발신 차단)도 SKIP 사유로 기록해 디버깅 비용을 줄임
  - UI(`/auto-faq`)에서 워커 상태(heartbeat/마지막 매치/마지막 발신)를 바로 확인 가능
  - 설정 저장 시 `regex` 패턴을 컴파일 검증하고, 유효하지 않으면 저장 자체를 실패 처리(조용한 무시 금지)
  - UI(`/auto-faq`)에 “최근 이벤트(최대 80)” + “매칭 시뮬레이터(발신 없음)” 추가
  - Talk-API 발신 실패 시 errMsg/talkStatus를 상태/이벤트에 함께 기록
  - 트리거별 `cooldownSec`(기본 10분) 지원 + regex 매칭 입력 길이 제한(안정성)

---

## 2025-12-18

- 강의 운영 v2(카페 등급 기반 톡방 참여 점검 + 통합 스프레드시트) 구현:
  - 워커(파이썬): `scripts/course_membership_audit_worker.py`, `scripts/course_membership_audit/*`
  - 기동 스크립트: `windows/start_course_membership_audit_worker.ps1`
  - UI(3100): 상단 카드 “강의 운영 v2 (등급 기반 참여 점검)” + API(`/api/course-membership-audit/*`)로 설정/상태/재시작 연결
  - 문서: `docs/reference/course-roster-v2-membership-audit.md` 스키마 확정, `docs/reference/verification-commands.md`에 커맨드 추가

- BRIDGE DOWN(상태바) 오탐/자동 복구 보강:
  - 원인: UI가 `lastEventAgeSec`만으로 BRIDGE DOWN을 표시하면 “채팅이 잠시 없는 방”에서도 DOWN으로 보이는 오탐이 발생.
  - 조치:
    - FastAPI `/health`에 `heartbeatTs/heartbeatAgeSec`를 추가하고, Next `/api/health`도 그대로 노출.
    - FastAPI `/status`의 bot stage ok 판정을 `lastEventTs`가 아니라 **`heartbeatTs` freshness** 기반으로 변경(채팅이 없어도 살아있으면 ok).
    - UI StatusBar는 heartbeatAgeSec 기준으로 BRIDGE OK/DEGRADED/DOWN을 표시하고, 참고로 이벤트 age를 함께 노출.

- watchdog(web) 자동 재기동 실패 근본 원인 수정:
  - 원인: `windows/watchdog.ps1`가 `windows/start_web.ps1` 호출 시 `"-Port" "3100"` 같은 **문자열 배열**로 인자를 전달 → PowerShell이 런타임 문자열을 파라미터 토큰으로 재해석하지 않아 `Port([int])`에 `"-Port"`가 바인딩되는 오류 발생.
  - 조치: `start_web.ps1` 호출을 **명시적 파라미터 전달**로 변경해 재기동이 실제로 성공하도록 수정.

- `windows/ensure_watchdog.ps1` 프로세스 오탐 수정:
  - 원인: `ensure_watchdog.ps1` 파일명 자체가 `watchdog.ps1` 서브스트링을 포함해, 단순 `'watchdog\.ps1'` 매칭으로는 **자기 자신을 watchdog로 오탐**.
  - 조치: watchdog 프로세스 판별을 “watchdog.ps1의 전체 경로 매칭”으로 강화.

- LOG 누락(“이벤트는 있는데 로그가 안 쌓임”) 가시화:
  - FastAPI `/health`에 `logStore.latestLogTs/logAgeSec`를 추가해, **BRIDGE OK인데 로그 저장이 멈춘 상태(LOG LAG)**를 UI에서 구분 가능하게 함.
  - UI StatusBar에 LOG 배지(`LOG OK/IDLE/LAG`)를 추가했고, 판정 기준은 `docs/reference/bridge-status.md`에 정리.

- 카카오 기본 닉네임 변경 요청(멘션) 워커(ADR-0041) 운영 편의(UI):
  - 2차/3차 안내 간격(기본 24h/48h)을 **UI(3100) 홈 상단 카드에서 수정/저장** 가능하게 함(`runtime.nicknameReminder.warningSchedule`).

- 수동 개입 최소화(“운영자는 명령을 안 친다”) 전제 보강:
  - `windows/register_watchdog_task.ps1`가 **1분 주기 + 로그인(ONLOGON)** 트리거로 `ensure_watchdog`를 자동 실행해 watchdog를 보장하도록 강화.
  - Task Scheduler는 `windows/run_ensure_watchdog.vbs`(`wscript.exe`)로 실행해 **PowerShell 창 플래시**를 방지.

- 카카오 기본 닉네임 변경 요청(멘션) 워커 도입(최대 3회 안내 + 방별 로그 + 도배 방지):
  - 워커: `node-iris-app/src/workers/nickname_reminder_worker.ts`
  - 활성화: `runtime.features[roomId].nicknameReminder=true`
  - 멤버 완전성 전제: `open_chat_member` 로딩이 `active_members_count`에 도달하기 전에는 발신 금지(+ `scripts/openchat_load_members.ps1` 자동 스크롤 로딩 트리거)
  - 결정 문서: `docs/adr/ADR-0041-default-nickname-reminder-mentions.md`

- Welcome 후속(첫 이미지) 정책 변경:
  - `runtime.json.welcome.followUp.windowMs`: 5분(300000ms) → 15분(900000ms)
  - 15분 내 첫 이미지(하트 인증샷) 미업로드 경고(추가 멘션): **제거**(ADR-0045)

- 에이전트 온보딩: `agents.md`/`docs/agents.md`/`docs/ssot.md`/`docs/prd.md`/`docs/roadmap.md`/주요 ADR/레퍼런스 숙지 완료(대기).

---

## 2025-12-20

- 공지 이미지 전파 누락(“1/N만 성공”) 재현 및 2차 핫픽스:
  - 관측: IRIS `/reply_media`는 모든 요청에 HTTP 200을 반환했지만, 실제 타겟 방에서는 일부만 이미지가 전송되는 케이스가 재현됨.
  - 원인: `/reply_media`가 UI 전송 완료 전에 반환 + 여러 방 연속 호출 시 IRIS UI automation이 이전 전송을 덮어써 “마지막 방만 전송”처럼 누락이 발생 가능.
  - 조치: IRIS 이미지 전파를 **방별 직렬화(send → MessageStore echo 확인 → 다음 방)**로 변경하고, echo 타임아웃을 60초로 확대. 공지 이미지 전파에서 Talk-API `dispatch_raw(photo)`는 비활성(불안정) 처리.
  - 코드: `node-iris-app/src/workers/broadcast_worker.ts`
  - 문서: `docs/adr/ADR-0029-broadcast-worker-from-logstream.md`, `docs/agents.md`, `docs/ssot.md`

## 2025-12-19

- 기본닉 예외값(카카오 기본 닉네임 후보) DB 리포트 보강:
  - 스크롤 로딩 + UI Participants count 기반 “완전 로딩 증명”을 강제(`scripts/report_default_nickname_candidates.ps1`).
  - node 리포트(JSON)에 `uiParticipantsCount/loadedDistinct`를 함께 기록(`node-iris-app/scripts/report_default_nickname_candidates.js`).
  - 예시(숏천모 2번방 `18426993080683374`):
    - UI Participants=2932 / DB distinctUsers=2932 / active_members_count=2933
    - 기본닉 후보: 66명(닉네임 46종)

- 운영 장애(EMFILE) 근본 원인 확정 및 핫픽스:
  - 원인: `@tsuki-chat/node-iris` Logger가 인스턴스마다 `winston.createLogger()` + File transport를 생성해 `logs/app.log`/`logs/error*.log` 파일 핸들이 누수됨 → EMFILE로 MessageStore/status 기록까지 연쇄 실패.
  - 조치: `node-iris-app/node_modules/@tsuki-chat/node-iris/dist/utils/logger.js`를 “공유 winstonLogger(transport 단일) + per-instance logLevel 필터링” 방식으로 핫픽스.
  - 적용: bot/welcome-worker 재기동 후 HandleCount가 안정적으로 유지됨.
  - 재설치 대비(워크플로우): `patch-package` 도입 + `postinstall`에서 패치 자동 재적용(`node-iris-app/patches/@tsuki-chat+node-iris+1.6.41.patch`).
  - 버전 드리프트 방지: `node-iris-app/package.json`의 `@tsuki-chat/node-iris`를 `1.6.41`로 고정.
  - 문서: `docs/adr/ADR-0042-node-iris-logger-handle-leak-emfile-hotfix.md` + `docs/ssot.md`/`AGENTS.md`/`docs/reference/verification-commands.md` 업데이트.

- Welcome 정책 재정렬(오픈프로필 안내 첫 이미지 트리거 + 리마인더 제거):
  - 환영 문구(텍스트 + 하트스샷 가이드 이미지 1장 발신):
    - 커스텀 닉네임: `@{entrance} 님 어서오세요 ~ 하트스샷 부탁드립니닷 ❤️`
    - 기본 닉네임: `@{entrance} 님 어서오세요~ 닉네임변경이랑 하트스샷 부탁드립니다! ❤️`
    - 템플릿 파일: `node-iris-app/config/templates/welcome/welcome_custom_*.json`, `node-iris-app/config/templates/welcome/welcome_kakao_default_*.json`
    - 하트스샷 가이드 이미지: `node-iris-app/config/templates/welcome/assets/common/KakaoTalk_20251213_123012048.png`
  - 첫 이미지 업로드(15분 내) 후속 동작:
    - 오픈프로필이 아닌 경우: 첫 이미지에 “감사합니다 …” Reply(type=26) 1회 발신
    - 오픈프로필인 경우: 감사 Reply는 스킵하고 “닫기 안내 + 가이드 이미지 1장”만 발신
  - 오픈프로필 닫기 안내:
    - 트리거: 입장 후 15분 내 “첫 이미지 업로드”에서만 실행(입장 직후 발신 금지)
    - 판별: `db2.open_chat_member.profile_link_id == 0` (닫기 안내 대상)
    - 설정: `runtime.json.welcome.openProfileCloseGuide` (멘션 텍스트 + 이미지 1장 + confirmText + 폴링)
    - 이미지: `node-iris-app/config/templates/welcome/assets/profile_close_guide/KakaoTalk_20251219_021112774.png`
  - 닫힘 확인 멘트:
    - 가이드 발신 후 `confirmWindowMs` 내에서 폴링으로 닫힘을 감지하면 즉시 1회 멘션 발신
  - 제거:
    - 15분 미업로드 경고(`welcome.followUp.timeoutMention`) 제거
    - 5분 기본닉 리마인더(`welcome.nicknameChangeReminder`) 제거
  - 추가:
    - `senderName=Iris` join 이벤트(feedType=4)는 스킵하여 “봇이 자기 자신을 환영/Reply”하는 오발신을 차단
  - 결정 문서: `docs/adr/ADR-0045-welcome-open-profile-guide-first-image-no-reminders.md` (→ ADR-0043 superseded)

- 운영 장애(워커 미실행) 복구/재발 방지:
  - 원인(대표): watchdog가 `start_all.ps1`을 동일 프로세스에서 동기 호출 → start_all이 장시간 블록되면 watchdog 루프가 멈춰 자동 복구 중단 가능.
  - 조치:
    - `windows/watchdog.ps1`: `start_all.ps1`을 `Start-Process`로 별도 프로세스 spawn(로그 리다이렉션)해 watchdog 루프 블록 방지.
    - `windows/ensure_watchdog.ps1`: 프로세스는 살아있어도 `windows/watchdog.log`가 오래 멈추면(hung) 자동 재기동(`-MaxLogAgeSec`, 기본 900s).
    - UI(3100): `Watchdog 재시작` 버튼(`/api/watchdog` POST) + `봇/워커 프로세스` 카드에서 워커 재시작 버튼(`/api/bot/workers/restart`) 추가.

- 운영 장애(공지 이미지 전파 성공/미발신) 핫픽스:
  - 증상: 공지(이미지 포함) 전파에서 “성공”으로 보고되지만 타겟 방에 이미지가 누락되는 케이스 발생.
  - 원인(대표): Talk-API raw 이미지 발신이 `status=-500`으로 실패 → IRIS `/reply_media` 폴백으로 전환되며, IRIS 응답이 HTTP 200이어도 실제 UI 발신은 비동기/지연 처리라 연속 발신 속도가 빠르면 누락 가능.
  - 조치(1차): `broadcast-worker`에서 IRIS 이미지 전파 시
    - 이미지 URL→base64 다운로드를 **1회 캐시**하고,
    - IRIS `/reply_media`는 **방별 1회 전송**(중복/리트라이 제거) 후,
    - MessageStore 로그 “IRIS 이미지 echo”를 기준으로 성공/실패를 판정(배치 폴링, 최대 20초),
    - 결과 메시지 포맷(성공/실패 목록 + 발송 정보) 개선(프리픽스: `📣 공지 전송 결과`).
  - 코드: `node-iris-app/src/workers/broadcast_worker.ts`, `node-iris-app/src/utils/iris.ts`
  - 문서: `docs/adr/ADR-0029-broadcast-worker-from-logstream.md`, `docs/agents.md`, `docs/ssot.md`

- 강의 운영 UI(/course) UX 단순화 + 가드레일 명확화:
  - `/course` 상단에 “빠른 사용법”을 추가해 워크플로우(1회 업서트 → 자동 갱신 → (옵션) 카카오 안내)를 5단계로 고정.
  - `v2 자동 갱신` 카드:
    - `worker.enabled` 토글을 “자동 갱신”으로 노출하고, 주기(초기 N일/안정기)를 함께 표시.
    - 토글 변경 시 설정 저장 + 워커 재시작까지 한 번에 수행(저장 실패 시 원복).
    - 서비스계정 업로드/워커 재시작 버튼 제공.
  - 코스 카드:
    - `지금 1회 업서트` 버튼(카페+3방 취합 → `AUDIT_VIEW`/`AUDIT_LOG` 1회 갱신, clear 없이 upsert).
    - `자동 갱신 포함` 토글(코스 enabled)과 방 매핑(roomId) 입력란 제공(자동 감지 실패/중복 대비).
    - “탭 이름(기본값)”은 고급 섹션으로 접어 UI 과밀을 줄임.
    - `카카오 안내(레거시)`는 코스별 `입장자 안내` 토글로 분리하고, ON 시 confirm을 추가.
  - RoomCard:
    - 방 단위 `멤버 보기/Sheets 업서트/멤버 Sheets 자동` UI는 혼선 방지를 위해 숨김(코스 운영은 `/course`에서 일원화).
  - 운영 반영:
    - `windows/start_web.ps1 -Mode prod -Port 3100 -ForceKillPort -CleanBuild`로 재빌드/재기동 후 `/course` 200 확인.

---

## 2025-12-21

- Welcome 오픈프로필 닫기 안내/확인(ADR-0045) 운영 보강:
  - 닫힘 확인 닉네임 SSOT: `feedType=2`(프로필 변경) 이벤트의 `member.nickName`을 우선 반영(일부 DB nickname 값이 base64-like 토큰으로 저장되는 케이스 대응)
  - 레이스 보완: `feedType=2` 이벤트가 pending 생성보다 먼저 들어오는 케이스 대비 최근 닉네임 캐시(20분 TTL) + pending 즉시 갱신
  - 오픈프로필 안내 dedup 키: `roomId:userId` → `roomId:userId:joinedAt` (동일 유저 재입장 시 안내 스킵 방지)
  - 안내/확인 템플릿에 멘션 placeholder가 없으면 `@{entrance} 님`을 자동 prefix해 멘션 누락을 방지
- 검증(서브 테스트용 오픈채팅방_1):
  - 15:26 1차 성공 (오픈채팅 열려있음 + 닉네임 변경 필요)
  - 15:59 2차 성공 (오픈채팅 닫혀있음)
  - 16:00 3차 성공 (카카오 프로필)
  - 16:01 4차 성공 (오픈채팅 열려있음 + 닉네임 변경 필요)

---

## 2025-12-22

- 강의 운영 v2(점검/시트) 현업 UX 보강:
  - `ACTIONS` 탭을 “해석 없이 처리 가능한” 형태로 재정리:
    - 상단: `지금/오늘/확인/정리` 건수
    - 구조: 단일 표 + `구분(지금/오늘/확인/정리)` 컬럼(`대상/해야 할 일/방/요청 닉네임/현재 톡닉`)
    - 추천 닉네임이 비어 있으면 `<이름마스킹>(카페닉)` placeholder로 표시(운영자가 이름 마스킹 규칙을 적용해 완성)
    - 슬래시(/) 케이스는 가능한 경우 `오@영(카페닉)`처럼 구체 추천을 우선 사용(placeholder로 덮어쓰지 않도록 bestRec 선택 로직 수정)
  - `OVERVIEW`/`ACTIONS` 상단에 “마지막 업데이트 <ISO>”를 1셀로 표기해(merge 영향 제거) 운영자가 갱신 시점을 바로 확인 가능하게 함.
- 결제 SSOT 닉네임 변경 기록 지원:
  - 결제 시트 `닉네임`에 `이전->현재`(또는 `→`) 표기를 허용하고,
    매칭/집계/표시는 **현재 닉네임 기준**, 이전 닉은 alias 매칭용으로만 사용.
- Sheets 서식 안정화:
  - `apply_overview_sheet_format`의 `unmergeCells` 범위를 sheet `columnCount` 기준으로 확장해 “부분 unmerge” 400 오류를 방지.
