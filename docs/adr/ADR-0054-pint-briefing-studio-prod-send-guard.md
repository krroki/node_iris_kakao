# ADR-0054: Pint Briefing Studio 실전 발신(묶음) 가드 및 운영 경로

## Meta

- **Date**: 2026-02-28
- **Status**: Accepted
- **Authors**: 정영록, GPT-5.2 (Codex)
- **Related Session**: `docs/sessions/main.md`

## Context (배경)

- 4.pint 오픈채팅(서비스방)에 Pint 브리핑을 “이미지(여러 장) + 텍스트 상세” 형태로 안정적으로 발송해야 한다.
- 과거에는 12.kakao가 Pint API를 직접 조회해 텍스트를 구성/발송했지만, 브리핑 품질/표현/템플릿 변경이 잦아 유지보수 비용이 커졌다.
- 동시에, 오발송(다른 방으로 발송)과 내부 정보(디버깅 용어/식별자) 노출 리스크는 절대 허용되지 않는다.

## Options Considered (고려한 대안)

### Option A: 12.kakao가 데이터 수집 + 텍스트/이미지 렌더링까지 모두 담당
- 장점: 외부 서버 의존 최소화
- 단점: 렌더링/템플릿 유지보수 부담이 12.kakao에 집중, 운영 환경(윈도우/VM/브라우저) 변동에 취약

### Option B: 4.pint에서 “완성 브리핑(이미지+텍스트)” 생성, 12.kakao는 전송만 담당 (선택)
- 장점: 브리핑 품질/템플릿 SSOT가 4.pint로 모이고, 12.kakao는 단순 전송 파이프라인으로 안정화
- 단점: 4.pint 대기열/토큰/스케줄러가 안정적으로 운영돼야 함

## Decision (결정)

**우리는 Option B를 선택했다.**

4.pint가 브리핑을 완성(이미지+텍스트)해 대기열(job)로 만들고, 12.kakao는 이를 폴링해 카카오톡으로 “묶음 발송”한다.

### Extension (확장) — draft job 자동 렌더링(2026-03-01)

- 4.pint 스케줄러가 **이미지 URL 없이(draft+텍스트만)** job을 enqueue할 수 있다.
- 이 경우 12.kakao는:
  - 4.pint의 봇 전용 렌더 페이지(`/briefing-studio/bot/render/:jobId`)를 Playwright로 열어
    1080×1920 스크린샷을 만들고
  - 4.pint의 봇 전용 업로드 API(`POST /api/briefing-studio/bot/images`)로 업로드해 signed URL을 만든 뒤
  - 해당 URL들로 묶음 발송(`/send/pint/briefing_bundle`)을 수행한다.
- 핵심 원칙은 유지한다:
  - 템플릿/문구/레이아웃 SSOT는 4.pint
  - 12.kakao는 “결정(컨텐츠 선정)”이 아니라 “결정된 화면을 캡처/전송”만 수행

### Invariants (불변식)

- **오발송 방지**
  - 12.kakao의 묶음 발송 API는 **임의 roomId를 받지 않는다.**
  - `target=test|prod`만 받고, 런타임 설정으로 고정된 방으로만 보낸다.
- **실전 발신 가드**
  - `target=prod` 발신은 기본 차단이며, `runtime.json.pintBriefing.allowProdSend=true`일 때만 허용한다.
- **운영 알림 방 분리**
  - 운영 알림은 test open chat으로만 발신한다(서비스방 오염 금지).
- **텍스트 인코딩(UTF-8) 보장**
  - IRIS `/reply` 호출은 `Content-Type: application/json; charset=utf-8`를 명시한다. (한글/이모지 `?` 대체 사고 방지)
  - SSOT: `server/app.py`의 `_http_post_json`
- **노이즈 방지**
  - “대기열이 비어 있음/next 조회 일시 실패”는 조치 불가 케이스가 많으므로 운영 알림을 남발하지 않고 로그만 남긴다.
  - 토큰 미설정/발송 실패/ack 실패처럼 조치 가능한 케이스만 운영 알림으로 남긴다.

## Consequences (결과)

### 긍정적 효과
- 템플릿/문구/이미지 렌더링 변경이 4.pint로 집중되어, 12.kakao 운영 리스크가 감소한다.
- `allowProdSend` 가드로 실전 전환을 명시적 동작(의도적 토글)으로 고정해 오발송 위험을 낮춘다.

### 부정적 효과 / 리스크
- 4.pint의 대기열 생성/스토리지/토큰 동기화 문제가 발생하면 발송이 멈출 수 있다.
- 실전 전환 시(allowProdSend ON) 대기열에 남아 있던 `prod` job이 즉시 발송될 수 있으므로 운영자가 큐 상태를 확인해야 한다.

### 후속 작업
- [ ] (4.pint) 템플릿별 스케줄러/큐 정책을 SSOT로 정리(스케줄/빈도/중복 방지)
- [ ] (12.kakao) `/status`에 Briefing Studio polling 상태/최근 성공/실패 요약 노출(운영 가시성)

## Links

- Reference: `docs/reference/pint-openchat.md`
- Runtime: `node-iris-app/config/runtime.json` (`pintBriefing.testRoomId`, `allowProdSend`, `studioPolling`)
- Sender API: `server/app.py` (`POST /send/pint/briefing_bundle`)
- Polling worker: `node-iris-app/src/workers/command_worker.ts` (`tickPintBriefingStudioPolling`)

