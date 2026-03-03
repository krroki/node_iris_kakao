# Refactoring Plan: Streamlit → FastAPI + SSE (+ Next.js)

Branch: `refactor/fastapi-sse` (base: a8867ee)

## Goals
- Replace per-second polling with server push (SSE first; WS optional later)
- Consolidate real-time updates into a single connection per client
- Preserve current filtering/formatting/dedup semantics
- Keep Windows/WSL/Hyper‑V bridging stable with least moving parts

## Phases

### Phase 0 — Bootstrapping
- Create branch `refactor/fastapi-sse`
- Add docs (this file + ARCHITECTURE.md) and update scripts index

### Phase 1 — Server (FastAPI)
- Directory: `server/`
- Endpoints (implemented):
  - `GET /health` — basic checks
  - `GET /logs` — snapshot (params: roomId, limit, include/exclude)
  - `GET /logs/stream` — SSE; sends snapshot + incremental events with roomId, ts, text, sender, roomName
- Internals:
  - Tailer watches `node-iris-app/data/logs/**.log`
  - Dedup by `messageId` or (sender,text,time-window), reuse logic from `scripts/log_api.py`
  - Include/Exclude keyword filter applied server-side
  - Backpressure: bounded queue, client drop on overload; auto-reconnect supported

### Phase 2 — Frontend (Next.js)
- Directory: `web/`
- Pages:
  - Dashboard (Rooms grid, All activity panel)
  - Logs page (filters, room selection)
- Data flow:
  - Initial snapshot via `GET /logs`
  - Live updates via `EventSource(/logs/stream)`; reconcile into UI state
  - Time format: `ko-KR`, `Asia/Seoul`
  - Streamlit 현행도 `register_log_realtime`로 SSE 적용(폴백 포함)

### Phase 3 — Cutover & Cleanup
- Feature parity checklist (see below)
- Default launcher points to Next.js client + FastAPI server
- Keep Streamlit as fallback for one release; then archive

## Validation Checklist
- End-to-End
  - Append new lines to a room log → UI reflects within 1s
  - Network flap → SSE reconnects automatically
  - Filters (include/exclude) match snapshot semantics
- Performance
  - 30+ rooms at 1 msg/sec sustained without UI stutter
  - CPU/network usage reduced versus polling
- Ops
  - Windows `setup_iris_port.ps1` still sets `5050/8510`
  - Single diagnostic page `/health`, `/metrics` (optional)

## Rollback Plan
- Keep Streamlit UI runner available behind a separate port for one release
- Preserve `scripts/log_api.py` as a working snapshot endpoint during migration

## Notes
- Consider WebSocket as an alternative once SSE parity is stable
- Tauri/Electron packaging can reuse the same FastAPI server as a local backend later

---

## Phase 4 — Architecture Hardening (SAFE_MODE / RAG / UI)

### Goals
- SAFE_MODE 의미/동작을 코드·스크립트·웹 UI 전체에서 완전히 일치시킨다.
- RAG(KB) 파이프라인을 “본문 기반 + 하드 실패(no fallback)” 구조로 정리해 답변 품질과 예측 가능성을 확보한다.
- 대시보드(Next.js)와 실시간 서버(FastAPI)의 템플릿/아바타/상태 패널을 SSOT 기준으로 단순화한다.
- 위 변경을 ADR/문서/테스트로 고정해, 이후 세션에서도 다시 되풀이되는 꼬임을 방지한다.

### Todo List (SAFE_MODE / 발신 제어)
- [x] SAFE_MODE SSOT를 `node-iris-app/config/runtime.json.safeMode`로 명시하는 섹션을 `docs/ARCHITECTURE.md`에 추가 <!-- 완료: 2025-12-06 -->
- [x] `/settings` 페이지 설명 문구를 “SAFE_MODE=ON → 모든 발신 차단(수신/로그 전용)”으로 수정 <!-- 완료: 2025-12-06 -->
- [x] `CustomMessageControllerBang`, `CustomNewMemberController`, `CustomBatchController`에서 `isSafeMode()` 호출 위치/순서를 리뷰하고, **모든 발신 경로 앞단에서 SAFE_MODE를 먼저 검사**하도록 정규화 <!-- 리뷰 완료: 2025-12-06 -->
- [x] `server/app.py`의 `/send/talkapi/dispatch` 등 발신성 API가 runtime.safeMode를 항상 체크하도록 재검토 <!-- 확인 완료: 2025-12-06 -->
- [x] SAFE_MODE 회귀 테스트 추가:
  - [x] runtime.safeMode=true일 때, AI 응답/공지/브로드캐스트/토크 API가 실제 발신을 수행하지 않는지 확인하는 통합 테스트 스크립트 작성 (`scripts/test_safe_mode.py`)
  - [x] runtime.safeMode=false + allowedRoomIds/feature 플래그 조합별 허용/차단 동작을 검증 (`node-iris-app/tests/guard.test.ts` + vitest)

### Todo List (RAG / KB 파이프라인)
- [x] `kb/search.py` 쿼리 구조 검토: 벡터 조인·dist 컷오프·norm_text 500자 스니펫 구조를 유지하되, ADR-0007/0014 스케일과 일치하도록 `KB_DIST_MAX` 기본값(1.5)을 확정하고 추가 리팩토링은 보류
- [x] `kb/service.py::ask_llm`에서:
  - [x] 벡터 검색 시 상위 50개까지 후보 확보 (`top_k=max(req.top_k, 50)`)
  - [x] “사알못 다시보기/녹화/링크/보너스/실습” 등 키워드가 있을 경우 제목+본문(norm_text)에 기반해 관련 후보를 앞으로 정렬하는 `_keyword_boost_filter` 적용
  - [x] 날짜 토큰(예: `12월 3일`, `12/3`, `12.3`)을 `_extract_date_keys`로 정규화해, 제목+본문에 동일한 날짜 키가 없는 후보는 1차/2차 모두 배제
  - [x] 필터 결과가 0건이면 LLM을 호출하지 않고 `"질문과 직접 관련된 카페 자료를 찾지 못했습니다."` 또는 날짜 전용 없음 메시지로 **명시적 없음 응답** 반환
- [x] `_rerank_posts` 프롬프트를 “제목 + 키워드 주변 본문요약(최대 300자)” 기준으로 재설계하고,
  - [x] 후보 수가 limit 이하일 때는 LLM 재랭크를 생략하고 기존 정렬을 사용하도록 변경
  - [x] JSON 파싱 실패/빈 배열 시 dist 기반 정렬로 되돌아가되, 경고 로그를 남기도록 유지
- [x] `scripts/verify_rag.py`를 작성하여 다음 케이스를 자동 검증:
  - [x] “사알못 다시보기 링크” → menu_id 23/32 등 강의 관련 게시판에서 결과가 나오고, 다시보기/링크 키워드가 포함된 글이 상위 후보에 포함되는지
  - [x] “12월 3일에 강의 있나” → 본문/제목에 해당 날짜 키가 없는 글은 최종 후보에서 제거되는지
  - [x] 엉뚱한 일반 질문 → “정보 없음” 응답이고, 근거 URL이 없을 때는 링크가 붙지 않는지

### Todo List (웹 UI / 템플릿 / 썸네일)
- [x] 템플릿 SSOT(`node-iris-app/config/templates/**`)를 `docs/ARCHITECTURE.md`와 `docs/adr/ADR-0008-kb-menu-ssot.md`(또는 신규 ADR)에서 명시
- [x] `/templates` 페이지 좌측 리스트에 카테고리별 템플릿 개수/유무를 더 명확히 표기(예: “(0개)”)하여, “사라진 것인지/아직 안 만든 것인지”를 구분할 수 있게 개선
- [x] 기능별 관리(`/settings`)의 템플릿 셀렉트 박스에서, 서버에 존재하지 않는 템플릿 이름이 runtime에 남아 있을 경우 경고를 띄우고 정리할 수 있는 UI/액션 추가
- [x] `RoomCard`의 아바타 fallback 스타일을 UI 체크리스트(`UI_VERIFICATION_CHECKLIST.md`)에 추가하고, 모든 방에 기본 썸네일(이니셜)이 보이는지 수동 검증
- [x] `/rooms` / `/avatar/{roomId}` / 로그 스냅샷이 **동일한 roomId 세트**를 사용하도록, `server/log_utils.list_rooms()`와 node-iris-app 쪽 로그 포맷간의 종속성을 문서화 <!-- 완료: 2025-12-07, docs/ARCHITECTURE.md \"상태/룸/아바타 SSOT\" 섹션에 정리 -->

### Todo List (문서 / ADR / CI)
- [x] 이번 SAFE_MODE 정리 내용을 중심으로 `docs/adr/ADR-0016-safe-mode-and-ui-alignment.md`를 보완(예: 구체적인 before/after 코드 경로 링크 추가)
- [x] `AGENTS.md`, `claude.md`에:
  - [x] SAFE_MODE 단일 소스,  
  - [x] RAG no-fallback 정책,  
  - [x] 템플릿/아바타 SSOT 경로  
  를 “에이전트가 반드시 지켜야 하는 불변식” 섹션으로 명시
- [x] `docs/adr/ADR-0017-status-api-and-fs-decoupling.md`를 Accepted로 승격하고, `/status` 구현/적용 후 링크 업데이트
- [x] CI(또는 수동 스크립트)에서 최소한 다음을 한 번에 돌려보는 `scripts/test_kb_e2e.py` 또는 통합 테스트 러너 준비:
  - [x] KB 계약 테스트 (`tests/test_kb_contract.py`)
  - [x] RAG 회귀(`scripts/verify_rag.py`)
  - [x] SAFE_MODE 동작 스모크(발신 여부만 확인, `scripts/test_safe_mode.py`)
