# ADR-0035: 오픈채팅 방별 명령어(FAQ) 트리거 워커(command-worker)

## Meta

- **Date**: 2025-12-15
- **Status**: Accepted
- **Authors**: [사용자], Codex(GPT-5.2)
- **Related Session**: `docs/sessions/main.md`
- **Related**: ADR-0026(Reply payload), ADR-0027(코어/워커 분리), ADR-0023(watchdog), `docs/reference/kakao-room-command-triggers.md`

## Context (배경)

- 운영 톡방에서 “자주 묻는 질문(FAQ)”/안내 멘트를 매번 사람이 복붙으로 답하면 피로가 크고 누락이 생긴다.
- 단순히 `@` 문자를 타이핑하는 수준이 아니라, **카카오톡 UI의 “답장(Reply)”** 형태로 응답하면 문맥이 유지되고 스팸/오해가 줄어든다.
- 코어(bot)는 “상시 수신/로그”가 핵심이므로(ADR-0027), 기능 추가로 코어가 흔들리면 안 된다.
  따라서 기능은 `/logs/stream` 기반의 별도 워커로 분리해 start_all/watchdog로 독립 복구 가능해야 한다.

## Options Considered (고려한 대안)

### Option A: 코어(bot)에서 `!키`를 직접 파싱/발신
- 장점: 구현이 단순해 보인다.
- 단점: 코어 변경 범위가 커지고, 장애 시 “로그 수집”까지 같이 흔들릴 위험이 있다(ADR-0027 위배).

### Option B: Web(Next.js) 서버에서 SSE 구독 후 발신
- 장점: UI와 통합하기 쉬움.
- 단점: 운영 UI 재기동/빌드/장애가 곧 기능 중단으로 이어지고, watchdog 단의 복구/모니터링이 어려워진다.

### Option C: 별도 feature-worker(`command-worker`)가 SSE 구독 후 처리 (선택)
- 장점: 코어 안정성 유지(ADR-0027), start_all/watchdog로 독립 복구, 기능 확장(권한/저장/통계) 용이.
- 단점: 워커/상태 파일/기동 스크립트가 추가된다.

## Decision (결정)

**Option C를 선택한다.**

구현 요약:
- 워커: `node-iris-app/src/workers/command_worker.ts`
- 저장소(영속): IRIS DB 테이블 `command_triggers`
- UI 설정: `runtime.features[roomId].commands=true`인 방에서만 활성
- 발신 형식: **Talk-API Reply** (`type=26 + attachment.src_*`)만 사용(폴백 금지)
- 기동/복구:
  - `windows/start_command_worker.ps1`
  - `windows/start_all.ps1`에서 기본 기동
  - `windows/watchdog.ps1`에서 heartbeat stale/프로세스 종료 시 자동 재기동

## Invariants (불변식)

- **코어 흔들림 금지**: 코어(bot)는 `!등록/!키`를 직접 처리하지 않고 “로그 기록”에 집중한다.
- **기본 OFF**: roomId별로 `commands=true`를 명시적으로 켠 방만 동작한다.
  - `commands=false`인 방에서 `!등록/!명령어` 등 관리 커맨드가 들어오면 “꺼져있음” 안내를 답장으로 발신한다.
- **덮어쓰기 금지**: `!등록`은 기존 키가 있으면 거부한다. 수정은 `!삭제` 후 재등록한다.
- **권한 강제**
  - `!등록/!삭제`: 방장/관리자만 가능
  - `!전체등록`: iris 계정만 가능
  - 비권한자가 호출하면 **안내 메시지**를 답장으로 발신한다.
- **Reply만 사용(폴백 금지)**: Reply에 필요한 메타(`src_logId/src_userId/src_linkId/src_type/src_message`)가 하나라도 없으면
  임의 값/일반 메시지(type=1)로 대체하지 않고 **스킵 + 로그 기록**한다.

## Permission Model (권한 모델)

### 방장/관리자 판별
- IRIS DB `open_chat_member`에서 `link_member_type`으로 판별한다.
  - `1` 또는 `4` → 방장/관리자로 간주
- 멤버 DB가 아직 로딩되지 않은 방은(특히 대형 방) 권한 확인이 실패할 수 있으며,
  이 경우 등록/삭제는 거부하고 안내 메시지를 발신한다(조용한 진행 금지).

### iris 계정 판별
우선순위(보안 강도 순):
1) `runtime.json.irisAdminSenderIds`에 senderId 포함
2) `runtime.json.irisAdminSenderNames`에 senderName(소문자) 포함
3) 둘 다 없으면 senderName이 `"iris"`(대소문자 무시)일 때만 허용

> 운영에서는 1번(senderId pinning)을 권장한다.

## Reply Payload (핵심)

- 카카오톡 UI에서 “답장”으로 렌더링되려면:
  - `type=26` + `attachment.src_*` 메타가 필요(ADR-0026)
- `command-worker`는 다음 값을 사용한다:
  - `src_logId`: 원본(명령 입력) 메시지의 messageId
  - `src_userId`: 원본 발신자 senderId
  - `src_linkId`: `chat_rooms.link_id` 조회(캐시)
  - `src_type`: 원본 메시지 type(환경별 16384 플래그 제거 후 문자열로 정규화)
  - `src_message`: 원본 메시지 1줄(첫 줄)

## Consequences (결과)

### 긍정적 효과
- 운영자/수강생이 `!키` 형태로 즉시 FAQ를 조회할 수 있다.
- Reply 기반으로 문맥이 남아 오해/스팸 판정 리스크가 낮다.
- 코어는 안정적으로 유지되고, 워커만 문제면 watchdog가 자동 복구한다.

### 부정적 효과 / 리스크
- iris 계정 판정이 senderName 기반(3번)일 경우 닉네임 위장 리스크가 있다 → senderId pinning 권장.
- Reply 발신은 `src_linkId`/`src_logId` 등 메타 의존이 있어, 로그/DB가 불완전하면 스킵될 수 있다.

## Links

- Reference: `docs/reference/kakao-room-command-triggers.md`
- Code:
  - `node-iris-app/src/workers/command_worker.ts`
  - `windows/start_command_worker.ps1`
  - `windows/start_all.ps1`
  - `windows/watchdog.ps1`
  - `windows/list_bots.ps1`
  - `web/src/components/RoomCard.tsx`
  - `web/src/app/api/bot/processes/route.ts`

