# ADR-0051: CourseOps 오픈채팅 현황 SSOT 정렬(방장/닉네임/썸네일)

## Meta
- **Date**: 2026-01-11
- **Status**: Accepted
- **Authors**: 운영팀, GPT-5.2
- **Related ADR**: ADR-0046, ADR-0047

## Context (배경)
- `go.yoorang.kr`에 “오픈채팅 현황” 페이지가 필요하다.
- 기존 구현에서 아래 문제가 반복됐다.
  - 오픈채팅이 아닌 일반 단톡이 섞여 “방장/부방장” 개념이 깨지고, UI에 placeholder(예: “어떤 분”)가 대량 노출됨.
  - 방장(Host) 정보는 host 위임/이관, open_link owner stale, “오픈채팅봇” 오판 등 케이스가 있어 SSOT 우선순위/보강이 필요함.
  - 오픈프로필 닉네임이 base64-like 토큰으로 저장되는 케이스에서 복호화 후보 선택 로직이 “첫 non-empty”로 끊기며, 실제로는 더 적합한 후보가 있음에도 닉네임이 비는 문제가 있음.
  - 닉네임 조회 실패를 영구 캐시(negative cache)하면, 이후 DB가 채워져도 회복이 느려짐.
- 목표
  - 오픈채팅만 보여주기(스코프 고정)
  - 방장은 항상 1명으로 표기(SSOT 고정)
  - userId/roomId 같은 숫자 식별자 노출 금지 + placeholder 이름 남발 금지(상태로 표현)
  - 오픈채팅 썸네일도 함께 노출

## Options Considered (고려한 옵션)

### Option A: 방장 = `open_chat_member.link_member_type=8`
- 장점: 구현이 단순하다.
- 단점: 드리프트/오판 가능(방장이 “오픈채팅봇”으로 잡히는 사례), 방장 1명 불변식을 깨기 쉽다.

### Option B: 방장 = `chat_rooms ↔ db2.open_link.user_id(owner)` (선택)
- 장점: 방장을 1명으로 고정할 수 있고, 표시 품질이 안정적이다.
- 단점: `open_link` 조인이 불가한 경우 예외 처리(대체 경로)가 필요하다.

### Option C: 썸네일 = `db2.open_link.icon_url/image_url` (선택)
- 장점: 오픈채팅 방의 대표 이미지를 바로 노출할 수 있다.
- 단점: 외부 URL이므로 UI에서 직접 로딩(네트워크/캐시/차단)에 대한 고려가 필요하다.

### Option D: 닉네임 복호화 “첫 non-empty” 채택
- 장점: 구현이 단순하다.
- 단점: “non-empty이지만 의심스러운 결과”에서 멈춰 실제 닉네임으로 이어지는 후보를 시도하지 못한다.

### Option E: 닉네임 복호화 후보 결과 유효성 검증 + negative cache TTL (선택)
- 장점: 복호화 성공률이 올라가고, DB가 채워진 뒤 자동 회복이 빨라진다.
- 단점: 호출/로직이 조금 복잡해진다.

## Decision (결정)

**오픈채팅 현황은 아래를 SSOT로 삼아 구현한다.**

1. 방 목록
   - 오픈채팅만: `/rooms?openchat=1`
2. 방장(Host)
   - 기본 SSOT: `open_chat_member.link_member_type=8`의 최신 host 1명(항상 1명)
   - fallback: host(8)를 못 구할 때 `chat_rooms.link_id ↔ db2.open_link.user_id(owner)`
3. 닉네임
   - `open_chat_member.nickname`가 base64-like 토큰이면 IRIS `/decrypt`로 복호화한다.
   - 후보별 복호화 결과가 “의심스러운 문자열”이면 채택하지 않고 다음 후보를 시도한다.
   - 조회 실패(negative cache)는 영구 캐시하지 않고 TTL을 둔다.
   - placeholder(예: “어떤 분”), 봇 닉네임(예: “오픈채팅봇”)은 “해결된 값”으로 취급하지 않고 “미확인”으로 처리해 자동 보강이 멈추지 않게 한다.
4. 썸네일
   - `db2.open_link.icon_url` 우선, 없으면 `image_url`을 `thumbnailUrl`로 내려준다.

### Invariants (불변식)
- UI/응답에서 `userId/roomId` 숫자 식별자는 노출하지 않는다(닉네임만).
- 방장 표기는 항상 1명으로 제한한다.
- 오픈채팅 현황 페이지는 “오픈채팅”만 포함한다(일반 단톡 제외).

## Consequences (결과)

### 긍정 효과
- 방장/부방장 표기의 신뢰도가 올라간다(오판 감소).
- 닉네임 복호화 누락이 줄고, 데이터가 채워진 뒤 자동 회복이 빨라진다.
- 썸네일로 리스트 가독성이 개선된다.

### 부정 효과 / 리스크
- IRIS 쿼리/복호화 호출이 늘 수 있다(캐시/TTL로 완화).
- 썸네일은 외부 URL 로딩이므로 네트워크 환경에 따라 지연/실패가 가능하다.

### 후속 작업
- [x] 운영 스모크(카운트만) 명령 추가 및 문서화: `scripts/courseops_openchat_smoke.py`

## Links
- Code
  - `server/app.py`
  - `courseops/agent/src/index.js`
  - `courseops/console/app/api/global/openchat/route.ts`
  - `courseops/console/app/(app)/openchat/ui/OpenchatView.tsx`
