# 카카오톡 오픈채팅 “멘션(@)” / “답장(Reply)” 발신 구현 레퍼런스

> **목적**: “텍스트에 `@이름`을 쓰는 것”이 아니라, 카카오톡 UI에서 실제 **멘션/답장**으로 렌더링되도록 하는 구현 경로를 정리한다.  
> **대상**: node-iris-app(봇) ↔ server(FastAPI Realtime API) ↔ Talk-API 연동을 유지보수/확장하는 작업.

---

## 0) 큰 그림(데이터 흐름)

1. **node-iris-app(봇)**: 메시지/이벤트를 받고 “멘션/답장” 발신 payload를 준비한다.
2. **server(FastAPI Realtime API)**: SAFE_MODE/런타임 가드레일을 최종 적용하고, Talk-API로 전달할 payload를 만든다.
3. **Talk-API(외부)**: `authHeader(accessToken-deviceUUID)`로 카카오 내부 API에 실제 발신한다.

관련 불변식(중요):
- SAFE_MODE가 켜져 있으면 멘션/답장 포함 **모든 발신이 차단**되어야 한다.
- Talk-API가 실패하면(예: `talkStatus=-500`) 멘션/답장 기능은 **대체 불가**다.
  - 운영 연속성을 위해 IRIS `/reply_text` 폴백(ADR-0034)을 허용할 수 있으나, 이 경우 카카오톡 UI에서 “진짜 멘션/답장”으로 렌더링되지 않는다.
  - 혼란 방지를 위해 폴백 텍스트에서는 `@닉네임`을 `닉네임`으로 치환한다(가짜 멘션 금지).

---

## 1) “멘션(@)” 기능 구현 방법

### 1.1 핵심: 실제 멘션은 `attachment.mentions`가 있어야 한다

- 단순히 메시지에 `@이름` 문자열을 포함하는 것은 “표시”일 뿐, 카카오톡이 멘션으로 처리하지 않는다.
- 오픈채팅 멘션은 payload에 아래 구조가 필요하다:
  - `attachment.mentions: [{ user_id, at:[1..], len }]`
  - `at`는 **문자 offset이 아니라** “멘션 등장 순서(1-based)”다.
  - `len`은 닉네임 길이(UTF-16 code unit)로 계산해야 한다(이모지 포함 시 중요).

### 1.2 구현 경로(권장): Realtime API의 Talk-API 경유 `/send/talkapi/dispatch`

- Node 호출 진입점:
  - `node-iris-app/src/utils/sender.ts:177` `safeReplyWithMentions(logger, context, message, mentionees)`
- 내부 동작:
  1. SAFE_MODE면 즉시 스킵
  2. 메시지 내에 `@{name}` 토큰(`@닉네임`)이 실제로 존재하는지 검증하며 mention struct를 구성
  3. mentionee에 `userId`가 있으면 Realtime API로 위임:
     - `node-iris-app/src/utils/talkapi.ts:3` `tryServerTalkApiDispatch(...)`
     - `POST {REALTIME_API_BASE}/send/talkapi/dispatch` `{ roomId, message, mentionees:[{name,userId}] }`
- Server 동작:
  - `server/app.py`의 `_make_mention_attachment(...)`가 LOCO-style `attachment.mentions`를 만든 뒤 Talk-API로 전달한다.

### 1.3 멘션 구현 시 주의사항(운영 함정)

- **멘션은 최대 15명 제한**: `safeReplyWithMentions`/server 모두 15명 초과면 실패 처리한다.
- message에 `@닉네임`이 **정확히 포함**되어야 한다:
  - 멘션 위치(`at`) 계산이 “토큰 등장 순서” 기반이라서, 토큰이 없으면 실패한다.
  - 템플릿에서는 `@{entrance}` 같은 플레이스홀더를 쓰고, 렌더링 결과에 `@닉네임`이 반드시 남게 해야 한다.
- mentionees는 `{name,userId}` 둘 다 필요:
  - `userId`가 없으면 Talk-API 경유 발신이 불가능하며, SDK mention API도 없는 환경에서는 실패한다.
- `userId` 확보 방법(실무):
  - IRIS DB `db2.open_chat_member`(멤버 목록 스크롤로 동기화) 또는 `scripts/openchat_load_members.ps1`로 강제 로딩
  - 대시보드(3100) 방 카드의 “멤버 보기” / Realtime API `GET /rooms/{roomId}/members`로 닉네임↔userId 조회

### 1.4 Welcome(환영)에서 멘션이 실제로 걸리는 구조

- (기본, ADR-0027) **welcome-worker 분리 구조**
  - 코어(bot)는 신규 입장 이벤트를 **`member_joined`로 로그만 기록**한다:
    - `node-iris-app/src/controllers/CustomNewMemberController.ts`
  - `welcome-worker`가 `/logs/stream`을 구독해 join 배치를 구성하고,
    템플릿 렌더링(`@{entrance}` → `@닉네임`) 후 Talk-API 경유 발신을 수행한다:
    - `node-iris-app/src/workers/welcome_worker.ts`
- (레거시/롤백) `WELCOME_DISPATCHER=bot`이면 bot 프로세스가 직접 welcome 발신을 수행한다:
  - `node-iris-app/src/controllers/CustomNewMemberController.ts`
- 템플릿 정책/세트 모드 관련 결정은 ADR-0022 참고.

### 1.5 Welcome 템플릿 이미지 발신(ADR-0030)

- 템플릿 JSON의 `images`(예: `assets/welcome/<name>/<file>.png`)는 welcome-worker가 `resolveTemplateImageUrls()`로
  `GET {REALTIME_API_BASE}/templates/assets/...` URL로 변환해 다운로드한다.
- 다운로드한 바이너리를 base64로 변환해 Realtime API `POST {REALTIME_API_BASE}/send/iris/reply_media`로 전달한다.
- Realtime API는 SAFE_MODE를 최종 체크한 뒤 IRIS `/reply`에 `type=image|image_multiple`로 전달해 이미지 메시지를 발신한다.
- 관련 코드:
  - `node-iris-app/src/workers/welcome_worker.ts`
  - `node-iris-app/src/utils/iris.ts`
  - `server/app.py` (`/send/iris/reply_media`)

---

## 2) “답장(Reply)” 기능 구현 방법

### 2.1 핵심: Reply는 `type=26 + attachment.src_*`여야 한다

카카오톡 UI에서 “답장”으로 렌더링되려면 아래 형태가 필요하다:

- `type = 26`
- `attachment`에 원본 메시지 메타 포함:
  - `src_logId`: 원본 메시지 logId (string)
  - `src_userId`: 원본 발신자 userId
  - `src_linkId`: 방의 open link id (`chat_rooms.link_id`)
  - `src_type`: 원본 메시지 type (예: 사진=2)
  - `src_message`: 원본 메시지 텍스트(사진이면 `"photo"`/`"사진"` 등)

※ 단순히 메시지에 `@`를 붙이는 것은 Reply가 아니다.

### 2.2 구현 경로: Realtime API의 Talk-API 경유 `/send/talkapi/dispatch_raw`

- Node 호출 진입점:
  - `node-iris-app/src/utils/talkapi.ts:44` `tryServerTalkApiDispatchRaw(...)`
  - `POST {REALTIME_API_BASE}/send/talkapi/dispatch_raw` `{ roomId, message, type, attachment }`

### 2.3 Reply에서 가장 중요한 함정: Talk-API `INVALID_ARGUMENT(-203)`와 타입 강제 변환

- Node(JS)는 64-bit userId(2^53 초과)가 많아 `number`로 안전하게 다룰 수 없다.
- 그래서 Node → Realtime API로는 `src_userId/src_linkId/src_type`를 **문자열로 전달**한다.
- 하지만 Talk-API는 Reply(`type=26`)에서 위 필드들을 **int(number)** 로 요구하는 케이스가 확인됐고,
  string이면 `INVALID_ARGUMENT(-203)`로 실패할 수 있다.
- 해결(SSOT):
  - `server/app.py`의 `/send/talkapi/prepare_raw`, `/send/talkapi/dispatch_raw`에서
    `type=26`이면 `attachment.src_userId/src_linkId/src_type`(및 `attach_type`가 있으면 포함)을
    **숫자형 문자열 → int로 강제 변환(coerce)** 후 Talk-API로 전달한다.

### 2.4 Welcome 후속(첫 이미지) 자동 Reply가 동작하는 구조

- (기본, ADR-0027) **welcome-worker 분리 구조**
  - 코어(bot)는 채팅 메시지를 `message`로 기록하면서 `messageType`을 함께 남긴다(워커 트리거 판단용):
    - `node-iris-app/src/controllers/CustomChatController.ts`
  - `welcome-worker`는 welcome 발신 성공 이후 entrant를 5분(windowMs) 추적하고,
    **첫 이미지(messageType=2/27/71, 16384 플래그 제거)** 에 `type=26` Reply를 1회 발신한다:
    - `node-iris-app/src/workers/welcome_worker.ts`
  - Reply 메타:
    - `src_linkId`는 IRIS `/query`로 `select link_id from chat_rooms where id=?`를 조회/캐시
    - `type=26` + `replyAttachment(src_*)`로 `/send/talkapi/dispatch_raw` 호출
- (레거시/롤백) `WELCOME_DISPATCHER=bot`이면 bot 프로세스의 `welcomeFollowUp`가 트리거를 처리한다:
  - `node-iris-app/src/services/welcomeFollowUp.ts`

---

## 3) 안전한 점검(발신 없이 payload만 확인)

실발송을 피하고 payload 형태만 확인하려면 아래를 사용한다:

- 멘션 payload 준비만: `POST http://127.0.0.1:8650/send/talkapi/prepare`
- raw payload 준비만: `POST http://127.0.0.1:8650/send/talkapi/prepare_raw`

주의:
- SAFE_MODE=true면 dispatch 계열은 차단되지만, prepare 계열은 “준비만” 하므로 점검에 안전하다.

---

## 4) 관련 문서/코드 포인터(새 세션 온보딩용)

- 운영 가드레일/원칙: `agents.md`, `docs/ops/send-guardrails.md`
- 스모크 절차: `docs/reference/verification-commands.md`
- 결정 근거:
  - 멘션/Talk-API 인증: `docs/adr/ADR-0024-talkapi-authheader-capture.md`
  - Welcome 세트/멘션 변수: `docs/adr/ADR-0022-welcome-template-sets-and-kakao-default-nickname.md`
  - Welcome 후속 Reply: `docs/adr/ADR-0026-welcome-followup-first-image-reply.md`
  - Welcome 템플릿 이미지 발신: `docs/adr/ADR-0030-welcome-worker-image-send-via-iris-reply.md`
- 핵심 코드:
  - 멘션: `node-iris-app/src/utils/sender.ts`, `node-iris-app/src/utils/talkapi.ts`, `server/app.py`(`_make_mention_attachment`)
  - Welcome(기본): `node-iris-app/src/workers/welcome_worker.ts` (core는 `member_joined` 기록만)
  - Reply(기본): `node-iris-app/src/workers/welcome_worker.ts`, `server/app.py`(`_coerce_reply_attachment_types`)
  - Reply(레거시): `node-iris-app/src/services/welcomeFollowUp.ts`, `server/app.py`(`_coerce_reply_attachment_types`)

---

## 5) 트러블슈팅: 멘션이 `@닉네임` 텍스트로만 보일 때

대부분 아래 케이스다:

- **Talk-API 전송 실패 → 텍스트 폴백으로 내려감**
  - 확인 방법(권장):
    - 대시보드(3100) `봇/워커 프로세스` 카드의 **Talk-API 태그** 확인
    - 또는 상태 파일 확인: `node-iris-app/data/talkapi_status.json`
  - 자주 보이는 상태:
    - `talkStatus = -500` (Talk-API는 응답했지만 “카카오 내부 발신”이 실패한 상태)
  - 이 상태에서는:
    - `attachment.mentions`가 전달되더라도 실제 발신이 실패하므로 **멘션/답장 렌더링을 기대할 수 없다**
    - 폴백 텍스트는 혼란 방지 목적으로 `@`를 제거한다(“멘션처럼 보이는 텍스트” 금지)

다음 조치(근본 해결):
- Redroid 카카오톡 **로그인 상태/세션 유지** 확인
- Talk-API `authHeader(accessToken-deviceUUID)` 재캡처/갱신(관련 ADR 참고: `docs/adr/ADR-0024-talkapi-authheader-capture.md`)
