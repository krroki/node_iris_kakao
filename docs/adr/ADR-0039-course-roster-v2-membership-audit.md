# ADR-0039: 강의 운영 v2 — 카페 멤버 자동 갱신 + 등급 기반 톡방 참여 점검 + 통합 스프레드시트

## Meta

- **Date**: 2025-12-17
- **Status**: Accepted
- **Authors**: PM, Codex CLI
- **Related**: ADR-0032(강의 운영 v1), ADR-0033(오픈채팅 멤버 Sheets), `docs/reference/course-roster-worker.md`

---

## Context(배경)

현재 강의 운영 v1(roster-worker, ADR-0032)은 아래에 집중한다:

- “입장자 이벤트” 기준으로 카페 가입 여부/닉네임 규칙을 검증한다.
- 15분/24시간 안내 정책으로 멘션 안내를 발송한다.
- 결과를 `ROSTER_RAW` 탭에 upsert한다.
- 카페 멤버 데이터는 `naver-cafe-member-crawler`가 만든 CSV 스냅샷을 참조한다.

하지만 현업 운영 목표는 v1 범위를 넘어선다:

1. **카페 멤버 데이터가 ‘수동 CSV’에 의존하면 운영이 끊긴다.**
   - 크롤링/갱신을 시스템 내부에서 주기적으로 수행해야 한다.
2. **등급(grade)에 따라 ‘필수 참여 톡방 조합’이 달라진다.**
   - 일반반: 사담방 + 공지방
   - 프리미엄반: 사담방 + 공지방 + 프리미엄방
   - 단, grade 명칭은 강의마다 달라질 수 있어 **UI에서 코스별로 입력/관리**가 필요하다.
   - 카페 가입 직후 “새싹(미등업)” 같은 상태가 존재할 수 있으나, 운영 규칙상 **새싹도 일반반으로 취급**한다.
     - 비공개 카페 운영 전제: 최소 일반 이상이어야 가입/활동 가능
3. **데이터가 여러 곳에 흩어져 있어 한눈에 점검하기 어렵다.**
   - 카페 멤버(등급) + 톡방별 참여자 + 검증/안내 이력(옵션)을 한 스프레드시트에 “RAW로 취합”하고,
   - 그 위에 “통합 점검 탭(뷰)”에서 누락/불일치 등을 시각적으로 확인 가능해야 한다.

---

## Options Considered(고려한 대안)

### Option A) v1 유지(카페 CSV 수동/외부 의존) + 운영자가 통합 시트 수작업

- 장점: 개발 없음
- 단점: 운영 병목이 해소되지 않고, 강의가 늘수록 유지 불가

### Option B) 카페 데이터만 자동 갱신(크롤러 내장) + 나머지는 v1 유지

- 장점: “CSV 갱신” 문제는 해결
- 단점: 등급 기반 톡방 참여 점검/통합 뷰라는 핵심 운영 목표가 남음

### Option C) 강의 운영 v2 도입(채택)

- 설명: 코스(강의) 단위로 “카페 멤버 자동 갱신 + 등급 기반 톡방 참여 점검 + 통합 시트”를 제공한다.
- 장점: 운영자가 보고 싶은 ‘한 장의 대시보드’가 생김
- 단점: 코스 설정(UI/설정 파일)과 데이터 매칭 규칙(닉네임 파싱 등) 설계가 필요

---

## Decision(결정)

**우리는 Option C(강의 운영 v2)를 도입한다.**

핵심 결정:

1. **카페 멤버 데이터 소스를 “주기 갱신 가능한 내부 워커”로 승격**한다.
   - `C:\dev\naver-cafe-member-crawler`의 크롤링 로직(Playwright 기반)을 12.kakao 운영 파이프라인에 통합한다.
   - 저장 형태(CSV/JSON 등)는 구현 편의에 따라 선택하되, 운영 관점에서 “수동 CSV 경로 입력” 의존은 제거한다.
2. **강의(코스) 단위 설정을 도입**한다.
   - 코스는 최소 3개 톡방(사담/공지/프리미엄)과 1개 카페(clubId)에 매핑된다.
   - 방 타입은 방 이름 접두어로 자동 추론한다: `(사담방)`, `(공지방)`, `(프리미엄방)`
   - 3개 톡방의 “기본 이름(접두어 제거 후)”이 동일하면 같은 코스로 묶는다. (예외는 UI에서 override)
3. **등급(grade) → 필수 톡방 조합 규칙을 코스별로 관리**한다.
   - grade는 운영 기준으로 **일반/프리미엄 2트랙**이며, **운영진(staff)은 별도 트랙**으로 분리한다.
   - UI에서 코스별로 아래 2개 목록을 입력한다(문자열 **완전 일치**):
     - `premiumGrades`: 프리미엄반으로 취급할 grade 목록
     - `staffGrades`: 운영진으로 취급할 grade 목록(점검 대상에서 제외하거나 별도 뷰로 분리)
   - 분류 규칙(고정):
     - `grade ∈ staffGrades` → staff
     - `grade ∈ premiumGrades` → premium
     - 그 외 → normal (새싹/일반/기타 표기 포함)
   - “포함/정규식” 기반 매칭은 혼란/오탐 리스크가 커서 v2 범위에서는 비목표로 둔다.
4. **스프레드시트는 코스 단위 1개 문서에 RAW→VIEW 구조로 구성**한다.
   - RAW 탭들에 카페/톡방 데이터를 “원천 형태로” 취합하고,
   - VIEW 탭에서 누락/불일치를 한눈에 보이도록 정리한다.
   - 탭 갱신은 **clear/rewrite를 하지 않고 key 기반 upsert**로 수행한다.
   - 변경 이력은 `AUDIT_LOG` 탭에 **append-only**로 기록한다.
   - RAW/VIEW 탭은 행을 삭제하지 않고 `present`, `firstSeenAt`, `leftAt` 컬럼으로 잔존 데이터를 관리한다.
5. **점검 주기는 단계형으로 운영**한다.
   - 오픈 초반(예: 2주)은 닉네임/등급 변경이 잦으므로 고빈도(분 단위)로 점검한다.
   - 안정화 이후에는 저빈도(시간 단위)로 낮춘다.
   - 주기 값은 코스별 또는 전역 기본값으로 UI에서 조정 가능해야 한다.

구현 요약(완료):

- 워커(파이썬): `scripts/course_membership_audit_worker.py`, `scripts/course_membership_audit/*`
- 설정(UI 저장, gitignore): `data/course_membership_audit.json` (예시: `config/course_membership_audit.example.json`)
- 카페 크롤링 재사용:
  - 브리지: `scripts/crawl_naver_cafe_members.py`
  - 외부 레포(로컬): `C:\dev\naver-cafe-member-crawler`
  - 설정 자동 탐색(우선순위):
    - `%LOCALAPPDATA%\NaverCafeMemberCrawler\config\settings.json`
    - `<crawler_repo>\config\settings.json`
- 시트 탭(코스당 1개 스프레드시트 문서):
  - `CAFE_RAW` / `OPENCHAT_RAW` / `RULES_RAW` / `AUDIT_VIEW` / `AUDIT_LOG` (기본값, 코스별 override 가능)
- 상태/락:
  - `node-iris-app/data/course_membership_audit_worker_status.json`
  - `node-iris-app/data/course_membership_audit_worker_state.json`
  - `node-iris-app/data/locks/course_membership_audit_worker.lock`
- 기동/자동복구:
  - 수동: `windows/start_course_membership_audit_worker.ps1`
  - `windows/start_all.ps1`: 설정 파일 존재 + `worker.enabled=true`일 때만 자동 기동
  - `windows/watchdog.ps1`: 설정 파일 존재 + `worker.enabled=true`일 때만 heartbeat 기반 자동 재시작
  - 운영 비활성화(옵션): `COURSE_MEMBERSHIP_AUDIT_WORKER_DISABLE=1`
- UI(3100):
  - `/course` 탭 상단 카드: “강의 운영 v2 (등급 기반 참여 점검)”
  - API: `/api/course-membership-audit/config`, `/api/course-membership-audit/status`, `/api/course-membership-audit/restart`

### Invariants(불변식)

- Kakao 발신 가드레일(SAFE_MODE 등)은 그대로 유지한다.
  - v2의 “점검/시트 업서트”는 발신이 아니므로, SAFE_MODE와 무관하게 실행 가능해야 한다.
- 데이터가 불완전할 때 “임의로 정상 처리”하지 않는다.
  - 예: 톡방 멤버 DB가 미로딩이면 `INCOMPLETE`로 표시하고 점검 결과를 확정하지 않는다.
  - (중요) IRIS `db2.open_chat_member`는 환경에 따라 `involved_chat_id`가 `0`으로 들어오는 row가 많아,
    roomId 기준 집계만 하면 `loadedMembersCount`가 과소 집계될 수 있다.
    따라서 멤버 목록/집계는 `chat_rooms.link_id` 기준을 우선한다.
- 방 타입 자동 추론/코스 자동 묶음이 애매한 경우(예: 접두어 누락/동명이 코스)는 `rooms 해석 실패(ROOM_NOT_FOUND/ROOM_AMBIGUOUS)`로 기록하고, UI에서 `rooms` override로 해결한다.
- 코어(bot)는 LogStore에만 집중하고, 신규 기능은 별도 워커(프로세스)로 분리한다(ADR-0027 준수).

---

## Consequences(결과)

### 긍정적 효과

- 운영자가 “코스별 통합 점검 탭”에서 등급/필수 톡방 누락을 즉시 확인할 수 있다.
- 카페 멤버 데이터 갱신이 자동화되어, 수작업/외부 도구 의존으로 인한 운영 단절이 줄어든다.

### 부정적 효과 / 리스크

- 카페 크롤링은 계정 제한/차단 리스크가 있으므로, 주기/재시도/로그 정책을 보수적으로 설계해야 한다.
- 등급/닉네임 매칭 규칙이 강의별로 달라질 수 있어, 설정 UX와 검증(프리뷰/샘플링)이 필요하다.

### 후속 작업

- [x] 레퍼런스 문서 추가: `docs/reference/course-roster-v2-membership-audit.md`
- [x] 설정 스키마/저장 위치 확정: `data/course_membership_audit.json` (예시: `config/course_membership_audit.example.json`)
- [x] UI(3100)에서 코스별 등급 규칙/스프레드시트/톡방 매핑(override)/주기 설정 입력 지원
- [x] 워커 구현(카페 멤버 자동 갱신 + 코스 통합 점검 시트 업서트)
- [x] 운영 명령/스모크 커맨드 추가: `docs/reference/verification-commands.md`

남은 TODO(선택):

- [ ] `AUDIT_VIEW` 조건부 서식/필터 템플릿(2차)
- [x] 카페 닉네임↔오픈채팅 닉네임 매칭 규칙 확장(괄호 + 슬래시 + 토큰 + 괄호 누락 보정)
- [ ] 강의별 커스텀 매칭 룰(필요 시)
