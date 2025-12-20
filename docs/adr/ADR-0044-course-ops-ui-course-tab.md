# ADR-0044: 강의 운영 UI를 `/course` 탭으로 통합

## Meta

- **Date**: 2025-12-19
- **Status**: Accepted
- **Authors**: PM AI, Codex CLI
- **Related**: ADR-0032(강의 운영 v1 roster-worker), ADR-0039(강의 운영 v2 membership-audit), `docs/reference/course-roster-worker.md`, `docs/reference/course-roster-v2-membership-audit.md`

---

## Context

강의 운영은 “코스(강의) 1개 = 오픈채팅 3방(사담/공지/프리미엄) + 카페 1개 + 스프레드시트 1개” 형태로 운영된다.

기존 UI는 방 카드(RoomCard) 단위로 강의 운영 설정이 노출되어 다음 문제가 있었다.

1. 코스 단위가 아니라 방 단위로 설정이 흩어져, 같은 코스임에도 카페/시트 정보를 방마다 반복 입력하게 됨.
2. “3방이 1시트에 올라간다” 요구(합본 RAW/VIEW + 변경 이력)와 UI 구조(방별 입력)가 어긋나 혼란이 발생.
3. 레거시 CSV 옵션(카페 멤버 CSV 경로)이 기본 UI에 노출되어, 크롤러 기반(비공개 카페 로그인 포함) 운영과 충돌.
4. `/course` 탭이 비어 있어 “강의 세트(예: 사담/공지/프리미엄)”를 한 눈에 관리하기 어려움.

---

## Decision

1) 강의 운영 UI의 중심을 `/course`로 이동한다.

- UI: `http://127.0.0.1:3100/course`
- 코스 자동 감지: 방 이름 접두어 `(사담방)`/`(공지방)`/`(프리미엄방)` 기준으로 3방을 1코스로 묶는다.
- v2(등급 기반 참여 점검 + 통합 시트 + 변경 이력) 설정/워커 관리를 `/course`에서 수행한다.

2) RoomCard에서 강의 운영(설정 입력) UI를 제거하고 `/course`로 안내 링크만 제공한다.

3) v1(roster-worker) 관련 기본값/추론을 보강한다.

- `rosterSheetName` 미설정 시 방 이름 접두어로 기본 탭명(`ROSTER_CHAT/ROSTER_NOTICE/ROSTER_PREMIUM`)을 추론한다.
- 카페 clubId 추출은 쿼리(`clubid=...`)뿐 아니라 `/cafes/<clubId>` 경로도 지원한다.

---

## Implementation

- UI
  - `web/src/app/course/page.tsx`: 워크플로우 중심 UI(빠른 사용법, v2 자동 갱신 토글+주기 표시, 코스별 1회 업서트, roomId 매핑 입력, 카카오 안내(레거시) 토글)
  - `web/src/components/RoomCard.tsx`: 강의 운영 입력 UI 제거 + 방 단위 멤버/Sheets 도구 숨김, `/course` 링크로 대체
  - `web/src/app/page.tsx`: RoomCard props 정리(강의 운영 입력 제거 후 반영)
- 워커/추론
  - `scripts/course_membership_audit/room_infer.py`: 괄호/대괄호/번호 접두어 패턴 지원
  - `scripts/course_roster_worker.py`: rosterSheetName 추론 + clubId 추출 보강
  - `web/src/app/api/course-roster/config/route.ts`: clubId 추출(`/cafes/<id>` 포함) 보강
- 문서
  - `docs/reference/course-roster-worker.md`, `docs/reference/course-roster-v2-membership-audit.md`의 UI 위치를 `/course` 기준으로 갱신

---

## Invariants

1. SAFE_MODE가 켜져 있으면(SSOT: `runtime.json.safeMode=true`) 어떤 강의 운영 워커도 발신을 수행하지 않는다.
2. 코스 자동 감지는 방 이름 규칙에 의존하며, 규칙 불일치/중복 시 코스 매핑은 불완전 상태로 표시된다(추측으로 자동 처리 금지).
3. CSV(카페 멤버 CSV 경로) 옵션은 레거시로 유지하되 기본 운영 경로는 크롤러 기반으로 한다.

---

## Consequences

### Positive

- 강의 운영을 코스 단위로 집중 관리(설정/상태/워커)할 수 있어 운영 편의성이 개선된다.
- 3방 + 카페 데이터를 한 시트에 upsert하고 변경 이력을 확인하는 v2 운영 흐름이 UI와 정렬된다.

### Negative / Risks

- 방 이름 규칙이 깨지면(접두어 누락/불일치/중복) 자동 감지가 실패할 수 있으며, 이 경우 운영자가 코스 매핑을 명시적으로 보정해야 한다.
- v1(roster-worker)은 레거시로 남아 있어, v2 중심 운영으로 점진적 전환이 필요하다.
