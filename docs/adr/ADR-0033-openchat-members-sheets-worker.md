# ADR-0033: 오픈채팅 멤버(전체) Sheets 자동 동기화 워커

## Meta

- **Date**: 2025-12-15
- **Status**: Accepted
- **Authors**: [사용자], Codex(GPT-5.2)
- **Related Session**: `docs/sessions/main.md`
- **Related**: ADR-0027(코어/워커 분리), ADR-0023(watchdog), `docs/reference/openchat-members-google-sheets.md`

## Context (배경)

- 오픈채팅방의 전체 멤버(닉네임/userId + 메타)를 **Google Sheets에 upsert**해서 운영 업무(인원 관리/분석/후속 자동화)의 기반 데이터를 만들고 싶다.
- 기존에는 스크립트를 수동 실행하거나(또는 UI에서 1회 실행) “업서트”를 사람이 눌러야 했고, 방이 많아질수록 반복 작업이 된다.
- 대형 방은 IRIS DB(`db2.open_chat_member`)가 **단말 멤버 목록 스크롤**을 통해서만 충분히 채워질 수 있어,
  “하나도 빠짐없이”를 지키려면 불완전한 상태에서 조용히 진행하는 폴백을 금지해야 한다.
- 또한 운영은 상시 가동이므로, start_all(콜드 부팅) 뿐 아니라 watchdog로 **자동 복구**가 되어야 한다.

## Options Considered (고려한 대안)

### Option A: 수동 스크립트 실행만 유지
- 장점: 구현 최소.
- 단점: 운영자가 매번 실행/확인해야 하고, 방/강의가 많아질수록 누락/피로가 커진다.

### Option B: Web(Next.js) 서버 내부에서 주기 실행
- 장점: UI와 한 프로세스에서 끝남.
- 단점: Web 재기동/빌드/배포와 동기화 작업이 결합되어 장애 범위가 커지고, watchdog 단의 복구/관리가 어려워진다.

### Option C: 별도 프로세스 워커 + UI 설정 파일로 제어 (선택)
- 장점: 코어/기능 워커 분리 철학(ADR-0027)에 부합, start_all/watchdog로 독립 복구 가능, UI 설정 기반으로 운영자가 “한 번 세팅 후 자동”.
- 단점: 워커/상태 파일/기동 스크립트가 추가된다.

## Decision (결정)

**우리는 Option C(별도 Python 워커 + UI 설정 파일 + start_all/watchdog 연동)를 선택했다.**

구현 요약:
- 워커: `scripts/openchat_members_sheets_worker.py`
- 설정(UI 저장): `data/openchat_members_sheets.json` (gitignore)
- 상태/락:
  - `node-iris-app/data/openchat_members_sheets_worker_status.json`
  - `node-iris-app/data/openchat_members_sheets_worker_state.json`
  - `node-iris-app/data/locks/openchat_members_sheets_worker.lock`
- 기동/복구:
  - `windows/start_openchat_members_sheets_worker.ps1`
  - `windows/start_all.ps1`에서 `worker.enabled=true`일 때만 자동 기동
  - `windows/watchdog.ps1`에서 heartbeat stale/프로세스 종료 시 자동 재기동(단, `worker.enabled=false`면 스킵)
- UI(3100):
  - `/course` 탭 상단 카드 “톡방 멤버 Sheets(선택)”: 전역 기본값 + 워커 on/off + 워커 재시작/저장
  - (강의) 코스 카드 “톡방 멤버 Sheets”: (사담/공지/프리미엄) 방별 enabled/시트 타겟/allowIncomplete 설정 + 즉시 1회 업서트(수동) 버튼
  - (레거시) 강의톡방이 아닌 일반 방은 RoomCard “멤버 Sheets 자동” UI로 roomId별 설정 가능

스케줄 정책:
- **고정 10분**: 워커 스케줄링 ON이면 **10분마다** 업서트한다(설정으로 변경 불가).
- **즉시 실행 금지**: 방/워커를 켜도 “바로 실행”하지 않고, **다음 주기(10분 후)** 부터 실행한다.
- **재시도 없음**: 실패해도 즉시 재시도하지 않고 다음 주기로 넘어간다.
- **알림(테스트 방)**: 실패/스킵 시 테스트용 오픈채팅방(`18462226881291012`)으로 **주기당 1회(배치)** 알림을 발신한다(전제: `safeMode=false`, `talkApi.enabled=true`).

### Invariants (불변식)

- **기본 OFF**: 워커는 `worker.enabled=true`로 명시적으로 켠 경우에만 동작한다.
- **roomId별 명시 ON**: 자동 동기화는 `rooms[roomId].enabled=true`인 방만 수행한다.
- **고정 주기**: 스케줄은 `10분(600s)` 고정이며, `intervalSec`은 입력/저장/해석하지 않는다.
- **즉시 실행 금지**: 방 enable 전환 시 즉시 upsert하지 않고 `now+10분`으로 예약한다(수동 실행은 UI의 “지금 업서트”로만 수행).
- **재시도 없음 + 테스트방 알림**: upsert 실패/스킵 발생 시 즉시 재시도하지 않으며, 테스트용 오픈채팅방(`18462226881291012`)으로 **주기당 1회(배치)** 알림을 보낸다.
- **폴백 금지(완전성)**: 기본 정책은 `loadedMembersCount < activeMembersCount`이면 upsert를 **수행하지 않는다**(스킵/실패로 기록).
  - 불가피한 경우에만 roomId별 `allowIncomplete=true`를 명시한다(권장하지 않음).
- **비밀키 커밋 금지**: 서비스 계정 키/시트 설정 파일은 `data/` 아래에 두고 gitignore로 관리한다.
- **전역 node 종료 금지**: start/stop는 repo 범위/PID 기반으로만 수행한다(`taskkill /im node.exe` 금지).

## Consequences (결과)

### 긍정적 효과
- 운영자가 “UI에서 한 번 설정 후” 자동 동기화로 전환할 수 있다.
- watchdog로 자동 복구되어 상시 가동에 적합하다.
- roomId별 시트 분리가 가능해 강의별 문서 공유/보안 요구를 충족할 수 있다.

### 부정적 효과 / 리스크
- IRIS DB 로딩이 불완전하면(단말 스크롤 미수행) 자동 업서트가 계속 스킵될 수 있다.
- 방 수가 많아질수록 Google Sheets API 호출량이 증가한다(고정 10분 주기이므로, 방별 `enabled`로 대상 수를 제어).

### 후속 작업
- [ ] `docs/reference/openchat-members-google-sheets.md`에 운영 예시(주기 추천/쿼터 주의) 추가
- [ ] (선택) 방이 많을 때를 대비한 “변경분만 동기화” 최적화(state 기반 incremental) 검토

## Links

- Reference: `docs/reference/openchat-members-google-sheets.md`
- Code:
  - `scripts/openchat_members_sheets_worker.py`
  - `scripts/sync_openchat_members_to_sheets.py`
  - `windows/start_openchat_members_sheets_worker.ps1`
  - `windows/start_all.ps1`
  - `windows/watchdog.ps1`
  - `web/src/app/api/openchat-members-sheets/config/route.ts`
  - `web/src/app/api/openchat-members-sheets/status/route.ts`
  - `web/src/app/api/openchat-members-sheets/restart/route.ts`
  - `web/src/app/page.tsx`
  - `web/src/components/RoomCard.tsx`
