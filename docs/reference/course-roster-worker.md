# 강의 운영: 카페/닉네임 검증 워커(course roster worker)

> **목적**: 강의용 오픈채팅방 입장자에 대해 “카페 가입 + 닉네임 규칙”을 자동 검증하고, 미확인 시 안내(멘션)를 발송하며, 결과를 Google Sheets에 업서트한다.

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

## 2) 전제/가드레일(중요)

발신(멘션 안내/확인 메시지)은 아래 조건을 **모두** 만족해야 한다.

- `node-iris-app/config/runtime.json.safeMode=false`
- `node-iris-app/config/runtime.json.talkApi.enabled=true`
- `runtime.allowedRoomIds`에 해당 roomId 포함
- 방별 활성화: `runtime.features[roomId].courseRoster === true`인 방에서만 동작(강의 운영)
- 워커 전체 비활성화(운영): `ROSTER_WORKER_DISABLE=1`

> **FALLBACK 금지**: 설정/데이터가 불완전하면 임의 값으로 진행하지 않고, 스킵/에러를 **명시적으로** 로그에 남긴다.

UI(대시보드)에서의 위치:

- `localhost:3100` → 방 카드(RoomCard) → **강의 운영** 섹션
  - `강의톡방` 배지/토글: 방 이름 접두어로 자동 추론(예: `(사담방)`, `(공지방)`, `(프리미엄방)`) + 수동 override 가능
  - `카페/닉네임 검증` 토글: `runtime.features[roomId].courseRoster`를 제어(켜면 워커가 멘션 안내/시트 업서트를 수행)
  - roomId별 `spreadsheetId/rosterSheetName/cafeCsvPath/joinUrl` 설정은 **UI에서 직접 입력 후 저장**한다(파일: `data/course_roster_worker.json`).
  - 서비스 계정 JSON도 **UI에서 업로드** 가능하다(파일: `data/gcp_service_account.json`).

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

- **네이버 카페 멤버 CSV**를 사용한다.
  - `C:\dev\naver-cafe-member-crawler\data\<카페이름>_<clubid>.csv`
  - 최소 컬럼 요구: `user_id`, `nickname`
  - roster-worker는 CSV `mtime`/TTL 캐시로 재로딩을 최소화한다.

---

## 6) Google Sheets 업서트(강의별 시트)

roster-worker는 강의별 스프레드시트 탭(기본 `ROSTER_RAW`)에 **key 기반 upsert**를 수행한다.

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
