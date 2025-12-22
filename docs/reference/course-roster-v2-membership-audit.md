# 강의 운영 v2: 카페 등급 기반 톡방 참여 점검 + 통합 스프레드시트

> **목적**: 코스(강의) 단위로 “카페 멤버(등급) + 톡방별 참여자” 데이터를 RAW로 한곳에 취합하고, 통합 점검 탭에서 누락/불일치를 한눈에 확인한다.

---

## 1) 범위(현재 문서의 대상)

이 문서는 **강의 운영 v2(점검/시트 중심)**를 다룬다.

- v1(기존): `roster-worker`가 “입장자 이벤트” 기준으로 카페/닉네임을 검증하고 15분/24시간 정책으로 안내를 발송함  
  - 참고: `docs/reference/course-roster-worker.md`, ADR-0032
- v2(본 문서): “코스 단위”로 **등급(grade) 기반 필수 톡방 참여 여부를 점검**하고, **통합 스프레드시트**로 시각화함  
  - 참고: ADR-0039

---

## 2) 운영 목표(현업 요구)

1. 카페 멤버 데이터는 **주기적으로 자동 갱신**되어야 한다. (수동 CSV 업데이트 의존 제거)
2. 카페 멤버 **등급(grade)**에 따라 필수 참여 톡방이 달라진다.
   - 일반반: 사담방 + 공지방
   - 프리미엄반: 사담방 + 공지방 + 프리미엄방
3. 등급 명칭은 강의마다 다를 수 있으므로, **코스별 등급 규칙을 UI에서 입력**할 수 있어야 한다.
4. 여러 곳(카페/톡방/설정)에 흩어진 데이터를 RAW로 취합한 뒤, 통합 탭에서 누락/불일치를 한눈에 확인할 수 있어야 한다.
5. 운영진은 “수강생 점검”과 분리되어야 한다. (점검 대상 제외 또는 별도 트랙/뷰)
6. “새싹(미등업)” 등급이 관측되더라도, 운영 규칙상 **일반반으로 취급**한다. (비공개 카페: 최소 일반 이상 가입/활동 전제)

---

## 3) 데이터 소스(SSOT)

### 3.1) 카페 멤버(등급 포함)

- 소스: `C:\dev\naver-cafe-member-crawler`의 크롤링 기능(Playwright 기반)
- 최소 필요 필드:
  - `user_id`(네이버 카페 user_id)
  - `nickname`(카페 닉네임)
  - `grade`(카페 등급)
  - (권장) `status`(active/departed), `join_date`, `last_visit` 등

> v2에서는 “카페 멤버 데이터 갱신” 자체가 내부 워커의 책임이다.  
> 운영/설정 UX에서 `CSV 경로 입력`에 의존하지 않는다. (저장 포맷은 내부 구현으로만 취급)

### 3.2) 톡방 참여자(오픈채팅 멤버)

- 소스: IRIS DB `db2.open_chat_member`
- 주의: 대형 방은 단말 스크롤 로딩이 필요하여 DB가 불완전할 수 있다.
  - (참고) 일부 환경에서는 `db2.open_chat_member.involved_chat_id`가 `0`으로 들어오는 row가 많아,
    `loadedMembersCount` 집계를 **roomId(involved_chat_id)만으로 하면 과소 집계**될 수 있다.
    v2 워커/`openchat_load_members.ps1`는 `chat_rooms.link_id` 기준 집계를 우선한다.
  - `loadedMembersCount < activeMembersCount`이면 점검 결과는 **INCOMPLETE로 표시**하고 확정하지 않는다.
  - 필요 시(송신 없음): `pwsh scripts/openchat_load_members.ps1 -RoomId <ROOM_ID> -Scrolls 600`
  - (선택) 자동 로딩: `data/course_membership_audit.json`의 `worker.openchatAutoLoad.enabled=true`로 켜면,
    v2 워커가 **DB 미완전(INCOMPLETE)** 상태에서 `openchat_load_members.ps1`를 **쿨다운/순차 실행**으로 자동 시도한다.

### 3.3) 결제 SSOT(구현됨)

- 목적: 결제(일반/프리미엄) 정보를 SSOT로 두고 트랙 확정/누락 탐지/운영 액션 도출에 활용한다.
- 결제 SSOT 시트는 **read-only**로 연동한다(서비스 계정 Viewer 공유로 충분).
- 설정: `data/course_membership_audit.json`의 코스 설정에 `paymentSsot.spreadsheetId`만 넣으면 된다. (탭/헤더/컬럼명은 기본값 사용)
- 결과:
  - 코스 스프레드시트의 `SSOT_RAW` 탭에 결제 SSOT 원본이 업서트된다.
  - `OVERVIEW`/`ACTIONS`/`AUDIT_VIEW`는 결제 SSOT 기준으로 산출된다.
- 상세 설계/운영: `docs/reference/payment-ssot-google-sheets.md`

---

## 4) 코스 모델(핵심)

코스(강의)는 아래를 1세트로 묶는다.

- 카페: `clubId` 1개
- 톡방: 최소 3개
  - `chat`(사담방)
  - `notice`(공지방)
  - `premium`(프리미엄방)
- 스프레드시트: 코스별 1개 문서
- 등급 규칙: 코스별(강의별) 상이 (UI 입력 구분자: 콤마(,), 줄바꿈, 슬래시(/), 점(.))

### 4.1) 톡방 타입 자동 추론(운영 전제)

방 이름이 아래처럼 **접두어 + 동일한 기본 이름** 패턴으로 구성된 것을 전제로 한다.

- `(사담방) <기본이름>`
- `(공지방) <기본이름>`
- `(프리미엄방) <기본이름>`

따라서 v2는 기본적으로:

- `roomType = 접두어`로 판별하고,
- `courseKey = 기본이름(접두어 제거 후 trim)`으로 3개 방을 한 코스로 묶는다.

> 접두어가 누락되거나, 기본이름이 겹쳐 “동명이 코스”가 생기면 자동 추론이 실패한다.  
> 이 경우 워커는 해당 코스를 `rooms 해석 실패(ROOM_NOT_FOUND/ROOM_AMBIGUOUS)`로 기록하고, UI에서 `rooms` override를 입력해야 한다.

---

## 5) 등급(grade) → 필수 톡방 규칙

### 5.1) 기본 규칙(요구사항)

- **일반반**: `chat`, `notice` 참여 필수
- **프리미엄반**: `chat`, `notice`, `premium` 참여 필수

### 5.2) 코스별 등급명 매핑(구성 필요)

grade 문자열이 강의마다 다를 수 있으므로, 코스별로 아래 규칙으로 매핑한다.

- v2 기본(고정): **문자열 완전 일치 목록**으로만 분류한다.
  - `premiumGrades`: 프리미엄반으로 취급할 grade 문자열 목록
  - `staffGrades`: 운영진으로 취급할 grade 문자열 목록(점검 대상 제외 또는 별도 트랙)
- 분류 규칙(고정):
  - `grade ∈ staffGrades` → staff
  - `grade ∈ premiumGrades` → premium
  - 그 외 → normal (새싹/일반/기타 표기 포함)
- “포함/정규식” 매칭은 v2 범위에서는 비목표다(오탐/혼란 방지).

---

## 6) 매칭 규칙(카페 멤버 ↔ 톡방 참여자)

### 6.1) 기본 매칭(현 운영 룰)

오픈채팅 닉네임에 카페 닉네임을 포함시키는 규칙을 사용한다.

- 권장 형식: `이름마스킹(@) + (카페닉)`
  - 3글자 이름: `정@록(나물쓰)`
  - 4글자 이름: `정@@록(나물쓰)`
  - 위 예시에서 카페 닉네임 = `나물쓰`

- 매칭 보조(참여는 인정하되 **닉네임 변경 요청**으로 기록):
  - `이름마스킹/카페닉` (슬래시)
  - `카페닉`만 (괄호 없음)
  - `카페닉 2`처럼 공백 토큰(카페닉이 토큰으로 포함)
  - `(홍*동)카페닉` (이름 괄호 + 카페닉)
  - `카페닉(이름마스킹)` (괄호 안/밖이 뒤바뀐 케이스)
  - `이름마스킹(카페닉` (닫는 괄호 누락)
- 보조 매칭은 **카페 명단(cafeNickname)과 정확히 일치**할 때만 적용하며, 실패하면 “매칭 불가”로 남는다.

### 6.2) 점검 원칙

- 매칭 실패/중복(AMBIGUOUS)은 “정상 처리”하지 않고, 통합 탭에 명시적으로 노출한다.
- 톡방 DB가 불완전하면(미로딩) 결과를 확정하지 않고 `INCOMPLETE`로 표시한다.

---

## 7) 통합 스프레드시트 구조(권장)

코스별 스프레드시트 문서 1개에 아래 탭들을 둔다.

### 7.0) OVERVIEW 탭(가장 앞, 운영용)

- `OVERVIEW`
  - 운영자가 “오늘 처리할 것”을 바로 볼 수 있도록 만든 **요약 탭**
  - 포함(현재):
    - 상단 카드(건수): `카페 가입 확인` / `필수방 참여` / `닉네임 수정` / `권한 확인` / `결제 시트 확인` / `동명이인/중복` / `목록 미완료` / `점검 대상`
    - 사람별 할 일 표(필요한 사람만)
    - 닉네임 관련 목록
      - `닉네임 수정 목록` / `카페닉 확인 목록` / `닉네임 확인 목록`
    - 최근 변경(= `AUDIT_LOG` 기반, 통합 탭에서 바로 확인)
  - 표기(현재):
    - 필수방: `참여` / `미참여` / `목록 미완료`
    - 프리미엄방(일반반): `정상` / `참여(확인)`
  - v2 워커가 매번 **clear + 전체 재작성**한다(derived view).

### 7.0.1) ACTIONS 탭(OVERVIEW 다음, 상세 할일)

- `ACTIONS`
  - 운영자가 “그대로 처리”할 수 있는 **할 일 큐** 탭
  - 구조(현재):
    - 상단: `지금/오늘/확인/정리` 건수
    - 섹션별 표:
      - `📌 지금` / `📌 오늘` / `📌 확인` / `📌 정리`
      - 컬럼: `대상` / `해야 할 일` / `방` / `요청 닉네임` / `현재 톡닉`
      - `요청 닉네임`이 `<이름마스킹>(카페닉)`처럼 보이면, **이름 마스킹 규칙(첫 글자 + @ 반복 + 마지막 글자)**을 적용해 닉네임을 맞추면 된다.
  - v2 워커가 매번 **clear + 전체 재작성**한다(derived view).

### 7.1) RAW 탭(원천 취합)

- `CAFE_RAW`
  - 카페 멤버 전체(등급 포함)
  - upsert 고유키: `clubId + cafeUserId`
- `OPENCHAT_RAW`
  - 3개 톡방 참여자(방 타입 포함)
  - upsert 고유키: `roomId + openchatUserId`
  - 파싱/매칭 컬럼(일부):
    - `parsedCafeNickname`, `parsedCafeNicknameSource`
    - `resolvedCafeNickname`, `resolvedCafeNicknameSource`
    - `needsNicknameChange`, `nameMaskPrefix`, `nameMaskOk`
- `RULES_RAW`
  - 코스 설정(grade 규칙/방 매핑/스케줄 등) 스냅샷

### 7.2) VIEW 탭(통합 점검)

- `AUDIT_VIEW`
  - 카페 멤버 단위로:
    - grade / track(normal|premium|staff)
    - 필수방 참여 여부(`in_chat`, `in_notice`, `in_premium`)
    - 필수방 목록/누락 방: `requiredRooms`, `missingRooms`
    - auditStatus: `OK` / `MISSING` / `AMBIGUOUS` / `INCOMPLETE` / `STAFF`
    - 데이터 갱신 시각(`cafeUpdatedAt`, `openchatUpdatedAt`)
    - 참고: 톡방별 중복 매칭은 `chatCount`/`noticeCount`/`premiumCount`로 확인
    - 조건부 서식/필터 템플릿은 2차(선택).
  - upsert 고유키: `cafeUserId`

> 시각화를 위해 조건부 서식(누락=빨강 등)을 추가하는 것은 선택이다. (2차)

---

### 7.3) 변경 이력 탭(append-only)

- `AUDIT_LOG`
  - 워커가 스프레드시트를 **clear 하지 않고 upsert**하는 과정에서 생긴 변경을 append-only로 기록한다.
  - `CAFE_RAW` / `OPENCHAT_RAW` / `AUDIT_VIEW`는 행을 삭제하지 않고, `present`, `firstSeenAt`, `leftAt` 컬럼으로 **잔존 데이터(탈퇴/이탈 포함)**를 관리한다.
  - `courseKey`는 표시용 컬럼이며, upsert 고유키에는 포함하지 않는다.
    - 과거에 `courseKey`가 깨진 상태로 업서트된 적이 있으면(예: `????`), 워커가 `present=FALSE`로 자동 비활성화한다.
    - 물리 삭제(시트 행 삭제)는 안전장치가 필요하므로 기본 동작에서는 수행하지 않는다. (필요 시 수동 정리 권장)
  - 기본 컬럼:
    - `ts`, `courseKey`, `tab`, `action`, `key`, `fields`, `old`, `new`
  - `action`:
    - `INSERT`: 신규 행 추가
    - `UPDATE`: 중요 필드 변경(로그 필드 기준)
    - `LEFT`: 기존에 있던 멤버가 이번 스냅샷에서 사라짐(present=FALSE)
    - `REJOIN`: LEFT였던 멤버가 다시 발견됨(present=TRUE)

---

### 7.4) AUDIT_VIEW의 `auditStatus` 해석(운영 가이드)

- `OK`: 필수방 참여 충족
- `MISSING`: 필수방 중 누락 있음(`missingRooms` 확인)
- `AMBIGUOUS`: 동일 카페 닉네임이 특정 톡방에서 2명 이상 매칭됨(`chatCount`/`noticeCount`/`premiumCount` 확인)
- `INCOMPLETE`: **해당 멤버의 필수방 중 하나라도** 톡방 멤버 DB가 미로딩 상태(`loadedMembersCount < activeMembersCount`)
  - 조치(송신 없음): `pwsh scripts/openchat_load_members.ps1 -RoomId <ROOM_ID> -Scrolls 600` 후 재점검
- `STAFF`: 운영진 등급으로 점검 대상 제외

---

## 8) 설정 스키마(현재)

설정 파일(기본, gitignore):

- `data/course_membership_audit.json`
- 예시: `config/course_membership_audit.example.json`

```json
{
  "version": 1,
  "worker": {
    "enabled": false,
    "hotIntervalSec": 600,
    "hotDays": 14,
    "steadyIntervalSec": 10800,
    "openchatAutoLoad": {
      "enabled": false,
      "serial": "",
      "scrolls": 650,
      "scrollPauseMs": 400,
      "timeoutSec": 900,
      "cooldownRoomSec": 900,
      "cooldownGlobalSec": 120,
      "maxAttempts": 1
    },
    "crawler": {
      "repoPath": "C:\\\\dev\\\\naver-cafe-member-crawler",
      "pythonExe": "C:\\\\dev\\\\naver-cafe-member-crawler\\\\venv\\\\Scripts\\\\python.exe",
      "settingsPath": ""
    }
  },
  "courses": {
    "<코스키(= 방이름에서 접두어 제거 후 기본이름)>": {
      "enabled": true,
      "clubId": "<NAVER_CAFE_CLUB_ID>",
      "spreadsheetId": "https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit",
      "paymentSsot": {
        "spreadsheetId": "https://docs.google.com/spreadsheets/d/<PAYMENT_SSOT_SHEET_ID>/edit",
        "sheetName": "종합",
        "headerRow": 19
      },
      "tabs": {
        "cafeRaw": "CAFE_RAW",
        "openchatRaw": "OPENCHAT_RAW",
        "ssotRaw": "SSOT_RAW",
        "rulesRaw": "RULES_RAW",
        "audit": "AUDIT_VIEW",
        "overview": "OVERVIEW",
        "actions": "ACTIONS",
        "auditLog": "AUDIT_LOG"
      },
      "gradeRules": {
        "premiumGrades": ["프리미엄반"],
        "staffGrades": ["운영진"]
      },
      "rooms": {
        "chat": "<ROOM_ID>",
        "notice": "<ROOM_ID>",
        "premium": "<ROOM_ID>"
      }
    }
  }
}
```

설명:

- `courses`의 key가 곧 `courseKey`다. (예: `(사담방) 쇼투벤 3기` → `쇼투벤 3기`)
- `rooms`는 **override(선택)**다.
  - 방 이름 접두어 규칙이 정상이라면, 기본은 `/rooms` 목록에서 자동 추론해도 된다.
  - 동명이 코스/접두어 누락 등으로 자동 추론이 불안정하면 `rooms`를 명시한다.

---

## 9) 운영 체크리스트(요약)

1. 서비스 계정 JSON(`data/gcp_service_account.json`) 업로드
2. 스프레드시트 문서에 서비스 계정 이메일을 Editor로 공유
3. 코스(강의) 설정:
   - 카페 clubId
   - 방 이름 규칙이면 자동(접두어 기반), 필요 시 `rooms`로 override
   - grade 규칙(일반/프리미엄)
   - 스프레드시트 ID/URL + 탭 이름
4. 워커 활성화 후, RAW 탭과 AUDIT_VIEW 탭이 갱신되는지 확인

---

## 10) UI/기동/자동복구

### 10.1) UI에서 어디를 설정하나?

- UI: `http://127.0.0.1:3100/course` (강의 운영 탭)
- 상단(권장 플로우)
  - **빠른 사용법**: 1회 업서트/자동 갱신/카카오(레거시) 흐름을 요약
  - **v2 자동 갱신**
    - 자동 갱신 ON/OFF(초기/안정기 주기 표시)
    - 서비스계정 업로드 + 워커 재시작
  - **강의톡방 자동 감지**
    - 코스 자동 감지: 방 이름 접두어 `(사담방)`/`(공지방)`/`(프리미엄방)` 기준으로 3방을 1코스로 묶음
    - `감지 코스 채우기(기본 OFF)`로 코스 카드를 초기화(코스 enabled=OFF)
  - **카카오 안내(레거시)**(옵션)
    - `강의 메시지 발송` ON/OFF (OFF면 절대 발송 X) + SAFE_MODE/Talk-API 상태 표시
- 코스 카드(코스 단위)
  - `지금 1회 업서트`: 카페 + 3방(+ 결제 SSOT 선택) 취합 → `AUDIT_VIEW`/`OVERVIEW`/`ACTIONS` + `AUDIT_LOG` 1회 갱신(업서트, no clear)
  - `자동 갱신 포함`: enabled 코스만 주기적으로 실행
  - 필수 입력:
    - `clubId`(카페 URL/clubId 입력 → 숫자 clubId로 설정)
    - `spreadsheetId`(URL 또는 ID)
    - `rooms.chat/notice/premium`(roomId)
    - 등급 규칙: `premiumGrades`, `staffGrades` (입력 구분자: 줄바꿈, 콤마(,), 점(.), 슬래시(/) / 그 외 등급은 일반/새싹 취급)
  - 고급: 탭 이름(기본값: `CAFE_RAW`/`OPENCHAT_RAW`/`SSOT_RAW`/`RULES_RAW`/`AUDIT_VIEW`/`OVERVIEW`/`ACTIONS`/`AUDIT_LOG`)
- 하단: **고급: v2 워커 상세 설정**(선택)
  - 주기 조정(초반/안정기): `hotIntervalSec`, `hotDays`, `steadyIntervalSec`
  - 크롤러 경로: `crawler.repoPath`, `crawler.pythonExe`, `crawler.settingsPath` (비공개 카페 로그인 정보는 crawler `settings.json`에 저장)

> 중요: Google Sheets 권한은 **Chrome 로그인**이 아니라 **서비스 계정** 권한이다.  
> 결제 SSOT 시트는 서비스 계정 **Viewer**, 업서트 대상(코스) 시트는 **Editor**로 공유해야 한다.

### 10.2) 기동(부분 재기동)

- 재기동(권장): `windows/start_course_membership_audit_worker.ps1 -Restart`
- 로그:
  - `windows/logs/course_membership_audit_worker.out.log`
  - `windows/logs/course_membership_audit_worker.err.log`
- 상태/락:
  - `node-iris-app/data/course_membership_audit_worker_status.json`
  - `node-iris-app/data/course_membership_audit_worker_state.json`
  - `node-iris-app/data/locks/course_membership_audit_worker.lock`

- **네이버 카페 창이 여러 개 뜨거나 로그인이 반복되는 경우(중요)**:
  - 대개 원인: `course-membership-audit-worker` **중복 실행**
  - 기본 동작: watchdog가 **중복 실행/heartbeat stale**을 감지하면 자동으로 재기동해 1개만 남긴다.
  - 수동 조치(예외): watchdog가 꺼져 있으면 `windows/ensure_watchdog.ps1 -Restart` → `windows/start_course_membership_audit_worker.ps1 -Restart`
  - 확인: `node-iris-app/data/course_membership_audit_worker_status.json`의 `pid`가 **1개**로 유지되는지 확인

### 10.3) start_all/watchdog 연동(운영)

- `windows/start_all.ps1`:
  - `data/course_membership_audit.json`이 있고 `worker.enabled=true`면 자동 기동
- `windows/watchdog.ps1`:
  - 위 조건을 만족하는 경우에만 heartbeat stale/프로세스 종료를 감지해 자동 재시작
- 전체 비활성화(옵션): `COURSE_MEMBERSHIP_AUDIT_WORKER_DISABLE=1`
