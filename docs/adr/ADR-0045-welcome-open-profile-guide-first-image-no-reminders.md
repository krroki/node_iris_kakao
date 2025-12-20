# ADR-0045: Welcome 오픈프로필 닫기 안내(첫 이미지 트리거) + 리마인더 제거

## Meta

- **Date**: 2025-12-19
- **Status**: Accepted
- **Authors**: PM, Codex CLI
- **Supersedes**: ADR-0043
- **Related**: ADR-0022(Welcome 템플릿 세트/기본닉 분기), ADR-0026(Welcome 후속 Reply), ADR-0034(Talk-API 실패 폴백)
- **Related Session**: `docs/sessions/main.md`

---

## Context (배경)

- 운영 요구가 변경되었다.
  - Welcome에서 “리마인더(5분 기본닉/미업로드 경고 등)”는 전부 제거한다.
  - “오픈프로필(오픈채팅 열린 프로필) 닫기” 안내는 **입장 직후가 아니라**, **첫 이미지 업로드(15분 내)** 시점에만 트리거한다.
  - 오픈프로필 “증명/검증 강화(추가 스텝)”는 후순위로 미룬다. (일단 닫기 안내/확인만)
- 입장 직후 발신이 겹치면(환영 + 가이드 + 이미지) 대형 방에서 오발신/스팸/깨진 메시지 리스크가 커진다.

---

## Options Considered (고려한 대안)

### Option A: 입장 직후 오픈프로필 안내 유지
- 장점: 안내가 빠르다.
- 단점: 입장 이벤트 품질/중복/재연결 영향이 크고, 환영 메시지와 섞여 스팸/오발신 리스크가 커진다.

### Option B: 오픈프로필 안내 자체를 제거
- 장점: 운영 리스크가 최소화된다.
- 단점: 운영자의 수동 안내 비용이 그대로 남는다.

### Option C: **첫 이미지 업로드에서만 오픈프로필 안내** (선택)
- 장점: “실제 참여 행동(이미지 업로드)”이 있는 신규 인원에만 개입하여 스팸/오발신을 줄인다.
- 단점: 이미지 업로드가 없는 신규 인원에게는 안내가 트리거되지 않는다.

---

## Decision (결정)

**우리는 Option C를 선택했다.**

### 최종 플로우

1) **입장(Welcome)**
- 텍스트 Welcome + **하트스샷 업로드 방법 가이드 이미지(1장)** 를 발신한다.
- 오픈프로필(프로필 닫기) 안내는 **입장 직후에는 발신하지 않는다**. (첫 이미지 트리거에서만)

2) **첫 이미지 업로드(Welcome 후속, 15분 내)**
- 신규 입장자 기준으로 15분 내 “첫 이미지 업로드”가 감지되면 프로필 상태를 IRIS DB로 조회한다.
- 오픈프로필(닫기 안내 대상)인 경우:
  - 감사 Reply를 보내지 않는다.
  - 멘션 텍스트 + 가이드 이미지(1장)를 발신한다.
  - 이후 닫힘을 폴링으로 감지하면 **즉시 1회** 확인 멘션을 발신한다.
- 오픈프로필이 아닌 경우:
  - 기존 정책대로 “감사합니다 …” Reply를 1회 발신한다.

3) **리마인더 제거**
- 기본닉 5분 리마인더 제거
- 15분 미업로드 경고(타임아웃 멘션) 제거

### 오픈프로필 판별(SSOT)

- 판별 기준: IRIS DB `db2.open_chat_member`
  - `profile_type == 16` → 오픈프로필(오픈채팅 프로필)
  - **운영 기준**: `profile_link_id != "0"` 이면 “오픈채팅방 열려있음(닫기 안내 대상)”로 본다.
  - 런타임 설정에서 `match`로 반전 가능하지만, 기본 운영값은 `profileLinkIdNonZero`를 사용한다.

### Invariants (불변식)

1. **SAFE_MODE=true이면 발신 0건** (SSOT는 `runtime.json.safeMode`)
2. **불확실한 상태에서 폴백 발신 금지**
   - IRIS 조회 실패/판별 불가 시 안내/확인 발신을 스킵한다.
3. **오픈프로필 안내는 “첫 이미지 업로드”에서만**
   - 입장 이벤트만으로는 오픈프로필 안내/이미지 발신이 발생하지 않는다.
4. **봇(Iris) 자신의 입장 이벤트는 스킵**
   - 봇이 방에 재입장/재연결되어도 Welcome/후속 Reply가 “자기 자신”에게 발신되는 문제를 방지한다.
5. **멘션 1회 메시지 최대 15명**

---

## Implementation (구현)

- 코드:
  - `node-iris-app/src/workers/welcome_worker.ts`
    - 첫 이미지 업로드 핸들러에서 오픈프로필 체크/가이드 발신
    - 닫힘 감지 폴링 + 1회 확인 멘션 발신
    - `senderName=Iris`인 join 이벤트는 무시(봇 self-welcome 방지)
- 런타임 설정(SSOT):
  - `node-iris-app/config/runtime.json`
    - `welcome.openProfileCloseGuide`:
      - `enabled`, `match`, `text`, `confirmText`, `confirmTextKakaoDefaultNickname`
        - 닫힘 확인 멘트(`confirmText`) 발신 시점에 **현재 닉네임이 “카카오 기본 닉네임”이면** `confirmTextKakaoDefaultNickname`를 우선 사용한다.
      - 판별(SSOT): IRIS DB `db2.open_chat_member`
        - `profile_type == 16` → 오픈프로필(오픈채팅 프로필)
        - `profile_link_id != 0` → “오픈채팅방 열려있음”(닫기 안내 대상)
        - 운영값: `match=profileLinkIdNonZero`
      - `confirmWindowMs`, `confirmCheckIntervalMs`
      - `images` (1장)
    - `welcome.followUp`:
      - `enabled`, `windowMs`, `replies` (오픈프로필이 아닌 경우에만 사용)
- 가이드 이미지(1장):
  - `node-iris-app/config/templates/welcome/assets/profile_close_guide/KakaoTalk_20251219_021112774.png`
  - (오픈프로필 관련 이미지는 위 1장만 유지한다)
- 하트스샷 가이드 이미지(1장):
  - `node-iris-app/config/templates/welcome/assets/common/KakaoTalk_20251213_123012048.png`
- 상태/진단:
  - `node-iris-app/data/welcome_worker_state.json` (pending confirmations 포함)
  - `node-iris-app/data/welcome_worker_status.json`

---

## Consequences (결과)

### 긍정적 효과

- 입장 직후 스팸/오발신/깨진 메시지 리스크가 크게 줄어든다.
- 오픈프로필 안내가 “참여 행동(첫 이미지 업로드)”과 결합되어 운영 체감이 자연스럽다.

### 부정적 효과 / 리스크

- 신규 입장자가 이미지를 올리지 않으면 오픈프로필 안내가 트리거되지 않는다.
- IRIS `open_chat_member` 갱신이 지연/누락되면 안내/확인이 스킵될 수 있다(불확실 상태 폴백 금지 원칙).
