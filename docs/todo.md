# TODO 리스트

## 긴급
- [ ] 루팅 단말 + IRIS + Hyper-V 연결 실기 검증 (대시보드, `/config`, `adb devices` 캡처 포함)
- [x] IRIS 이벤트 수신 스켈레톤 + 샘플 로그 작성
- [ ] IRIS 실서버 엔드포인트 공유 및 연결 테스트
- [ ] SSOT/PRD/ADR 싱크 검토 로그 작성 (`docs/journal/`)
- [ ] IRIS API 인증 정보 확보 (URL, 토큰, 테스트 방 ID 전달)
- [ ] 루팅 단말 원격 접속/캡처 공유 경로 설정 (ADB, AnyDesk 등) 또는 운영자 캡처 확보

## 단기 (Phase 1)
- [x] 메시지 저장 서비스 구현 및 파일 로그 포맷 확정 (`src/services/message_store.py`)
- [ ] 명령어 라우터 설계 및 테스트 초안 (`src/services/command_router.py`, `tests/services/test_command_router.py`)
- [ ] 환영 템플릿/이미지 파이프라인 구성 (`config/templates/welcome/`, `src/services/welcome_handler.py`, `tests/services/test_welcome_handler.py`)
- [ ] 로그 포맷 표준 문서화 (`docs/ops/log-format.md`)
- [ ] 운영 상태 확인 가이드 작성 (`docs/ops/status-check.md`)
- [x] 닉네임 감지 자동화 모듈 구현 및 테스트 (`src/services/automation/nickname_watcher.py`, `tests/services/test_nickname_watcher.py`)
- [x] 카페 자료 기반 기능 사양서 작성 (명령어/환영/방송) → `docs/ops/feature-design.md`
- [ ] Playwright 상세 본문 수집 안정화 (iframe 지연 대응, `NAVER_DETAIL_RETRY`/`NAVER_DETAIL_LIMIT` 실측 검증)

## 중기 (Phase 2)
- [ ] 방송 큐/스케줄러 구현 (`src/services/broadcast_scheduler.py`, `data/broadcast_queue.sqlite`)
- [ ] IRIS 실서버 전송 함수와 방송 스케줄러 연동 검증 (실환경 테스트)
- [ ] 방송 재시도/복구 전략 문서화 (`docs/ops/retry-policy.md`)
- [ ] 운영 스크립트 자동 재기동 로직 구현 (`scripts/manage_instances.ps1`)
- [ ] 테스트 자동화 및 CI 구성 (`tests/`, `.github/workflows/` 예정)
- [ ] 로그 검증 배치 작성 (`scripts/verify_logs.py`)

## 장기 (Phase 3)
- [ ] 웹 대시보드 기획/프로토타입 (`docs/design/dashboard.md`)
- [ ] 멀티 인스턴스 오케스트레이션 가이드 (`docs/ops/instance-orchestration.md`)
- [ ] 메시지 분석/리포팅 자동화 (`src/services/reporting/`)
- [ ] 운영자 알림 채널 연동 (`docs/ops/alerting.md`)
