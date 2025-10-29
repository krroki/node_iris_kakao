# IRIS 기능 설계 노트 (카페 레퍼런스 기반)

카페 `IRIS 가이드` 게시판(메뉴 383)에서 확보한 글을 중심으로 현재/계획 중인 모듈의 설계 근거를 정리합니다. 각 항목은 코드 위치, 연계 테스트, 필요한 문서 업데이트를 함께 명시합니다.

## 1. 명령어 라우터 (`src/services/command_router.py`)
- **레퍼런스 출처**
  - `node-iris 레퍼런스` (ID 52546) – prefix 기반 명령 디스패치, 권한 체크 패턴.
  - `irispy-client 레퍼런스` (ID 52111) – Python 바인딩 구조, async 핸들러 패턴.
- **핵심 설계**
  - 접두어 기반(`!`) 명령 매핑 + 관리자 전용 태그(@IsAdmin, @HasRole) 지원.
  - 메시지 길이/쿨다운 제한과 재시도(최대 3회, 지수 백오프) 정책을 모듈 내부에서 관리.
  - 향후 `node-iris` 포팅을 대비한 어댑터 레이어(`adapters/node_iris.py` 예정) 정의.
- **구현 체크리스트**
  - [x] `CommandRouter.register/dispatch` API 정식화 및 `src/bot/main.py`에 기본 명령 연결.
  - [ ] `tests/services/test_command_router.py` 확장: 권한/쿨다운/예외 경로 커버.
  - [ ] SSOT에 명령어 표준/권한 매트릭스 추가, PRD 섹션 3.2와 동기화.

## 2. 환영/템플릿 파이프라인 (`src/services/welcome_handler.py`)
- **레퍼런스 출처**
  - `[공지]카페 유료 회원 혜택 안내(+가입 안내)` (ID 52693) – 등급별 안내 문구.
  - 중수 등업 체크리스트 (ID 39556) – 신규 멤버 시나리오.
- **핵심 설계**
  - 신규 입장 이벤트 시 등급별 텍스트 + 선택 이미지 템플릿 전송.
  - 템플릿 검증(JSON Schema)과 기본 템플릿 fallback 제공.
  - 실패 시 재시도(3회) 후 운영 알림 큐에 적재.
- **구현 체크리스트**
  - [ ] `config/templates/welcome/*.json` 샘플 + 스키마 정의.
  - [ ] `tests/services/test_welcome_handler.py` 작성 (Mock reply).
  - [ ] SSOT/PRD에 환영 메시지 SLA(3초 이내 텍스트, 5초 이내 이미지) 명시.

## 3. 방송 큐 & 재시도 (`src/services/broadcast_scheduler.py`)
- **레퍼런스 출처**
  - `[공지]📌2025 카페 통합 규정📌 ✅️` (ID 46857) – 규정/공지 일괄 발송 시나리오.
  - `[사전공고]코드 공유로 보상 받는 게시판을 신설합니다. (11/5 ~ )` (ID 52697) – 시간 기반 공지.
- **핵심 설계**
  - `data/broadcast_queue.sqlite` 로컬 큐 + 상태 필드(`pending/sending/done/failed`).
  - 실패 시 지수 백오프(1s→2s→4s) + 최대 3회 재시도.
  - 완료 후 `artifacts/<ts>-broadcast/summary.json`에 성공/실패 통계 출력.
- **구현 체크리스트**
  - [ ] SQLite 스키마 마이그레이션 스크립트 작성.
  - [ ] `tests/services/test_broadcast_scheduler.py`에 동시 실행/락 테스트 추가.
  - [ ] `docs/ops/retry-policy.md` 작성하여 재시도 규칙/알림 흐름 명문화.

## 4. 닉네임 감지 자동화 (`src/services/automation/nickname_watcher.py`)
- **레퍼런스 출처**
  - `닉변감지[python]` (ID 50786) – DB 쿼리 및 알림 로직 예시.
- **핵심 설계**
  - `db2.open_chat_member` 쿼리 → 최근 상태와 비교 후 변경 감지.
  - 방 필터(`NICKWATCH_ROOMS`), 폴링 간격(`NICKWATCH_INTERVAL`) 환경 변수화.
  - 알림 실패 시 로그 + Slack/메일 알림 후속처리.
- **구현 체크리스트**
  - [x] `NicknameWatcherConfig` 상태 저장(`data/automation/nickname_watcher_state.json`) 구현.
  - [x] `tests/services/test_nickname_watcher.py`로 변경 감지/예외 처리 검증.
  - [ ] IRIS 실제 엔드포인트/토큰 기반 통합 테스트 스텁 작성 (`tests/test_iris_connection.py` 연계).

## 5. 모바일/Termux 연계
- **레퍼런스 출처**
  - `Hayul+Termux를 이용한 노루팅 Iris 돌리기.youtube` (ID 52388)
  - `휴대폰에서 irispy-client 봇 돌리기.youtube` (ID 52150)
- **주요 작업**
  - `docs/setup/iris-hyperv.md`와 본 문서를 상호 링크, Hyper-V/루팅 단말 절차와 Termux 보조 루틴 동기화.
  - 실기 캡처 확보 후 `docs/journal/` 로그 및 TODO(“루팅 단말 + IRIS + Hyper-V 연결 실기 검증”) 완료 처리.
  - Termux 명령 스크립트화 (`scripts/setup_termux.sh` 예정) 및 검증 결과 SSOT 업데이트.

## 6. 문서-코드 연결 체크리스트
- [x] 명령어 라우터 설계 → `src/bot/main.py`에 통합, SSOT 히스토리에 반영.
- [ ] 환영 템플릿 업데이트 시 SSOT/PRD/TODO 동시 갱신.
- [ ] 방송 재시도 정책을 `docs/ops/retry-policy.md`로 분리하고 TODO 항목 갱신.
- [ ] 닉네임 감지 로그/모니터링 계획을 `docs/ops/status-check.md` 초안에 기록.
- [ ] Playwright 수집 실패(iframe 타임아웃) 재현 로그를 수집해 스크립트 재시도 전략 정의.
