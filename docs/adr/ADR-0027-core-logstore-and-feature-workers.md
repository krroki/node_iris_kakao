# ADR-0027: 코어(LogStore) 상시 가동 + 기능(Feature) 워커 분리 (첫 타겟: Welcome)

## Meta

- **Date**: 2025-12-14
- **Status**: Accepted
- **Authors**: 사용자, Codex CLI
- **Related**: ADR-0016(SAFE_MODE), ADR-0017(Status API), ADR-0019(로그 파이프라인), ADR-0022/0026(Welcome), docs/runbook_redroid_iris.md, agents.md
- **Related Session**: `docs/sessions/fix-kb-routing-and-schedule.md`

## Context (배경)

현재 구조는 “IRIS 이벤트 수신/로그 저장”과 “각종 기능(Welcome/AI/Reply/공지 등)”이 같은 프로세스(봇) 안에 결합되어 있다.
이로 인해 다음 문제가 반복 발생했다.

- 기능 코드 수정/배포 시 봇 전체 재시작이 필요하여, **수신/로그 파이프라인까지 함께 다운**되는 경우가 생긴다.
- “welcome”은 특히 운영 변화가 잦은데(템플릿/멘션/분기/후속 답장), 결합 구조에서는 수정 중 전체가 흔들린다.
- 사용자는 “IRIS에서 기본 제공되는 welcome 멘트(또는 운영자가 의도하지 않은 템플릿)”가 발송되는 것을 원하지 않으며,
  **운영자가 지정한 템플릿만** 사용되어야 한다.
- 서버가 꺼지거나 작업을 다시 시작했을 때 “자동으로 다시 진행”이 잘 되지 않는다는 운영 불만이 있었다.
  (프로세스 단위 복구/관측/재기동 체계를 더 명확히 해야 함)

요구 조건:

- 코어(수신/로그 저장)는 **항시 가동**을 목표로 한다.
- 기능은 모듈(=별도 프로세스)로 분리하여 **개별 재시작/배포** 가능해야 한다.
- SAFE_MODE/allowlist 가드레일은 기능 분리 후에도 깨지면 안 된다.
- “조용한 폴백” 금지: 템플릿이 없으면 기본 문구로 보내지지 않아야 한다.

## Options Considered (고려한 대안)

### Option A: 현재처럼 단일 봇 프로세스 유지(Feature flag만 강화)

- 설명: welcome/ai/공지 등을 계속 컨트롤러 내부에서 처리하되, 옵션/예외를 늘린다.
- 장점: 구현이 가장 단순, 프로세스 수가 늘지 않는다.
- 단점: 기능 수정/장애가 코어(수신/로그)까지 영향을 준다. 운영 중단 리스크가 가장 큼.

### Option B: 단일 프로세스 내부에서 플러그인(동적 로딩) 구조로 분리

- 설명: 같은 프로세스 안에서 기능을 모듈로 쪼개고, 동적으로 enable/disable 한다.
- 장점: 코드 구조는 개선되지만 프로세스는 1개라 운영 단순.
- 단점: 여전히 프로세스 재시작/메모리 누수/의존성 충돌 시 코어까지 영향을 받는다.

### Option C: 코어(LogStore) + 기능 워커(별도 프로세스)로 분리 (선택)

- 설명:
  - 코어 봇은 IRIS 이벤트를 받아 **로그(MessageStore)로 저장**만 “항시” 수행한다.
  - welcome 같은 발신 기능은 **별도 워커 프로세스**가 로그 스트림을 구독하여 처리한다.
  - 워커는 Realtime API의 Talk-API dispatch 엔드포인트를 통해 발신한다.
- 장점:
  - 기능 장애/재시작이 코어(수신/로그)에 영향을 최소화한다.
  - watchdog/운영 스크립트에서 “기능만 재기동”이 가능해진다.
  - 템플릿/분기 정책을 워커에 고립시켜, “기본 문구 발송” 같은 사고를 줄인다.
- 단점/리스크:
  - 프로세스 수 증가(관측/재기동 대상 증가).
  - 워커는 IRIS ChatContext가 없으므로, **welcome 이미지 발송**은 1차 범위에서 제외(텍스트/멘션 우선) 또는 추가 구현이 필요.

## Decision (결정)

**우리는 Option C(코어 + 기능 워커 분리)를 채택한다.**
첫 번째 분리 대상은 “welcome(텍스트/멘션) + welcomeFollowUp(Reply)”로 한다.

그 이유는:
1. welcome은 변경/실험 빈도가 높아, 코어 안정성에 가장 큰 영향을 준다.
2. welcome이 ‘의도하지 않은 템플릿’을 발송하는 사고를 막기 위해, “템플릿 미설정이면 스킵”을 워커에서 강제하기 쉽다.
3. Reply(후속 답장)는 Talk-API raw 발신으로 구현 가능하여, 워커 분리 효과가 즉시 크다.

### Invariants (불변식)

- **SAFE_MODE=true면 어떤 워커도 발신하지 않는다.** (최종 차단은 Realtime API /send/talkapi/*)
- allowlist(`runtime.json.allowedRoomIds`) 밖 방에는 워커가 발신하지 않는다.
- 템플릿이 없거나 불완전하면 **발신하지 않고 스킵/로그**한다. (기본 문구 폴백 금지)
- welcome 템플릿 이름은 “숫자만” 또는 `welcome_default_*` 류 기본값을 **사용 경로에서 차단**한다. (ADR-0022)
- 코어는 “수신/로그 저장”을 최우선으로 하며, 기능 변경은 코어 다운타임을 최소화하는 방향으로만 한다.
- 테스트 커맨드(`!welcome:test`, `!reply:test`)는 **테스트 방(18462226881291012)에서만** 실행한다. (운영 방 오발신 방지)

## Consequences (결과)

### 긍정적 효과

- 기능 수정/추가(특히 welcome)가 코어 안정성에 미치는 영향이 줄어든다.
- watchdog/운영 스크립트에서 기능 워커만 재기동 가능해 장기 운영성이 좋아진다.

### 부정적 효과 / 리스크

- 프로세스가 늘어나므로, “어느 프로세스를 재시작해야 하는지”를 문서/스크립트로 명확히 해야 한다.
- welcome 이미지 발송은 1차 워커 분리에서 제외될 수 있다(텍스트 우선). 필요 시 후속 ADR/구현으로 확장한다.

### 운영: 재기동 기준(SSOT)

**원칙: 부분 재기동 우선.** “항상 start_all”은 코어/워커 분리 취지에 반한다.

- `windows/start_all.cmd`: 콜드 부팅/전체 복구(PC 재부팅 직후, 포트/프로세스 꼬임, web 404/산출물 파손, env 드리프트 등)
- 그 외 배포/수정은 변경한 컴포넌트만 재기동:
  - welcome-worker: `windows/start_welcome_worker.ps1 -Restart`
  - bot: `windows/start_bot.ps1 -Restart`
  - API(server): `windows/start_api.ps1 -Port 8650`
  - web(UI): `windows/start_web.ps1 -Mode prod -Port 3100 -ForceKillPort`

관련 문서:
- `agents.md` (가장 먼저 읽는 운영 지침)
- `docs/reference/verification-commands.md` (명령어 SSOT)

### 후속 작업

- [x] 문서: 워커 분리/재기동 절차를 `agents.md`와 runbook에 반영
- [x] 코드: join 이벤트를 로그에 기록하고, welcome-worker가 이를 구독해 발신하도록 구현
- [x] 코드: 기존 봇 프로세스에서 welcome 발신/후속 답장 트리거를 기본 비활성화(코어 역할로 축소, `WELCOME_DISPATCHER=bot` 롤백 가능)
- [x] 운영: `start_all.cmd/.ps1`, watchdog에서 welcome-worker 자동 기동/복구 추가
- [x] 테스트: welcome-worker의 중복 방지(dedup), SAFE_MODE/allowlist 준수, Reply payload(coerce) 회귀 테스트

## Links

- Code:
  - `node-iris-app/src/controllers/CustomNewMemberController.ts`
  - `node-iris-app/src/services/messageStore.ts`
  - `node-iris-app/src/services/welcomeFollowUp.ts` (기존 구현; 워커로 이관)
  - `server/app.py` (`/send/talkapi/dispatch*`)
  - `windows/start_all.ps1`, `windows/watchdog.ps1`
- Related ADR:
  - `docs/adr/ADR-0022-welcome-template-sets-and-kakao-default-nickname.md`
  - `docs/adr/ADR-0026-welcome-followup-first-image-reply.md`
