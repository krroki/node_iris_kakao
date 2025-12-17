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
  - UI(3100): 상단 “오픈채팅 멤버(전체) Sheets 동기화” 카드 + 방 카드 “멤버 Sheets 자동”으로 roomId별 설정/상태 확인
  - 결정 문서: `docs/adr/ADR-0033-openchat-members-sheets-worker.md`
  - 스케줄 정책:
    - ON이면 **10분마다 업서트(고정)**, enable 직후 즉시 실행하지 않고 **다음 주기부터** 실행
    - 실패/스킵 시 테스트 방(`18462226881291012`)으로 1회 알림(전제: `safeMode=false`, `talkApi.enabled=true`)
    - 재시도 없음(다음 주기에서만 재시도)
    - 즉시 1회 실행은 방 카드의 `지금 업서트`(수동) 버튼으로 수행
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
- 주의: 현재 워킹트리 브랜치가 `main`이 아닌 `fix/chat-summary-24h`로 확인되며 로컬 변경 사항이 다수 존재한다. 공유 워킹트리 정책(브랜치 체크아웃/생성 금지)과 충돌 가능성이 있어, 브랜치 워크플로는 별도 clone/worktree에서만 수행한다.
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
