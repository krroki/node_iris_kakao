# ADR-0032: 강의 운영(카페/닉네임 검증) 워커 + 15분/24시간 안내 정책

> **주의(업데이트)**: 2025-12-19 기준, 강의 운영 UI는 `/course` 탭으로 이동했습니다(ADR-0044).  
> 카페 멤버 소스는 `crawler`가 기본이며, CSV 경로(`cafeCsvPath`)는 레거시 옵션입니다. (`docs/reference/course-roster-worker.md` 참고)

## Meta

- **Date**: 2025-12-14
- **Status**: Superseded by ADR-0044
- **Authors**: PM AI, Codex CLI
- **Related**: ADR-0016(SAFE_MODE), ADR-0019(LogStore), ADR-0024(Talk-API authHeader), ADR-0027(코어/워커 분리), ADR-0044(강의 운영 UI /course 통합), `docs/reference/course-roster-worker.md`

---

## Context(배경)

강의 운영 시 매주(혹은 수시로) 다음 리소스가 새로 생성된다:

- 비공개 네이버 카페(강의 전용)
- 카카오 오픈채팅방(사담방/공지방/프리미엄방 등 최소 3개)
- 수강생 규모는 수백 명 단위

운영자가 수동으로 수행하던 작업:

- 결제 완료 목록 대비, 카페 가입 여부 확인/승인
- 오픈채팅 닉네임 규칙 준수 여부 확인 및 개별 안내
- 가입/닉네임 미준수 인원 추적 및 리마인드

문제:

- 카페/톡방/결제 데이터가 분산되어 있고, 매 강의마다 500명 수준의 수동 검증은 비효율적이다.
- 카페 멤버 데이터는 실시간이 아니어서, “입장 즉시 미가입”으로 단정하면 오탐/스팸 위험이 있다.
- 오픈채팅은 UI에서 네이버 ID(user_id)를 직접 식별할 수 없고, 닉네임 규칙(예: `정@록(나물쓰)`)을 통해서만 매칭이 가능하다.

---

## Options Considered

### Option A) 입장 즉시 안내(리마인드 0분)

- 장점: 빠른 피드백
- 단점: 카페 데이터 갱신 지연/가입 진행 중인 사용자에게 스팸이 될 가능성이 높다.

### Option B) 유예(Grace) + 제한된 리마인드(채택)

- 장점: 데이터 지연을 고려하면서도 운영 자동화를 달성
- 단점: 유예 기간 동안 “미확인”이 남아 있을 수 있음(시트로 추적)

### Option C) Talk/카페를 강제 통합 SSOT로 만들고 실시간 동기화

- 장점: 이상적
- 단점: 개발/운영/보안 비용이 크고 1차 목표(운영 부담 절감) 대비 과도함

---

## Decision

1. **별도 프로세스 워커(roster-worker)를 도입**한다.
   - 코어(bot)는 LogStore만 담당(ADR-0027 불변식 유지)
2. 카페/닉네임 검증은 **카페 멤버 CSV 스냅샷**을 기준으로 수행한다.
   - `C:\dev\naver-cafe-member-crawler\data\<카페이름>_<clubid>.csv`
   - 최소 컬럼 요구: `user_id`, `nickname`
3. 안내 정책(확정):
   - 입장 후 **15분 유예**
   - 15분 이후에도 미확인 시 **1회 안내(멘션, 공개)**
   - 24시간 이후에도 미확인 시 **1회 추가 안내(멘션, 공개)**
   - VERIFIED 또는 2차 안내 시도 이후 **추적 종료**
4. 결과는 강의별 Google Sheets 탭(`ROSTER_RAW`)에 **key 기반 upsert**한다.
   - key: `roomId:kakaoUserId`
5. 가드레일:
   - SAFE_MODE / talkApi.enabled / allowlist / 방별 feature toggle 준수
     - 방별 활성화 키: `runtime.features[roomId].courseRoster === true`
     - UI: `localhost:3100` 방 카드의 **강의 운영** 섹션에서 토글(강의톡방 배지 포함)
   - 설정/데이터 불완전 시 임의 진행 금지(스킵/에러를 명시적으로 기록)

---

## Consequences

### 긍정

- 운영자가 수동으로 수행하던 “미가입/닉네임 미준수 추적” 부담이 크게 줄어든다.
- 워커는 독립 프로세스이므로, 장애/수정 시 코어(LogStore)에 영향 없이 재시작/배포 가능하다.

### 부정/리스크

- 카페 스냅샷(CSV)이 갱신되지 않으면 VERIFIED 판정이 지연될 수 있다.
  - 이에 대비해 유예/리마인드 정책과 `cafeSnapshotAt` 기록으로 가시성을 확보한다.
- 닉네임 중복(동일 카페닉) 케이스는 `AMBIGUOUS`로 기록되며 운영 확인이 필요할 수 있다.

---

## Implementation Links

- Worker:
  - `scripts/course_roster_worker.py`
- 운영 스크립트/복구:
  - `windows/start_roster_worker.ps1`
  - `windows/start_all.ps1`
  - `windows/watchdog.ps1`
- 레퍼런스:
  - `docs/reference/course-roster-worker.md`
