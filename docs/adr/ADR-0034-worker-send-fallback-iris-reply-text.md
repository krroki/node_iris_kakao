# ADR-0034: Talk-API 실패 시 IRIS `/reply` 기반 텍스트 폴백(Worker/Command)

## Meta

- **Date**: 2025-12-15
- **Status**: Accepted
- **Authors**: 사용자, GPT-5.2 (Codex CLI)
- **Related Session**: `docs/sessions/main.md`

## Context (배경)

- welcome/ai/broadcast 기능은 코어(LogStore)와 분리되어 각각 워커가 SSE(`/logs/stream`)를 구독해 발신한다(ADR-0027/0028/0029).
- 워커의 기본 발신 경로는 Talk-API 경유(`POST /send/talkapi/dispatch`, `POST /send/talkapi/dispatch_raw`)인데, 운영 중 Talk-API가 `talkStatus != 0`(예: -500)로 실패하여 Realtime API가 502를 반환하는 장애가 반복 발생했다.
- 결과:
  - welcome-worker: 환영 텍스트가 실패 → 이미지(ADR-0030)도 함께 중단되어 “웰컴이 안 나감”
  - bot 명령(`!welcome:test` 등): 멘션 API 부재 + Talk-API 실패 시 예외로 종료되어 “웰컴 템플릿 테스트 중 오류”가 발생
  - ai-worker/broadcast-worker: 답변/공지 발신이 통째로 실패

제약:
- SAFE_MODE(SSOT: `node-iris-app/config/runtime.json.safeMode`)는 어떤 경로에서도 우회하면 안 된다(ADR-0016).
- IRIS `/reply`는 **멘션/Reply(답장) 미지원**이며 텍스트/이미지만 가능하다(레퍼런스: `docs/reference/kakao-mentions-and-reply.md`).
- 서버가 Talk-API 실패를 “조용히 성공 처리”하면 장애 탐지가 늦어지므로, Talk-API 엔드포인트는 실패를 명확히 502로 유지해야 한다.

## Options Considered (고려한 대안)

### Option A: Talk-API 복구만으로 해결
- 설명: authHeader 재캡처/설정 정비로 Talk-API 100% 의존을 유지
- 장점: 멘션/Reply 등 고급 기능 유지
- 단점: Talk-API 장애 시 “발신 전체 중단”이 재발, 운영 연속성 취약

### Option B: 서버가 Talk-API 실패 시 자동 텍스트 폴백(조용한 폴백)
- 설명: `/send/talkapi/dispatch`가 실패하면 서버가 내부적으로 IRIS `/reply`로 텍스트를 대신 보내고 200을 반환
- 장점: 호출자는 단순해짐
- 단점: 장애가 감춰져 운영 탐지/복구가 늦어짐(금지), 멘션/Reply 불가를 호출자가 인지하기 어려움

### Option C: (선택) “명시적” IRIS 텍스트 브리지 + 워커/명령에서 폴백
- 설명:
  - Realtime API에 `POST /send/iris/reply_text`를 추가해 IRIS `/reply(type=text)`로 전달(서버가 SAFE_MODE 최종 차단).
  - 기존 `POST /send/iris/reply_media`(ADR-0030)와 함께 사용.
  - 워커/명령은 Talk-API 실패 시에만 **명시적으로** IRIS 폴백을 시도한다.
- 장점:
  - Talk-API 장애 시에도 최소 “텍스트/이미지 발신”은 유지(운영 연속성).
  - Talk-API 실패는 여전히 502로 드러나며(탐지 가능) 폴백은 호출자 로그로 추적 가능.
- 단점:
  - 폴백 경로에서는 멘션/Reply 불가(텍스트만).
  - 이미지 폴백은 URL→base64 다운로드가 필요하며 실패 가능.

## Decision (결정)

**Option C를 채택한다.**

구현 핵심:
- Realtime API
  - `POST /send/iris/reply_text` 추가 (`server/app.py`)
  - 기존 `POST /send/iris/reply_media` 유지(ADR-0030)
- Node 워커/명령
  - Talk-API 실패 시 텍스트는 `/send/iris/reply_text`로 폴백
  - Talk-API가 연속 실패할 때는 일정 시간 Talk-API 호출을 스킵하고 IRIS 폴백으로 즉시 전환한다(기본 30초, env: `TALKAPI_FAILURE_COOLDOWN_MS`)
  - 이미지 URL만 있는 경우 URL→base64로 변환 후 `/send/iris/reply_media`로 폴백
  - 멘션 API가 없을 때는 예외로 종료하지 않고 “일반 텍스트”로 degrade

### Invariants (불변식)
- SAFE_MODE=true면 서버가 최종적으로 403으로 차단한다(모든 발신 경로 공통).
- Talk-API 엔드포인트는 실패를 숨기지 않는다(`talkStatus != 0`이면 502).
- 운영방(실제 톡방)에는 “Reply 불가/장애” 같은 진단 문구를 발신하지 않는다. 운영자 알림은 **테스트용 오픈채팅방(`18462226881291012`)으로만** 남긴다.
- IRIS 폴백은 “텍스트/이미지”만 다룬다(멘션/Reply 없음).

## Consequences (결과)

### 긍정적 효과
- Talk-API 장애에도 welcome/ai/공지의 “최소 발신”이 유지되어 운영 다운타임/무응답을 줄인다.
- Talk-API 장애는 502로 지속 노출되어 운영자가 원인(authHeader, 관리자만 채팅 등)을 추적/복구하기 쉽다.

### 부정적 효과 / 리스크
- 폴백 경로의 메시지는 멘션/Reply가 아닌 “일반 메시지”로만 발신된다(기능 저하).
- 이미지 폴백은 URL 다운로드 실패/타임아웃에 취약하다(베스트 에포트).

### 후속 작업
- [ ] 문서 업데이트: `docs/ops/send-guardrails.md`, `docs/reference/verification-commands.md`, `agents.md`
- [ ] 운영 점검: Talk-API authHeader 재캡처/검증 절차(ADR-0024) 정기화

## Links

- Related ADR: `docs/adr/ADR-0030-welcome-worker-image-send-via-iris-reply.md`
- Related ADR: `docs/adr/ADR-0027-core-logstore-and-feature-workers.md`
- Related ADR: `docs/adr/ADR-0028-ai-worker-from-logstream.md`
- Related ADR: `docs/adr/ADR-0029-broadcast-worker-from-logstream.md`
- Code:
  - `server/app.py` (`/send/iris/reply_text`)
  - `node-iris-app/src/utils/iris.ts`
  - `node-iris-app/src/workers/welcome_worker.ts`
  - `node-iris-app/src/workers/ai_worker.ts`
  - `node-iris-app/src/workers/broadcast_worker.ts`
  - `node-iris-app/src/utils/sender.ts`
