# ADR-0028: AI 응답을 ai-worker로 분리 (LogStore 구독 기반)

## Meta

- **Date**: 2025-12-14
- **Status**: Accepted
- **Authors**: 사용자, Codex CLI
- **Related**: ADR-0016(SAFE_MODE), ADR-0017(Status API), ADR-0019(로그 파이프라인), ADR-0018/0021(RAG 라우팅), ADR-0027(코어+워커 분리)
- **Related Session**: `docs/sessions/fix-kb-routing-and-schedule.md`

## Context (배경)

현재 `?디하클 ...` 질의(=KB/RAG 호출 + 답변 발신)는 Node-IRIS 봇 프로세스 안에서 처리된다.
그 결과:

- RAG/프롬프트/라우팅/검증 로직 변경 시 **코어(수신/로그)까지 함께 재기동**해야 한다.
- KB 호출 실패/지연/예외가 봇 전체에 영향을 줄 수 있다(운영 중 무응답/불안정 체감).
- “코어는 상시 가동, 기능은 모듈/워커로 분리”라는 ADR-0027 방향성과도 결합도가 높다.

요구 조건:

- 코어(bot)는 **IRIS 이벤트 수신 + 로그 저장 + 상태(heartbeat/lastEvent) 갱신**에 집중한다.
- AI 답변은 **별도 프로세스(ai-worker)** 가 `/logs/stream`(SSE)을 구독하여 처리한다.
- SAFE_MODE/allowlist/room feature 토글은 기존과 동일하게 유지한다.
- 폴백 금지: 접두어 미일치/KB 오류 시 임의 추측 답변을 생성하지 않는다.

## Options Considered (고려한 대안)

### Option A: 기존처럼 봇 프로세스에서 AI 처리 유지

- 장점: 구현 단순, 프로세스 증가 없음
- 단점: 기능 변경/장애가 코어 안정성에 영향을 준다(ADR-0027 취지와 충돌)

### Option B: 봇 내부 플러그인(동적 로딩)으로만 분리

- 장점: 코드 구조는 개선
- 단점: 여전히 프로세스 재기동/메모리/의존성 문제가 코어에 전파됨

### Option C: ai-worker로 분리 (선택)

- 설명:
  - 코어(bot)는 MessageStore 로그만 기록한다.
  - ai-worker는 Realtime API의 SSE(`/logs/stream`)를 구독해 “신규 메시지” 이벤트 중 `?디하클` 접두 질의만 선별한다.
  - ai-worker가 KB(`/ask_llm`)에 질의하고, Talk-API 브리지(`/send/talkapi/dispatch`)로 답변을 발신한다.
- 장점:
  - AI 관련 변경/재시작이 코어 다운타임을 유발하지 않는다.
  - watchdog가 “AI만 재시작”하는 운영이 가능해진다.
- 단점/리스크:
  - 프로세스 수 증가(관측/재기동 대상 증가)
  - 워커/코어 중복 처리(이중 응답) 위험 → dispatcher 플래그로 단일화 필요

## Decision (결정)

**Option C(ai-worker 분리)를 채택한다.**

- 기본값은 `AI_DISPATCHER=worker`.
- 긴급 롤백이 필요하면 `AI_DISPATCHER=bot`으로 되돌릴 수 있어야 한다.
- 필요 시 `AI_WORKER_DISABLE=1`로 워커를 완전 비활성화한다(코어는 계속 가동).

## Invariants (불변식)

- **SAFE_MODE=true면 어떤 워커도 발신하지 않는다.** (최종 차단은 Realtime API `/send/talkapi/*`)
- allowlist(`runtime.json.allowedRoomIds`) 밖 방에는 ai-worker가 응답하지 않는다.
- 방별 기능 토글(`runtime.json.features[roomId].ai`)이 `true`일 때만 응답한다.
- 접두어는 반드시 문장 맨 앞 `?디하클`(공백 변형 허용)만 인식한다.
- KB 오류/타임아웃 시 임의 추측 답변을 생성하지 않고, 고정 에러 메시지로 안내한다.
- ai-worker는 봇 계정(예: IRIS 자체 발신) 메시지에 반응하지 않아 루프를 만들지 않는다.
- **ai-worker는 1개만 실행되어야 한다.** 락 파일(`node-iris-app/data/locks/ai_worker.lock`)로 중복 실행을 방지하며, 락이 이미 잡혀있으면 새 프로세스는 즉시 종료한다.

## Consequences (결과)

### 긍정적 효과

- AI/KB 변경이 코어 안정성에 미치는 영향이 줄어든다.
- 운영 중 장애 시 watchdog가 ai-worker만 재기동할 수 있어 복구가 빨라진다.

### 부정적 효과 / 리스크

- 프로세스 관리 복잡도가 증가한다.
- dispatcher 설정이 꼬이면 중복 응답이 발생할 수 있다 → `AI_DISPATCHER`를 단일 SSOT로 유지한다.

### 후속 작업

- [ ] ai-worker 구현 및 운영 스크립트/Watchdog 연동
- [ ] 기존 봇 프로세스에서 AI 처리 비활성화(또는 `AI_DISPATCHER=bot`에서만 활성)
- [ ] 문서: 엔트리포인트/복구/상태 확인 방법 정리(agents/SSOT/verification-commands)

## Links

- Code:
  - `node-iris-app/src/workers/ai_worker.ts`
  - `node-iris-app/src/controllers/CustomMessageController.ts` (AI dispatcher 토글)
  - `node-iris-app/src/controllers/CustomChatController.ts` (코어 lastEvent 갱신)
  - `server/app.py` (`/logs/stream`, `/send/talkapi/dispatch`)
  - `windows/start_ai_worker.ps1`, `windows/watchdog.ps1`, `windows/start_all.ps1`
- Docs:
  - `docs/ops/core-feature-split-plan.md`
