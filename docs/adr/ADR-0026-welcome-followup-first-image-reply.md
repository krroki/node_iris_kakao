# ADR-0026: Welcome 후속(첫 이미지) 자동 답장(Reply)

## Meta

- **Date**: 2025-12-14
- **Status**: Accepted
- **Authors**: PM AI, Codex CLI
- **Related**: ADR-0016(SAFE_MODE), ADR-0022(Welcome 템플릿/멘션), ADR-0024(Talk-API authHeader), docs/ops/send-guardrails.md

---

## Context

운영 요구:

- welcome 기능이 켜진 방에서 신규 입장자를 멘션 포함 환영 문구로 안내한다.
- 환영을 받은 신규 입장자가 **입장 후 5분 이내**에 올리는 **첫 이미지 메시지(= 하트 인증샷으로 간주)** 에,
  봇이 해당 이미지 메시지에 **답장(Reply)** 으로 “감사합니다~ 편하게 소통해주시면 됩니다!” 류 안내를 **랜덤 1회** 발신한다.
- 트래킹 상태가 누적되어 메모리/운영 부담이 커지지 않도록 **TTL/상한**이 필요하다.

제약/가드레일:

- SAFE_MODE가 켜져 있으면 **모든 발신(멘션/답장 포함) 차단**.
- allowlist(`runtime.json.allowedRoomIds`) 밖은 발신 금지.
- “조용한 폴백” 금지: 설정/데이터가 불완전하면 임의 값으로 진행하지 말고 **명시적으로 스킵/로그 기록**.
- Reply는 “텍스트 @”가 아니라, 카카오톡의 “답장” 기능 payload(attachment의 `src_logId/src_userId/src_linkId/src_type/src_message`)로 구현해야 한다.

---

## Options Considered

### Option A: 이미지 내용(하트 UI) 판별 후 트리거

- 장점: 의도(하트 인증샷)와 트리거의 정합성이 높다.
- 단점: 이미지 분석/특징 추출/학습/오탐/성능/개발 비용이 과도하고 운영 리스크가 큼.

### Option B: “첫 이미지면 전부 하트 인증샷”으로 간주(채택)

- 장점: 구현 단순, 오탐(하트가 아닌 이미지) 리스크는 있으나 운영 비용/복잡도가 낮다.
- 단점: 의도와 무관한 첫 이미지에도 답장이 갈 수 있음.

---

## Decision

1. **트래킹 시작 시점**은 “welcome 텍스트 발신 성공 이후”로 고정한다. (결정 A)
2. **트리거 조건**:
   - 동일 사용자 기준 **입장 후 5분(windowMs=300_000) 이내**
   - **첫 이미지 메시지 1회**만 트리거
   - 이미지 판별이 어려운 경우를 고려해 **“이미지면 전부 하트 인증샷”** 으로 간주(Option B).
3. **답장 문구**는 여러 개를 설정하고 **랜덤 선택**한다.
4. **재시도**는 0회로 한다. (실패 시 즉시 트래킹 종료)
5. **적용 범위**:
   - welcome이 켜진 방에서 기본 활성
   - 방별로 추가 옵션으로 끄고/킬 수 있어야 한다.
     - 구현은 `runtime.features[roomId].welcomeFollowUp === false` 인 경우만 비활성(기본은 ON).

---

## Implementation

### 1) 런타임 설정

- 글로벌 설정:
  - `runtime.json.welcome.followUp.enabled`
  - `runtime.json.welcome.followUp.windowMs` (기본 300000)
  - `runtime.json.welcome.followUp.maxPendingPerRoom`
  - `runtime.json.welcome.followUp.replies` (비어 있으면 오류로 처리)
- 방별 비활성:
  - `runtime.features[roomId].welcomeFollowUp: false`

### 2) Node(IRIS) 서비스/연동

- 서비스: `node-iris-app/src/services/welcomeFollowUp.ts`
  - `trackAfterWelcomeSent(context, entrants)`:
    - welcome 텍스트 발신 성공 후, entrant들을 `roomId:userId` 키로 TTL(`expiresAt`)까지 추적한다.
    - 방별 pending 상한(`maxPendingPerRoom`)을 넘으면 명시적으로 스킵 기록.
  - `handleChatMessage(context)`:
    - 추적 중인 사용자가 이미지 첨부 메시지를 보내면,
      해당 메시지의 `logId`에 대해 Talk-API `dispatch_raw`로 Reply 1회 발신 후 상태 제거.
    - SAFE_MODE/allowlist 위반 시에도 상태를 종료하고 `dry_run`/skip reason을 기록한다.
    - “이미지” 판별은 `message.type` 기반(사진/멀티사진: 2/27/71, 16384 플래그는 제거)으로만 수행해
      텍스트/스티커/기타 메시지가 트래킹 상태를 소모하지 않도록 한다.
- 컨트롤러 연결:
  - `node-iris-app/src/controllers/CustomNewMemberController.ts`:
    - welcome 텍스트 발신 성공 직후 `trackAfterWelcomeSent` 호출.
  - `node-iris-app/src/controllers/CustomChatController.ts`:
    - 모든 채팅 메시지 기록 후 `handleChatMessage` 호출.
- 로그/관측:
  - `messageStore.record`로 `welcome_followup_*` 이벤트를 기록해 UI/로그에서 원인 추적 가능.

### 2.1) Reply payload 규격(중요)

- KakaoTalk “답장(Reply)” 렌더링을 위해서는 일반 텍스트 발신(type=1)로는 부족하며,
  **type=26 + attachment에 `src_*` 메타**가 포함되어야 한다.
- 실제 오픈채팅 로그에서 관측되는 최소 형태(키/값 타입 포함):
  - `src_logId`: string (원본 메시지 logId)
  - `src_userId`: (오픈채팅 로그에서는 string으로 관측되지만) Talk-API 발신 시에는 **int(number)** 가 필요
  - `src_linkId`: (오픈채팅 로그에서는 string으로 관측되지만) Talk-API 발신 시에는 **int(number)** 가 필요 (`chat_rooms.link_id`)
  - `src_type`: (오픈채팅 로그에서는 string으로 관측되지만) Talk-API 발신 시에는 **int(number)** 가 필요 (원본 메시지 type; 예: 이미지 `2`)
  - `src_message`: string (원본 메시지 text; 이미지면 `"사진"` 등)
- `src_linkId`는 IRIS `/query`로 `select link_id from chat_rooms where id=?` 를 조회해 캐시한다.
- Node에서 `senderId`는 64-bit 범위 숫자(2^53 초과)가 많아 **JS number로 정확히 표현할 수 없다**.
  - 따라서 Node → Realtime API에서는 `src_userId/src_linkId/src_type`를 문자열로 전달하고,
  - `server/app.py`의 `/send/talkapi/dispatch_raw`(및 `prepare_raw`)에서 **숫자형 문자열을 int로 강제 변환(coerce)** 한 뒤 Talk-API로 전달한다.
  - 이 변환이 없으면 Talk-API가 `INVALID_ARGUMENT(-203)`로 실패하는 케이스가 확인됐다.

### 3) Web(UI) 방별 토글

- `web/src/components/RoomCard.tsx`: “웰컴 답장(첫 이미지)” 체크박스 추가
  - welcome이 꺼진 방에서는 disabled.
  - `welcomeFollowUp === false`인 경우만 OFF로 취급(기본 ON).
- `web/src/types.ts`: `RoomFeatures.welcomeFollowUp?: boolean` 추가

---

## Invariants

1. SAFE_MODE가 켜진 상태에서는 **후속 답장도 절대 발신하지 않는다**.
2. allowlist 밖 방에는 발신하지 않는다.
3. **폴백 금지**:
   - `runtime.json` 로드/파싱 실패, 설정 누락/형식 오류 시 조용히 진행하지 않고 스킵을 기록한다.
4. 트래킹 상태는 TTL/상한으로 bounded 되어야 한다(무한 누적 금지).
5. Reply는 반드시 `src_logId/src_userId` 기반으로 수행한다(단순 `@이름` 텍스트는 멘션/답장이 아님).
   - 오픈채팅에서는 `src_linkId/src_type/src_message`까지 포함해야 UI에서 답장으로 렌더링되는 케이스가 확인됨.

---

## Consequences

### 긍정

- 신규 입장자 온보딩(하트 인증 → 자동 안내) 흐름이 단절되지 않고 자연스럽게 이어진다.
- 트래킹 TTL/상한으로 운영 리스크(상태 누적)를 제어한다.

### 부정/리스크

- “첫 이미지 = 하트 인증샷” 간주로 인해, 의도와 무관한 이미지에도 답장이 갈 수 있다.
- 이미지 판별은 `message.type` 기반(2/27/71)으로만 수행하므로, 이벤트/필드 변화 시 트리거 누락 가능성이 있다(폴백 없이 스킵/로그로 처리).

---

## Links

- Code:
  - `node-iris-app/src/services/welcomeFollowUp.ts`
  - `node-iris-app/src/controllers/CustomNewMemberController.ts`
  - `node-iris-app/src/controllers/CustomChatController.ts`
  - `server/app.py` (`/send/talkapi/prepare_raw`, `/send/talkapi/dispatch_raw`)
  - `web/src/components/RoomCard.tsx`
  - `web/src/types.ts`
- Docs:
  - `docs/adr/ADR-0022-welcome-template-sets-and-kakao-default-nickname.md`
  - `docs/adr/ADR-0024-talkapi-authheader-capture.md`
  - `docs/reference/verification-commands.md`
