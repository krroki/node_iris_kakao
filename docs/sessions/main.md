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
  - 발신: Talk-API Reply(type=26)로만 응답(attachment `src_*` 포함)
  - 운영: `windows/start_command_worker.ps1`, `windows/start_all.ps1`, `windows/watchdog.ps1` 연동 + 프로세스 UI(`/api/bot/processes`)에 `command-worker` 추가
  - 문서: `docs/adr/ADR-0035-room-command-triggers-worker.md`, `docs/reference/kakao-room-command-triggers.md`
