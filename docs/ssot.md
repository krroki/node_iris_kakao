# 단일 정보 출처 (SSOT)

## 프로젝트 개요
- 이름: 12.kakao
- 목적: 루팅 안드로이드 + IRIS + Hyper-V 리눅스 봇 서버 조합으로 카카오톡 오픈채팅(명령어, 환영, 방송)을 안정적으로 운영.
- 현재 상태: Hyper-V/루팅 단말 기반 설치 가이드 정리 및 요구사항 문서 갱신 완료 (2025-10-28).

- 2025-12-19: 강의 운영 UI 정리 — RoomCard의 강의 운영(카페 CSV/시트 입력) 제거, `/course` 탭에서 코스 자동 감지 + v2(등급 기반 참여 점검) 설정/워커 관리로 통합. v1 roster-worker는 `rosterSheetName` 미설정 시 방 이름 접두어로 기본 탭명(`ROSTER_CHAT/ROSTER_NOTICE/ROSTER_PREMIUM`)을 추론한다.
- 2025-12-12: welcome 템플릿 SSOT 정합성 강화(신규입장/`welcome:test`에서 runtime.json.templateByFeature.welcome → welcomeTemplateName 순으로만 사용) 및 템플릿 미존재 시 기본 환영 폴백 발송 금지.
- 2025-12-12: KB 스케줄 영속화(`secrets.KB_SCHEDULE_JSON`) + 서비스 재시작 시 스케줄러 자동 재개(즉시 1회 실행), 작업 실행은 `windows/kb_task_runner.ps1`(task별 lock + 의존성 자동 보정)로 통일.
- 2025-12-12: RAG 라우팅/일반 상식 경로 개선 — node-iris는 `?디하클` 접두어를 제거한 질문 본문 + `context_tags`(기본 `dinohighclass`, 필요 시 `sajulab*`)를 KB로 전달, KB는 `context_tags`가 있으면 기본적으로 도메인(RAG) 경로를 시도하되 유튜브 수익화/venv 등 명백한 일반 상식 질문은 `general_out_of_scope`로 처리(고정 프리픽스 + URL 출력 금지).
- 2025-12-12: RAG 링크/근거 가드레일 강화 — 답변 URL은 자료(게시글 url/매뉴얼 본문)에 포함된 URL만 허용(미지원 URL 제거, https canonicalize, URL 중복 제거), “자료 기준 확인 불가” 응답은 링크/근거를 비워 혼동 방지.
- 2025-12-12: RAG 자동 평가 스위트 추가 — `scripts/eval_rag_20_questions.py`(trained/creative/all + `--dump-md`)로 질문 20개 단위 회귀 검증.
- 2025-12-12: 운영 스크립트 안정화 — `windows/start_bot.ps1`는 Start-Process pid 기반으로 READY 판정(불필요한 TIMEOUT 감소), KB 작업 스크립트(`kb_collect/embed/manualize`)는 로그 스트리밍으로 진행 상태 가시화.
- 2025-12-13: RAG 라우팅 보강 — “오픈채팅/네이버/카카오톡” 등 플랫폼 사용법 질문은 `general_out_of_scope`로 처리(웹 검색 + URL 출력 금지), 게시판 최신 글 라우팅에 이벤트/전체공지/성장일기/자유게시판 인식 추가 + “강사들의 꿀팁(172)”은 수집/조회 제외(`disabled_board`).
- 2025-12-13: 메뉴 SSOT/수집 규칙 정리 — `config/menus_dinohighclass.json`에서 “강사들의 꿀팁(172)”을 collect=false로 전환하고(profile 제거), `kb/profiles.yaml`/`config/collect_rules.yaml`/`web/src/app/kb/page.tsx`에서 172를 제거해 수집·노출·조회에서 완전 제외.
- 2025-12-13: KB 작업 재시작 안정화 — `windows/kb_task_runner.ps1`가 `KB_LOG_FILE`을 task별로 강제 분리(WinError 32 rotate 충돌 방지), `kb/ingest.py`에서 `get_article(..., menu_id=mid)`로 상세 수집 호환성 개선, `scripts/kb_status.py`에서 collect=true 메뉴를 0개 포함해 출력.
- 2025-12-13: 테스트 안정화 — pytest/TestClient에서는 KB in-process scheduler를 자동 비활성화(`PYTEST_CURRENT_TEST`/`KB_DISABLE_SCHEDULER`)해 불필요한 작업 spawn 및 WinError 10055(소켓 고갈) 회귀를 방지.
- 2025-12-13: RAG 회귀 보강 — `scripts/eval_rag_20_questions.py --suite room455` 추가(455330144472802 로그 기반: 마케터제이/룰루랄라릴리/캡컷 가격) + `scripts/quick_call_ask_llm.py`가 기본 `context_tags=['dinohighclass']`로 node-iris 조건 재현.
- 2025-12-13: RAG 용어/인물 SSOT 고정 — `docs/kb_glossary.md`를 `[KB] 운영 용어/인물 정의`로 upsert(`kb/manualize.py`), “누구야/정체/소개” 류 질문은 `config/entities_dinohighclass.json`(역할 정의) + 카페 글 URL 근거만으로 결정적 응답(`diag.mode=entity_intro`).
- 2025-12-13: RAG 안전성 보강 — 날짜+다시보기/녹화 키워드가 매칭되지 않으면 `keyword_filter_empty_with_date_posts`로 “해당 날짜 글은 있으나 다시보기 공지는 못 찾음” 형태로 안내(오답 링크/추측 금지) + “가입 인사 글 어디에 써?”류 질문을 `membership_policy`로 라우팅해 LLM 환각 방지.
- 2025-12-13: KB 스케줄러 의존성 정렬 — 서비스 재시작 직후 scheduler 실행 순서를 `collect → manual → embed → backfill`로 조정하고, lock/grace 기반으로 동시 실행을 억제해 “수집 후 임베딩 누락”을 방지.
- 2025-12-13: RAG 자동 평가 스위트 확장 — `scripts/eval_rag_20_questions.py --suite creative2` 추가(실사용 문장/오탈자/복합 의도 포함).
- 2025-12-13: 일반 상식 경로 웹 검색 강제 — `general_out_of_scope` 답변은 `web_search_preview`를 `tool_choice`로 강제하고, 응답에 `(검색 기준일: YYYY-MM-DD)`를 항상 포함(도구 실패 시 추측 답변 금지). 또한 열애설/루머/속보 등 뉴스성 질문은 안전 템플릿으로 통일(상대방/신상 생성 방지).
- 2025-12-13: Windows 기동 동작 정렬 — 사용자 실행은 `windows/start_all.cmd`, 로직 SSOT는 `windows/start_all.ps1`로 통일(중복 로직 제거로 드리프트 방지). 또한 `start_all.ps1`은 내부 스크립트를 순차 실행해 각 컴포넌트 READY를 기다리도록 정렬.
- 2025-12-14: KB manual 작업 복구 — `windows/kb_manualize.ps1`이 샘플(`kb.manualize2`)이 아니라 실제 manualize 파이프라인(`kb.manualize`)을 호출하도록 수정해, `[KB] 메뉴 xx 최근 모음`/`[KB] 운영 용어/인물 정의` 매뉴얼이 자동 갱신되도록 복원.
- 2025-12-14: RAG 엔티티 질문 보강 — “누구야”뿐 아니라 “어떤 강의 해?” 류도 entity_intro로 처리해 신청 게시판(23/42)에서 해당 고유명이 포함된 공지 글을 우선 제시.
- 2025-12-14: 일반 상식(YPP) 안전장치 — 웹 검색 결과에 YouTube/Google 공식 도메인 근거가 없으면 수익창출 조건(숫자/기간)을 단정하지 않고 보류하도록 보수적으로 변경(추측 금지).
- 2025-12-14: RAG 회귀 스위트 추가 — `scripts/eval_rag_creative_20_v2.py`(실사용/엣지 질문 20개) 추가 및 `tmp/rag_eval_creative_20_v2.md`로 결과 덤프.
- 2025-12-14: 디하클 카페 멤버수(회원수) 질문 대응 — KB 수집/RAG로 답하지 않고 카페 홈(카페정보) HTML에서 실시간 파싱하여 결정적으로 응답(`diag.mode=cafe_member_count`). 파싱 실패 시 추측 금지(자동 조회 실패로 안내).
- 2025-12-14: 카페 기본 정보/강사진 정리 자동화 — `docs/cafe_profile.md`를 `[KB] 디하클 카페 기본 정보`로 upsert하고, 신청 게시판(23/42) 기반으로 `[KB] 강의/강사 인덱스 (신청 게시판)` 매뉴얼을 자동 생성(`kb/manualize.py`). 또한 “강사진/강사 목록” 요청은 LLM 없이 결정적으로 응답(`diag.mode=instructors_list`), 짧은 permalink(`https://cafe.naver.com/<post_id>`)는 SSOT cafe_url로 보정해 링크 깨짐을 방지.
- 2025-12-14: Web 바인딩 옵션 추가 — `windows/start_web.ps1`에 `-Hostname` 옵션을 추가(기본 `::`, IPv6 dual-stack)하여 `localhost`(::1) / `127.0.0.1` 모두에서 UI가 열리게 함. VM/다른 기기에서 접근이 필요하면 `0.0.0.0`(IPv4) 또는 `::`(IPv6)으로 바인딩을 열 수 있음. `windows/start_all.ps1`도 `-WebHostname`을 전달하도록 정렬.
- 2025-12-13: `!welcome:test` 가시성 개선 — SAFE_MODE/allowlist로 발신이 차단된 경우에도 드라이런 이벤트를 기록해 “왜 반응이 없었는지”를 대시보드/로그에서 확인 가능.
- 2025-12-13: Welcome 템플릿 세트 + 카카오 기본닉 분기 도입 — `runtime.json.welcome.templateSets`(기본닉/커스텀 세트) + `templateSetPick=random` + `kakaoDefaultNicknameRegexes`(필수, 니니즈/춘식이/죠르디 등 확장)로 세트를 선택(폴백 금지, ADR-0022).
- 2025-12-13: 멘션(카카오톡 @태그) 지원 — 텍스트의 `@이름`만 보내는 방식이 아니라 `attachment.mentions` 기반으로 실제 멘션이 동작하도록 발신 경로를 보강하고, SAFE_MODE=true에서는 서버 단에서 최종 403으로 차단되도록 가드레일을 추가.
- 2025-12-13: “로그가 안 올라옴/봇이 죽어있음” 재발 방지 — Node `MessageStore`의 디스크 기록을 동시성 제한(`MESSAGE_STORE_PERSIST_CONCURRENCY`)으로 직렬화해 EMFILE(too many open files) 리스크를 낮추고, `status.json`은 원자적 갱신(.bak)으로 0-byte 파일 잔존을 방지. FastAPI `/status`의 logStore는 Windows 디렉터리 mtime 비신뢰 문제를 피하도록 “최근 N일 날짜 로그 파일 stat” 기반으로 정확도 개선.
- 2025-12-15: EMFILE 재발/자동복구 안정화 — `MessageStore`의 기본 동시성을 보수적으로 하향(기본 2)하고, `fs.appendFile`에서 EMFILE 발생 시 백오프 재시도(최대 6회) 후에도 지속되면 `/status`에 플래그로 노출 및 watchdog가 봇 재시작으로 복구하도록 정렬. `windows/start_bot.ps1`는 `MESSAGE_STORE_PERSIST_CONCURRENCY` 기본값을 2로 둔다. (ADR-0031)
- 2025-12-15: 공지(Announcement) 운영성 복구 — `/announcement` UI 저장이 실제 `runtime.json`에 반영되도록 Realtime API `POST /runtime`가 `announcement` 설정을 정식 수용. 대량 공지 시 동일성 리스크 완화를 위해 `appendTargetIndex`(+`targetIndexStart`)로 타겟별 끝 번호 옵션 제공, 실패 타겟 추적을 위해 Talk-API 로그에 `roomId`를 포함.
- 2025-12-13: Watchdog 자동 복구 도입 — `windows/watchdog.ps1`가 `/status` 기반으로 bot/logStore 이상을 감지해 **봇 자동 재시작**(사유/쿨다운 포함 로그 기록)하고, API 자체 다운 시 `windows/start_all.ps1`로 **파이프라인 자동 재가동**. `windows/start_all.ps1`는 기본으로 watchdog를 백그라운드 실행하며 필요 시 `-NoWatchdog`로 비활성화.
- 2025-12-13: Web 운영 안정화 — Next.js 운영은 `next start`(prod)로 고정하고(distDir `.next-prod`), watchdog가 `/api/ping` 헬스체크 실패 시 web만 자동 재시작(반복 실패 시 CleanBuild).
- 2025-12-13: KB 서비스(:8610) 기동 실패 해결 — SQLAlchemy 1.4 환경에서 `postgresql+psycopg` dialect 로딩이 실패(NoSuchModuleError)하는 문제를 피하기 위해 기본 `DATABASE_URL`을 `postgresql+psycopg2://...`로 정렬(`kb/db.py`, `windows/kb_service.ps1`, `windows/kb_task_runner.ps1`). `windows/kb_service.ps1` 실행 시 `/health` 200으로 READY 확인.
- 2025-12-13: Welcome 세트 운영 UX/가시성 강화 — `/settings`에서 세트/정규식 편집을 칩 기반으로 단순화하고 템플릿 미리보기(이미지 포함) + 닉네임 판별 테스트 + **welcome 딜레이(3~5초) 설정**을 제공. Node 발신 유틸에서 SAFE_MODE를 재차 강제하고, 이미지 “URL 텍스트 폴백”을 제거하며(welcome/announcement), 신규입장 welcome은 딜레이 윈도우 내 합류자를 묶어 처리(다중 멘션)하고 `messageStore`에 `welcome_sent` 이벤트로 기록해 UI 로그에서 선택된 템플릿을 확인 가능.
- 2025-12-13: Welcome 기본 템플릿 차단 — IRIS 기본 제공/레거시 welcome 템플릿(숫자 `"1"`, `"2"`, `welcome_default_*`)은 자동 선택 경로에서 차단하여, 운영자가 지정한 템플릿만 발송되도록 강제(ADR-0022 보강).
- 2025-12-13: KB 다운 자동 복구 — FastAPI `/status`에 KB stage(`kb`)를 추가하고, `windows/watchdog.ps1`가 KB가 꺼진 것을 감지하면 `windows/kb_service.ps1`로 **KB만 우선 재기동**(실패 시 전체 재기동).
- 2025-12-14: 운영 안정화 보강 — `windows/start_all.ps1`가 bot 빌드 스킵을 “src 변경 없음”일 때만 허용(구버전 dist로 무응답되는 케이스 방지). 로컬 welcome 템플릿/`runtime.json`의 차단 이름(`"1"`, `"2"`, `welcome_default_*`)을 `welcome_kakao_default_*`로 마이그레이션해 ADR-0022 차단 정책을 유지하면서 템플릿 세트가 정상 동작하도록 정리. `windows/kb_task_runner.ps1`는 env 로딩을 dot-source로 단순화해 단독 실행 호환성 개선.
- 2025-12-14: 오픈채팅 명령 안정화 — `?디하클` 접두어는 `? 디하클` 같은 공백 변형도 허용(문자열 맨 앞 조건은 유지), KB `/ask_llm` 호출은 일시 네트워크/5xx 실패 시 짧은 재시도, `!welcome:test`는 이미지 전송 실패가 있어도 텍스트 발송이 성공했으면 사용자에게 오류 메시지를 추가로 보내지 않음. 또한 `docs/kb_glossary.md`에 신청 게시판 SSOT(무료특강 23 / 정규강의 42)를 명시.
- 2025-12-14: Welcome 후속 답장(첫 이미지) 도입 — welcome 텍스트 발신 성공 이후 입장자를 windowMs(후속 추적 시간) 동안 추적해 “첫 이미지”에 1회 reply(랜덤 문구)로 “감사/소통 안내”를 자동 발송. 방별로 `features[roomId].welcomeFollowUp=false`로 비활성 가능(기본 ON, ADR-0026).
- 2025-12-18: Welcome 후속(첫 이미지) 정책 조정 — windowMs 기본값을 15분(900000ms)으로 변경하고, 15분 내 첫 이미지 미업로드 시 1회 추가 멘션 경고를 발신(템플릿: `runtime.json.welcome.followUp.timeoutMention.text`, ADR-0026).
- 2025-12-14: Talk-API Reply(type=26) 실패(-203) 해결 — Node는 64-bit userId(2^53 초과)를 안전하게 다루기 위해 reply attachment의 `src_userId/src_linkId/src_type`를 문자열로 전달하고, Realtime API(`server/app.py`)에서 `type=26`일 때 숫자형 문자열을 int로 강제 변환(coerce) 후 Talk-API로 전달한다(미변환 시 `INVALID_ARGUMENT(-203)` 가능, ADR-0026).
- 2025-12-14: Welcome 배치 동작 정렬 — 딜레이 윈도우 내 연속 입장자는 set-mode(기본닉/커스텀닉 세트)에서도 welcome을 **한 번만** 발신하고, 멘션은 입장자 전원을 포함한다. 템플릿 선택은 가능하면 커스텀닉 기준으로 우선 선택해 “기본닉 변경 유도” 문구가 섞이지 않도록 한다(ADR-0022).
- 2025-12-14: Welcome 템플릿 이미지 발신 복구 — welcome-worker가 템플릿 이미지(`/templates/assets/...`)를 base64로 변환해 Realtime API의 `/send/iris/reply_media` 경유로 IRIS `/reply`에 전달하여 발신한다. SAFE_MODE=true면 서버가 403으로 최종 차단한다(ADR-0030).
- 2025-12-15: Welcome-worker 안정화 — 중복 실행을 락 파일(`node-iris-app/data/locks/welcome_worker.lock`)로 차단하고, SSE(`/logs/stream`) 연결을 TTL(기본 60초, `WELCOME_WORKER_STREAM_TTL_MS`)로 주기 재연결해 설정 변경(allowlist 등)이 재기동 없이도 반영되도록 보강. 또한 welcome 스킵 사유(`ROOM_NOT_ALLOWED`, `WELCOME_DISABLED`)를 로그로 남겨 운영 디버깅 가시성을 개선.
- 2025-12-14: KB 임베딩 안정화 — `kb/update_embeddings.py`에서 chunk sub-batch + pause를 도입해 429로 embed 작업이 반복 실패하던 케이스를 완화하고, 누락 임베딩(post/manual)이 자동으로 0개로 수렴하도록 보강.
- 2025-12-14: 엔티티/메타 회귀 수정 — `_extract_entity_keywords`가 `config/entities_dinohighclass.json`의 name/aliases를 우선 매칭해 “마케터 제이”처럼 띄어쓰기 변형에서도 primary 엔티티가 흔들리지 않게 보강. 또한 `말이야/알아?` 같은 약한 소개 문장도(SSOT 엔티티일 때만) `entity_intro`로 처리해 LLM 환각을 차단. “왜 기억 못해/왜 까먹어” 류는 `bot_memory`로 시스템 동작을 결정적으로 안내(필요 시 근거 링크 함께 제공).
- 2025-10-28: IRIS 엔드포인트 캡처 작업이 장비 미제공으로 보류됨(`docs/journal/2025-10-28-iris-endpoint-check.md` 기록) 및 보안 지침 초안 작성(`docs/ops/security-guidelines.md`).
- 2025-10-28: 루팅 안드로이드 + Hyper-V 리눅스 구조 채택, 설치 가이드 `docs/setup/iris-hyperv.md` 반영.
- 2025-10-28: IRIS 봇 엔트리 재구성(명령어·방송·환영 통합) 및 Playwright 상세 재시도 파라미터 도입.
- 2025-10-28: Playwright 재수집(31건) 및 `docs/ops/iris-usage-manual.md`/`docs/ops/feature-design.md` 업데이트, 상세 본문 수집 한계(3건) 이슈 기록.
- 2025-10-28: IRIS 가이드 게시판 Playwright 수집 및 `docs/ops/iris-usage-manual.md` 초안 작성.
- 2025-10-27: IRIS 이벤트 스켈레톤 및 파일 로그 스토어 작성, dry-run으로 샘플 로그 검증.
- 2025-10-27: PRD 및 로드맵에 핵심 요구사항 상세화 반영.
- 2025-10-27: PC UIA 대신 LDPlayer+IRIS 채택 (ADR 0001). ※ 2025-10-28 기준 폐기, ADR 0002로 대체.
- 2025-10-27: 새 저장소 구조 수립, 문서 골격/스크립트/설정 디렉터리 생성.

- 2025-12-14: 코어(LogStore) 상시 가동 + 기능 워커 분리(Welcome 1차) ? welcome은 bot에서 기본 발신하지 않고 `welcome-worker`가 `/logs/stream` 구독 후 Talk-API로 발신(후속 Reply 포함). 기본값 `WELCOME_DISPATCHER=worker`, 롤백은 `WELCOME_DISPATCHER=bot`. (ADR-0027, `docs/ops/core-feature-split-plan.md`)
- 2025-12-14: AI 응답 워커 분리 — `?디하클` 질의 처리를 bot에서 분리하고 `ai-worker`가 `/logs/stream` 구독 후 KB 호출(`/ask_llm`) + Talk-API 발신(`/send/talkapi/dispatch`)을 담당. 기본값 `AI_DISPATCHER=worker`, 롤백은 `AI_DISPATCHER=bot`. (ADR-0028)
- 2025-12-14: 공지/브로드캐스트 워커 분리 — 공지 복제/브로드캐스트 큐 발신을 `broadcast-worker`로 분리하고, 이미지 복제를 위해 `/logs/stream`에 `imageUrls`(최소 필드) 노출을 추가. 기본값 `ANNOUNCEMENT_DISPATCHER=worker`, `BROADCAST_DISPATCHER=worker`. (ADR-0029)
- 2025-12-14: Windows 재기동 안정화 — PowerShell `$PID/$pid` 충돌로 인한 기동 실패를 제거하고(`windows/start_welcome_worker.ps1`), `windows/start_all.ps1`의 pre-clean이 상대경로로 실행된 bot/worker(`dist/index.js`, `dist/workers/welcome_worker.js`)도 정리하도록 보강. 또한 `windows/start_web.ps1`에서 Next 종료를 선행하고 로그 로테이션을 재시도해(WinError 32) 전체 재기동이 안정적으로 완료되도록 개선.
- 2025-12-14: RAG `price_policy` 결정적 답변은 근거로 사용하지 않은 게시글/링크를 응답에 섞지 않도록(`posts`, `selected_posts`, `link_hint` 비움) 처리(오답 링크/중복 링크 방지).
- 2025-12-14: 일반 상식(웹 검색) 경로에서 유튜브 수익창출(YPP) 질문은 공식 도메인(support.google.com/youtube.com) 근거가 우선 노출되도록 프롬프트 규칙을 강화.
- 2025-12-14: KB 스케줄러가 작업 lock의 PID 확인에 실패할 때(권한/일시 오류 등) “실행 중”으로 고정되어 재개가 막히지 않도록, 확인 실패 시 재개 우선(False)으로 처리.
- 2025-12-19: EMFILE 재발 원인 확정 및 핫픽스 — `@tsuki-chat/node-iris` Logger가 인스턴스마다 winston File transport를 생성해 `logs/app.log`/`logs/error*.log` 핸들이 누수되었고, 공유 winstonLogger(transport 단일) 방식으로 핫픽스해 누수를 차단. 재설치 대비로 `patch-package`를 도입해 `postinstall`에서 자동 재적용, `@tsuki-chat/node-iris`는 `1.6.41`로 버전 고정. (ADR-0042)
- 2025-12-19: Welcome 업그레이드 — 오픈프로필(별도 프로필) 참여자에게 “닫기 안내 + 가이드 이미지 3장”을 발송하고, 기본닉 신규 입장자에 대해 “5분 내 미변경 시 1회 리마인더”를 추가. (ADR-0043)

## 기술 결정 요약
| 날짜 | 결정 | 참고 |
| --- | --- | --- |
| 2025-12-18 | 강의 운영 v2(카페 자동 갱신 + 등급 기반 참여 점검 + 통합 시트) 워커 도입 | `docs/adr/ADR-0039-course-roster-v2-membership-audit.md`, `docs/reference/course-roster-v2-membership-audit.md` |
| 2025-12-18 | roster-worker 카페 데이터 소스 전환: CSV(레거시) → 크롤러(JSON 스냅샷) | `docs/adr/ADR-0040-roster-worker-cafe-snapshot-crawler.md`, `docs/reference/course-roster-worker.md` |
| 2025-12-18 | 운영 안정화: BRIDGE/LOG 상태 분리 + watchdog 보장(Task Scheduler) + Web 빈 화면 방지 | `docs/reference/bridge-status.md`, `docs/adr/ADR-0023-watchdog-auto-restart.md`, `docs/adr/ADR-0025-web-prod-mode-and-watchdog-web-health.md` |
| 2025-12-18 | 카카오 기본 닉네임 변경 요청(멘션) 워커 도입 | `docs/adr/ADR-0041-default-nickname-reminder-mentions.md` |
| 2025-12-19 | node-iris Logger 파일 핸들 누수(EMFILE) 핫픽스 | `docs/adr/ADR-0042-node-iris-logger-handle-leak-emfile-hotfix.md` |
| 2025-12-19 | Welcome: 오픈프로필 닫기 안내 + 5분 기본닉 닉네임 변경 리마인더 | `docs/adr/ADR-0043-welcome-open-profile-guide-and-5m-nickname-reminder.md` |
| 2025-12-19 | 운영: Watchdog hung 방지 + UI에서 Watchdog/워커 재시작 | `docs/adr/ADR-0023-watchdog-auto-restart.md`, `docs/agents.md` |
| 2025-12-19 | 공지: 이미지 전파 “성공 보고/실제 미발신” 핫픽스(에코 확인 + 배치 전송 + 재시도 + 결과 포맷 개선) | `docs/adr/ADR-0029-broadcast-worker-from-logstream.md`, `docs/agents.md` |
| 2025-12-15 | Talk-API 실패 시 IRIS `/reply` 기반 텍스트 폴백(워커/명령) | `docs/adr/ADR-0034-worker-send-fallback-iris-reply-text.md` |
| 2025-12-15 | 오픈채팅 멤버(전체) Sheets 자동 동기화 워커 추가 | `docs/adr/ADR-0033-openchat-members-sheets-worker.md` |
| 2025-12-15 | MessageStore EMFILE(too many open files) 완화 및 자동복구 정렬 | `docs/adr/ADR-0031-messagestore-emfile-mitigation.md` |
| 2025-12-14 | Welcome 후속(첫 이미지) 자동 답장(Reply) 도입 | `docs/adr/ADR-0026-welcome-followup-first-image-reply.md` |
| 2025-12-14 | Talk-API Reply(type=26) src_* 타입 강제 변환(-203 방지) | `docs/adr/ADR-0026-welcome-followup-first-image-reply.md`, `server/app.py` |
| 2025-12-14 | Welcome 배치: 다중 입장자 1회 환영 + 멀티 멘션 | `docs/adr/ADR-0022-welcome-template-sets-and-kakao-default-nickname.md` |
| 2025-12-14 | 코어(LogStore) 상시 가동 + 기능 워커 분리(Welcome 1차) | `docs/adr/ADR-0027-core-logstore-and-feature-workers.md`, `docs/ops/core-feature-split-plan.md` |
| 2025-12-14 | AI 응답을 ai-worker로 분리 | `docs/adr/ADR-0028-ai-worker-from-logstream.md` |
| 2025-12-14 | 공지/브로드캐스트 발신을 broadcast-worker로 분리 | `docs/adr/ADR-0029-broadcast-worker-from-logstream.md` |
| 2025-12-14 | Welcome-worker 템플릿 이미지 발신 복구(IRIS /reply) | `docs/adr/ADR-0030-welcome-worker-image-send-via-iris-reply.md` |
| 2025-12-14 | 강의 운영(카페/닉네임 검증) roster-worker 도입(15분/24시간 안내 + Sheets 업서트) | `docs/adr/ADR-0032-course-roster-worker.md` |
| 2025-12-13 | Welcome 템플릿 세트 + 기본닉 분기 정책 도입 | `docs/adr/ADR-0022-welcome-template-sets-and-kakao-default-nickname.md` |
| 2025-12-13 | `/status` 기반 watchdog 자동 재시작 도입 | `docs/adr/ADR-0023-watchdog-auto-restart.md` |
| 2025-12-13 | Talk-API authHeader 캡처(Frida) 및 저장/반영 가드레일 | `docs/adr/ADR-0024-talkapi-authheader-capture.md` |
| 2025-12-13 | Next.js Web 운영(prod) 고정 + web 헬스체크 재시작 | `docs/adr/ADR-0025-web-prod-mode-and-watchdog-web-health.md` |
| 2025-10-28 | 루팅 안드로이드 + Hyper-V 리눅스 + IRIS 구조 채택 | `docs/adr/ADR-0002-adopt-rooted-android-hyperv.md` |
| 2025-10-27 | (폐기) LDPlayer + IRIS 채택 | `docs/adr/ADR-0001-adopt-iris-ldplayer.md` |
| 2025-10-27 | SSOT/PRD/ADR 업데이트 프로세스 정의 | 이 문서, `agents.md` |

## 미완료 사항
- Hyper-V VM ↔ 루팅 단말 간 엔드포인트 검증 및 캡처 확보 (대시보드, `/config`, `/reply` 응답).
- 루팅 단말 보안 지침 및 분실 대응 절차 수립.
- IRIS WebSocket 상시 연결 및 오류 복구 경로 검증 (실서버 엔드포인트 필요).
- 닉네임 감지 자동화 통합 테스트 및 운영 배포 플로우 정리 (`tests/test_iris_connection.py` 보강).
- IRIS API 인증 값 확보 및 브로드캐스트 스케줄러 실환경 검증 (URL/토큰/테스트 방 ID 필요).
- 로그 표준 및 운영 지침 문서화 (`docs/ops/log-format.md`, `docs/ops/status-check.md`).
- 운영 자동화 고도화(부팅 시 자동 기동/스케줄드 태스크) 및 재기동 로직 확장 (`windows/watchdog.ps1` 1차 완료, 서비스화는 미완료).
- Playwright 상세 본문 수집 실패(iframe 로딩) 재현 및 안정화 전략 수립 (`scripts/iris_board_collector.py` 재시도 옵션 검토).

## 업데이트 지침
- **주요 작업 완료 혹은 의사결정 직후**, 해당 내용과 날짜를 위 표 또는 히스토리 섹션에 추가한다.
- 새로운 결정일 경우 ADR을 작성하고 여기서 링크를 갱신한다.
- 범위/요구 변경 시 PRD 수정 후 `최근 히스토리`에 기록한다.

### 업데이트 트리거 체크리스트
- 기능/스크립트/테스트 구현이 완료되었을 때 (코드 변경).
- 의존성, 환경 변수, 인프라 설정이 바뀌었을 때.
- 제품 범위/우선순위/로드맵이 조정되었을 때.
- 리스크·장애·회고에서 새 인사이트가 발견되었을 때.

### 업데이트 절차
1. `docs/sessions/<branch>.md`에 세션 로그를 남기면서 변경 요약을 기록한다.
2. SSOT 히스토리/결정 표를 업데이트하고 관련 문서 링크를 추가한다.
3. 추가 ADR/PRD/로드맵 수정이 필요하면 동시 반영하고, `docs/todo.md`에 후속 액션을 적는다.
4. PR 작성 전 SSOT와 Agents 체크리스트를 다시 확인하여 누락된 항목이 없는지 검증한다.

## 다음 점검 예정
- 2025-10-29: Hyper-V VM ↔ Iris 엔드포인트 호출 캡처 (`curl`, `/reply`) 확보.
- 2025-10-29: 루팅 단말에서 `iris_control status` 및 `/dashboard` 스크린샷 확보.
- 2025-10-29: IRIS 이벤트 스켈레톤에서 메시지 로그 생성 여부 확인.
- 2025-10-31: Phase 0 마일스톤 리뷰 및 문서 싱크 점검.
