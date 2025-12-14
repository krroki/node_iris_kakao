## Quick Index
- 2025-12-09 19:10 [kb][rag][bot] /ask_llm 도메인 라우팅·컨텍스트 태그 정렬 및 일반 상식 경로 하드닝
- 2025-12-08 14:50 [kb][scheduler][rag] KB 수집/임베딩 스케줄 기본값 정렬 및 신선도 점검 루틴 추가
- 2025-12-07 23:40 [docs][ops][ui] WSL 기반 Realtime Quickstart 레거시화 및 Windows 런북 정렬
- 2025-12-07 11:20 [server][bot][logs] SAVE_CHAT_LOGS 기본값/상태 API(logStore) 하드닝
- 2025-12-06 23:30 [kb][rag] 일반 상식 경로 프리픽스 강제 및 URL 차단
- 2025-11-27 17:20 [kb][menus] dinohighclass KB 대상 메뉴 재정의 (무료/정규 신청 포함)
- 2025-11-27 16:17 [ops][bot][ui] 遊??ш???????쒕낫??湲곕룞 (IRIS 誘몄쓳??
- 2025-11-25 15:55 [ops][cleanup] talkapi 罹≪쿂/?좏겙 ?ㅽ겕由쏀듃 ?꾨웾 ?쒓굅
- 2025-11-25 15:35 [ops][realtime][roster] IRIS DB 湲곕컲 ? ?ㅻ깄??+ ?대쭅 ?ㅽ겕由쏀듃 異붽?
- 2025-11-25 15:10 [ops][realtime][roster] ?ㅼ떆媛??ㅽ뵂梨꾪똿 ?됰꽕??由ъ뒪???섏쭛 ?ㅽ겕由쏀듃 異붽?
- 2025-11-25 13:35 [kb][crawl] dinohighclass 湲곗궗 蹂몃Ц 500 ?ㅻ쪟 ?닿껐 諛?猷??뺤젙
- 2025-11-25 00:05 [kb][ops][crawl] dinohighclass 硫붾돱 留?異붿텧쨌湲곕낯 ???異붿쿇 ?ㅼ젙
- 2025-11-24 23:58 [kb][data][ops] ???移댄럹 dinohighclass濡??쒖젙 諛??섑뵆 ?곗씠???뺣━
- 2025-11-24 23:46 [kb][data][search] ?섑뵆 KB ?곗씠???곸옱 諛?寃??荑쇰━ 罹먯뒪???섏젙
- 2025-11-24 23:35 [kb][embed][docs] KB 留ㅻ돱???꾨쿋???뚯씠?꾨씪???뺣퉬
- 2025-11-24 17:35 [bot][ops][talkapi] 硫섏뀡 寃쎈줈 ?붾쾭源?濡쒓렇 異붽? 諛??ы듃?꾨줉???ъ꽕??- 2025-11-21 16:05 [ui][ops] 湲곕뒫蹂?愿由?????ㅻ쪟 ?섏젙 (runtime API ?꾨줉??
- 2025-11-21 15:55 [bot][ops][safety] ?뚯뒪?몃갑 ID ?뺤젙 諛?!而ㅻ㎤??媛??異붽?
- 2025-11-21 20:15 [bot][ops][safety] ?뚯뒪?몃갑 ?쒖젙 ?≪떊 媛???뺣퉬
- 2025-11-20 14:26 [ui][ops] Next.js ?ы듃 3100?쇰줈 ?섏썝
- 2025-11-20 15:05 [ui][api] /api/runtime POST ???濡쒖쭅 異붽?
- 2025-11-18 13:02 [server][ui][ops] Realtime API 8650 ?ы듃 ?섏썝 + 24h 濡쒓렇 ?숇벑??蹂듦뎄

### [2025-12-07 23:40 KST] [docs][ops][ui] WSL 기반 Realtime Quickstart 레거시화 및 Windows 런북 정렬
- Summary: Windows 전용 스택(ADR-0010)과 상태/룸 API 단일화(ADR-0017)에 맞춰, 여전히 WSL + `scripts/serve_web.sh` 조합을 기본값처럼 안내하던 문서를 레거시로 명시하고, 운영 기준을 `windows/start_all.ps1` / `windows/start_web.ps1` / `windows/start_api.ps1` 중심으로 정리했습니다.
- Why(근본 원인):
  - AGENTS/CLAUDE 문서에서는 이미 `scripts/serve_web.sh`를 “폐기된 명령어(사용 금지)”로 정의하고 Windows 전용 스택을 표준으로 삼고 있었으나,
  - 일부 ops/setup 문서와 README가 여전히 WSL + Streamlit/Next.js 구성을 기본 Quickstart로 안내하고 있어, 신규 세션에서 잘못된 명령을 실행할 위험이 있었습니다.
- What(무엇을 바꿈):
  - `scripts/serve_web.sh` 상단에 **DEPRECATED** 주석을 추가해, Windows 스택에서는 사용하지 말고 PowerShell 스크립트를 따르도록 명시했습니다.
  - `docs/ops/realtime_api.md`에서
    - Realtime API 포트를 8650 기준으로 정리하고,
    - 개발용 uvicorn 실행 예시를 Windows/WSL 공통 형식으로 갱신했으며,
    - UI 연동 섹션을 Windows PowerShell 스크립트 중심으로 재작성하고, WSL + `serve_web.sh`/`serve_ui.sh` 조합은 레거시로 분리했습니다.
  - `docs/setup/realtime_quickstart.md`에 “WSL + Streamlit 구성은 레거시”라는 경고를 추가하고, 본 문서가 실험용/참고용임을 명시했습니다.
  - `README.md` 상단에 이 문서가 WSL + Streamlit 기준 레거시 README임을 알리는 경고 블록을 추가하고, 최신 구조는 agents/CLAUDE/ARCHITECTURE/ops 런북을 우선 참고하도록 안내했습니다.
- Files: `scripts/serve_web.sh`, `docs/ops/realtime_api.md`, `docs/setup/realtime_quickstart.md`, `README.md`, `docs/CHANGELOG.md`
- Verify:
  - 문서 링크 기준으로 Next.js/Realtime API 실행 절차가 Windows PowerShell 스크립트 중심으로 일관되게 안내되는지 확인.
  - `rg "serve_web.sh" docs README.md`로 검색했을 때, 남아 있는 참조가 모두 “레거시/사용 지양” 맥락인지 검토.
- Rollback: `git checkout -- scripts/serve_web.sh docs/ops/realtime_api.md docs/setup/realtime_quickstart.md README.md docs/CHANGELOG.md`

### [2025-12-08 14:50 KST] [kb][scheduler][rag] KB 수집/임베딩 스케줄 기본값 정렬 및 신선도 점검 루틴 추가
- Summary: 최근 무료 특강/정규 강의가 카페에는 존재하는데 KB RAG에서 “정보 없음”으로 응답한 원인이, KB 서비스를 `windows/start_all.ps1`가 아닌 다른 경로로 기동해 `KB_SCHED_*`가 비어 있고 수집/임베딩 스케줄이 멈춰 있었기 때문임을 확인하고, Windows 스크립트/문서 전반을 정리해 같은 문제가 반복되지 않도록 했다.
- Why(근본 원인):
  - `kb_status.py` 기준으로 무료 특강(23)/정규 강의(42) 메뉴의 최근 수집 시각이 각각 6일/4일 전으로, KB DB가 카페 실데이터보다 최대 6일 뒤처져 있었다.
  - KB in-process 스케줄러는 `KB_SCHED_COLLECT_MIN` 등 환경변수가 0/미설정인 경우 완전히 비활성화되는데, `windows/kb_service.ps1`로 KB만 단독 실행할 때 이 값들을 채워주지 않아 `/schedule`이 전부 0으로 남아 있는 세션이 있었다.
  - 이 상태에서 RAG는 “어제 무료강의 있었어?” 같은 질문에 대해 실제 카페에 강의가 있어도 “어제 날짜의 글이 없다”고 판단하고 `정보 없음`으로 응답했다.
- What(무엇을 바꿈):
  - `windows/kb_service.ps1`:  
    - KB 서비스 기동 시 `KB_SCHED_COLLECT_MIN`/`KB_SCHED_EMBED_MIN`/`KB_SCHED_MANUAL_MIN`/`KB_SCHED_BACKFILL_MIN` 기본값(30/30/60/60분)을 설정하도록 추가했다.  
    - 이미 환경변수나 .env에서 값을 명시한 경우에는 그대로 존중하고, 비어 있을 때만 기본값을 채우도록 구현했다.  
    - `windows/start_all.ps1`와 동일한 스케줄 정책을 단독 KB 기동에도 적용해, 공식 스크립트로 시작하는 한 스케줄이 꺼진 상태로 올라오지 않도록 했다.
  - `docs/reference/verification-commands.md`:  
    - KB/RAG 섹션에 `python scripts/kb_status.py`를 추가해, 메뉴별 최신 글 날짜·임베딩 개수·스케줄 상태(`/schedule`)를 한 번에 보는 신선도 점검 루틴을 문서화했다.
  - `agents.md` / `CLAUDE.md`:  
    - 테스트 & 품질 게이트에 “KB/RAG – kb_status.py로 수집 최신일과 스케줄 상태를 확인하고, 무료 특강(23)/정규 강의(42)가 2일 이상 비어 있으면 먼저 수집/임베딩 스케줄을 조사한다”는 항목을 추가했다.
    - KB 서비스는 `windows/start_all.ps1` 또는 `windows/kb_service.ps1`로만 기동하고, 직접 `uvicorn kb.service:app`를 띄우는 것은 금지(지원 대상 아님)라는 불변식을 명시했다.
  - `scripts/quick_call_ask_llm.py`:  
    - 단발 질문을 /ask_llm로 보내고 실제 answer/선택 게시글을 출력하는 헬퍼 스크립트를 추가해, “어제 무료강의 있었어?”/“어제 무료강의 신청하려면 어떻게 해야해?”와 같은 회귀 사례를 재현·검증할 수 있게 했다.
- Files: `windows/kb_service.ps1`, `docs/reference/verification-commands.md`, `agents.md`, `CLAUDE.md`, `scripts/quick_call_ask_llm.py`, `docs/CHANGELOG.md`
- Verify:
  - KB 서비스를 `windows/start_all.ps1` 또는 `windows/kb_service.ps1`로 기동 후 `/schedule` 호출 시 collect/embed/manual/backfill interval이 기본값(30/30/60/60분)으로 설정된 것을 확인.
  - `python scripts/kb_status.py` 실행 시, 향후에는 무료 특강(23)/정규 강의(42)의 최근 수집 시각이 장기간(2일 이상) 정체되지 않는지 주기적으로 점검.
  - `python scripts/quick_call_ask_llm.py "어제 무료강의 있었어 ?"` 등으로 질문을 던졌을 때, 실제로 해당 날짜 데이터가 DB에 존재할 경우에는 RAG가 더 이상 “정보 없음”만 반환하지 않는지 확인.
- Rollback: `git checkout -- windows/kb_service.ps1 docs/reference/verification-commands.md agents.md CLAUDE.md scripts/quick_call_ask_llm.py docs/CHANGELOG.md`

### [2025-12-07 11:20 KST] [server][bot][logs] SAVE_CHAT_LOGS 기본값/상태 API(logStore) 하드닝
- Summary: 봇은 메시지를 받는데 대시보드 로그가 멈춰 보일 수 있는 구조적 위험을 줄이기 위해, SAVE_CHAT_LOGS 기본값을 항상 true로 고정하고 `/status`의 logStore 스테이지가 봇 이벤트와 로그 파일 타임라인을 비교하도록 강화했습니다.
- Why(근본 원인):
  - `SAVE_CHAT_LOGS=false`가 기본값이고, 시작 스크립트에서 이를 강제하지 않아 **로그가 꺼진 채로 봇이 뜨는 세션**이 존재할 수 있었습니다.
  - FastAPI `/status`의 logStore 스테이지가 `status.json.lastEventTs`를 기준으로 판단해, 실제 로그 파일이 갱신되지 않아도 ok로 보이는 설계였습니다.
- What(무엇을 바꿈):
  - `node-iris-app/src/app.ts`: `SAVE_CHAT_LOGS`가 지정되지 않은 경우 `saveChatLogs=True`를 기본값으로 사용하고, `"false"`일 때만 비활성화하도록 수정했습니다.
  - `node-iris-app/.env.example`: 운영 기본값을 `SAVE_CHAT_LOGS=true`로 변경하고, 테스트 환경에서만 false를 허용한다는 주석을 추가했습니다.
  - `node-iris-app/.env`(로컬): 현재 세션 기준으로 `SAVE_CHAT_LOGS=true`로 정렬했습니다.
  - `windows/start_bot.ps1`: IRIS_URL을 설정한 뒤, `SAVE_CHAT_LOGS`가 비어 있으면 `'true'`로 강제 설정하도록 추가했습니다.
  - `server/app.py`: `/status`의 `_log_stage()`에서
    - `status.json.lastEventTs`는 “봇 이벤트 타임라인”만 판단에 사용하고,
    - 실제 로그 신선도는 `logs_dir` 내 로그 파일 mtime 기준으로만 계산하도록 변경했습니다.
    - `lastEventTs`는 최근인데 로그 mtime이 60초 이상 뒤처져 있으면, `logStore.ok=False` 및 `"로그 파일 업데이트가 지연되고 있습니다 (SAVE_CHAT_LOGS 설정 또는 디스크/권한 문제를 확인하세요)."` 메시지를 반환하도록 했습니다.
  - `tests/test_log_pipeline_status.py`: IRIS_LOGS_DIR를 임시 디렉터리로 바인딩해,
    - 최근 로그가 존재할 때 `logStore.ok=True`인 케이스와,
    - `lastEventTs`는 현재, 로그 mtime은 30분 전인 경우 `logStore.ok=False`가 되는 케이스를 회귀 테스트로 추가했습니다.
- Files: `node-iris-app/src/app.ts`, `node-iris-app/.env.example`, `node-iris-app/.env`, `windows/start_bot.ps1`, `server/app.py`, `tests/test_log_pipeline_status.py`, `docs/adr/ADR-0019-log-pipeline-hardening.md`, `docs/CHANGELOG.md`
- Verify:
  - `pytest tests/test_log_pipeline_status.py -q` 로 logStore 스테이지 회귀 테스트 2건 통과 확인.
  - `powershell -File windows/start_bot.ps1 -IrisUrl http://127.0.0.1:5050` 로 봇 재기동 후, 실제 채팅을 보냈을 때 `curl http://127.0.0.1:8650/logs?limit=5` 와 `curl http://127.0.0.1:8650/status`의 logStore.timestamp가 모두 최근 시각으로 갱신되는지 확인.
- Rollback: `git checkout -- node-iris-app/src/app.ts node-iris-app/.env.example windows/start_bot.ps1 server/app.py tests/test_log_pipeline_status.py docs/adr/ADR-0019-log-pipeline-hardening.md docs/CHANGELOG.md`
- Links: `docs/adr/ADR-0019-log-pipeline-hardening.md`

### [2025-12-06 23:30 KST] [kb][rag] 일반 상식 경로 프리픽스 강제 및 URL 차단
- Summary: KB 일반 상식 경로에서 LLM이 지침을 어겨도 항상 동일한 프리픽스로 시작하고, 외부 URL이 포함되지 않도록 방어 로직을 추가했습니다.
- Why(근본 원인): 카페와 무관한 질문에 대해 RAG 대신 일반 상식 경로를 사용하지만, 실제 응답에서 프리픽스가 누락되거나 LLM이 외부 URL을 끼워 넣는 경우가 있어 품질과 일관성이 깨졌습니다.
- What(무엇을 바꿈):
  - `kb/service.py`의 `_build_general_answer`에 `GENERAL_PREFIX` 상수를 도입하여, 응답이 항상 `가이드라인에는 없지만, 일반 상식으로 답변드립니다.` 문장으로 시작하도록 후처리 로직을 추가했습니다.
  - LLM 출력 앞뒤에 붙는 마크다운/따옴표/공백을 정규화하고, 프리픽스가 없으면 프리픽스를 강제로 선행시키도록 했습니다.
  - 일반 상식 경로 응답에 포함된 `http://`/`https://` 형태의 외부 URL을 정규식으로 제거하여, 카페 KB와 무관한 링크가 노출되지 않도록 했습니다.
  - `python -m compileall kb` 및 더미 클라이언트를 이용한 스모크 스크립트로 `_build_general_answer`의 프리픽스/URL 제거 동작을 검증했습니다.
- Files: `kb/service.py`, `docs/CHANGELOG.md`
- Verify: `python -m compileall kb` 실행 후, 임시 스크립트에서 `kb.service._gemini_client`를 더미 클라이언트로 치환해 `_build_general_answer` 호출 시 항상 프리픽스로 시작하고 URL이 제거되는지 확인.
- Rollback: `git checkout -- kb/service.py docs/CHANGELOG.md`
- Links: `docs/adr/ADR-0018-rag-general-answer-out-of-domain.md`

### [2025-11-27 17:20 KST] [kb][menus] dinohighclass KB 대상 메뉴 재정의
- Summary: KB_MENUS를 무료/정규 신청 포함 11개 메뉴로 재정의하고 collect 플래그를 정리했습니다.
- Why(근본 원인): 강의 신청/후기 메뉴 누락과 불필요 메뉴 포함으로 LLM 근거가 어긋날 위험이 있었기 때문입니다.
- What(무엇을 바꿈): collect=true(23/32/42), collect=false(24/77/165)로 조정; recommended_menu_ids를 23,32,42,33,206,136,51,172,48,62,245로 변경; .env.kb.example KB_MENUS를 동일 목록으로 갱신.
- Files: `config/menus_dinohighclass.json`, `.env.kb.example`
- Verify: `cat config/menus_dinohighclass.json | findstr "recommended_menu_ids"` 로 목록 확인, `.env.kb.example`의 KB_MENUS 확인.
- Rollback: `git checkout -- config/menus_dinohighclass.json .env.kb.example`
- Links: (none)
### [2025-11-27 16:17 KST] [ops][bot][ui] 遊??ш???????쒕낫??湲곕룞 (IRIS 誘몄쓳??
- Summary: SAFE_MODE ?좎? ?곹깭濡?WSL 遊뉗쓣 ?ш린?숉븯怨?Next.js/Realtime API(dev)源뚯? ?щ졇?쇰굹 IRIS 5005媛 ?ロ? ?덉뼱 遊뉗? socket hang up ?ъ떆??以묒씠??
- Why(洹쇰낯 ?먯씤): 遊??곹깭 ?뺤씤 諛???쒕낫??媛???붿껌 ???
- What(臾댁뾿??諛붽퓞):
  - `scripts/start_bot_wsl.sh` ?ㅽ뻾 ??`.env`(SAFE_MODE=true, IRIS_URL=172.19.192.1:5005) ?ъ옉?? 遊?pid 71239 湲곕룞 ??IRIS 誘몄쓳?듭쑝濡??곌껐 ?ъ떆??
  - `nohup ./scripts/serve_web.sh` 諛깃렇?쇱슫???ㅽ뻾 ??Next.js dev on 3100, 理쒖큹 uvicorn? web ?붾젆?곕━ 湲곗? import ?ㅻ쪟濡??ㅽ뙣?섏뿬 猷⑦듃?먯꽌 `uvicorn server.app:app --port 8650` ?ш린??
  - FastAPI `/health` OK(`rooms=65`, bot pid ?쒖떆), SSE 踰좎씠??`http://localhost:8650`.
- Files: `docs/sessions/refactor-fastapi-sse.md`, `logs/bot_wsl.log`, `logs/serve_web.out`, `logs/realtime_api.log`
- Verify: `curl http://127.0.0.1:8650/health` ??200, `ps -ef | grep 'node dist/index.js' | grep -v grep` ??bot pid ?뺤씤, Next dev 濡쒓렇 `Ready` ?뺤씤.
- Rollback: `pkill -f 'node dist/index.js'; pkill -f 'next dev -p 3100'; pkill -f 'uvicorn .*server.app:app'`
- Links: (none)

### [2025-11-25 15:55 KST] [ops][cleanup] talkapi 罹≪쿂/?좏겙 ?ㅽ겕由쏀듃 ?꾨웾 ?쒓굅
- Summary: ?ъ슜?섏? ?딄퀬 ?쇱꽑??二쇰뒗 Talk API 罹≪쿂쨌?좏겙 異붿텧 ?ㅽ겕由쏀듃瑜?紐⑤몢 ??젣?덈떎.
- Why: ?좏겙 罹≪쿂媛 ?숈옉?섏? ?딅뒗 ?섍꼍?먯꽌 ?붿옱 ?ㅽ겕由쏀듃濡??ㅽ빐/?쇱꽑???좊컻.
- What:
  - ??젣: scripts/fetch_talkapi_token.js, capture_talkapi*.ps1, talkapi_capture.sh, orchestrate_capture.ps1,
    hook_capture_auth*.js, hook_interceptor*.js, hook_capture_token.js, pull_kakao_token.js.
- Files: ???ㅽ겕由쏀듃 ?쇱껜 ??젣.
- Verify: git status?먯꽌 ??젣 ?뚯씪 ?뺤씤.
- Rollback: ?꾩슂??寃쎌슦 git checkout -- <??젣???뚯씪>.
### [2025-11-25 15:35 KST] [ops][realtime][roster] IRIS DB 湲곕컲 ? ?ㅻ깄??+ ?대쭅 ?ㅽ겕由쏀듃 異붽?
- Summary: `scripts/live_roster_full.py`濡?IRIS `open_chat_member`瑜?二쇨린 議고쉶???洹쒕え 諛⑹쓽 ?꾩껜 李몄뿬???됰꽕?꾩쓣 利됱떆 ?뺣낫?섍퀬, 利앷컧/?됰????쒖떆?섎룄濡??덈떎.
- Why: join/leave 濡쒓렇留뚯쑝濡쒕뒗 湲곗〈 ?洹쒕え ?몄썝???????놁뼱???꾩껜 ?ㅻ깄?룹씠 ?꾩슂?덈떎.
- What:
  - IRIS `/query`(db2.open_chat_member)濡??꾩껜 roster ?ㅻ깄?? room ?꾪꽣/?좏겙/媛꾧꺽 ?듭뀡 吏??
  - 利앷컧/?됰? diff 異쒕젰, ?⑤컻(`--once`) ?먮뒗 二쇨린??`--interval`) 紐⑤뱶.
- Files: `scripts/live_roster_full.py`
- Verify: `IRIS_BASE_URL=http://127.0.0.1:3000 python scripts/live_roster_full.py --once` 濡?諛⑸퀎 ?몄썝??異쒕젰 ?뺤씤.
- Rollback: `git checkout -- scripts/live_roster_full.py`
### [2025-11-25 15:10 KST] [ops][realtime][roster] ?ㅼ떆媛??ㅽ뵂梨꾪똿 ?됰꽕??由ъ뒪???섏쭛 ?ㅽ겕由쏀듃 異붽?
- Summary: FastAPI 濡쒓렇 ?ㅽ듃由쇱쓣 ?쒖슜??room蹂??꾩옱 李몄뿬???됰꽕?꾩쓣 ?좎?쨌?쒖떆?섎뒗 `scripts/live_roster.py`瑜?異붽??덈떎.
- Why: ?댁쁺?먭? ?ㅼ떆媛?李몄뿬??紐⑸줉???뺤씤?????덈뒗 寃쎈웾 ?꾧뎄媛 ?꾩슂?덈떎.
- What:
  - `scripts/live_roster.py`: `/rooms`濡?roomId ?먮룞 ?먯깋 ??`/logs` ?ㅻ깄??+ `/logs/stream`(join/leave ?꾪꽣)?쇰줈 ?ㅼ떆媛?roster ?좎?.
  - ?섍꼍 蹂??吏?? REALTIME_API_URL, ROOM_IDS; ?곌껐 ?딄? ?먮룞 ?ъ떆??諛?珥덇린 ?ㅻ깄??濡쒕뵫 ?ы븿.
- Files: `scripts/live_roster.py`
- Verify: FastAPI(8600) 湲곕룞 ?곹깭?먯꽌 `python scripts/live_roster.py` ?ㅽ뻾 ??諛??낇눜????異쒕젰 媛깆떊 ?뺤씤.
- Rollback: `git checkout -- scripts/live_roster.py`
### [2025-11-25 13:35 KST] [kb][crawl] dinohighclass 湲곗궗 蹂몃Ц 500 ?ㅻ쪟 ?닿껐 諛?猷??뺤젙
- Summary: articleapi v2.1濡??곸꽭 議고쉶 500 ?ㅻ쪟瑜??닿껐?섍퀬, dinohighclass 硫붾돱 ID/蹂몃Ц 湲몄씠 洹쒖튃??留욎떠 ?섏쭛 ?깃났(51嫄?.
- Why: 湲곗〈 洹쒖튃???ㅻⅨ 移댄럹(board include 遺덉씪移?? 湲몄씠 600?쒗븳?쇰줈 紐⑤몢 ?꾪꽣留? articleapi v2??500??諛섑솚??蹂몃Ц??鍮꾩썙踰꾨┝.
- What:
  - `kb.cafe_api.get_article`: v2.1?뭭2?뭠egacy ?쒖감 ?쒕룄, menuId ?놁씠??200 ?묐떟 ?뺣낫.
  - `config/collect_rules.yaml`: dinohighclass 硫붾돱 11醫낆쑝濡?include 援먯껜, 理쒖냼 湲몄씠 100?쇰줈 ?꾪솕, ?쒕ぉ ?덉슜/蹂몃Ц 湲덉????뺣━.
  - ?ъ닔吏?寃곌낵 `sources_post` 51嫄? `manual_doc` 2嫄? ?꾨쿋???붾? ?앹꽦 ?꾨즺.
- Verify: `select count(*) from sources_post` => 51, `python -m kb.manualize`, `EMBED_PROVIDER=NONE python -m kb.update_embeddings` OK.
- Rollback: `git checkout -- kb/cafe_api.py config/collect_rules.yaml`
### [2025-11-25 00:05 KST] [kb][ops][crawl] dinohighclass 硫붾돱 留?異붿텧쨌湲곕낯 ???異붿쿇 ?ㅼ젙
- Summary: dinohighclass 移댄럹(30819883) 硫붾돱 85媛쒕? ?ㅽ겕?⑺빐 `config/menus_dinohighclass.json`?쇰줈 ??ν븯怨? 湲곕낯 ?섏쭛 ???硫붾돱 ?명듃瑜?`.env.kb.example`??諛섏쁺.
- Why: ?섏쭛 踰붿쐞 ?쇱꽑??留됯퀬 ?뺢린 ?щ·留?硫붾돱瑜?紐낆떆?곸쑝濡?愿由ы븯湲??꾪븿.
- What:
  - 臾대줈洹몄씤?쇰줈 PC 移댄럹 HTML ?뚯떛?뭢enu_id/name 紐⑸줉 ?앹꽦, 異붿쿇 ?섏쭛 硫붾돱(吏덈Ц쨌?먯쑀쨌?몄쬆쨌轅???? collect=true 留덊궧.
  - `.env.kb.example`??KB_CAFE_ID=30819883, KB_MENUS 湲곕낯媛?165,33,206,136,51,172,77,48,24,62,245) 異붽?.
- Files: `config/menus_dinohighclass.json`, `.env.kb.example`
- Verify: `cat config/menus_dinohighclass.json`濡?硫붾돱/異붿쿇 紐⑸줉 ?뺤씤; `KB_MENUS`瑜??ㅼ젙??`python -m kb.ingest` ?ㅽ뻾 ??硫붾돱 誘몄????ㅻ쪟 ?놁쓬.
- Rollback: `git checkout -- config/menus_dinohighclass.json .env.kb.example`
### [2025-11-24 23:58 KST] [kb][data][ops] ???移댄럹 dinohighclass濡??쒖젙 諛??섑뵆 ?곗씠???뺣━
- Summary: KB ?섏쭛/?꾨쿋????곸쓣 dinohighclass(?대읇 ID 30819883)濡?怨좎젙?섍퀬, ?섎せ ?ｌ? ?뚯뒪??湲/留ㅻ돱???꾨쿋?⑹쓣 ?꾨웾 ??젣.
- Why(洹쇰낯 ?먯씤): ?댁쟾 ?뚯뒪?몄슜 ?섑뵆???쇱엯???듬? ?뺥솗?꾩? ?댁쁺 移댄럹 踰붿쐞媛 ?쇰룞???꾪뿕???덉뿀??
- What(臾댁뾿??諛붽퓞):
  - `kb.ingest`: CAFE_ID=30819883 怨좎젙, 硫붾돱 ID??KB_MENUS ?섍꼍蹂?섎줈留??덉슜(誘몄??????ㅻ쪟), upsert ?????移댄럹留??ъ슜.
  - DB ?뺣━: embeddings(post/manual) ?꾩껜, `[KB] 硫붾돱 %` 留ㅻ돱?? ?섑뵆 ?ъ뒪??1001~1003,2001~2003) ??젣.
- Verify: `docker exec -i iris_pg psql ...` ??젣 荑쇰━ ?ㅽ뻾, ?댄썑 ?섏쭛 ???곗씠???놁쓬 ?뺤씤. ?섏쭛 ?ш컻 ??`KB_MENUS` ?ㅼ젙 ?꾩닔.
- Rollback: `git checkout -- kb/ingest.py docs/CHANGELOG.md`; ?꾩슂 ??諛깆뾽 ?곗씠?곕줈 蹂듭썝.
### [2025-11-24 23:46 KST] [kb][data][search] ?섑뵆 KB ?곗씠???곸옱 諛?寃??荑쇰━ 罹먯뒪???섏젙
- Summary: 媛뺤쓽/?쇱툩 愿???섑뵆 寃뚯떆湲 3嫄댁쓣 DB???ｊ퀬 留ㅻ돱???꾨쿋???ъ깮?? 踰≫꽣 寃????罹먯뒪???ㅻ쪟瑜??닿껐.
- Why: ?ㅼ젣 吏덈Ц???듬? ?뚯뒪?명븯?ㅻ㈃ 移댄럹 肄섑뀗痢?湲곕컲 ?곗씠?곌? ?꾩슂?덇퀬, dummy ?꾨쿋???ъ슜 ??`<->` ?곗궛??????ㅻ쪟媛 諛쒖깮?덉쓬.
- What:
  - `sources_post`??2001(理쒓렐 媛뺤쓽 ?댁슜), 2002(?ㅼ쓬 媛뺤쓽 ?쇱젙), 2003(?좏뒠釉??쇱툩 媛?대뱶) ?쎌엯 ??`kb.manualize`濡?硫붾돱蹂?留ㅻ돱??2嫄??앹꽦.
  - `kb.search.vector_search`?먯꽌 鍮꾧탳 踰≫꽣瑜?`(:q)::vector`濡?罹먯뒪?낇빐 pgvector ?곗궛???ㅻ쪟 ?쒓굅.
  - `EMBED_PROVIDER=NONE python -m kb.update_embeddings`濡?dummy 踰≫꽣 ?앹꽦?섏뿬 end-to-end 寃利?
- Verify: `manual_doc` 5嫄?硫붾돱 30/40 ?ы븿), `embeddings` manual/post 媛?5/6嫄? 寃???ㅽ겕由쏀듃濡?吏덉쓽 3醫??ㅽ뻾(?댁슜 ?섎줉).
- Rollback: `docker-compose down`; ?꾩슂 ??`docker-compose up` ???대떦 ?뚯씠釉붿뿉??post_id 2001~2003, manual_doc title '[KB] 硫붾돱 30/40...' 諛?embeddings ??젣.
### [2025-11-24 23:35 KST] [kb][embed][docs] KB 留ㅻ돱???꾨쿋???뚯씠?꾨씪???뺣퉬
- Summary: 硫붾돱蹂?留ㅻ돱???먮룞 ?앹꽦怨?湲??띿뒪??泥?궧?믫룊洹??꾨쿋??泥섎━, 濡쒖뺄 pgvector 而⑦뀒?대꼫濡??숈옉 ?뺤씤.
- Why(洹쇰낯 ?먯씤): manualize媛 ?ㅼ펷?덊넠 ?곹깭??臾몄꽌媛 ?볦씠吏 ?딆븯怨? ?꾨쿋?⑹? 湲몄씠 珥덇낵/誘몄셿??濡쒖쭅?쇰줈 ?ㅽ뙣 ?꾪뿕???덉뿀??
- What(臾댁뾿??諛붽퓞):
  - manualize: 理쒓렐 clean 寃뚯떆湲??硫붾돱蹂꾨줈 臾띠뼱 draft 臾몄꽌瑜?upsert, 珥앸웾/硫붾돱???쒗븳? env(KB_MANUAL_TOTAL, KB_MANUAL_PER_MENU)濡??쒖뼱, title 異⑸룎? update?뭝nsert ?쒖쑝濡?泥섎━.
  - update_embeddings: ?띿뒪??泥?궧/寃뱀묠 ??泥?겕 ?꾨쿋?⑹쓣 ?됯퇏 踰≫꽣濡???? 紐⑤뜽/湲몄씠 env(EMBED_MODEL, KB_EMBED_MAX_CHARS) 諛섏쁺.
  - 濡쒖뺄 pgvector 而⑦뀒?대꼫 湲곕룞 ???섑뵆 ?ъ뒪??3嫄?1001~1003) ?쎌엯 ??manual_doc 2嫄??좉퇋 ?앹꽦, embeddings 6嫄?dummy provider) 湲곕줉.
- Files: `kb/manualize.py`, `kb/update_embeddings.py`, `docker-compose.yml`(?ъ슜), ?곗씠?? `sources_post`(id 1001~1003), `manual_doc`, `embeddings`.
- Verify: `docker-compose up -d postgres`; env ?곸슜 ??`python -m kb.manualize` ??"upserted manuals for 2 menus"; `EMBED_PROVIDER=NONE python -m kb.update_embeddings` ??manual/post 媛?3嫄??낆꽌?? `psql`濡?counts ?뺤씤.
- Rollback: `docker-compose down`; `docker exec iris_pg psql -U iris -d iris -c "delete from embeddings where obj_type in ('manual','post'); delete from manual_doc where title like '[KB] 硫붾돱 %'; delete from sources_post where post_id in (1001,1002,1003);"`; `git checkout -- kb/manualize.py kb/update_embeddings.py`.
### [2025-11-24 17:35 KST] [bot][ops][talkapi] 硫섏뀡 寃쎈줈 ?붾쾭源?濡쒓렇 異붽? 諛??ы듃?꾨줉???ъ꽕??- Summary: 硫섏뀡 ?ㅽ뙣 ?먯씤 異붿쟻???꾪빐 replyRich 遺꾧린/?좏겕API 寃곌낵 濡쒓렇瑜?異붽??섍퀬, ?ы듃?꾨줉?쒕? 127.0.0.1:5050/8510 -> 192.168.127.63?쇰줈 ?ъ꽕?뺥븿.
- Why(洹쇰낯 ?먯씤): talk-api ?붿뒪?⑥튂媛 401(Unauthorized)濡??ㅽ뙣?섎㈃??硫섏뀡???⑥닚 ?띿뒪?몃줈留??대젮媛붽퀬, IRIS ?ы듃(3000/8510)媛 ?ロ? ?덉뼱 遊??ъ젒?띾룄 諛섎났 ?ㅽ뙣 以묒씠?덉쓬.
- What(臾댁뾿??諛붽퓞):
  - safeReplyWithMentions??湲곕뒫 媛?⑹꽦 濡쒓렇, segments/mentionees ?ы븿??payload 異붽?.
  - talk-api ?붿뒪?⑥튂 ?ㅽ뙣 ??遺꾧린 濡쒓렇 蹂닿컯.
  - netsh portproxy瑜?5050/8510 -> 192.168.127.63?쇰줈 ?ъ꽕??
- Files: `node-iris-app/src/utils/sender.ts`, portproxy(Windows)
- Verify: `npm run build` ?꾨즺, `Invoke-WebRequest http://127.0.0.1:8600/send/talkapi/dispatch` 寃곌낵 status=401 ?뺤씤. IRIS 3000/8510 ?ъ쟾???ロ? ?덉쓬(異붽? 議곗튂 ?꾩슂).
- Rollback: ?ы듃?꾨줉????젣 ??湲곗〈 二쇱냼濡??ъ꽕?? `git checkout -- node-iris-app/src/utils/sender.ts`
### [2025-11-21 16:05 KST] [ui][ops] 湲곕뒫蹂?愿由?????ㅻ쪟 ?섏젙 (runtime API ?꾨줉??
- Summary: 湲곕뒫蹂?愿由??섏씠吏媛 8650 吏곷젹?몄텧濡?CORS/?ы듃 ?ㅻ쪟瑜??대ŉ SAFE_MODE 蹂寃쎌씠 ??λ릺吏 ?딅뜕 臾몄젣瑜?Next API ?꾨줉??寃쎌쑀濡??섏젙.
- Why(洹쇰낯 ?먯씤): settings ?섏씠吏媛 釉뚮씪?곗??먯꽌 吏곸젒 http://127.0.0.1:8650/runtime??POST?섎㈃??Next.js ?먮윭 ?ㅻ쾭?덉씠媛 諛쒖깮, ????ㅽ뙣.
- What(臾댁뾿??諛붽퓞): settings ?섏씠吏媛 /api/runtime쨌/api/templates ?꾨줉?쒕? ?ъ슜?섎룄濡?蹂寃쏀븯怨?SAFE_MODE ?쒖떆瑜??고???媛믪쑝濡??쒖떆.
- Files: web/src/app/settings/page.tsx
- Verify: ??쒕낫??/settings ?먯꽌 SAFE MODE 泥댄겕諛뺤뒪 ?댁젣?뭆ave ???깃났 硫붿떆吏, curl http://127.0.0.1:8650/runtime?먯꽌 safeMode=false ?뺤씤.
- Rollback: ?대떦 ?뚯씪???댁쟾 踰꾩쟾?쇰줈 蹂듭썝.
### [2025-11-21 15:55 KST] [bot][ops][safety] ?뚯뒪?몃갑 ID ?뺤젙 諛?!而ㅻ㎤??媛??異붽?
- Summary: ?덉슜 諛⑹쓣 ?ㅼ젣 ?뚯뒪?몃갑(18462226881291012)?쇰줈 留욎텛怨?! ?묐몢 而ㅻ㎤?쒕룄 SAFE_MODE/?덉슜 諛?泥댄겕瑜?嫄곗튂?꾨줉 ?뺣퉬.
- Why(洹쇰낯 ?먯씤): config/runtime.json???섎せ??roomId(18467788394908110)濡??ㅼ젙???덉뼱 >> 而ㅻ㎤?쒕뒗 李⑤떒?섍퀬, ! 而ㅻ㎤?쒕뒗 媛?쒓? ?놁뼱 ?ㅻⅨ 諛??≪떊 ?꾪뿕???덉뿀??
- What(臾댁뾿??諛붽퓞):
  - config/runtime.json allowedRoomIds, features瑜?18462226881291012濡??섏젙.
  - windows/start_bot.ps1 湲곕낯 ALLOWED_ROOM_IDS瑜??숈씪 ID濡??듭씪.
  - CustomMessageControllerBang??SAFE_MODE/?덉슜諛?媛?쒕? 異붽???鍮꾪뿀??諛⑹뿉?쒕뒗 臾댁쓳??泥섎━.
- Files: 
ode-iris-app/config/runtime.json, windows/start_bot.ps1, 
ode-iris-app/src/controllers/CustomMessageControllerBang.ts
- Verify: ?뚯뒪?몃갑?먯꽌 >>room, !room, >>welcome:test, !welcome:test ?꾩넚 ???묐떟 異쒕젰, ?ㅻⅨ 諛⑹? 臾댁쓳??
- Rollback: ???뚯씪?ㅼ쓣 ?댁쟾 踰꾩쟾?쇰줈 蹂듦뎄.
### [2025-11-21 20:15 KST] [bot][ops][safety] ?뚯뒪?몃갑 ?쒖젙 ?≪떊 媛???뺣퉬
- Summary: ?덉슜 諛⑹쓣 ?섎せ ?쎌뼱 ?ㅻ컻???꾪뿕???덈뜕 寃쎈줈瑜??뚯뒪?몃갑 ?⑥씪濡?怨좎젙?섍퀬 紐낅졊?대룄 allowedRoomIds? SAFE_MODE瑜??곕Ⅴ?꾨줉 留됱쓬.
- Why(洹쇰낯 ?먯씤): config/runtime.json??JSON ?щ㎎???꾨땲?댁꽌 ?뚯떛 ?ㅽ뙣 ??ALLOWED_ROOM_IDS ?섍꼍媛??ㅻⅨ 諛?ID)??????곸슜?섍퀬, 紐낅졊??而⑦듃濡ㅻ윭??蹂꾨룄 媛?쒓? ?놁뼱 ?ㅻⅨ 諛??묐떟 媛?μ꽦???덉뿀??
- What(臾댁뾿??諛붽퓞):
  - config/runtime.json???щ컮瑜?JSON?쇰줈 援먯껜?섍퀬 roomId瑜?臾몄옄?대줈 紐낆떆.
  - windows/start_bot.ps1 湲곕낯 ALLOWED_ROOM_IDS瑜??뚯뒪?몃갑 ID濡??섏젙.
  - CustomMessageController??SAFE_MODE/allowedRoomIds 媛??異붽?(鍮꾪뿀??諛㈑룹꽭?댄봽紐⑤뱶 ??臾댁쓳??濡쒓렇留??④?).
- Files: 
ode-iris-app/config/runtime.json, windows/start_bot.ps1, 
ode-iris-app/src/controllers/CustomMessageController.ts
- Verify: (吏곸젒 ?ㅽ뻾 ???? powershell -File windows/start_bot.ps1 -SkipBuild -IrisUrl http://192.168.127.63:3000 ???뚯뒪?몃갑?먯꽌 >>room, >>welcome:test ?≪떊 ?щ? ?뺤씤.
- Rollback: ???뚯씪?ㅼ쓣 吏곸쟾 踰꾩쟾?쇰줈 ?섎룎由щ㈃ ?⑸땲??
### [2025-11-20 14:26] [ui][ops] Next.js 疫꿸퀡??????3100 ?袁れ넎(3000 ?겸뫖猷???곕돗)
- Summary: ??삘뀲 嚥≪뮇類??袁⑥쨮??븍뱜揶쎛 3000???癒????????뺣궖???臾믩꺗??筌띾맪? 疫꿸퀡?????껆몴?3100??곗쨮 ???곫??온????쎄쾿?깆????얜챷苑?CORS/???뮞?紐? ?類ｂ봺.
- Why(域뱀눖???癒?뵥): Next.dev 疫꿸퀡??????3000)揶쎛 ?? ?袁⑥쨮??븍뱜?? ?겸뫖猷????쎈뻬 ??쎈솭(EADDRINUSE)揶쎛 獄쏆꼶???
- What(?얜똻毓??獄쏅떽??:
  - Next.js dev/start 疫꿸퀡?????껆몴?3100??곗쨮 癰궰野? `web/package.json`, `scripts/serve_web.sh`, `windows/start_web.ps1/.cmd`, `windows/start_all.ps1/.cmd`, `windows/run_web.ps1`.
  - ?怨밴묶 筌ｋ똾寃뺝첎? UI ???????뤵??? ??낅즲嚥?`/api/status`揶쎛 FastAPI 甕곗쥙???`NEXT_PUBLIC_REALTIME_BASE`)??筌욊낯??鈺곌퀬??
  - FastAPI CORS ??됱뒠 筌뤴뫖以??3100 ?곕떽?.
  - ???뮞???袁㏓럡 疫꿸퀡??URL 揶쏄퉮?? `web/playwright.config.ts`, `web/tests/e2e/*`, `scripts/capture_next_error.js`.
  - ?얜챷苑????뮞??????????덇땀 3100??곗쨮 ?類ㅼ젟(README, HANDOVER, setup/realtime_quickstart, ops/realtime_api, project-structure).
- Files: `web/package.json`, `scripts/serve_web.sh`, `windows/start_web.ps1`, `windows/start_web.cmd`, `windows/start_all.ps1`, `windows/start_all.cmd`, `windows/run_web.ps1`, `web/src/app/api/status/route.ts`, `server/app.py`, `web/playwright.config.ts`, `web/tests/e2e/next_sse.spec.ts`, `web/tests/e2e/ui-health.spec.ts`, `web/tests/e2e/filters.spec.ts`, `scripts/capture_next_error.js`, `README.md`, `docs/HANDOVER.md`, `docs/reference/project-structure.md`, `docs/setup/realtime_quickstart.md`, `docs/ops/realtime_api.md`.
- Verify: `powershell -File windows/start_web.ps1 -Port 3100` ??`Invoke-WebRequest http://127.0.0.1:3100/api/status`; FastAPI??`curl http://127.0.0.1:8650/health`.
- Rollback: ?????뵬??쇱벥 3100??3000??곗쨮 ??롫즼?귐덊?FastAPI CORS origin?癒?퐣 3100????볤탢.
- Links: N/A

### [2025-11-20 14:57 KST] [bot][ops] bot.lock ?癒?짗 ?類ｂ봺嚥???由????쎈솭 獄쎻뫗?
- Summary: ??곸읈 ?袁⑥쨮?紐꾨뮞揶쎛 雅뚯럩?앾쭖???ｋ┸ `node-iris-app/data/bot.lock` ????????딅돆??`BOT_LOCK_EXISTS`嚥?筌앸맩???ル굝利??롫쐲 ?얜챷?ｇ몴?start_bot ??ｍ?癒?퐣 ?癒?짗 筌????롫즲嚥???륁젟.
- Why: ?겸뫖猷?揶쏅벡???ル굝利???lock ???뵬筌???λ툡 ??뺥겦 ??由??봔?甕곌쑵????믩?? ??낅뮉 ?怨밴묶揶쎛 獄쏆꼶???
- What: `windows/start_bot.ps1`?癒?퐣 (1) 疫꿸퀣??bot ?袁⑥쨮?紐꾨뮞 揶쏅벡???ル굝利???(2) bot.lock??鈺곕똻???랁?PID揶쎛 ??얘탢??10????곴맒 筌왖??野껋럩???癒?짗 ????
- Verify: `powershell -File windows/start_bot.ps1 -IrisUrl http://192.168.127.63:3000 -SkipBuild` ??쎈뻬 ??bot.lock????源?源낅┷??`node-iris-app/data/status.json`??`lastEventTs`揶쎛 筌앸맩??揶쏄퉮???롫뮉筌왖 ?類ㅼ뵥.
- Rollback: `windows/start_bot.ps1`????곸읈 甕곌쑴???곗쨮 ??롫즼?귐됥늺 ??몃빍??

### [2025-11-20 15:05 KST] [ui][api] /api/runtime POST ?袁⑥쨯???곕떽? (??륁겫 ??쇱젟 ??????살첒 ??륁젟)
- Summary: ????뺣궖??뽯퓠??SAFE_MODE/??륁겫 ??쀫탣????????Next揶쎛 GET筌?筌왖?癒곕퉸 ??쎈솭??롫쐲 ?얜챷?ｇ몴?FastAPI `/runtime`??곗쨮 ?????븍릭??POST ?紐껊굶??? ?곕떽?????욧퍙.
- Files: `web/src/app/api/runtime/route.ts`
- Verify: ????뺣궖??뽯퓠????륁겫 筌ｋ똾寃??????????源껊궗 筌롫뗄?놅쭪?, `node-iris-app/config/runtime.json`??獄쏆꼷???類ㅼ뵥.
- Rollback: ???????뵬 癰궰野껋럥彛???롫즼?귐됥늺 ??몃빍??

### [2025-11-18 13:02 KST] [server][ui][ops] Realtime API 8650 ?????袁れ넎 + 24h 嚥≪뮄??????됱젟??- Summary: FastAPI ???껃첎? Windows IP Helper(8600)?? ?겸뫖猷??롢늺??Next.js揶쎛 ??湲???媛?野껋럥以덃에?뺤춸 ??덉삂??랁? 24??볦퍢 ??곸읈 嚥≪뮄?뉐첎? ?④쑴???紐꾪뀱夷??쎄쾿嚥?筌왖?怨? 獄쏆뮇源??롫쐲 ?얜챷?ｇ몴?8650 ?????袁れ넎 + 獄쏄퉮肉???袁⑥쨴????덈뻻 ?袁り숲筌띻낯?앮에??類ｂ봺.
- Why(域뱀눖???癒?뵥):
  - Windows `iphlpsvc`揶쎛 `127.0.0.1:8600` ???癒????FastAPI(uvicorn)揶쎛 揶쏆늿? ????癒?퐣 ?븍뜆釉?類λ릭野???덉삂 ??`/logs/bulk`夷?/health` ?怨뚭퍙 ??쎈솭.
  - Next `/api/bulk` 揶쎛 ??湲???쎈솭 ??Node fallback(`web/src/lib/logs.ts`)筌????? ??由?癒?뮉 24h ?뚮９????곷선??11/3夷?1/11 嚥≪뮄?뉐첎? ?④쑴??癰귣똻??
  - `/api/health` 揶쎛 FastAPI ???袁⑸툡?猿뗭뱽 疫꿸퀡?롧뵳?흭 ?臾먮뼗????苡??袁⑹굙 雅뚯눘? ??녿툡 StatusBar夷????뺣궖???怨룸뼊???癒?폒 ??몿而숅겫?嚥≪뮆逾??怨밴묶嚥???μ벉.
- What(?얜똻毓??獄쏅떽??:
  - Realtime API 疫꿸퀡?????껆몴?**8650**??곗쨮 ?袁れ넎: `windows/start_api.ps1`, `windows/start_all.ps1/.cmd`, `windows/recover_realtime.ps1`, `windows/start_api.cmd`, `server/app.py`, `scripts/serve_web.sh`, `scripts/serve_ui.sh` ?類ｂ봺.
  - Windows 疫꿸퀡猷?野껋럥以?癒?퐣 `REALTIME_API_BASE` / `NEXT_PUBLIC_REALTIME_BASE` / `TEMPLATE_ASSETS_BASE` ??`http://127.0.0.1:8650` 疫꿸퀣???곗쨮 ?癒?짗 雅뚯눘??
  - Node fallback 嚥≪뮄???귐됰쐭(`web/src/lib/logs.ts`)??24??볦퍢 ???곕떽?(tailRoom/tailAll): FastAPI ??쇱뒲 ??뽯퓠??24h ??곸읈 嚥≪뮄????袁? ?袁り숲筌?
  - `/api/health` ??fetch ???袁⑸툡??2.5?? + fallback(status.json) ?怨몄뒠??곴퐣 FastAPI ?臾먮뼗????援????꾧볼????쥓?ㅵ칰??怨밴묶??獄쏆꼹???롫즲嚥???륁젟.
  - Next dev ??뺤쒔揶쎛 .next 筌?Ŋ??筌?寃??쀑딆뿫??곗쨮 500/404???????怨밴묶?癒?퐣 `.next` ?類ｂ봺 + `npm run build` ???궢 ?類ㅼ뵥 ??`windows/start_web.ps1` 疫꿸퀣? ??由??
- Files: `web/src/lib/logs.ts`, `web/src/app/api/health/route.ts`, `server/app.py`, `windows/start_api.ps1`, `windows/start_all.ps1`, `windows/start_api.cmd`, `windows/start_all.cmd`, `windows/recover_realtime.ps1`, `scripts/serve_web.sh`, `scripts/serve_ui.sh`
- Verify:
  - FastAPI 筌욊낯?? `Invoke-WebRequest http://127.0.0.1:8650/health` ??200, `/logs/bulk?all=1&limit=120` ?臾먮뼗 ts 揶쎛 筌뤴뫀紐?24h ??沅?
- Next API: `http://127.0.0.1:3100/api/health`, `/api/status`, `/api/bulk?all=1&limit=120`, `/api/rooms` 筌뤴뫀紐?200 獄?24h ??ts 疫꿸퀣?) ?類ㅼ뵥.
  - FastAPI DOWN ?怨뱀넺?癒?퐣 `/api/bulk` 揶쎛 Node fallback ??곗쨮 ?袁れ넎??롫쐭??곕즲 `all`/`rooms` 獄쏄퀣肉??ts 揶쎛 24h ??沅?紐? ?????
  - Next ??슢諭? `cd web && npm run build` ?源껊궗, dev 筌뤴뫀諭?癒?퐣 `/` 筌ㅼ뮇??嚥≪뮆諭???????곴맒 `AbortError` / `TypeError: Failed to fetch` / 筌?寃?404 揶쎛 獄쏆뮇源??? ??놁벉(HTTP 疫꿸퀣? ?類ㅼ뵥).
- Rollback: ???껓쭕???롫즼?귐됱젻筌??????뵬??8650 ??8600 燁살꼹????`windows/start_api.ps1`, `windows/start_all.ps1`, `windows/start_web.ps1`, `windows/recover_realtime.ps1` ??沅?? ?袁⑷퍥 ?臾믩씜?? `git revert` 嚥?嚥▲끇媛?亦낅슣??
- Links: N/A

### [2025-11-12 15:45 KST] [ui][ops] /kb ???吏쀥슖?る츇??????熬곣뫖???곗뮆竊숁묾?筌뤾퍔夷?윜??怨뺣뼺? ??KB ??類λ룴?????꾩씩?源????곌랜???- Summary: KB ?꾩룄??굢??亦껋꼶?뉒뵳???됰さ???筌뤿굝由?`fetch_failed` ???逾???蹂ㅽ깴 ?? Next API ?熬곣뫁夷??????뚮뜆??????熬곣뫖???곗뮆竊숁묾???β돦裕??믩ご??怨뺣뼺????겶?KB ??類λ룴?????꾩씩?源??猿녿ご??꾩룄????源녿뮧???β돦裕??筌먦끉紐드슖???흮??
- Why(?잙???????逾?: KB(8610) ????????⑤객臾?????`/api/kb/*` ?熬곣뫁夷??? ?????????덉넮. ??븐뼚?붺뭐??β돦裕???遊붋??餓????逾??????嶺뚯솘???
- What(??쒕샍驪???꾩룆???:
  - Next API stats/run/run_cookie/creds/cookies/schedule ??源녿뮡?筌뤾쑬????븐슙?뺟솻?rid/??????蹂?뜟/??⑤객臾?袁⑤?獄??β돦裕???怨뺣뼺?
  - 嶺뚮ㅄ維獄??筌? fetch?????熬곣뫖?????⑤챷???リ옇??????鸚?筌먲퐤?? ????????β돦裕???筌먐쇨델??
  - windows/kb_service.ps1 ????? venv ???吏???ルㅎ臾????노뭵, ?β돦裕???洹먮맧堉??????windows/logs/kb.*.log), ?リ옇?←뙴????????熬곣뫖???
  - kb/service.py ???留??\n ?洹먮뿪?????蹂ㅽ깴(??쒖굡?????댁쾼 ??瑜곸젧)
- Files: `web/src/app/api/kb/**/route.ts`, `kb/service.py`, `windows/kb_service.ps1`
- Verify:
  - KB: `powershell -File windows/kb_service.ps1` ??`http://127.0.0.1:8610/health` 200
  - Web: `/kb` ?????遊?????????類ㅼŦ?잙갭梨???臾믪쪡亦?嶺뚢븞??뜎??????????袁⑷섭??????`[kb-proxy:*]` ?β돦裕???筌먦끉逾? ?꾩룄?? ?띠룄???- Rollback: ?곌떠?????`page_backup.tsx` ???. `windows/kb_service.ps1.bak` ???????裕?`git restore`.
- Links: N/A













