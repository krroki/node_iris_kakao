# Session: fix/kb-routing-and-schedule (2025-12-12)

## Goal
- IRIS 기본 welcome/예시 템플릿 자동 발송 차단(사용자 지정 템플릿만 사용)
- KB 수집/임베딩 파이프라인이 서버 재시작 후에도 자동 재개
- RAG 응답 품질(가독성/추측 금지/링크 정책) 개선 + 자동 평가 스위트 구축

## Changes (요약)

### KB / RAG (`kb/service.py`)
- 라우팅 정확도 개선
  - `DOMAIN_KEYWORDS`에서 너무 광범위한 키워드(`카페`) 제거
  - 등업/재수강/재등록/필독/닉네임/채널톡 등 “도메인 의도” 키워드 추가
  - 가격 정책(`price_policy`) 오탐 방지: `할인` 단독은 가격 질문으로 취급하지 않음
- “추측 위험 큰 질문” 키워드 필터 강화
  - 등업 질문은 `등업`이 실제 포함된 문서만 남김(가입/승인 글로 오염 방지)
  - `재수강/재등록`, `충전/추가구매` 등 키워드 필터 추가
- 링크 정책 강화
  - 답변 내 URL은 “자료(게시글 url / 매뉴얼 본문에 포함된 URL)”로만 허용
  - 미지원 URL은 제거하고, 소스 기준으로 canonicalize(https 우선)
  - “자료 기준 확인 불가/찾지 못함” 류 응답은 URL 제거 + `manuals/posts`를 비워 혼동 방지(`no_docs_llm`)
- Sajulab 특수 처리
  - “사주랩 포인트 추가 충전/구매” 질문은 수강생 매뉴얼 근거로만 결정적 응답(`sajulab_points_topup`)

### RAG 평가 스위트 (`scripts/eval_rag_20_questions.py`)
- `--suite trained|creative|all` 지원
- `--dump-md <file>`로 질문/응답/근거/모드 덤프 저장
- 금지 문구/URL 중복/근거 없는 URL/일반상식 프리픽스 등을 자동 검증

## Verify
- Python: `pytest -q` → 41 passed
- KB: `python scripts/eval_rag_20_questions.py --suite creative --base-url http://127.0.0.1:8610 --dump-md tmp\\rag_eval_creative_20.md` → 20/20 PASS

## Notes / Next
- Next.js `RangeError: Maximum call stack size exceeded` 재현/원인 추적 필요
- 오픈채팅 `!welcome:test` 무응답 케이스 재현 및 메시지 파이프라인 점검 필요

---

## Update (2025-12-13)

### KB / RAG
- 플랫폼 사용법(네이버/카카오톡/오픈채팅 알림/설정/복사 등) 질문은 `general_out_of_scope`로 라우팅(웹 검색 + URL 출력 금지)하여 “자료 기준 확인 불가”만 나오는 문제 완화.
- 게시판 최신 글 요청 라우팅 보강: 이벤트 공지(47), 회원 대상 전체 공지(1), 성장 일기(62), 자유 게시판(33) 인식 + 강사들의 꿀팁(172)은 수집/조회 제외(`disabled_board`).
- “가장 최근” 오탐 방지: 최신 강의 분기(`latest_lecture`)는 강의/특강 문맥이 있을 때만 동작하도록 제한.
- 답변 내 `링크:` 라벨 제거(가독성/정책).

### KB 파이프라인(수집/임베딩)
- `windows/kb_task_runner.ps1`: `KB_LOG_FILE`을 task별로 강제 분리해 WinError 32(로그 rotate 충돌) 방지.
- `kb/ingest.py`: 게시글 상세 수집 시 `get_article(..., menu_id=mid)`로 호출해 메뉴별 API 호환성 보강.
- `kb/logging_util.py`: 기본 로그 파일을 `kb.log`로 변경(서비스 로그와 분리).
- `scripts/kb_status.py`: SSOT collect=true 메뉴를 0개 포함해 출력(누락/권한 문제 가시화).

### Node(IRIS)
- `!welcome:test`: SAFE_MODE/allowlist에 막혀 발신이 불가한 경우에도 “드라이런” 이벤트로 기록(발신 없음)하여 대시보드/로그에서 원인 확인 가능.
- welcome 템플릿 세트 + “카카오 기본닉” 분기(랜덤 선택) 적용: `runtime.json.welcome.templateSets`(기본닉/커스텀) + `templateSetPick=random` + `kakaoDefaultNicknameRegexes`(필수). 템플릿은 `welcome sample.txt` 기반 10종 + 공통 이미지(`KakaoTalk_20251213_123012048.png`) 적용, UI(`/settings`)에서 세트 경고 표시(ADR-0022).

## Verify (2025-12-13)
- Python: `pytest -q` → 41 passed
- KB: `python scripts/eval_rag_20_questions.py --suite member --base-url http://127.0.0.1:8610 --dump-md tmp\\rag_eval_member_20.md` → 20/20 PASS
- KB 수집/임베딩: `windows/kb_task_runner.ps1 -Task collect`, `windows/kb_task_runner.ps1 -Task embed`로 누락 1건 보정 확인.
- Node: `cd node-iris-app && npm test && npm run build` PASS
- Web: `cd web && npm run build` PASS

### 추가 변경 (2025-12-13)
- 회귀 방지 케이스 보강: `scripts/eval_rag_20_questions.py --suite room455` 추가(455330144472802 로그 기반: 마케터제이/룰루랄라릴리/캡컷 가격).
- 단발 테스트 스크립트 개선: `scripts/quick_call_ask_llm.py`가 기본으로 `context_tags=['dinohighclass']`를 붙여 node-iris와 동일 조건으로 재현 가능(`--no-tags`, `--model` 지원).
- Windows 재기동 동작 정렬: `windows/start_all.cmd`에서도 KB 서비스(`windows/kb_service.ps1`)를 함께 기동하도록 수정(기존 `start_all.ps1`와 동작 일치).
  - 추가 정리: `windows/start_all.ps1`을 정식 엔트리포인트로 두고, `windows/start_all.cmd`는 `start_all.ps1` 호출 래퍼로 통일(중복 로직 제거). `start_all.ps1`은 내부 스크립트를 순차 실행해 READY까지 대기하도록 정렬.

---

## 온보딩/대기 (2025-12-13)

- `agents.md` 및 핵심 문서(Workflow/SSOT/PRD/Roadmap/구조/검증 명령) 빠른 스캔 완료.
- ADR 전반 스캔 완료(특히 ADR-0016/0018/0020/0021 불변식 재확인).
- 본 세션에서는 코드/설정 변경 없이 대기.

---

## 추가 업데이트 2 (2025-12-13)

- KB: “강사들의 꿀팁(172)”을 수집/조회에서 2중 차단(`kb/disabled_menus.py` + ingest/search/service 필터).
- KB: pytest/TestClient 환경에서 in-process scheduler 비활성화(`PYTEST_CURRENT_TEST`/`KB_DISABLE_SCHEDULER`)로 WinError 10055 방지.
- Windows: portproxy 5050 self-loop 수정 → `127.0.0.1:5050 → <REDROID_IP>:3000`로 재설정 후 bot WebSocket 연결 확인.
- RAG: `python scripts/eval_rag_20_questions.py --suite edge --dump-md tmp\\rag_eval_edge.md` 20/20 PASS로 갱신.

---

## 멘션 기능 검토 (2025-12-13)

- “실제 멘션”은 단순 `@이름` 문자열이 아니라 LOCO 계열 `attachment.mentions`(user_id + at/len)가 필요함(`docs/research/kakao-mention-members.md`).
- 현재 코드 경로:
  - `node-iris-app/src/utils/sender.ts:safeReplyWithMentions()`:
    1) `server/app.py:/send/talkapi/dispatch` 우선 시도(성공 시 종료)
    2) 실패 시 SDK mention API(`replyRich`/`replyWithMentions`/`replyMentions`) 시도
    - “조용한 텍스트 폴백”은 하지 않음(멘션 실패는 실패로 처리)
  - `server/app.py:/send/talkapi/dispatch`는 `runtime.json.safeMode=false` + `runtime.json.talkApi.enabled=true` + `talkApi.authHeader`가 있어야 실발신 가능.
- 현재 blocker:
  - `talkApi.authHeader`(Authorization: `accessToken-deviceUUID`) 확보/유지 이슈로 멘션 실발신이 막힐 수 있음(`docs/HANDOVER.md`).
- 멘션 대상 식별:
  - sender 멘션은 IRIS 이벤트의 `senderId`로 가능.
- 임의 사용자 멘션은 `db2.open_chat_member` 등에서 nickname↔user_id 매핑이 필요하며, DB 적재를 위해 `scripts/openchat_load_members.ps1` 활용 가능.

---

## 추가 업데이트 3 (2025-12-13)

- KB/RAG: “누구야/정체/소개” 및 인물 외부 링크 요청은 LLM 환각 위험이 커서 **결정적 응답**으로 처리(`diag.mode=entity_intro`).
  - 역할 SSOT: `config/entities_dinohighclass.json`
  - 용어 SSOT: `docs/kb_glossary.md` → `kb/manualize.py`가 `[KB] 운영 용어/인물 정의`로 upsert
  - 외부 플랫폼 URL/외부 계정 핸들 + 계좌/전화 같은 민감 숫자는 최종 응답에서 제거
- RAG: 가격/할인 질문에서 “현재 할인 중” 같은 시점 민감 표현을 “할인 안내”로 완화하고, 구매/결제 유도 문구를 제거.
- 문서: `agents.md`, `CLAUDE.md`, `docs/ssot.md`에 “용어/인물 SSOT” 및 Windows 엔트리포인트(사용자=cmd, 로직=ps1) 기준을 반영.
- 검증: `python scripts/eval_rag_20_questions.py --suite edge --dump-md tmp\\rag_eval_edge.md` → 20/20 PASS (entity_intro 적용 확인).

---

## 추가 업데이트 4 (2025-12-13)

- RAG: 날짜 키 기반 DB fallback(`_search_posts_by_date_keys`) 추가 + 날짜+다시보기/녹화 미매칭 시 `keyword_filter_empty_with_date_posts`로 “해당 날짜 글은 있으나 다시보기 공지는 못 찾음” 안내(오답 링크/추측 금지).
- RAG: membership policy 라우팅 확장 — “가입 인사 글 어디 메뉴에 써?”류 질문을 `membership_policy`로 처리해 LLM 환각 방지.
- KB 스케줄러: 재시작 직후 동시 spawn 레이스를 줄이고, 실행 순서를 `collect → manual → embed → backfill`로 정렬(수집/매뉴얼 생성 후 임베딩 누락 0 유지).
- 평가: `python scripts/eval_rag_20_questions.py --suite creative2 --dump-md tmp\\rag_eval_creative2.md` 추가/갱신(20/20 PASS).

---

## 추가 업데이트 6 (2025-12-13)

- 일반 상식 경로: `web_search_preview`를 `tool_choice`로 강제(웹 검색이 실제로 수행되지 않으면 안전하게 중단) + 답변 끝에 `(검색 기준일: YYYY-MM-DD)`를 항상 포함.
- 뉴스/루머(열애설/속보/단독 등) 질문: 웹 검색을 하더라도 사실 단정/상대방 추측을 방지하기 위해 안전 템플릿으로 통일.
- 디버그: `scripts/quick_call_ask_llm.py`가 `general_out_of_scope` 응답의 `diag.web_search_*`를 출력하도록 개선.

---

## 추가 업데이트 5 (2025-12-13)

- Web(`/settings`): Welcome 세트 **편집 UI** 추가(세트 토글/`templateSetPick`/`kakaoDefaultNicknameRegexes`/CASE1·CASE2 세트 저장) + realtime 연결 실패 시 폴백 없이 에러 표시.
- Web: `web/src/app/api/runtime/route.ts`의 GET 폴백 제거(연결 실패 시 502 + `{ ok:false, error }`).
- Windows: `windows/start_web.ps1` 포트 점유 PID 전부 kill + next start(랩퍼) 패턴 종료 보강 + child 로그를 `web.next.*.log`로 분리해 잠금 충돌 회피 → `/kb`, `/settings` 500(누락 chunk) 재현/해결.
- Docs: ADR-0022 근거를 Kakao Developers `is_default_nickname`(공식 플래그)로 보강.
- Verify: `cd web && npm run build` PASS, `cd node-iris-app && npm test && npm run build` PASS, `python -m compileall server -q` PASS.

---

## Talk-API authHeader 캡처/검증 보강 (2025-12-13)

- TalkApi 업스트림 확인: authHeader(`accessToken-deviceUUID`)는 Kakao 내부 API 호출 시 `Authorization=<accessToken>`, `Duuid=<deviceUUID>`로 전달됨.
- `scripts/capture_talkapi_auth_frida.py`: frida-tools Java bridge를 선행 로드하여 Python에서도 KakaoTalk Java 훅이 동작하도록 보강(값은 레드랙트만 출력, 결과는 `data/` 저장).
- `scripts/verify_talkapi_auth_candidates.py`: `--auth-header`/`--auth-header-file` 지원 추가(ADB 없이 단일 authHeader 실발송 검증 가능).
- Docs: `docs/reference/verification-commands.md`, `docs/ops/send-guardrails.md`에 관련 명령 추가.
- Docs: `docs/adr/ADR-0024-talkapi-authheader-capture.md`로 authHeader 캡처 절차/가드레일을 ADR로 고정.
- Verify: `pytest -q tests/test_talkapi_mentions.py` PASS.

---

## Talk-API authHeader 자동 캡처 성공 + “실제 멘션” E2E (2025-12-13)

- `scripts/capture_talkapi_auth_frida.py`
  - KakaoTalk 내부 `Fp.U0.<init>` / `LocoJob.i()` 훅으로 `oauthToken`(=accessToken) + `duuid`를 캡처해 authHeader를 생성.
  - 초기화 과정에서 너무 짧은 `oauthToken`이 먼저 잡히는 케이스를 방지하기 위해 **최소 길이(min_len=20) 검증**을 추가(짧으면 무시하고 다음 후보 대기).
  - 캡처 성공률을 높이려면 `adb shell am force-stop com.kakao.talk` 후 스크립트를 실행해 **spawn 시점부터 훅을 설치**한다.
- Verify(실발송): `python scripts/verify_talkapi_auth_candidates.py --chat-id 455330144472802 --confirm-send --auth-header-file data/talkapi_auth.txt` → `http=200 status=0`.
- Realtime 서버 E2E:
  - `/send/talkapi/prepare`로 mentions attachment 생성 확인(발신 없음).
  - `/send/talkapi/dispatch`로 오픈채팅 방에서 **실제 멘션 발송** 확인(`talkApi.status=0`).
  - 테스트 후 `POST /runtime {safeMode:true}`로 다시 차단.

---

## 추가 업데이트 7 (2025-12-13) — “로그가 안 올라옴/봇이 죽어있음” 재발 방지

- 장애 관측: 대시보드에서 로그가 멈춘 상태로 보였고, FastAPI `/health`의 bot pid/lastEvent가 `null`로 표시됨.
  - 원인 1) `node-iris-app/data/status.json`이 0-byte로 남아 파싱이 실패(봇 강제 종료/크래시 타이밍에 writeFile truncate만 남는 케이스).
  - 원인 2) Node `MessageStore`에서 `EMFILE: too many open files`가 발생(로그 파일 append burst로 파일 핸들 한도 초과).
  - 원인 3) FastAPI `/status`의 logStore 판단이 Windows 디렉터리 mtime 기반 샘플링(top-5)이라 최신 로그를 놓치는 케이스가 있음.
- 조치:
  - Node: `MessageStore` 디스크 기록을 동시성 제한(기본 8, `MESSAGE_STORE_PERSIST_CONCURRENCY`)으로 직렬화 + roomDir mkdir 캐시로 파일 I/O burst를 완화.
  - Node: `updateStatus()`를 write chain + 원자적 갱신(.bak)으로 변경해 0-byte 상태파일 잔존을 방지.
  - Node: 시작 시 `data/bot_health.json`(EMFILE 플래그) 잔존을 정리해 상태 혼동 방지.
  - FastAPI: logStore 최신성 계산을 “최근 N일 날짜 로그 파일 stat” 기반으로 변경해 Windows mtime 함정 회피.
- Verify: `cd node-iris-app && npm test && npm run build` PASS, `python -m compileall server -q` PASS, `/status`에서 bot/logStore ok 동작 확인.

---

## 추가 업데이트 8 (2025-12-13) — Watchdog 자동 재시작(재발 방지)

- `windows/watchdog.ps1`를 `/status` 기반으로 개편: `bot.ok=false` 또는 “이벤트는 오는데 로그가 안 쌓임(logStore 지연)” 감지 시 봇 자동 재시작(`windows/start_bot.ps1 -Restart -SkipBuild`), `/status` 자체가 죽었으면 `windows/start_all.ps1`로 파이프라인 자동 재가동.
- 재시작 폭주 방지: Bot 120s / Pipeline 300s / IRIS repair 300s cooldown + 스킵 사유도 `windows/watchdog.log`에 기록(조용한 폴백 금지).
- `windows/start_all.ps1`가 기본으로 watchdog를 백그라운드로 기동하며, 필요 시 `windows/start_all.ps1 -NoWatchdog`로 비활성화 가능. Web 홈의 Watchdog 카드(`/api/watchdog`)에서 최근 로그 확인.
- 참고: Windows PowerShell 5.1에서 한글이 포함된 `.ps1`은 UTF-8 BOM 저장을 권장(인코딩 오인으로 스크립트 파싱 에러 방지).

---

## 추가 업데이트 9 (2025-12-13) — `/kb` 페이지/KB 서비스(:8610) 기동 복구

- 장애 관측: `windows/start_all.ps1` 실행 후 KB 서비스가 TIMEOUT, `/kb`가 비정상 동작.
- 원인: SQLAlchemy 1.4 환경에서 `postgresql+psycopg` dialect 로딩 실패(`NoSuchModuleError: sqlalchemy.dialects:postgresql.psycopg`).
- 조치:
  - 기본 `DATABASE_URL`을 `postgresql+psycopg2://...`로 정렬(`kb/db.py`, `windows/kb_service.ps1`, `windows/kb_task_runner.ps1`).
  - `windows/kb_service.ps1`의 의존성 프리플라이트(import 체크)를 `psycopg2` 기준으로 보강.
- Verify: `windows/kb_service.ps1 -Port 8610` → `/health` 200 READY, `http://127.0.0.1:3100/kb` 200 확인.

---

## 추가 업데이트 10 (2025-12-13) — Welcome 세트 운영 UX/가시성 강화 + 이미지 폴백 제거

- UI(`/settings`):
  - Welcome 세트 편집을 “라인별 textarea”에서 **칩(선택 목록) 기반**으로 전환(추가/제거 버튼, 샘플 5개 자동 채우기 제공).
  - **템플릿 미리보기 모달** 추가(텍스트 줄바꿈 + 이미지 포함, 카카오톡 스타일 프리뷰).
  - 기본닉 판별을 위한 **닉네임 테스트 입력** + 정규식 편집(고급) 토글 추가.
- Node(IRIS):
  - 신규 입장 welcome 발신 Delay를 `runtime.json.welcome.sendDelayMinMs`/`sendDelayMaxMs`로 제어(기본 3~5초). 최소 딜레이(예: 3초) 동안 합류한 입장자는 묶어서 처리(다중 멘션).
  - `safeReply`/`safeReplyImageUrls`가 **SAFE_MODE를 내부에서도 강제**(발신 함수 레벨에서 재차 차단 + 로그).
  - 이미지 발송에서 “URL 텍스트로 대체” 폴백을 제거하고, 가능한 경우 **per-image API(replyImage)** 로 대체 경로를 제공(둘 다 없으면 에러).
  - Welcome 신규입장 발신 시 **항상 로그 + `messageStore`에 `welcome_sent` 이벤트 기록**하여 UI 로그에서 템플릿 선택(랜덤/세트) 결과 확인 가능.
  - Announcement 이미지 발송도 URL 텍스트 폴백을 제거하고 에러로 처리(조용한 폴백 금지 원칙 준수).
- Docs:
  - ADR-0022의 “카카오 기본닉” 근거를 **카카오 고객센터/카카오프렌즈 공식 IP 페이지**로 보강하고, `@{entrance}`(멘션+치환) 지원을 명시.
- Verify:
  - `cd node-iris-app && npm test && npm run build` PASS
  - `cd web && npm run build` PASS

---

## Update (2025-12-14) — 공지/브로드캐스트 워커 분리(순차 모듈화)

### Node(IRIS)
- 공지/브로드캐스트 분리(ADR-0029):
  - `broadcast-worker` 추가: `/logs/stream` 구독 기반으로 공지 복제 + 브로드캐스트 큐(`data/broadcast-queue.json`) 디스패치 담당
  - bot 측 중복 실행 방지: `ANNOUNCEMENT_DISPATCHER`, `BROADCAST_DISPATCHER` 기본값을 worker로 두고 bot 컨트롤러는 dispatcher=bot일 때만 실행
  - SAFE_MODE 가드레일 강화: announcement는 SAFE_MODE=true일 때 어떤 예외도 허용하지 않도록 `isAnnouncementAllowed()` 정책 변경
- `/logs/stream` 스키마 보강:
  - 이미지 복제를 위해 SSE 엔트리에 `imageUrls`(최소 필드) 노출 추가(`server/log_utils.py`)

### Windows 운영
- `windows/start_broadcast_worker.ps1` 추가
- `windows/start_all.ps1`에 broadcast-worker 기동 및 기본 env 추가:
  - `ANNOUNCEMENT_DISPATCHER=worker`, `BROADCAST_DISPATCHER=worker`
- `windows/watchdog.ps1`에 broadcast-worker heartbeat 감시/자동 재기동 추가

### Verify (2025-12-14)
- Node: `cd node-iris-app && npm test && npm run build` PASS
- Python: `python -m compileall server` PASS
- Python: `pytest -q tests/test_log_pipeline_status.py` PASS

---

## 추가 업데이트 11 (2025-12-13) — Next.js Web 에러 폭증(MODULE_NOT_FOUND) 재발 방지

- 장애 관측: `windows/logs/web.err.log`에 `Cannot find module './chunks/...` 류 에러가 반복적으로 누적되며 Web UI가 지속적으로 깨짐.
- 원인: `next dev`(개발 서버)와 `next build/start`가 같은 distDir(`.next`)를 공유하면, 산출물이 “부분 삭제/불일치” 상태가 되어 chunk require 실패가 반복됨.
- 조치:
  - `web/next.config.mjs`: dev/prod distDir 분리(dev `.next`, prod `.next-prod`)로 충돌 제거.
  - `windows/start_web.ps1`: `-Mode prod|dev` 지원. 운영은 prod(`next start`)로 고정하고, `/api/ping`으로 READY 판정. `.next-prod` 누락(손상) 감지 시 삭제 후 재빌드.
  - `windows/watchdog.ps1`: Web health(`http://127.0.0.1:3100/api/ping`) 연속 실패 시 web만 자동 재시작(반복 실패 시 CleanBuild로 단계적 복구).
  - `windows/start_all.ps1`: web 기동을 `-Mode prod`로 고정하고 Timeout을 180s로 상향(초기 빌드/설치 시간 고려).
  - `.gitignore`: `.next-prod`를 build output으로 명시적으로 ignore.
- Docs: `docs/adr/ADR-0025-web-prod-mode-and-watchdog-web-health.md` 추가.

---

## Update 12 (2025-12-14) — 실행/템플릿/KB 품질 보강

- Node(IRIS): `windows/start_all.ps1`에서 bot 빌드 스킵 조건을 개선해, `node-iris-app/src/**` 변경 시 자동으로 `npm run build`가 수행되도록 보강.
- Welcome: ADR-0022의 “숫자/`welcome_default_*` 자동 선택 차단” 정책은 유지하면서, 로컬 템플릿 파일명/`runtime.json`의 차단 이름(예: `"1"`, `"2"`, `welcome_default_*`)을 `welcome_kakao_default_*`로 마이그레이션.
- KB: `windows/kb_task_runner.ps1`의 env 로딩에서 `Import-Module`을 제거(dot-source)하여, 같은 PowerShell 세션에서 직접 실행 시 발생하던 `EnvFile` 충돌을 해결.
- RAG: `price_policy` 답변 포맷을 “첫 문장 직답 + 요약 불릿”으로 개선하고, LLM이 붙이던 상투 헤더(“디하클 최신 강의 소식/최근 카페에서의…”)를 후처리에서 제거하도록 추가.
- 상태: OpenAI 429(쿼터)로 임베딩 누락이 남아 있을 수 있으며, 키/결제 복구 시 스케줄러가 자동으로 재시도해 누락을 메운다(`python scripts/kb_status.py`로 확인).

---

## Update 13 (2025-12-14) — RAG/KB 실사용 보정 + 회귀 검증

- RAG(일반 상식):
  - 유튜브 수익창출(YPP) 질의는 **웹 검색 결과에서 YouTube/Google 공식 도메인 근거가 없으면 숫자/조건을 단정하지 않도록** 보수적으로 변경(추측 금지).
- RAG(엔티티):
  - `룰루랄라릴리 어떤 강의 해?`처럼 “누구야”가 아닌 표현도 **entity_intro**로 처리해, 신청 게시판(23/42)에서 해당 고유명이 포함된 공지 글을 우선 제시.
- KB 매뉴얼:
  - `windows/kb_manualize.ps1`가 `kb.manualize2`(샘플) 대신 `kb.manualize`를 호출하도록 수정 → `[KB] 메뉴 xx 최근 모음`, `[KB] 운영 용어/인물 정의`가 실제로 갱신되도록 복구.
- 운영/가시성:
  - `scripts/kb_status.py`에서 스케줄 next 시간을 **로컬 타임존 + UTC**로 함께 표시(“스케줄이 멈춘 것처럼 보이는” 혼동 방지).
- RAG 평가:
  - `scripts/eval_rag_creative_20_v2.py` 추가, `tmp/rag_eval_creative_20_v2.md` 생성(자동 PASS 20/20).
- Verify:
  - Python: `python -m compileall kb src server`, `pytest -q` PASS
  - Node: `cd node-iris-app && npm install && npm test && npm run build` PASS
  - Web: `cd web && npm install && npm run build` PASS

---

## Update 14 (2025-12-14) — 오픈채팅 답장(Reply) 테스트 명령 개선

- 이슈:
  - 오픈채팅에서 “답장으로 `!reply test`”를 보냈을 때, reply 메타가 `attachment.reply`가 아니라 `attachment.src_logId/src_userId...` 형태로 **평탄화되어 들어오는 케이스**가 있었고,
  - IRIS 컨텍스트에서는 `raw.attachment`가 `null`인데 `message.attachment`에만 데이터가 들어오는 케이스가 있어 기존 로직이 `attachment가 없습니다`로 오탐함.
- 조치:
  - `node-iris-app/src/controllers/CustomMessageControllerBang.ts`:
    - `!reply:test`뿐 아니라 공백 버전인 `!reply test`도 인식하도록 보강.
    - reply attachment 소스를 `raw.attachment` → `message.attachment`까지 확장.
    - `attachment`가 JSON 문자열로 들어오는 케이스를 대비해 `JSON.parse` 정규화 추가.
    - reply 메타를 `attachment.reply`(중첩) + `attachment.src_logId/srcLogId`(평탄화) 모두 허용.
- Verify:
  - Realtime API의 `/send/talkapi/dispatch_raw`로 reply attachment 포함 발신 시 `talkApi.status==0` 확인(테스트 방).

---

## Update 15 (2025-12-14) — `?디하클` 접두 파싱 내구성 + KB 호출 재시도 + `!welcome:test` 안정화

- Node(IRIS):
  - `?디하클` 접두어 파싱을 “문자열 맨 앞에서 `?` + 공백* + `디하클`”로 완화해, `? 디하클 ...` 같은 공백 변형도 정상 응답하도록 보강(오탈자/추측 기반 fallback은 여전히 금지).
  - `askKb.ts`에서 KB 호출이 일시 실패(5xx/네트워크)할 때 **짧은 재시도**를 수행하도록 보강해, KB 재기동 타이밍/순간 단절에서 “KB 응답 중 오류”가 튀는 케이스를 완화.
  - `!welcome:test`는 텍스트 발송이 성공하면 이미지 발송 실패가 있어도 “오류 메시지”를 추가로 보내지 않고 로그로만 남기도록 변경(운영자 체감 안정성 개선).
- KB:
  - 임베딩 작업(`kb/update_embeddings.py`)에서 텍스트 chunk가 많을 때 단일 요청이 429로 실패하던 케이스를 줄이기 위해 **chunk sub-batch + 짧은 pause**를 도입(기본 batch=24, pause=0.15s).
  - Verify: `windows/kb_task_runner.ps1 -Task embed` 실행 시 누락 임베딩(post/manual) 0개로 수렴(`python scripts/kb_status.py` 확인).
- Docs:
  - `docs/kb_glossary.md`에 신청 게시판 SSOT(무료특강 23 / 정규강의 42) 명시.
  - `agents.md`에 동일 SSOT를 링크로 재강조.
- Verify:
  - `cd node-iris-app && npm test && npm run build` PASS
  - `pytest -q` PASS

---

## Update 16 (2025-12-14) — 엔티티 인식(마케터제이/룰루랄라릴리) 회귀 수정 + 메타(기억) 질문 처리

- 문제:
  - `?디하클 마케터 제이가 누구야`가 `마케터`로 토큰 분리되어 “제휴마케터” 등 무관 글이 섞이거나,
  - `?디하클 마케터제이 말이야`, `?디하클 룰루랄라릴리는 알아?`처럼 패턴이 약한 문장에서는 LLM 경로로 새어 환각/“자료 기준 확인 불가”가 발생.
- KB:
  - `_extract_entity_keywords`에서 SSOT 엔티티(`config/entities_dinohighclass.json`)의 name/aliases를 먼저 매칭해 **primary_entity 안정화**.
  - `entity_intro`의 트리거를 보강해 `말이야/알아?` 류도(SSOT 엔티티일 때만) 결정적 응답으로 처리(`mode=entity_intro`) → LLM 환각 차단.
  - “왜 기억 못해/왜 까먹어” 류 메타 질문은 `mode=bot_memory`로 **시스템 동작을 결정적으로 안내**하고, 엔티티가 있으면 인물 답변(근거 링크)도 함께 제공.
- Verify:
  - `python scripts/quick_call_ask_llm.py "마케터 제이가 누구야"` → `entity_intro`(역할+근거)
  - `python scripts/quick_call_ask_llm.py "룰루랄라릴리는 알아?"` → `entity_intro`(환각 없이 링크)
  - `python scripts/quick_call_ask_llm.py "마케터제이는 왜 알려줘도 기억을 안함"` → `bot_memory`(안내+근거)
  - `pytest -q` PASS

---

## Update 17 (2025-12-14) — Welcome 후속(첫 이미지) 자동 답장(Reply) 도입

- 요구/결정:
  - welcome 텍스트 발신 성공 이후에만 트래킹 시작(결정 A).
  - 신규 입장자가 **입장 후 5분 이내**에 올리는 **첫 이미지**를 “하트 인증샷”으로 간주하고, 해당 이미지 메시지에 **답장(Reply)** 으로 랜덤 안내 문구를 **1회만** 발신.
  - 재시도 0(실패/스킵 시 상태 종료), 방별로 ON/OFF 가능(기본 ON).
- Node(IRIS):
  - `node-iris-app/src/services/welcomeFollowUp.ts` 추가:
    - pending(TTL) 추적 + dedup + SAFE_MODE/allowlist 가드 + Talk-API `dispatch_raw`로 reply 발신.
  - `node-iris-app/src/controllers/CustomNewMemberController.ts`:
    - welcome 텍스트 발신 성공 직후 `welcomeFollowUp.trackAfterWelcomeSent(...)` 호출.
    - 세트 모드(기본닉/커스텀닉 분기)에서도 `joinedAt`이 보존되도록 entrants 매핑 보강.
  - `node-iris-app/src/controllers/CustomChatController.ts`:
    - 모든 채팅 메시지 기록 후 `welcomeFollowUp.handleChatMessage(...)`로 트리거 처리.
- Web(UI):
  - `web/src/components/RoomCard.tsx`: 방 카드에 “웰컴 답장(첫 이미지)” 토글 추가(welcome OFF면 disabled).
  - `web/src/types.ts`: `RoomFeatures.welcomeFollowUp?: boolean` 추가.
- 설정:
  - 글로벌: `runtime.json.welcome.followUp`(enabled/windowMs/maxPendingPerRoom/replies)
  - 방별: `runtime.features[roomId].welcomeFollowUp=false`면 비활성(기본 ON)
- Docs:
  - ADR-0026 추가: `docs/adr/ADR-0026-welcome-followup-first-image-reply.md`
  - `docs/ssot.md`, `docs/reference/verification-commands.md`, `docs/adr/README.md`에 결정/스모크/목록 반영
- Verify:
  - Node: `cd node-iris-app && npm test && npm run build` PASS
  - Web: `cd web && npm run build` PASS

---

## Update 18 (2025-12-14) 디하클 카페 멤버수(회원수) 실시간 응답 추가

- 문제:
  - “디하클 카페 회원수/멤버수/가입자수” 질문은 게시글/매뉴얼 수집 대상이 아니라 RAG가 “자료 없음/확인 불가”로 빠지는 케이스가 발생.
- 조치:
  - `kb/cafe_api.py`: 카페 홈(카페정보) HTML에서 멤버수 숫자를 파싱(`parse_member_count`)하고, 봇 반복 질문 시 부담을 줄이기 위해 짧은 TTL 캐시(`KB_CAFE_MEMBER_COUNT_CACHE_SEC`, 기본 300s) 추가.
  - `kb/service.py`: 멤버수 질문은 LLM/RAG를 타지 않고 결정적으로 응답(`diag.mode=cafe_member_count`). 파싱 실패 시 숫자를 추측/생성하지 않고 “자동 조회 실패”로 안내.
  - `kb/menu_ssot.py`: SSOT에서 `cafe_url` 제공(`get_cafe_url`).
- Verify:
  - `pytest -q` PASS

---

## Update 19 (2025-12-14) 카페 기본 정보/강사진 정리 자동화 + 링크 보정

- 요구:
  - 카페 기본 정보/강사진 정보가 “자료 기반”으로 안정적으로 정리되어야 함.
  - 신청 게시판(23/42)에 신규 강의가 올라오면 바로 검색/응답에 반영되어야 함.
  - 링크가 깨져(예: `https://cafe.naver.com/<post_id>`) 오동작하는 케이스 제거 필요.
- 조치:
  - `docs/cafe_profile.md` 추가 → `kb/manualize.py`가 `[KB] 디하클 카페 기본 정보`로 upsert.
  - `kb/manualize.py`: 신청 게시판(23/42) 최신 글 기반으로 `[KB] 강의/강사 인덱스 (신청 게시판)` 매뉴얼 자동 생성.
  - `kb/service.py`: “강사진/강사 목록” 질의는 LLM 없이 결정적으로 응답(`diag.mode=instructors_list`, 제목 끝 `(닉네임)` 표기 기준 — 누락 가능).
  - `kb/manualize.py`: 짧은 permalink(`https://cafe.naver.com/<post_id>`)를 SSOT cafe_url 기반 canonical 링크로 보정해, 응답/인덱스 링크가 깨지지 않도록 함.
- Verify:
  - `python -c "from kb.manualize import run; run()"` 실행 시 short url 보정 로그 확인
  - `python scripts/quick_call_ask_llm.py "?디하클 강사진 목록 알려줘"` → 정상 링크/결과 확인
  - `pytest -q` PASS

---

## Update 20 (2025-12-14) Web(3100) VM/원격 접속용 바인딩 옵션 추가

- 이슈:
  - Web UI가 특정 주소로만 바인딩되어, 환경에 따라 `localhost:3100`이 “안 뜸/접속 실패”로 보이는 케이스가 발생할 수 있음.
    - 특히 Windows에서 `localhost`가 IPv6(::1)로 우선 해석되는 경우, `127.0.0.1`로만 바인딩하면 `localhost:3100`이 타임아웃될 수 있음.
- 조치:
  - `windows/start_web.ps1`: `-Hostname` 파라미터 추가(기본 `::`, IPv6 dual-stack)로 `localhost`(::1) / `127.0.0.1` 모두에서 접근 가능하게 함. 필요 시 `0.0.0.0`(IPv4) 또는 `::`(IPv6)로 바인딩을 열 수 있음.
  - `windows/start_all.ps1`: `-WebHostname` 파라미터 추가 후 `start_web.ps1 -Hostname`으로 전달.
  - 문서 보강: `docs/setup/realtime_quickstart.md`, `docs/runbook/quickstart_vm_iris_adb.md`에 “VM/원격 접속 시 host IP 사용 + Hostname=0.0.0.0” 안내 추가.

---

## Update 21 (2025-12-14) — Welcome 후속 Reply(답장) 렌더링 안정화

- 문제:
  - welcome 후속(첫 이미지) 발신은 성공(talkApi.status==0)했지만, 카카오톡 UI에서 “답장(Reply)”로 렌더링되지 않고 일반 메시지처럼 보이는 케이스가 발생(attachment=null로 관측).
- 조치:
  - `node-iris-app/src/services/welcomeFollowUp.ts`:
    - reply attachment를 실제 오픈채팅 로그 형태에 맞춰 `src_logId/src_userId/src_linkId/src_type/src_message`를 **문자열로 정규화**하고, 불필요 필드는 포함하지 않도록 정리.
    - `src_linkId` 조회를 `db2.open_chat_member`가 아니라 `chat_rooms.link_id` 기반으로 변경(방 멤버 DB 미동기화 케이스 내구성 강화).
    - 트리거 판별을 attachment 휴리스틱에서 `message.type`(사진/멀티사진: 2/27/71, 16384 플래그 제거) 기반으로 변경해, 중간 텍스트/기타 메시지가 트래킹을 소모하는 케이스를 방지.
- Verify:
  - `cd node-iris-app && npm test && npm run build` PASS

---

## Update 22 (2025-12-14) — Talk-API Reply INVALID_ARGUMENT(-203) 해결 (src_* 타입 강제 변환)

- 문제:
  - welcome 후속(첫 이미지) Reply 발신이 Talk-API에서 `INVALID_ARGUMENT(-203)`로 실패하여, 아예 답장 메시지가 전송되지 않는 케이스가 발생.
  - 원인: `type=26` Reply attachment의 `src_userId/src_linkId/src_type`가 **문자열(string)** 로 전달되면 Talk-API가 거부하는 케이스 확인.
    - Node에서는 64-bit 범위(2^53 초과) userId를 JS number로 안전하게 다룰 수 없어 string으로 전달하는 것이 불가피함.
- 조치:
  - `server/app.py`:
    - `/send/talkapi/dispatch_raw` 및 `/send/talkapi/prepare_raw`에서 `type=26`인 경우
      `src_userId/src_linkId/src_type`(및 `attach_type`가 있으면 포함)을 **숫자형 문자열 → int로 강제 변환(coerce)** 후 Talk-API로 전달.
- Verify:
  - `http://127.0.0.1:8650/send/talkapi/prepare_raw`로 `type=26` + string `src_*` 전송 시 payload에서 `src_userId/src_linkId/src_type`가 number로 변환됨 확인
  - `http://127.0.0.1:8650/send/talkapi/dispatch_raw` 스모크에서 `ok=true`, `talkApi.status==0`, `chatLog.type==26` 확인

---

## Update 23 (2025-12-14) — 코어/기능 워커 분리(Welcome 1차)

### 결정/문서
- ADR-0027 작성 및 Accepted: `docs/adr/ADR-0027-core-logstore-and-feature-workers.md`
- 구현계획서 추가: `docs/ops/core-feature-split-plan.md`

### 구현
- Node(IRIS) 코어:
  - 신규 입장 이벤트를 `member_joined`로 로그 기록(워커가 구독해 처리).
  - 기본값 `WELCOME_DISPATCHER=worker`에서 welcome 발신을 bot 프로세스에서 수행하지 않음(레거시 롤백: `WELCOME_DISPATCHER=bot`).
  - message 이벤트에 `messageType`을 함께 기록하여 워커가 이미지/Reply 트리거를 판단할 수 있게 함.
- welcome-worker:
  - `node-iris-app/src/workers/welcome_worker.ts` 추가(SSE `/logs/stream` 구독 → welcome 텍스트/멘션 + 후속 Reply(type=26) 처리).
  - 상태 파일: `node-iris-app/data/welcome_worker_status.json`
  - state 파일: `node-iris-app/data/welcome_worker_state.json` (lastSeen/pending 영속화)
- Windows/운영:
  - `windows/start_welcome_worker.ps1` 추가.
  - `windows/start_all.ps1`에서 welcome-worker 자동 기동(단, `WELCOME_DISPATCHER=bot` 또는 `WELCOME_WORKER_DISABLE=1`이면 스킵).
  - `windows/watchdog.ps1`에서 welcome-worker 비정상(프로세스 종료/heartbeat stale) 감지 시 자동 재기동.

### Verify
- Node: `cd node-iris-app && npm test && npm run build` PASS
- Python: `pytest -q` PASS
- Web: `cd web && npm run build` PASS

---

## Update 24 (2025-12-14) — 전체 재기동(start_all) 실패(WinError 32 / `$PID` 충돌) 해결

- 문제:
  - `windows/start_welcome_worker.ps1`에서 `$pid` 사용으로 `$PID` 자동변수와 충돌 → start_all 도중 에러.
  - `windows/start_web.ps1`에서 이전 Next 프로세스가 `web.next.out.log` 핸들을 잡고 있는 상태에서 로그 로테이션을 먼저 수행 → Move-Item 실패로 start_all이 중단.
  - bot/web/welcome-worker가 상대경로로 실행되면(예: `node dist/index.js`, `node node_modules/next/...`) pre-clean/kill 패턴이 누락되어 잔존 프로세스가 남는 케이스.
- 조치:
  - `windows/start_welcome_worker.ps1`: `$workerPid`로 변경, status 기반 단일 인스턴스/중복 정리 강화.
  - `windows/start_web.ps1`: 대상 포트 기반으로 Next 프로세스 선 종료 → 로그 로테이션(재시도) 순으로 정렬, `$listenPid`로 변경.
  - `windows/start_all.ps1`: pre-clean에 `dist/index.js`/`dist/workers/welcome_worker.js` 정리 추가.
- Verify:
  - `powershell -NoProfile -ExecutionPolicy Bypass -File windows/start_all.ps1` 정상 완료
  - API `http://127.0.0.1:8650/health`, KB `http://127.0.0.1:8610/health`, Web `http://127.0.0.1:3100/api/ping` OK

---

## Update 25 (2025-12-14) — Welcome-worker 템플릿 이미지 발신 복구(ADR-0030)

- 문제:
  - 기능 워커 분리(ADR-0027) 1차 범위에서 welcome-worker가 템플릿 `images`를 스킵하고 있어, welcome에서 이미지가 발신되지 않음.
- 조치:
  - Realtime API:
    - `POST /send/iris/reply_media` 추가(`server/app.py`)
    - SAFE_MODE=true면 403으로 최종 차단, base64만 허용(서버 URL fetch 금지), 최대 6장/8MB 제한.
  - Node(IRIS):
    - `node-iris-app/src/utils/iris.ts`에 `tryServerIrisReplyMedia()` 추가
    - `node-iris-app/src/workers/welcome_worker.ts`에서 템플릿 이미지 URL(`/templates/assets/...`) 다운로드 → base64 변환 → `/send/iris/reply_media` 호출로 발신 복구
    - 이미지 발신 실패는 welcome 텍스트/후속 Reply 추적을 막지 않도록 분리(레거시 동작 정합).
- Verify:
  - Node: `cd node-iris-app && npm test && npm run build` PASS
  - Python: `python -m compileall server` PASS
  - `powershell -NoProfile -ExecutionPolicy Bypass -File windows/start_all.ps1 -NoWatchdog` 재기동 후 API/KB/Bot/Workers/Web READY 로그 확인

---

## Update 26 (2025-12-14) — RAG edge 회귀(“가장 최근 강의”) 수정 + 평가 스크립트 개선

- 문제:
  - “가장 최근 강의 뭐야” 같은 질의에서 `entity_keywords`가 `"가장"`을 고유명으로 오인해 `entity_intro`로 라우팅되는 케이스가 발생(최신 강의 결정적 경로 미동작).
- 조치:
  - `kb/service.py`의 고유명 추출 stopword에 `"가장"` 추가 → `latest_lecture` 경로가 정상 동작하도록 회귀 수정.
  - `scripts/eval_rag_20_questions.py`에 `--llm-model` 옵션 추가 → gpt-4.1 등 모델 강제 테스트 가능.
- Verify:
  - `python scripts/eval_rag_20_questions.py --suite edge --base-url http://127.0.0.1:8610 --llm-model gpt-4.1 --dump-md tmp\\rag_eval_edge_gpt41.md` → 20/20 PASS

---

## Update 27 (2025-12-14) — 카페 프로필 오탐(인물 소개) 라우팅 수정

- 문제:
  - “디하클 카페 룰루랄라릴리 소개”처럼 문장에 `카페`가 섞이면 `cafe_profile`로 오탐되어,
    인물 소개가 카페 기본 정보로 답변되는 케이스가 발생.
- 조치:
  - `kb/service.py`: `cafe_profile` 결정적 분기에서, `entity_override(SSOT 엔티티)`가 잡히고 인물 소개 의도(`entity_intro`)가 명확한 경우는
    `cafe_profile`로 처리하지 않고 `entity_intro` 경로로 넘기도록 가드 추가.
- Verify:
  - `python scripts/eval_rag_20_questions.py --suite creative2 --base-url http://127.0.0.1:8610 --llm-model gpt-4.1 --dump-md tmp\\rag_eval_creative2_gpt41.md` → 20/20 PASS

---

## Update 28 (2025-12-14) — 테스트 커맨드 방 제한 + Room ID/userId 클릭 복사 + 오픈채팅 멤버 Sheets 업서트

### 문제/요구

- 운영 방에서 `!welcome test`, `!reply test` 같은 테스트 커맨드가 실행되면 오발신 리스크가 큼 → **테스트 방에서만** 동작해야 함.
- UI에서 roomId/userId를 자주 복사해야 하므로 클릭으로 복사 UX 필요.
- 오픈채팅 멤버(닉네임/userId)를 “하나도 빠짐없이” Google Sheets로 업서트하고 싶음(단, 멤버 DB 로딩 완전성 보장 필요).

### 조치

- 테스트 커맨드 방 제한:
  - `node-iris-app/src/controllers/CustomMessageControllerBang.ts`:
    - `!welcome test/!welcome:test`, `!reply test/!reply:test`는 **테스트용 오픈채팅방(18462226881291012)에서만** 수행.
    - 타 방에서 실행 시 발신/응답 없이 스킵하고 `*_test_dry_run (reason=NOT_TEST_ROOM)`만 기록.
- UI 복사 UX:
  - `web/src/components/RoomCard.tsx`: Room ID 클릭 시 클립보드 복사(clipboard API + legacy fallback).
  - 멤버 목록의 userId 클릭 복사도 동일 helper 사용.
- Google Sheets 업서트(서비스 계정 OAuth):
  - `scripts/sync_openchat_members_to_sheets.py` 추가:
    - 단일 소스: IRIS `db2.open_chat_member`
    - 기본 동작: `loadedMembersCount < activeMembersCount`이면 **즉시 실패(중단)** (폴백 금지, `--allow-incomplete`로만 강제 진행)
    - Sheets “쓰기”는 API key로 불가 → 서비스 계정 JSON(OAuth) 필요.
  - 레퍼런스 문서:
    - `docs/reference/openchat-members-google-sheets.md`
    - `docs/reference/kakao-mentions-and-reply.md` (멘션/답장 payload 경로 SSOT)
  - 인덱스/온보딩 링크:
    - `docs/reference/README.md`, `docs/reference/verification-commands.md`, `agents.md`, `CLAUDE.md`

### Verify

- Node: `cd node-iris-app && npm test && npm run build` PASS
- Web: `cd web && npm run build` PASS

---

## Update 29 (2025-12-14) — welcome-worker 이미지 E2E 확인 + KB 스케줄 재개 안정화 + RAG price_policy/웹검색 개선

### 조치

- Welcome:
  - `welcome-worker`가 `member_joined` 이벤트를 수신하면 텍스트 발신(Talk-API) + 템플릿 이미지 발신(IRIS `/reply_media`)까지 수행되는 것을 E2E로 확인.
- KB:
  - 스케줄러가 task lock(PID) 확인에 실패할 때(권한/일시 오류 등) “실행 중”으로 고정되어 작업이 재개되지 않는 문제를 막기 위해, 확인 실패 시 재개 우선(False)로 처리하도록 보강.
- RAG:
  - `price_policy` 결정적 답변은 근거로 사용하지 않은 게시글/링크가 섞이지 않도록(`posts`, `selected_posts`, `link_hint` 비움) 처리.
  - 일반 상식 `유튜브 수익창출(YPP)` 질문에서 웹 검색 시 공식 도메인(support.google.com/youtube.com)이 상단에 오도록 프롬프트 규칙 강화.

### Verify

- Node: `cd node-iris-app && npm test && npm run build` PASS
- Python: `pytest` PASS
- KB 스모크:
  - `python scripts/quick_call_ask_llm.py --model gpt-4.1 "?디하클 비지니스반이랑 일반반 포인트 차이가 얼마야?"` → `mode=price_policy`, `selected_posts=[]`
  - `python scripts/quick_call_ask_llm.py --model gpt-4.1 "?디하클 유튜브 수익창출 기준 알려줘"` → `mode=general_out_of_scope`, `web_search_results_preview`에 `support.google.com` 포함

---

## Update 30 (2025-12-15) — welcome 토글 ON인데 미발송되는 케이스 보완(중복 프로세스/설정 반영/스킵 사유 로그)

### 관측된 원인

- **welcome-worker 중복 실행**(pid 2개 이상) 시:
  - 상태파일(`welcome_worker_status.json`) 및 lastSeen 갱신이 경합 → “이벤트는 있는데 웰컴이 안 나감” 체감 발생 가능.
- 방별 기능 플래그:
  - `runtime.json.features[roomId].welcome === true`가 아니면 welcome-worker는 **조용히 스킵**했었음 → 사용자가 원인을 못 봄.
- 운영 중 설정 변경 반영:
  - SSE(`/logs/stream`) 연결이 장시간 유지되면 `allowedRoomIds` 변경이 즉시 반영되지 않음(재연결 전까지 구독 방 목록 고정).

### 조치

- `node-iris-app/src/workers/welcome_worker.ts`:
  - **락 파일 기반 싱글톤** 도입: `data/locks/welcome_worker.lock`
    - 다른 welcome-worker가 살아있으면 새 프로세스는 즉시 종료(중복 실행 방지)
    - stale lock(PID 미존재)은 자동 정리 후 재획득
  - **SSE 연결 TTL 재연결**(기본 60초):
    - 환경변수 `WELCOME_WORKER_STREAM_TTL_MS`로 조절 가능
    - 설정 변경(allowlist 등)이 “재기동 없이도” 늦어도 TTL 내에 반영
  - **스킵 사유 로그** 추가(1분 rate-limit):
    - `ROOM_NOT_ALLOWED`, `WELCOME_DISABLED`

### Verify

- 프로세스 단일화 확인: `Get-CimInstance Win32_Process | ? { $_.CommandLine -match 'welcome_worker\\.js' }` 결과가 1개
- 테스트방(18462226881291012) synthetic join(feedType=4) → welcome 텍스트 + 이미지 전송 확인
- welcome=OFF 방 synthetic join → welcome-worker 로그에 `reason=WELCOME_DISABLED` 출력 확인

---

## Update 31 (2025-12-15) — EMFILE로 LogStore 중단 → welcome 미발송(트리거 끊김) 복구

### 관측(12/15 02:10 KST 전후)

- `/status`에서 `bot.ok=false`, `logStore.ok=false`, `extra.emfile=true`로 표기되며, `node-iris-app/data/bot_health.json`에 `{"emfile": true}`가 기록됨.
- 이 상태에서는 bot은 이벤트를 받더라도 **파일 로그 기록이 중단**될 수 있고, `/logs/stream`(파일 로그 기반)을 구독하는 `welcome-worker`는 **트리거 자체를 못 받아** “welcome이 안 도는 것처럼” 보일 수 있음.

### 조치

- `node-iris-app/src/services/messageStore.ts`:
  - persist 동시성 기본값을 보수적으로 하향(기본 2).
  - `fs.appendFile`에서 EMFILE 발생 시 백오프 재시도(최대 6회) 후에도 실패하면 `/status`에서 확인 가능한 플래그로 남김.
  - EMFILE가 해제되면 `bot_health.json`을 자동 정리.
- `windows/start_bot.ps1`:
  - `MESSAGE_STORE_PERSIST_CONCURRENCY` 기본값을 2로 설정(미지정 시).

### Verify

- `windows/start_all.ps1`로 전체 재기동 후 `/status`에서 `bot.ok=true`, `logStore.ok=true`, `emfile=false` 확인.

---

## Update 32 (2025-12-15) — 공지(Announcement) 관리/대량 발송 운영성 복구(+번호 옵션)

### 문제

- `/announcement` UI에서 공지 route를 저장해도 실제로는 `runtime.json`에 반영되지 않아 “설정했는데 안 됨/쓸 수 없음” 케이스가 발생.
- 다수 방에 동일 문구를 뿌릴 때, 동일성(중복/스팸 판정) 리스크를 낮추기 위한 “타겟별 약간의 변형(끝 번호)” 옵션이 필요.
- 공지 발송 실패 시 어떤 타겟 roomId가 실패했는지 로그에서 추적이 어려움.

### 조치

- Realtime API `POST /runtime`가 `announcement`를 정식으로 수용/정규화하도록 추가(`server/app.py`):
  - `announcement.routes[*].targets`는 dedup + source 제외 + 빈 값 제거
  - 신규 필드도 함께 저장: `appendTargetIndex`, `targetIndexStart`
- Node(IRIS):
  - 공지 미러링 시 타겟별 번호 옵션 지원:
    - `appendTargetIndex=true`면 각 타겟에 `... 1`, `... 2` 형태로 번호를 붙여 전송
    - `targetIndexStart`로 시작 번호를 조절(기본 1)
  - Talk-API 발신 로그에 `roomId`를 포함해 실패 타겟 추적 강화(`node-iris-app/src/utils/talkapi.ts`)
  - `broadcast-worker`가 route 단위 성공/실패 카운트를 로그/상태 파일로 남김(`lastAnnouncement*`)
- Web UI:
  - `/announcement` 편집 모달에 “타겟 roomId 직접 입력(붙여넣기)” 추가(방 목록에 없는 ID도 관리 가능)
  - SAFE_MODE는 공지 포함 “예외 없이 발신 차단”임을 명확히 표시(오해 방지)

### Verify

- Node: `cd node-iris-app && npm test && npm run build` PASS
- Web: `cd web && npm run build` PASS
- Python: `python -m compileall server -q` PASS
- 적용: `windows/start_all.ps1` 재기동 후 `/runtime`에서 `announcement` 업데이트/정규화 반영 확인(POST→GET 일치)

---

## Update 33 (2025-12-14) — 강의 운영 roster-worker(카페/닉네임 검증) 도입

### 요구/결정(운영 정책)

- 식별자 SSOT: **네이버 아이디(user_id, 이메일)** (카페 멤버 데이터 기준)
- 단, 오픈채팅에서는 user_id를 직접 볼 수 없으므로 닉네임 규칙 `이름@름(카페닉)`의 **(카페닉)** 으로 매칭한다.
- 카페 데이터 지연을 고려해 다음 정책으로 운영한다:
  - 입장 후 15분 유예 → 미확인 시 1회 안내(공개 멘션)
  - 24시간 후에도 미확인 시 1회 추가 안내(공개 멘션)
  - VERIFIED 또는 2차 안내 시도 후 추적 종료

### 구현

- `scripts/course_roster_worker.py`:
  - `/logs/stream` 구독 → `member_joined`/`message` 이벤트 처리
  - 닉네임에서 `(카페닉)` 파싱 후, 카페 멤버 CSV 스냅샷과 매칭하여 VERIFIED/미확인 판정
  - 안내/확인 메시지는 `POST /send/talkapi/dispatch`(멘션)로 발신
  - 결과는 Google Sheets 탭(`ROSTER_RAW`)에 key(`roomId:kakaoUserId`) 기반 upsert
- 설정:
  - 예시: `config/course_roster_worker.example.json`
  - 로컬(운영): `data/course_roster_worker.json` (gitignore)
  - 카페 멤버 CSV: `C:\dev\naver-cafe-member-crawler\data\<카페이름>_<clubid>.csv`
- 운영 스크립트/복구:
  - `windows/start_roster_worker.ps1` 추가
  - `windows/start_all.ps1`에서 기본 기동(환경변수 `ROSTER_WORKER_DISABLE=1`이면 스킵)
  - `windows/watchdog.ps1`에서 heartbeat stale/프로세스 종료 시 자동 재기동

### Verify

- `python -m py_compile scripts/course_roster_worker.py` PASS

---

## Update 34 (2025-12-15) — 공지 결과 메시지/방 검색/재기동 안정화

### 문제

- 공지 소스방에서 “전파 결과(성공/실패)”를 바로 확인하기 어려워 운영 피드백 루프가 느림.
- Web 재기동 시 `:3100` 포트 충돌(EADDRINUSE)로 Next가 실패해도 `/api/ping`이 기존 프로세스 응답으로 200이 떠서 “READY 오판” 가능.
- 일부 방이 roomId만 노출되어 공지 타겟 선택이 불편(검색/식별 어려움).

### 조치

- `broadcast-worker`:
  - 공지 전파 완료 후 소스 방에 `[공지 전파 결과]` 요약 메시지를 1회 발신(성공/실패/실패 roomId 미리보기).
  - `[공지 전파 결과]` prefix로 시작하는 메시지는 공지 미러링에서 제외(결과 메시지 재전파 방지).
- Realtime API `/rooms`:
  - IRIS `chat_rooms.meta`의 `Welcome to '<ROOM_NAME>'` 패턴을 best-effort로 파싱해 `roomName`을 보강.
- Web `/announcement`:
  - 소스/타겟 방 선택에 “방 이름/roomId 검색” 입력 추가.
  - 표시 라벨을 `방이름 (roomId)` 형태로 노출해 식별성 강화.
- `windows/start_web.ps1`:
  - `-ForceKillPort` 시 `Get-NetTCPConnection` 기반으로 포트 리스너 PID를 종료하고, 포트 해제까지 대기.
  - Next child PID를 latest 포인터에 기록하고, 조기 종료 시 “READY”로 간주하지 않도록 방지.

### Verify

- Node: `cd node-iris-app && npm test && npm run build` PASS
- Web: `cd web && npm run build` PASS
- Python: `python -m compileall server -q` PASS
