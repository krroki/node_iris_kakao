# 강의 운영: 카페/닉네임 검증 워커(course roster worker)

> **목적**: 강의용 오픈채팅방 입장자에 대해 “카페 가입 + 닉네임 규칙”을 자동 검증하고, 미확인 시 안내(멘션)를 발송하며, 결과를 Google Sheets에 업서트한다.

> **참고(v2)**: “카페 등급(grade) 기반 톡방 참여 점검 + 통합 스프레드시트”는 별도 문서로 확장한다.  
> `docs/reference/course-roster-v2-membership-audit.md`

---

## 1) 데이터 흐름(SSOT)

1. **코어(bot)**: IRIS 이벤트 수신 → 로그 저장(LogStore)
   - `node-iris-app/src/controllers/CustomNewMemberController.ts` → `member_joined` 이벤트를 **발신 없이 로그만 기록**
   - `node-iris-app/src/controllers/CustomChatController.ts` → `message` 이벤트를 `messageType`과 함께 기록
2. **Realtime API(server)**: 로그 tail + SSE
   - `server/log_utils.py` → `/logs/stream` entry에 `payloadType/senderId/senderName/messageType/entrants` 포함
3. **roster-worker(본 기능)**: SSE 구독 → 검증/발신/Sheets upsert
   - `scripts/course_roster_worker.py` (별도 프로세스)
   - 발신은 `POST /send/talkapi/dispatch`(Talk-API) 경유
4. **운영 스크립트/복구**
   - 기동: `windows/start_roster_worker.ps1`
   - 자동 복구: `windows/watchdog.ps1` (heartbeat stale/프로세스 종료 감지)

---

## 1.1) 수작업 운영 플로우(현업) → 자동화 대응

현업에서 반복되는 흐름(요약):

1. 결제 완료자를 결제완료 시트에 기록(수기)
2. 비공개 카페 가입 URL 전송
3. 톡방 초대(사담/공지 + 프리미엄이면 프리미엄방 추가)
4. “카페 가입 여부/닉네임 규칙”을 일일이 대조해 미가입/불일치자에게 별도 안내
5. 결제자 확인 후 카페 가입 승인 및 등업(일반/프리미엄 반영)
6. 수강 완료 후 메인 카페 등업 등 추가 작업

본 프로젝트의 자동화 포커스(현재 범위):

- 톡방 “입장자” 기준으로,
  - 카페 데이터(멤버 스냅샷)에서 **가입 여부/닉네임 일치 여부**를 자동 판별하고
  - 정책(15분 유예, 24시간 추가 1회)대로 **멘션 안내를 자동 발신**
  - 결과를 강의별 시트에 **upsert**해 “수작업 대조량”을 크게 줄인다.

---

## 2) 전제/가드레일(중요)

발신(멘션 안내/확인 메시지)은 아래 조건을 **모두** 만족해야 한다.

- `node-iris-app/config/runtime.json.safeMode=false`
- `runtime.courseOps.sendEnabled=true` (강의 운영 메시지 발송 토글, OFF면 절대 발신하지 않음)
- `node-iris-app/config/runtime.json.talkApi.enabled=true`
- `runtime.allowedRoomIds`에 해당 roomId 포함
- 방별 활성화: `runtime.features[roomId].courseRoster === true`인 방에서만 동작(강의 운영)
- 워커 전체 비활성화(운영): `ROSTER_WORKER_DISABLE=1`

> **FALLBACK 금지**: 설정/데이터가 불완전하면 임의 값으로 진행하지 않고, 스킵/에러를 **명시적으로** 로그에 남긴다.

발신 메시지 스타일(필수):

- roster-worker가 발신하는 안내/확인 멘트(멘션 포함)도 동일한 표준 포맷을 따른다:
  - `docs/reference/outbound-message-style.md`
  - 첫 줄 결론, 구조화, 링크는 푸터(링크 없으면 푸터 금지), 로그/타임스탬프/메타 라인 금지

UI(대시보드)에서의 위치:

- `http://127.0.0.1:3100/course` → **강의 운영** 탭(코스 단위)
  - 코스 자동 감지: 방 이름 접두어 `(사담방)`/`(공지방)`/`(프리미엄방)` 기준으로 3방을 1코스로 묶는다.
  - (레거시 v1) **입장자 안내** 토글: 코스 카드의 `카카오 안내(레거시)`에서 ON/OFF (내부 플래그: `runtime.features[roomId].courseRoster`).
  - (레거시 v1) **강의 메시지 발송** 토글: `/course` 상단 `카카오 안내(레거시)`에서 ON/OFF (`runtime.courseOps.sendEnabled`). OFF면 입장자 안내가 켜져 있어도 절대 발신하지 않음.
  - v1 roomId별 시트/카페 설정은 파일로 유지: `data/course_roster_worker.json` (CSV(`cafeCsvPath`)는 레거시).
  - 서비스 계정 JSON 업로드: `/course`에서 업로드(파일: `data/gcp_service_account.json`).

---

## 3) 닉네임 규칙(파싱)

오픈채팅 닉네임 예시:

- `정@록(나물쓰)`

파싱 규칙:

- 닉네임 끝의 `(...)`를 **카페 닉네임**으로 간주한다.
  - 예: `(나물쓰)` → `나물쓰`
- `(...)`가 없으면 `INVALID_NICK`로 취급하며, 유예/안내 정책에 따라 안내 메시지를 발송한다.

---

## 4) 정책(확정)

- 입장 후 **15분 유예**: 이 시간 동안은 조용히 대기(스냅샷 갱신으로 VERIFIED가 되면 즉시 확인 처리 가능)
- 입장 후 **15분이 지나도 미확인**이면 1회 안내(멘션)
- 입장 후 **24시간이 지나도 미확인**이면 1회 추가 안내(멘션)
- **VERIFIED 또는 2차 안내 시도 이후 추적 종료**

---

## 5) 카페 데이터 소스(현재)

- 기본/권장: **naver-cafe-member-crawler 기반 크롤링(JSON 스냅샷)**
  - UI에서 roomId별로 아래를 입력:
    - `cafeSource=crawler`
    - `cafeUrl`(선택): `clubid=<숫자>` 또는 `search.clubid=<숫자>`가 포함된 URL이면 clubId를 자동 추출할 수 있다.
    - `cafeClubId=<NAVER_CAFE_CLUB_ID>` (또는 위 `cafeUrl`로 자동 추출)
    - (선택) `crawlerRepoPath`, `crawlerPythonExe`, `crawlerSettingsPath`
  - 워커는 로컬에 스냅샷을 저장해 캐시하며, `--cafe-cache-sec`(기본 300초)보다 자주 크롤링하지 않는다.
- 레거시(비권장): **CSV 스냅샷**
  - `cafeSource=csv` + `cafeCsvPath`

카페 데이터 갱신 시차(운영 현실):

- 카페 가입/닉네임 변경이 즉시 스냅샷에 반영되지 않을 수 있다.
- 그래서 roster-worker는 “즉시 재시도”를 하지 않고,
  - 15분 유예(조용히 대기)
  - 24시간 1회 추가 안내
  - 다음 주기(예: 크롤링/스냅샷 갱신 후)에서 자연스럽게 VERIFIED로 전환되도록 설계한다.

> 정책/시간 값은 강의 운영 경험에 따라 조정될 수 있으나,
> “자료가 늦게 들어온다”는 이유로 즉시/무한 재시도를 추가하는 것은 운영 알림 폭주로 이어지므로 금지한다.

---

## 6) Google Sheets 업서트(강의별 시트)

roster-worker는 강의별 스프레드시트 탭에 **key 기반 upsert**를 수행한다.

- 탭 기본값: `rosterSheetName`이 비어있으면 방 이름 접두어로 추론한다: `(사담방)`→`ROSTER_CHAT`, `(공지방)`→`ROSTER_NOTICE`, `(프리미엄방)`→`ROSTER_PREMIUM` (추론 실패 시 해당 room 설정은 disabled)

- key: `roomId:kakaoUserId`
- 서비스 계정 JSON: `data/gcp_service_account.json` (gitignore)
- roomId별 매핑 config: `data/course_roster_worker.json` (gitignore)
  - 예시: `config/course_roster_worker.example.json`

컬럼(고정):
- `key`, `roomId`, `roomName`, `kakaoUserId`, `kakaoNickname`
- `cafeNicknameParsed`, `cafeUserId`, `status`
- `joinedAt`, `verifiedAt`, `nudge1At`, `nudge1Ok`, `nudge2At`, `nudge2Ok`
- `lastSeenAt`, `lastCheckedAt`, `cafeSnapshotAt`, `workerUpdatedAt`, `lastError`

---

## 7) 운영 명령/로그 위치

- 시작: `pwsh windows/start_roster_worker.ps1`
- 재시작: `pwsh windows/start_roster_worker.ps1 -Restart`
- 로그:
  - `windows/logs/roster_worker.out.log`
  - `windows/logs/roster_worker.err.log`
- 상태/헬스(Watchdog용):
  - `node-iris-app/data/roster_worker_status.json`
  - `node-iris-app/data/roster_worker_state.json`
