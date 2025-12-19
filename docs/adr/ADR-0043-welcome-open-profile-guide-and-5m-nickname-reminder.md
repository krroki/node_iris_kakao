# ADR-0043: Welcome 오픈프로필 닫기 안내 + 5분 기본닉 닉네임 변경 리마인더

## Meta

- **Date**: 2025-12-19
- **Status**: Superseded (→ ADR-0045)
- **Authors**: PM AI, Codex CLI
- **Related**: ADR-0045(본 ADR 대체), ADR-0022(Welcome 템플릿 세트/기본닉 분기), ADR-0026(Welcome 후속 Reply), ADR-0034(Talk-API 실패 폴백), ADR-0041(기본닉 멘션 워커)

---

## Context

Welcome 운영 요구가 아래로 확장되었다.

1. 신규 입장자가 **오픈프로필로 참여**한 경우, 운영자가 수동으로 “기본프로필로 변경/오픈프로필 닫기”를 안내하는 비용이 컸다.
2. 신규 입장자가 **카카오 기본 닉네임(기본닉)** 인 경우, Welcome에서 즉시 닉네임 변경을 요청하더라도 5분 이내 미변경이 자주 발생했다.

기존 Welcome 흐름(#1~#4: 기본닉/커스텀닉 분기 + 하트스샷 후속 Reply + 15분 미업로드 경고)은 유지하되, 신규 입장자 중심으로 2가지 자동 안내를 추가한다.

---

## Decision

### 1) 오픈프로필 닫기 안내(OpenProfileCloseGuide)

Welcome-worker는 신규 입장자에 대해 IRIS DB(`db2.open_chat_member`)를 조회해 오픈프로필 상태를 판별한다.

- 판별 기준(SSOT): `profile_link_id`
  - `profile_link_id != "0"` 이면 오픈프로필(별도 프로필)로 판단한다.
  - `profile_link_id == "0"` 이면 기본프로필로 판단한다.
- 동작:
  - 조건에 해당하는 입장자에게 1회 안내 텍스트를 발송하고,
  - 닫는 방법 가이드 이미지를 **3장 묶어서** 추가 발송한다(이미지는 IRIS `/reply_media` 경유).
- 중복 방지:
  - 중복 입장 이벤트/재연결로 같은 안내가 반복되지 않도록, (방, 유저) 단위로 TTL 기반 dedup을 적용한다.
- 발신 경로:
  - 텍스트는 Talk-API 우선(멘션 가능), 실패 시 IRIS `/reply_text`로 명시적 폴백(가짜 멘션 금지: `@` 제거)
  - 이미지는 IRIS `/reply_media`로만 발신

Runtime 설정(SSOT):

- `node-iris-app/config/runtime.json` → `welcome.openProfileCloseGuide`
  - `enabled`, `match(profileLinkIdNonZero|profileLinkIdZero)`, `text`, `images`

### 2) 5분 기본닉 닉네임 변경 리마인더(NicknameChangeReminder)

Welcome-worker는 “신규 입장자 중 기본닉으로 판정된 유저”에 대해 5분 후 재확인한다.

- 대상:
  - Welcome 시점(입장 이벤트) 닉네임이 `welcome.kakaoDefaultNicknameRegexes`에 매칭되는 유저
- 재확인(5분 후):
  - IRIS DB(`db2.open_chat_member.nickname`)를 다시 조회해 현재 닉네임이 기본닉인지 확인한다.
  - 5분이 지나도 기본닉이면 1회 안내를 발신한다.
- 안정성:
  - IRIS `/query`의 nickname 인코딩(UTF-8 mojibake) 가능성이 있어 latin1→utf8 정규화를 수행한다.
  - IRIS 조회 실패 등으로 판별이 불확실하면 **폴백 발신 없이 스킵**한다.
  - 짧은 구간(그레이스) 내에서만 제한적으로 재시도하고, 늦게 보내는 발신은 금지한다(시간 민감).
- 발신 경로:
  - 텍스트는 Talk-API 우선(멘션 가능), 실패 시 IRIS `/reply_text`로 명시적 폴백(가짜 멘션 금지: `@` 제거)

Runtime 설정(SSOT):

- `node-iris-app/config/runtime.json` → `welcome.nicknameChangeReminder`
  - `enabled`, `delayMs`, `maxPendingPerRoom`, `text`

> NOTE: ADR-0041 `nickname-reminder-worker`는 “방 전체 스캔 기반(24h/48h 등 단계적 안내)”이며,
> 이 ADR의 `nicknameChangeReminder`는 “신규 입장자 기준 5분 리마인더”로 목적/트리거가 다르다.

---

## Implementation

- 코드:
  - `node-iris-app/src/workers/welcome_worker.ts`
    - 오픈프로필 닫기 안내: `maybeSendOpenProfileCloseGuide()`
    - 5분 기본닉 리마인더: `enqueueNicknameChangeReminder()` + `expirePendingNicknameChangeRemindersAndMaybeNudge()`
- 런타임 설정:
  - `node-iris-app/config/runtime.json`
- 가이드 이미지(3장):
  - `node-iris-app/config/templates/welcome/assets/profile_close_guide/01.png`
  - `node-iris-app/config/templates/welcome/assets/profile_close_guide/02.png`
  - `node-iris-app/config/templates/welcome/assets/profile_close_guide/03.png`
- 상태/진단:
  - `node-iris-app/data/welcome_worker_state.json`
  - `node-iris-app/data/welcome_worker_status.json`

---

## Invariants

1. **SAFE_MODE=true이면 발신 0건** (최종 차단 SSOT는 `runtime.json.safeMode`)
2. **불확실한 상태에서 폴백 발신 금지**
   - 기본닉 판별 정규식이 없거나(혹은 유효하지 않거나), IRIS 조회가 실패하면 스킵한다.
3. **Talk-API 실패 시 명시적 폴백만 허용**
   - 텍스트 폴백은 IRIS `/reply_text`이며, 폴백 텍스트에서는 `@`를 제거해 가짜 멘션을 만들지 않는다(ADR-0034).
4. **멘션 1회 메시지 최대 15명**
   - 멘션은 chunk(15명) 단위로 분할 발신한다.

---

## Consequences

### Positive

- 오픈프로필(별도 프로필)로 입장하는 신규 인원에 대한 운영자 안내 비용이 감소한다.
- 기본닉 신규 입장자에 대해 “Welcome 직후 + 5분 리마인더” 이중 가드로 닉네임 변경 유도가 강화된다.

### Negative / Risks

- IRIS `open_chat_member` 갱신이 지연/누락되는 환경에서는 리마인더가 스킵될 수 있다(불확실 상태 폴백 금지 원칙).
- 신규 입장자가 단시간에 많이 몰리면 5분 리마인더가 방 단위로 단발성 스팸처럼 느껴질 수 있어 `maxPendingPerRoom`로 상한을 둔다.
