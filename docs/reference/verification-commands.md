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
| Playwright E2E(Next.js 대시보드) | `npx playwright test` | 기본: Next dev 서버를 `http://127.0.0.1:3110`로 자동 기동 후 E2E 실행 (`PW_BASE_URL`/`PW_WEB_PORT`). 레거시 Streamlit(:8512)은 `LEGACY_STREAMLIT_E2E=1`일 때만 실행 |
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

### 테스트 커맨드(방 제한)

- `!welcome test` / `!welcome:test`, `!reply test` / `!reply:test`는 **테스트용 오픈채팅방에서만** 동작한다: `18462226881291012`
  - 다른 방에서 실행하면 **발신/응답 없이 스킵**되며, 로그에는 `*_test_dry_run (reason=NOT_TEST_ROOM)`만 기록된다.

### 오픈채팅 “답장(Reply)” 발신 스모크

- 카카오톡에서 임의의 메시지에 **‘답장’으로** `!reply test` (또는 `!reply:test`) 전송 → Iris가 **실제 답장**으로 `답장 테스트: ...` 를 발신해야 한다.
  - 전제: `runtime.json.safeMode=false`, `runtime.json.talkApi.enabled=true`, 테스트 방 roomId가 `allowedRoomIds`에 포함
  - 참고: Reply는 `type=26`이며, Realtime API의 `/send/talkapi/dispatch_raw` 경로를 사용한다. 이때 `attachment.src_userId/src_linkId/src_type`는 Talk-API 요구사항 때문에 최종적으로 int(number)로 전달되어야 하며, 서버가 숫자형 문자열을 int로 강제 변환(coerce)한다(미적용 시 `INVALID_ARGUMENT(-203)` 가능).

### IRIS 텍스트 발신 스모크 (Talk-API 폴백 경로)

- 목적: Talk-API가 502로 실패해도 “텍스트 발신”이 가능한지 빠르게 확인한다(ADR-0034).
- 전제:
  - Realtime API(:8650) 실행 중
  - `runtime.json.safeMode=false` (SAFE_MODE=true면 403으로 최종 차단됨)
  - 테스트 방(`18462226881291012`)만 사용
- 명령(PowerShell):

```powershell
$body = @{ roomId = '18462226881291012'; text = '[smoke] iris reply_text OK' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8650/send/iris/reply_text -ContentType 'application/json' -Body $body
```

- 기대 결과:
  - HTTP 200 + `"ok": true`
  - 카카오톡 테스트 방에 일반 텍스트가 1회 발신됨(멘션/Reply 없음)

### Welcome 후속 “첫 이미지” 자동 답장 스모크

- 전제:
  - `runtime.json.safeMode=false`, `runtime.json.talkApi.enabled=true`
  - 테스트 방 roomId가 `allowedRoomIds`에 포함
  - welcome 기능 ON + (방 옵션) `welcomeFollowUp`가 OFF가 아닐 것(기본 ON)
- 시나리오:
  1. 신규 입장자가 들어오고 welcome 텍스트가 정상 발신되는지 확인
  1-1. (템플릿 이미지) welcome 템플릿에 `images`가 설정되어 있다면 이미지도 별도 메시지로 발신되는지 확인(ADR-0030)
  2. 해당 신규 입장자가 **입장 후 15분 이내**에 **첫 이미지**를 전송
  3. 봇이 그 이미지 메시지에 **답장(Reply)** 으로 랜덤 문구(예: “감사합니다~ 이제 편하게 소통해주시면 됩니다!”)를 1회 발신
- 체크:
  - 같은 사용자가 추가 이미지를 보내도 **추가 답장은 없어야 함**(1회 트리거)
  - 15분이 지난 뒤 첫 이미지를 보내면 **답장이 없어야 함**
  - 15분이 지났는데도 첫 이미지가 없으면 1회 추가 멘션 경고가 발신됨:
    - `@{entrance} 하트스샷 미업로드시 광고계정으로 간주, 추방될 수 있습니다 ㅠ`

### 공지(Announcement) 미러링 스모크 (소스 → 다중 타겟 복제)

- 전제:
  - `runtime.json.safeMode=false`, `runtime.json.talkApi.enabled=true`
  - 소스/타겟 roomId가 `runtime.json.allowedRoomIds`에 포함
  - 운영 방 오발신 방지를 위해, **테스트용 소스/타겟 방을 별도로 만들어** 그 방들로만 검증 권장
- 설정:
  - 대시보드 `http://127.0.0.1:3100/announcement`에서 route 추가/편집
  - route 옵션:
    - `appendTargetIndex=true` → 타겟별로 끝에 번호를 붙임(예: `공지 1`, `공지 2`…)
    - `targetIndexStart` → 시작 번호(기본 1)
- 확인:
  - `windows/logs/broadcast_worker.out.log`에 `[announce] triggered` / `[announce] completed` 로그가 찍히는지 확인
  - 실패 시 같은 로그에 `[talkapi] dispatch non-OK`가 찍히며, `roomId`/`talkStatus`로 어떤 타겟이 실패하는지 확인 가능
  - 워커 상태 파일: `node-iris-app/data/broadcast_worker_status.json`의 `lastAnnouncement*` 필드 확인
  - (이미지) 소스 방에서 사진(이미지)만 올렸을 때 타겟 방에도 **실제 이미지가 전송되는지** 확인
    - 타겟에 텍스트 `사진`만 가고 이미지가 안 가면: Realtime API 로그 변환에서 이미지 URL이 `imageUrls`로 노출되지 않은 상태일 수 있다. (`server/log_utils.py`의 `attachment.url` → `imageUrls` 추출 경로)
  - 소스 방에 `[공지 전파 결과]` 요약 메시지가 1회 남고, **이 메시지가 타겟 방으로는 복제되지 않는지** 확인

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

> 원칙: **부분 재기동 우선**. start_all은 “콜드 부팅/전체 복구”에만 사용한다.  
> (코어/워커 분리(ADR-0027) 이후 “항상 start_all”은 취지에 반한다.)

| 목적 | 명령 (PowerShell 관리자) | 설명 |
|------|-------------------------|------|
| 전체 스택 기동(API+KB+Bot+Web) | `windows/start_all.cmd` | 사용자 실행 권장 엔트리포인트(cmd 래퍼, 내부적으로 `windows/start_all.ps1` 호출). 기본 포트: API 8650, Web 3100. 실행 후 watchdog가 **자동으로 백그라운드 기동**되며(`windows/watchdog.log` 기록), 필요 시 `windows/start_all.ps1 -NoWatchdog`로 비활성화 |
| 부팅 자동 기동 등록(Task Scheduler) | `windows/register_start_all_task.ps1` | Windows 작업 스케줄러에 로그인/부팅 트리거로 `start_all.cmd` 자동 실행 작업을 등록. 삭제는 `windows/register_start_all_task.ps1 -Delete` |
| Watchdog 자동 유지 등록(Task Scheduler) | `windows/register_watchdog_task.ps1` | watchdog가 죽어 있으면 자동 복구가 동작하지 않으므로 **ensure_watchdog를 ① 1분 주기 + ② 로그인(ONLOGON) 트리거**로 등록해 watchdog를 자동 보장한다(창 플래시 방지: `windows/run_ensure_watchdog.vbs`). 삭제는 `windows/register_watchdog_task.ps1 -Delete` |
| Bot 단독 재기동(빌드 포함) | `windows/start_bot.ps1 -Restart` | `node-iris-app/dist`가 최신이 아니면 자동으로 `npm run build` 후 기동. 운영 중 “코드 변경이 반영되지 않음”이 의심되면 이 명령으로 확인 |
| Bot 단독 재기동(빌드 생략) | `windows/start_bot.ps1 -Restart -SkipBuild` | 빠른 재기동(이미 빌드가 최신이라는 확신이 있을 때만) |
| Welcome-worker 단독 재기동 | `windows/start_welcome_worker.ps1 -Restart` | Welcome/후속 Reply 기능 워커(ADR-0027). 중복 실행은 락 파일(`node-iris-app/data/locks/welcome_worker.lock`)로 자동 차단된다. 기본값은 `WELCOME_DISPATCHER=worker`이며, 레거시(`WELCOME_DISPATCHER=bot`)로 롤백한 경우에는 worker를 끄는 것을 권장. 설정 변경 반영을 위해 SSE 재연결 TTL(기본 60초, `WELCOME_WORKER_STREAM_TTL_MS`)이 적용된다 |
| AI-worker 단독 재기동 | `windows/start_ai_worker.ps1 -Restart` | `?디하클` AI 응답 워커(ADR-0028). 중복 실행은 락 파일(`node-iris-app/data/locks/ai_worker.lock`)로 자동 차단된다. 기본값은 `AI_DISPATCHER=worker`이며, 레거시(`AI_DISPATCHER=bot`)로 롤백한 경우에는 worker를 끄는 것을 권장 |
| Broadcast-worker 단독 재기동 | `windows/start_broadcast_worker.ps1 -Restart` | 공지/브로드캐스트 워커(ADR-0029). 중복 실행은 락 파일(`node-iris-app/data/locks/broadcast_worker.lock`)로 자동 차단된다. 기본값은 `ANNOUNCEMENT_DISPATCHER=worker`, `BROADCAST_DISPATCHER=worker`이며, 둘 다 레거시(`...=bot`)로 롤백한 경우에는 worker를 끄는 것을 권장 |
| Command-worker 단독 재기동 | `windows/start_command_worker.ps1 -Restart` | 방별 명령어(FAQ) 워커(ADR-0035). `runtime.features[roomId].commands=true`인 방에서 `!등록/!삭제/!명령어/!키`를 처리한다. 중복 실행은 락 파일(`node-iris-app/data/locks/command_worker.lock`)로 자동 차단된다 |
| 기본닉 멘션 워커 단독 재기동 | `windows/start_nickname_reminder_worker.ps1 -Restart` | 카카오 기본 닉네임 사용자에게 닉네임 변경을 “멘션”으로 안내(ADR-0041). `runtime.features[roomId].nicknameReminder=true`인 방에서만 동작하며, 발신 전 Redroid 멤버 목록 스크롤 로딩으로 `open_chat_member` 완전성을 확인한다 |
| Image-worker 단독 재기동 | `windows/start_image_worker.ps1 -Restart` | 이미지 생성/수정 워커. `runtime.features[roomId].imageGen=true`인 방에서 `!사진`/`!사진수정`(Reply) 명령을 처리한다 |
| Auto-faq-worker 단독 재기동 | `windows/start_auto_faq_worker.ps1 -Restart` | 무명령어 자동 FAQ 워커(ADR-0037). `runtime.features[roomId].autoFaq=true`인 방에서 질문 트리거를 Reply로 자동응답한다. 이미지가 설정된 트리거는 Reply 후 별도 메시지로 이미지 묶음을 1회 발신한다 |
| Roster-worker 단독 재기동 | `windows/start_roster_worker.ps1 -Restart` | 강의 운영 워커(선택 기능). 설정 파일 `data/course_roster_worker.json`이 없으면 `start_all`/watchdog에서 자동으로 스킵된다 |
| Openchat-members-sheets-worker 단독 재기동 | `windows/start_openchat_members_sheets_worker.ps1 -Restart` | 오픈채팅 전체 멤버 Sheets 동기화 워커(선택 기능). `data/openchat_members_sheets.json`이 없거나 `worker.enabled=false`면 `start_all`/watchdog에서 자동으로 스킵된다 |
| Course-membership-audit-worker 단독 재기동 | `windows/start_course_membership_audit_worker.ps1 -Restart` | 강의 운영 v2(카페 등급 기반 톡방 참여 점검 + 통합 시트) 워커. 설정 파일 `data/course_membership_audit.json`이 필요하며, `worker.enabled=false`면 즉시 종료한다 |
| Web 단독 기동(prod) | `windows/start_web.ps1 -Mode prod -Port 3100 -ForceKillPort` | 운영 모드(`next start`, distDir `.next-prod`). READY는 `/api/ping`(200) + `/`에서 참조하는 `/_next/static` 자산 1개(200)로 판정(“남색 배경만” 빈 화면 방지) |
| Web 단독 기동(prod, CleanBuild) | `windows/start_web.ps1 -Mode prod -Port 3100 -ForceKillPort -CleanBuild` | `.next-prod` 삭제 후 재빌드(Next chunk 깨짐/MODULE_NOT_FOUND 복구용) |
| Web 개발 서버(dev) | `windows/start_web.ps1 -Mode dev -Port 3100 -ForceKillPort` | 개발용(`next dev`, distDir `.next`). 시작 전 `.next` 삭제 실패 시 즉시 실패(폴백 금지) |
| Watchdog 단독 기동 | `windows/watchdog.ps1` | `/status` 기반으로 bot/logStore 이상을 감지해 자동 재시작. 로그는 `windows/watchdog.log`에 기록되며 Web 홈에서 “Watchdog” 카드로 확인 가능 |
| 포트/ADB 설정 | `windows/setup_iris_port.ps1 -LocalPort 5050` | 기본 포트 5050. 기본 동작은 ADB forward만 설정한다. 외부/WSL 노출이 필요하면 `-ExposePort <포트>`로 별도 포트에 PortProxy를 건다(충돌 방지) |
| IRIS 자동 복구(ADB) | `windows/repair_redroid_iris.ps1 -Fix` | `http://127.0.0.1:5050/config`이 죽었을 때 ADB forward(5050→device:3000) 재설정 + Iris.apk(`party.qwer.iris.Main`) 프로세스를 재기동한다. watchdog가 IRIS 장애를 감지하면 자동으로 이 스크립트를 호출한다 |
| 상태 점검 | `windows/probe_iris.ps1` | HTTP 200 여부 체크 |
| WSL 봇 로그 모니터링 | `windows/tail_wsl_bot.ps1` | 실시간 로그 tail |
| 포트프록시 해제/재설정 | `windows/tcp_proxy_iris.ps1` | 고급 네트워크 설정 |

### `/status` 기반 장애 진단(Welcome 미발송 포함)

- 빠른 상태 확인(권장):
  - `powershell -NoProfile -Command "Invoke-RestMethod http://127.0.0.1:8650/status | ConvertTo-Json -Depth 6"`
- 체크 포인트:
  - `bot.ok=false` 또는 `logStore.ok=false`면 **welcome-worker/ai-worker가 트리거를 못 받을 수 있음**(`/logs/stream`은 파일 로그 기반).
  - `extra.emfile=true` 또는 `node-iris-app/data/bot_health.json` 존재 시: MessageStore가 `EMFILE(too many open files)`로 로그 기록을 중단한 상태일 수 있음.
    - 우선 복구: `windows/start_bot.ps1 -Restart` (또는 콜드 부팅은 `windows/start_all.cmd`)
    - 운영에서는 watchdog가 자동 재시작하지만, watchdog가 죽어있으면 수동 복구가 필요.
    - (추가) 재기동 직후에도 EMFILE가 빠르게 재발하거나, 프로세스 HandleCount가 수천 단위로 치솟으면 **node-iris Logger 파일 핸들 누수**(ADR-0042)를 의심한다.
      - 확인(간단): `powershell -NoProfile -Command "Get-Process -Id <PID> | Select-Object Id,HandleCount"`
      - 패치/버전 점검:
        - `node-iris-app/package.json`에서 `@tsuki-chat/node-iris`가 `1.6.41`로 고정되어 있는지 확인
        - (강제) `cd node-iris-app && npx patch-package --error-on-fail`
      - 원인/조치(SSOT): `docs/adr/ADR-0042-node-iris-logger-handle-leak-emfile-hotfix.md`

모든 스크립트는 관리자 권한 PowerShell에서 실행해야 하며, 실행 전 `Set-ExecutionPolicy RemoteSigned` 상태를 확인한다.

---

## 7. 오픈채팅 멤버(닉네임) 로딩/조회 (`scripts/`, `web/`)

> 대시보드(3100)의 “멤버 보기”는 IRIS DB(`db2.open_chat_member`)를 조회한다.  
> 대형 방은 단말에서 “멤버 목록”을 한 번 열고 스크롤해야 DB가 충분히 채워질 수 있다.

| 목적 | 명령 | 설명 |
|------|------|------|
| 멤버 DB 강제 로딩(단말 UI 스크롤) | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/openchat_load_members.ps1 -RoomId <ROOM_ID> -Serial <ADB_SERIAL> -Scrolls 650` | 오픈채팅 URL로 진입 → 멤버 화면 스크롤로 `db2.open_chat_member`를 채움(송신 없음) |
| 기본닉 후보 리포트(증명 포함) | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/report_default_nickname_candidates.ps1 -RoomId <ROOM_ID> -Serial <ADB_SERIAL> -Scrolls 650` | 멤버 로딩을 선행한 뒤, DB 기준 “카카오 기본 닉네임” 후보를 중복 제거해 출력 + JSON 저장(`node-iris-app/data/reports/default_nickname_candidates/`) |
| 멤버 스냅샷(JSON) 저장 | `python scripts/iris_members_snapshot.py --rooms <ROOM_ID> --output logs/analysis/iris_members_snapshot.json` | `db2.open_chat_member`를 roomId로 필터해 userId/nickname 목록을 저장 |
| 대시보드에서 멤버 보기 | `http://127.0.0.1:3100` | 방 카드의 “멤버 보기”에서 닉네임 검색/페이지 이동(userId 클릭 시 복사) |
| Google Sheets 업서트 | `python scripts/sync_openchat_members_to_sheets.py --room-id <ROOM_ID>` | `db2.open_chat_member`를 Google Sheets에 upsert(서비스 계정 OAuth 필요). 기본은 loaded<active면 실패. 1회 등록(`--init-config`)을 안 했으면 `--spreadsheet-id`가 필요 |

### 강의 운영: 카페/닉네임 검증 워커(roster-worker)

- 설정(로컬, gitignore):
  - `data/course_roster_worker.json` (예시: `config/course_roster_worker.example.json`)
  - `data/gcp_service_account.json` (서비스 계정)
  - 카페(권장, 크롤러): `cafeSource=crawler` + `cafeClubId=<NAVER_CAFE_CLUB_ID>`
    - (선택) `crawlerRepoPath`, `crawlerPythonExe`, `crawlerSettingsPath`
    - 크롤러 레포(기본): `C:\dev\naver-cafe-member-crawler`
    - 계정/비번은 크롤러 설정 파일에 저장됨(예: `%LOCALAPPDATA%\NaverCafeMemberCrawler\config\settings.json`)
  - 카페(레거시): `cafeSource=csv` + `cafeCsvPath`
- 기동:
  - `pwsh windows/start_roster_worker.ps1`
  - 재시작: `pwsh windows/start_roster_worker.ps1 -Restart`
- 비활성화:
  - 전체 비활성화(운영): `setx ROSTER_WORKER_DISABLE 1`
  - 방별 비활성화: `runtime.features[roomId].courseRoster=false`
- 로그/상태:
  - `windows/logs/roster_worker.out.log`
  - `node-iris-app/data/roster_worker_status.json`

### 강의 운영 v2: 카페 등급 기반 참여 점검 워커(course-membership-audit-worker)

- 설정(로컬, gitignore):
  - `data/course_membership_audit.json` (예시: `config/course_membership_audit.example.json`)
  - `data/gcp_service_account.json` (서비스 계정)
  - 카페 크롤러 레포: `C:\dev\naver-cafe-member-crawler`
    - 계정/비번은 크롤러 설정 파일에 저장됨(예: `%LOCALAPPDATA%\NaverCafeMemberCrawler\config\settings.json`)
- 기동:
  - `pwsh windows/start_course_membership_audit_worker.ps1`
  - 재시작: `pwsh windows/start_course_membership_audit_worker.ps1 -Restart`
- 권한:
  - Sheets 업서트는 **Chrome 로그인**이 아니라 **서비스 계정 권한**이 필요
  - 스프레드시트 문서에 서비스 계정 이메일을 **Editor**로 공유(이메일은 UI의 “강의 운영 v2” 카드에 표시)
- 비활성화:
  - 전체 비활성화(운영): `setx COURSE_MEMBERSHIP_AUDIT_WORKER_DISABLE 1`
- 점검 전제:
  - 방 이름 규칙: `(사담방) <코스키>` / `(공지방) <코스키>` / `(프리미엄방) <코스키>`
  - 등급 매핑: `staffGrades` → staff, `premiumGrades` → premium, 그 외 → normal(새싹 포함)
  - `loadedMembersCount < activeMembersCount`면 AUDIT_VIEW는 `INCOMPLETE`로 표시됨(확정 금지)
  - `data/course_membership_audit.json`이 있고 `worker.enabled=true`면 `start_all`/watchdog가 자동 기동/복구 대상
- 로그/상태:
  - `windows/logs/course_membership_audit_worker.out.log`
  - `node-iris-app/data/course_membership_audit_worker_status.json`
  - `node-iris-app/data/course_membership_audit_worker_state.json`

---

## 8. KB/RAG/SAFE_MODE 통합 검증 (`scripts/`)

| 시나리오 | 명령 | 설명 |
|----------|------|------|
| KB Postgres(5433) 자동 보장 | `pwsh windows/ensure_postgres.ps1` | Docker Desktop/컨테이너(`iris_pg`)를 자동 기동하고 healthy까지 대기 (watchdog/start_all에서 자동 호출되지만, 수동 복구 시 유용) |
| KB 계약 + RAG 회귀 + SAFE_MODE 스모크 | `python scripts/test_kb_e2e.py` | KB 계약 테스트, RAG 결과 검증, SAFE_MODE 토크 API 차단 여부를 한 번에 점검 |
| KB 수집/임베딩 신선도 점검 | `python scripts/kb_status.py` | 메뉴별 수집 최신일(예: 무료 특강/정규 강의가 며칠 전까지 들어왔는지), 포스트/임베딩 개수, 스케줄 상태(`/schedule`)를 한 번에 확인 |
| SAFE_MODE 스모크 단독 실행 | `python scripts/test_safe_mode.py` | `/runtime`으로 safeMode 토글 → `/send/talkapi/dispatch`가 safeMode=true일 때 403을 반환하는지 확인 (테스트 후 원래 값 복원). payload의 roomId는 기본적으로 테스트 방(`TEST_ROOM_ID=18462226881291012`)을 사용 |
| Talk-API authHeader 저장(수동 주입) | `powershell -ExecutionPolicy Bypass -File scripts/extract_talkapi_auth.ps1 -AccessToken "<token>" -DeviceUUID "<uuid>" -ApplyRuntime` | Authorization `accessToken-deviceUUID`를 `data/`에 저장하고 Realtime API(`/runtime`)에 반영 |
| Talk-API authHeader 추출(자동 스캔, root 필요) | `powershell -ExecutionPolicy Bypass -File scripts/extract_talkapi_auth.ps1` | 카카오톡 로컬 경로에서 토큰/UUID 후보를 스캔(성공 시 `data/`에 저장). 실패 시 후보를 레드랙트 출력 후 종료 |
| Talk-API authHeader 캡처(Frida) | `python scripts/capture_talkapi_auth_frida.py` | KakaoTalk 앱에서 실제 Authorization/Duuid 헤더를 캡처해 `data/`에 저장(값은 레드랙트만 출력) |
| Talk-API authHeader 검증(실발송, confirm 필요) | `python scripts/verify_talkapi_auth_candidates.py --chat-id <ROOM_ID> --confirm-send --auth-header-file data/talkapi_auth.txt` | 저장된 authHeader로 1회 전송하여 `status==0` 성공 여부를 확인(테스트 방 권장) |
| Talk-API authHeader 스냅샷(보관) | `powershell -ExecutionPolicy Bypass -File scripts/snapshot_talkapi_auth.ps1` | 현재 `data/talkapi_auth.txt`를 `data/talkapi_auth_snapshots/`로 타임스탬프 스냅샷 보관(값은 레드랙트만 출력) |
| Talk-API authHeader 재적용(파일 → 런타임) | `powershell -ExecutionPolicy Bypass -File scripts/ensure_talkapi_auth_applied.ps1 -Force` | `data/talkapi_auth.txt`를 Realtime API(`/runtime`)에 반영해 runtime.json 드리프트를 복구(응답은 토큰을 포함하므로 출력하지 않음) |
| RAG 회귀 단독 실행 | `python scripts/verify_rag.py --base-url http://127.0.0.1:8610` | “사알못 다시보기 링크”, “12월 3일에 강의 있나”, “엉뚱한 질문” 등 핵심 질의를 자동화로 검증 |
| RAG 예상 질문 20개 평가 | `python scripts/eval_rag_20_questions.py --suite member --base-url http://127.0.0.1:8610 --dump-md tmp\\rag_eval_member_20.md` | 카페 회원 관점 20문항을 일괄 호출해 라우팅/금지문구/URL 정책/가독성을 PASS/FAIL로 점검 (`--suite trained|creative|creative2|member|room455|edge|all`, LLM 모델 강제: `--llm-model gpt-4.1`) |
| (추가) 창의/엣지 질문 20개(v2) | `python scripts/eval_rag_creative_20_v2.py` | 실사용/엣지 질문 20개로 빠르게 점검하고 `tmp/rag_eval_creative_20_v2.md`를 생성(금지문구/URL 중복/일반 상식 URL 정책 위반 자동 체크) |
| (회귀) 특정 방 로그 재현 | `python scripts/eval_rag_20_questions.py --suite room455 --base-url http://127.0.0.1:8610` | 455330144472802 로그 기반 회귀(마케터제이/룰루랄라릴리/캡컷 가격) |
| /ask_llm 단발 호출 | `python scripts/quick_call_ask_llm.py "질문"` | 기본 `context_tags=['dinohighclass']`로 node-iris와 동일 조건 테스트 (`--no-tags`, `--tags`, `--model` 지원) |

통합 검증 스크립트는 **서비스가 실제로 띄워진 상태**에서만 의미가 있으므로, 먼저 KB 서비스(:8610)와 Realtime API(:8650)를 실행한 뒤 사용해야 한다.

---

## 9. 세션 종료 체크

1. 코드 변경이 있는 모든 언어/영역에 대해 위 명령으로 테스트 수행 (`pytest`, `npm test`, `npx playwright test` 등).
2. `scripts/log_api.py` 또는 UI 스모크를 통해 런타임 동작 스크린샷/로그 확보.
3. 결과를 PR 또는 `docs/sessions/<branch>.md`에 링크로 남긴다.
4. 필요 시 `docs/ssot.md`와 `docs/todo.md`를 업데이트하여 후속 조치 기록.

본 레퍼런스는 `agents.md`/`claude.md` 체크리스트와 함께 사용되며, 명령 추가 시 두 문서를 동기화해야 한다.
