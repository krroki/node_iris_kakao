# ADR-0037: 무명령어 자동 FAQ(auto-faq-worker) – 로그 스트림 기반 Reply + 이미지(업로드) 지원

## Meta

- **Date**: 2025-12-17
- **Status**: Accepted
- **Authors**: 사용자, Codex CLI
- **Related**: ADR-0027(core+feature workers), ADR-0035(command-worker), ADR-0036(outbound message style), `docs/reference/auto-faq-worker.md`
- **Related Session**: `docs/sessions/main.md`

---

## Context (배경)

오픈채팅 운영 중 반복 질문(결제/무료강의/다시보기/보너스 등)이 누적되며, 매번 운영자가 수동으로 답변하면 운영 비용이 과도하다.
또한 “명령어(`!`) 기반 FAQ”는 일부 상황에서 유효하지만, 실제 사용자는 명령어를 기억하지 못하고 **일반 채팅으로 질문**하는 경우가 많다.

요구 조건:

- 질문이라고 해서 `?`가 항상 붙지 않는다.
- 오답/오인식(질문 아닌데 답변, 엉뚱한 답변) 방지가 최우선이다. **애매하면 침묵**한다.
- 답변은 **답장(Reply) 우선**으로 발신한다(모바일 UI에서 맥락이 유지되어야 함).
- 이미지가 필요한 답변은 “외부 URL”이 아니라, 운영자가 UI에서 업로드한 이미지(templates assets)만 사용한다.
- 스코프는 운영 편의상 **전역 / 강의ID / 방별** 3종으로 분리해 관리한다.
- 코어(LogStore)는 흔들리지 않아야 하므로(ADR-0027) 자동응답은 **별도 워커 프로세스**로 분리한다.

---

## Decision (결정)

### 1) auto-faq-worker 도입 (feature-worker)

- `auto-faq-worker`는 Realtime API의 SSE(`/logs/stream`)를 구독해 `payloadType=message` 중 **텍스트(messageType=1)** 만 대상으로 삼는다.
- 스태프/관리자/봇(iris 포함) 메시지는 자동응답에서 **무시**한다(루프/오인식 방지).
- 룸별 feature flag: `runtime.features[roomId].autoFaq === true` 인 방에서만 작동한다.
- 발신은 Talk-API Reply(type=26) 기반으로 수행한다.
  - Reply attachment는 `src_*`(원문 logId/userId/linkId/type/message)를 포함해야 UI에서 “답장”으로 렌더링된다.

### 2) 설정/스코프 모델

- 설정 파일: `node-iris-app/data/auto_faq_config.json`
- 스코프 3종:
  1) `room` (방별)
  2) `lectureId` (강의ID)
  3) `global` (전역)
- 충돌 우선순위: `room > lectureId > global`
- 매칭 결과가 2개 이상(ambiguous)이면 기본은 **발신하지 않는다**.
  - 단, 스코프/priority로 “명확한 1개”가 결정되는 경우에만 1개로 수렴한다(레퍼런스 참고).
- 매칭 타입:
  - `exact_norm`: 정규화된 문장 **완전 일치**만 허용하며, 문장 끝의 `?`/`!`/`.` 같은 구두점은 제거해 매칭한다.
  - `regex`: UI 저장 시점(`/api/auto-faq/config`)에서 컴파일 검증을 수행하며, **유효하지 않은 정규식이 있으면 저장 자체가 실패**한다.
- 동일 사용자 + 동일 트리거는 쿨다운(dedup)으로 중복 발신을 방지한다.

### 3) 이미지 발신 정책

- 이미지 소스는 **외부 URL 금지**(운영자가 UI에서 업로드한 templates assets만).
- 이미지 여러 장은 IRIS `/reply` 브리지로 **묶음 1회(image_multiple)** 발신한다.
- 텍스트 답변(Reply) 1회 + 이미지 묶음 1회를 **최대 2회 발신**한다.
  - 순서: Reply 성공 후 이미지 발신(best-effort).

### 4) “매주 바뀌는 링크/일정” 처리 (KB 기반)

- 자동응답에서 링크/일정은 **절대 추측/하드코딩하지 않는다**(FALLBACK 금지).
- KB 서비스가 제공하는 “최근 글 조회” 경량 API를 사용한다:
  - `kb/service.py` `GET /posts/recent` (menu_ids, limit, keywords, include_norm_text)

### 5) 운영/기동/감시 연동

- 기동 스크립트: `windows/start_auto_faq_worker.ps1`
- 전체 기동: `windows/start_all.ps1`에서 기본 포함(비활성화는 `AUTO_FAQ_WORKER_DISABLE=1`)
- watchdog 감시/재시작: `windows/watchdog.ps1`에 heartbeat 기반 stage 추가
- 프로세스 UI: `web/src/app/api/bot/processes/route.ts` expectedKinds에 `auto-faq-worker` 포함
- 운영 UI(`/auto-faq`):
  - “워커 상태”(heartbeat/최근 발신/스킵 사유) 표시
  - “최근 이벤트” (최대 80건 ring-buffer)
  - “매칭 시뮬레이터(발신 없음)”로 트리거/응답 미리보기 제공

---

## Invariants (불변식)

- SAFE_MODE가 켜져 있으면 발신은 최종적으로 차단되어야 한다(Realtime API).
- allowlist(`runtime.allowedRoomIds`) 밖 방에는 발신하지 않는다.
- 링크/일정/가격은 KB에 근거한 실제 게시글 URL만 제공한다(없으면 침묵).
- 운영방에 디버그/로그/타임스탬프/보고서형 섹션을 노출하지 않는다(ADR-0036).

---

## Links

- 코드:
  - `node-iris-app/src/workers/auto_faq_worker.ts`
  - `web/src/app/auto-faq/page.tsx`
  - `web/src/app/api/auto-faq/config/route.ts`
  - `kb/service.py` (`GET /posts/recent`)
  - `windows/start_auto_faq_worker.ps1`, `windows/start_all.ps1`, `windows/watchdog.ps1`
- 레퍼런스:
  - `docs/reference/auto-faq-worker.md`
  - `docs/reference/outbound-message-style.md`
