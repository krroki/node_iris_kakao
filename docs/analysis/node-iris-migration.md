# Node-iris 전환 실험 및 매핑 결과

## 1. 템플릿 세팅 요약
- `node-iris-app/` 폴더에 `create-node-iris-app`의 `simple` 템플릿을 그대로 가져와 의존성(`@tsuki-chat/node-iris`)까지 설치했고 `npm run build`로 TypeScript 컴파일을 검증했다.
- 기본 진입점은 `src/index.ts` → `src/app.ts`이며, `App` 클래스가 `Bot` 인스턴스를 직접 생성하고 모든 컨트롤러를 명시적으로 등록한다.
- `.env`에는 최소 `IRIS_URL`만 있으면 실행이 가능하고, 카카오링크/HTTP 모드/스로틀 등은 추가 환경변수로 제어한다.
- 컨트롤러 구조
  - `CustomMessageController`: 명령어 처리/권한/스로틀/카카오링크 예제
  - `CustomChatController`/`CustomNewMemberController`/`CustomDeleteMemberController`: 이벤트 라우팅
  - `CustomFeedController`: 피드 이벤트 훅
  - `CustomBatchController` + `CustomBootstrapController`: 스케줄링, 예약 메시지, 부트스트랩 훅
  - `CustomUnknownController`, `CustomErrorController`: 에러 및 미등록 명령 대응

## 2. 기존 Python 아키텍처 대비 매핑

| Python 구성요소 (`src/`) | 역할 | Node-iris 템플릿 대응 | 비고 |
| --- | --- | --- | --- |
| `bot/main.py`의 `IRISConnectionManager` | IRIS URL 검증, 재연결, 신호 처리 | `App` 클래스 + `Bot` 자체 연결 로직 | Node-iris는 WebSocket 재연결을 내장. 필요 시 `Bot` 이벤트(`onDisconnect` 등)로 보강해야 함 |
| `services/command_router.py` | Prefix 기반 명령어 라우팅, 권한/스로틀 | `@MessageController` + `@BotCommand`/`@HasRole`/`@Throttle` | 명령어 메타데이터가 데코레이터로 대체. Python Router 테스트 케이스는 TS 데코레이터 단위 테스트로 전환 필요 |
| `services/message_store.py` | 파일/SQLite 기록, Snapshot | 템플릿엔 직접 대응 없음 → 커스텀 서비스 필요 | Node-iris `ChatContext`를 받아 자체 로그 서비스 작성 (ex: `services/logger.ts`) |
| `services/welcome_handler.py`, `RoomManager` | 입장 환영, 방 등록/상태 관리 | `CustomNewMemberController`, `BatchScheduler` | 환영 메시지 로직을 컨트롤러로 옮기고, 방 메타는 별도 persistence 계층 필요 |
| `services/broadcast_scheduler.py` | SQLite 큐 기반 방송 & 재시도 | `BatchScheduler` (`scheduleMessage`, `@ScheduleMessage`) | Node-iris 스케줄러가 동일 개념 제공 → SQLite 연동만 교체하면 기능 대체 가능 |
| `services/automation/nickname_watcher.py` | IRIS HTTP API 폴링 | 템플릿엔 없음 | Node-iris에서도 `IrisAPI` 인스턴스를 통해 동일 API 호출 가능. 별도 `services/nicknameWatcher.ts` 작성 |
| `utils/logger.py` | 구조화 로그, `ServiceLogger` | `Logger` 클래스 (내장) | Node-iris `Logger`는 JSON/레벨 지원. 추가 필드 필요 시 wrapper 작성 |
| `scripts/register_rooms.py` | Room 자동 등록 CLI | 컨트롤러/Batch로 직접 대응 어렵 | Node CLI (`src/scripts/`) 추가 제작 또는 `package.json` scripts 활용 |
| 테스트 (`pytest`) | 유닛/통합 | Vitest/Jest + TS | 데코레이터/컨트롤러 단위 테스트 전략 수립 필요 |

## 3. 포팅 시 고려사항
1. **저장소 계층**: Python은 SQLite/파일 기반으로 메시지와 이벤트를 영속화한다. Node 버전에서도 동일 DB를 사용하려면 `sqlite` 혹은 `better-sqlite3` 등을 채택하고, `ChatContext`를 직렬화하는 헬퍼를 만들어야 한다.
2. **환경 변수/설정**: 기존 `.env`(Python)와 템플릿 `.env.example` 항목이 다르므로 `docs/setup/` 문서를 업데이트하고, 공통 설정 키(`IRIS_URL`, 브로드캐스트 주기 등)를 통일해야 한다.
3. **명령어 스펙**: Python `CommandRouter`는 `!` prefix와 JSON 응답 등을 처리한다. Node-iris의 `@Prefix`/`@BotCommand`로 동일 스펙을 재현하고, JSON 응답이 필요하면 `context.reply(JSON.stringify(...))` 패턴으로 유지하면 된다.
4. **브로드캐스트/알림**: 기존 `BroadcastScheduler`는 SQLite 큐 + 후처리 로깅을 수행한다. Node-iris `BatchScheduler`는 인메모리이므로, 스냅샷/재시작 복원은 `CustomBootstrapController.loadSchedulesFromDatabase()`에 실제 SQLite 연동을 구현해야 한다.
5. **에러/로그 흐름**: Python의 `ServiceLogger.log_error_with_context` 처럼 구조화 로그가 필요하면 Logger wrapper를 만들어 메타데이터를 JSON 으로 전송하고, Kibana 등을 고려한다.
6. **자동화 스크립트**: Python `scripts/` 영역은 CLI 기반이다. Node 진영에서는 `src/scripts/` 또는 `package.json` `bin` 항목으로 재작성하여 동일한 운영 자동화를 제공해야 한다.
7. **테스트 전략**: Python의 `pytest` 시나리오를 TypeScript로 이식할 때, `@tsuki-chat/node-iris`가 제공하는 이벤트를 mocking 하는 패턴을 정의해야 한다. (예: `Bot`을 HTTP/WebSocket 없이 `Bot.emit()` 형태로 트리거하거나, Iris API를 mock 처리)

## 4. 다음 단계 제안
1. **환경 통합**: `node-iris-app/.env.example`을 작성하고 Python `.env` 항목과 싱크 (`IRIS_URL`, `COMMAND_PREFIX`, 카카오링크 키 등).
2. **메시지 스토리지 서비스 작성**: `src/services/messageStore.ts`(Node)로 Python `MessageStore`를 대체하고, SQLite 스키마를 공유하도록 설계.
3. **브로드캐스트 이식**: `CustomBatchController` / `CustomBootstrapController`에 Python `BroadcastScheduler` 로직을 포팅하고, 실패 재시도/로그 남기기를 구현.
4. **명령어 이동**: 기존 Python 명령어 구현(`src/services/command_router.py` 사용)들을 `CustomMessageController` 메서드로 옮기면서 기능 parity 검증.
5. **환영/자동화 기능 변환**: `WelcomeHandler`, `nickname_watcher` 등 서비스를 Node 환경에서 구현하고, 필요 시 Python 서비스와 동일한 테스트 케이스를 Jest/Vitest로 작성.
6. **배포/운영 전략**: Node 프로젝트용 `pm2` 또는 systemd 서비스 유닛 초안 작성, Python 서비스와 공존 기간 동안 이중화 전략 수립.

위 단계에 맞춰 세부 구현이 진행되면, Python → Node 전환 시 기능 격차를 최소화할 수 있다. 필요 시 각 단계별로 세부 업무 티켓을 추가로 분해해 관리하자.
