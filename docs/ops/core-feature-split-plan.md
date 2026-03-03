# 구현계획서: 코어(LogStore) 상시 가동 + 기능(Feature) 워커 분리 (Welcome 1차)

본 문서는 `docs/adr/ADR-0027-core-logstore-and-feature-workers.md` 결정을 실제 구현/운영으로 옮기기 위한 실행 계획서입니다.

## 목표

- “IRIS 이벤트 수신/로그 저장(코어)”은 가능한 한 **항시 가동**한다.
- 기능(welcome/후속답장 등)은 **별도 워커 프로세스**로 분리해 개별 재시작/배포가 가능하게 한다.
- welcome은 **운영자가 지정한 템플릿만 사용**하고, 템플릿 미설정 시 **발신하지 않는다(폴백 금지)**.
- SAFE_MODE/allowlist 가드레일을 기능 분리 후에도 동일하게 유지한다.

## 비목표(이번 1차에서 하지 않음)

- Welcome 이미지 발송의 워커 이관(텍스트/멘션 우선).  
  이미지 발송은 IRIS ChatContext 의존성이 있어, 1차는 텍스트/멘션 + 후속답장(Reply)만 분리한다.
- AI 답변/브로드캐스트 등 다른 기능 워커화(Welcome 안정화 후 단계적으로 진행).

## 현재 구조(요약)

- 코어 봇(Node-IRIS): `node-iris-app`
  - IRIS 이벤트 수신
  - MessageStore 로그 저장: `node-iris-app/data/logs/**`
  - (기존) welcome/후속답장도 같은 프로세스에서 수행
- Realtime API(FastAPI): `server/app.py`
  - 로그 tail + SSE(`/logs/stream`)
  - Talk-API 발신 브리지(`/send/talkapi/dispatch*`) — SAFE_MODE 최종 차단
- Web(Next.js): `web/`
- KB(FastAPI): `kb/service.py`

## 목표 구조(Welcome 1차)

- 코어 봇(Node-IRIS): **수신/로그 저장만** 담당
  - join 이벤트(`member_joined`)도 로그에 기록
- welcome-worker(Node): 별도 프로세스
  - `/logs/stream` 구독 → join 이벤트 감지 → welcome 텍스트/멘션 발신(Talk-API)
  - welcome 성공 후, entrant를 5분 트래킹 → 첫 이미지 메시지에 Reply 1회 발신(Talk-API raw)
- watchdog: 코어/서버/web + welcome-worker까지 자동 복구

## 단계별 구현 계획

### Phase 1) 이벤트 스키마/로그 보강(코어)

- [x] join 이벤트를 `messageStore`에 기록
  - payload: `type=member_joined`, entrants[], roomId/roomName, joinedAt 등
- [x] 채팅 메시지 이벤트에 `messageType`(숫자)을 함께 기록
  - worker가 “이미지 타입(2/27/71, 16384 플래그 정규화)”을 판단할 수 있어야 함
- [x] 서버 SSE(`/logs/stream`)가 worker가 사용할 수 있도록 최소 필드 추가
  - `payloadType`, `senderId`, `senderName`, `messageType` 등을 entry에 포함(추가 필드는 UI에 비파괴적)

검증:
- 대시보드 로그에서 `member_joined` 이벤트가 보이는지 확인
- 이미지 메시지 이벤트에 `messageType`이 노출되는지 확인

### Phase 2) welcome-worker(텍스트/멘션) 구현

- [x] welcome-worker 프로세스 추가(typescript entrypoint)
  - SSE를 직접 파싱(fetch stream)하여 snapshot/append 이벤트를 처리
  - room별 join batching(3~5초 지연 윈도우) 후 1회 통합 환영
  - 템플릿 선택은 `resolveWelcomeTemplateSelection` 정책(ADR-0022)만 사용
  - 템플릿이 없으면 발신하지 않고 스킵(폴백 금지)
  - allowlist + `runtime.features[roomId].welcome === true` 일 때만 발신
- [x] 발신 경로: `server/app.py`의 `/send/talkapi/dispatch`
- [x] (추가, ADR-0030) 템플릿 이미지 발신
  - welcome 템플릿 `images`를 `/templates/assets/...`에서 다운로드→base64 변환
  - Realtime API `POST /send/iris/reply_media` 경유로 IRIS `/reply`에 전달해 이미지 발신(SAFE_MODE 최종 차단 유지)

검증:
- 테스트방에서 신규 입장 → 지정한 템플릿으로 welcome 텍스트 1회 발신
- 템플릿에 이미지가 있으면 이미지도 별도 메시지로 발신(ADR-0030)
- SAFE_MODE=true → 발신 0회(로그는 남아도 됨)
- allowlist 밖 방 → 발신 0회

### Phase 3) 후속답장(Reply) 워커 이관

- [x] welcome 성공 후 entrant 상태 저장(pending)
- [x] pending 사용자 5분 내 첫 이미지 메시지 감지 → Reply(type=26) 1회 발신
  - `src_logId/src_userId/src_linkId/src_type/src_message` 구성
  - `src_linkId`는 IRIS `/query`의 `chat_rooms.link_id`로 조회/캐시
  - Talk-API raw 발신은 `/send/talkapi/dispatch_raw`

검증:
- welcome 직후 5분 내 이미지 올리면 “답장” 형태로 1회만 응답
- 5분 경과 후 이미지 → 응답 없음
- 동일 logId 중복 입력 → 중복 발신 없음

### Phase 4) 기존 봇 프로세스에서 welcome/후속답장 제거

- [x] `CustomNewMemberController`에서 “발신” 로직 기본 비활성화(또는 worker 모드가 기본)
- [x] `CustomChatController`에서 `welcomeFollowUp.handleChatMessage` 호출 제거

검증:
- welcome-worker를 끄면 welcome이 나가지 않아야 함(코어는 계속 로그 저장)
- welcome-worker만 재시작해도 바로 정상 동작해야 함

### Phase 5) 운영 스크립트/Watchdog 자동 기동

- [x] `windows/start_all.ps1`(및 `start_all.cmd`)에서 welcome-worker 자동 시작
- [x] `windows/watchdog.ps1`가 welcome-worker 종료/비정상 상태를 감지해 재시작
- [x] 로그 위치/확인 방법을 runbook/agents.md에 명시

검증:
- welcome-worker 강제 종료 → watchdog가 재기동
- `start_all.cmd` 실행만으로 전체가 정상 기동

## 롤백(되돌리기) 전략

- welcome-worker를 일시 중지하면 코어는 계속 가동되며 welcome은 발신되지 않는다(안전).
- 필요 시 “봇 내 welcome 발신(레거시)”을 다시 켜는 플래그를 추가해 긴급 복구할 수 있다.

## 운영 체크리스트(요약)

- 원칙: **부분 재기동 우선**. start_all은 “콜드 부팅/전체 복구”에만 사용한다.
- 전체 기동(콜드 부팅/복구): `windows/start_all.cmd`
- 부분 재기동(권장):
  - welcome-worker만: `windows/start_welcome_worker.ps1 -Restart`
  - bot만: `windows/start_bot.ps1 -Restart`
  - API만: `windows/start_api.ps1 -Port 8650`
  - web만: `windows/start_web.ps1 -Mode prod -Port 3100 -ForceKillPort`
- 상태: Web(`/status`), KB(`/stats`), watchdog 로그(`windows/watchdog.log`)
- VM/Redroid 접속:
  - VM에서 보는 `localhost`는 “VM 자신”이므로, PC에서 접속하려면 `start_web.ps1 -Hostname 0.0.0.0` + PC IP로 접속
