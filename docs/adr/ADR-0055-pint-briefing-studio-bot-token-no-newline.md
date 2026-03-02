# ADR-0055: Pint Briefing Studio 봇 토큰 동기화(개행/CRLF 혼입 방지)

## Meta

- **Date**: 2026-02-28
- **Status**: Accepted
- **Authors**: 정영록, GPT-5.2 (Codex)
- **Related Session**: `docs/sessions/main.md`

## Context (배경)

- 12.kakao `command-worker`는 4.pint의 Briefing Studio 대기열을 폴링한다.
  - `GET https://pint.kr/api/briefing-studio/bot/next`
  - `Authorization: Bearer <token>`
- 폴링이 `403 forbidden`이면 실전 발신(서비스방)이 중단된다.

## Problem (문제)

- Vercel production에 설정된 `PINT_BRIEFING_BOT_TOKEN`과 12.kakao의 `PINT_BRIEFING_BOT_TOKEN`이 **겉보기에는 동일**해도,
  실제 값에 **개행(CRLF) 또는 보이지 않는 공백**이 섞이면 `presented !== token` 비교에서 403이 발생한다.

## Decision (결정)

- `PINT_BRIEFING_BOT_TOKEN`은 **반드시 “개행 없는 1줄 문자열”**로 저장한다.
- Vercel production에 토큰을 반영할 때는, 파이프/복사로 값이 변형되지 않도록 **개행 없는 입력 경로**를 사용한다.

## Consequences (결과)

### 긍정적 효과

- 403(권한 없음) 재발을 크게 줄인다.
- 운영자가 “토큰은 맞는데 왜 403이지?”를 반복 디버깅하지 않게 된다.

### 운영/검증 포인트

- 토큰 반영 후 production redeploy를 수행해야 실제 함수 런타임에 적용된다.
- 정상 여부는 아래로 판정한다:
  - `/api/briefing-studio/bot/next`가 `200(ok=true)`로 응답

## Links

- Reference: `docs/reference/pint-openchat.md` (403 체크리스트 포함)
- 4.pint Bot API: `/api/briefing-studio/bot/next`, `/api/briefing-studio/bot/ack`
- 12.kakao polling: `node-iris-app/src/workers/command_worker.ts` (`tickPintBriefingStudioPolling`)

