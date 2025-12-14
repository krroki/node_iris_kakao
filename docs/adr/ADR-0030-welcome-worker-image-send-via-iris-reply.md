# ADR-0030: Welcome-worker 템플릿 이미지 발신을 IRIS /reply로 복구 (Realtime API 브리지)

## Meta

- **Date**: 2025-12-14
- **Status**: Accepted
- **Authors**: (Operator), OpenAI GPT-5.2
- **Related Session**: `docs/sessions/fix-kb-routing-and-schedule.md`

## Context (배경)

- ADR-0027로 **welcome 발신을 bot → welcome-worker**로 분리하면서, worker는 1차 범위에서 **템플릿 이미지 발신을 스킵**했다.
- 기존 bot 경로는 `safeReplyImageUrls()`가 **이미지 URL 다운로드 → base64 변환 → IRIS `/reply` 호출** 방식으로 이미지를 보낼 수 있었다.
- 운영 요구사항:
  - welcome은 **내가 지정한 템플릿(텍스트+이미지)만** 발신되어야 한다.
  - **SAFE_MODE=true면 어떤 발신도 불가**하며, 최종 차단은 Realtime API가 책임진다.
  - 기능 분리(워커 구조)는 유지해야 한다.

## Options Considered (고려한 옵션)

### Option A: Talk-API raw(type=27, `attachment.imageUrls`)로 템플릿 이미지를 발신
- 장점: worker의 기본 발신 경로(Talk-API)와 일관.
- 단점: welcome 템플릿 이미지는 **로컬 assets 기반**이 많아 “카카오 CDN imageUrls” 형태로 바로 재사용하기 어렵다(형태/제약/인증).

### Option B: welcome 이미지만 bot 경로로 유지(= `WELCOME_DISPATCHER=bot` 롤백)
- 장점: 기존 이미지 발신이 그대로 동작.
- 단점: “코어 상시 + 기능 워커 분리” 목적을 훼손하고, 유지보수/복구(Watchdog) 복잡도가 증가한다.

### Option C: Realtime API에 IRIS `/reply` 브리지 API를 추가하고, welcome-worker가 base64로 호출 (**선택**)
- 흐름:
  1) welcome-worker가 템플릿 이미지 URL(`/templates/assets/...`)을 다운로드해 base64로 변환  
  2) Realtime API `POST /send/iris/reply_media` 호출  
  3) Realtime API가 SAFE_MODE를 최종 체크 후 IRIS `/reply`로 전달
- 장점:
  - **SAFE_MODE 최종 차단** 책임을 Realtime API에 유지
  - 서버는 URL fetch를 하지 않고 **base64만 받아 SSRF 위험을 줄임**
  - 워커 구조 유지 + 기존 “IRIS `/reply` 기반 이미지 발신” 기능을 복구

## Decision (결정)

**Option C를 채택한다.**

### Invariants (불변 조건)

- `runtime.json.safeMode=true`이면 Realtime API `/send/iris/reply_media`는 **항상 403(SAFE_MODE)** 로 차단한다.
- Realtime API는 **base64만 입력으로 받으며**, 서버가 임의 URL을 fetch하지 않는다(SSRF 방지).
- Realtime API 응답/로그에 base64 본문을 포함하지 않는다(응답/로그 폭증 방지).
- welcome 텍스트 발신 성공 이후에 follow-up 추적을 시작하며, 이미지 발신 실패는 follow-up을 막지 않는다(레거시 동작 정합).

## Consequences (결과)

### 긍정적 효과
- welcome-worker 분리 구조를 유지하면서 **welcome 템플릿 이미지 발신이 복구**된다.
- SAFE_MODE 최종 차단이 Realtime API에 유지되어 운영 가드레일이 단단해진다.

### 부정적 효과 / 리스크
- 이미지 다운로드/변환으로 welcome-worker의 처리 시간이 늘어날 수 있다(최대 6장, 1장당 15초 타임아웃으로 제한).
- IRIS `/reply`가 불안정하면 이미지 발신이 실패할 수 있다(텍스트/후속 Reply와는 분리).

### 후속 작업
- [x] Realtime API `/send/iris/reply_media` 추가: `server/app.py`
- [x] Node util 추가: `node-iris-app/src/utils/iris.ts`
- [x] welcome-worker 이미지 발신 복구: `node-iris-app/src/workers/welcome_worker.ts`
- [x] 문서 갱신: `docs/adr/README.md`, `docs/ops/send-guardrails.md`, `docs/reference/kakao-mentions-and-reply.md`, `docs/reference/verification-commands.md`, `docs/ssot.md`

## Links

- Related ADR: `docs/adr/ADR-0027-core-logstore-and-feature-workers.md`, `docs/adr/ADR-0022-welcome-template-sets-and-kakao-default-nickname.md`, `docs/adr/ADR-0026-welcome-followup-first-image-reply.md`
- Code:
  - `server/app.py` (`/send/iris/reply_media`)
  - `node-iris-app/src/utils/iris.ts`
  - `node-iris-app/src/workers/welcome_worker.ts`

