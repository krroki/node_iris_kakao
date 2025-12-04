# 로드맵

## Phase 0 (2025-10-27 ~ 2025-10-31)
| 우선순위 | 작업 | 산출물 | 선행 조건 | 연관 기능 |
| --- | --- | --- | --- | --- |
| P0 | 루팅 단말 + IRIS + Hyper-V 연결 검증 | `docs/setup/iris-hyperv.md` 업데이트, 대시보드/`adb devices` 캡처 | 장비 준비 | 다중 방 추적, 환영 |
| P0 | IRIS 이벤트 수신 파이프라인 스켈레톤 작성 | `src/bot/main.py` 기본 핸들러, 샘플 로그 | 설치 검증 완료 | 다중 방 추적 |
| P1 | 운영 스크립트 골격 작성 | `scripts/manage_instances.ps1` 초기 버전 | 없음 | 전 기능 |
| P1 | SSOT/PRD/ADR 초기화 점검 | 문서 리뷰 로그 (`docs/journal/`) | 없음 | 문서 전반 |

## Phase 1 (2025-11-01 ~ 2025-11-15)
| 우선순위 | 작업 | 산출물 | 선행 조건 | 연관 기능 |
| --- | --- | --- | --- | --- |
| P0 | 메시지 저장 서비스 구현 | `src/services/message_store.py`, 파일 로그 | Phase 0 완료 | 다중 방 추적 |
| P0 | 명령어 라우터 설계 및 테스트 | `src/bot/commands.py`, `tests/test_commands.py` | 메시지 저장 | 명령어 응답 |
| P1 | 환영 템플릿/이미지 파이프라인 구성 | `config/templates/welcome/`, `src/services/welcome_handler.py` | Phase 0 완료 | 환영 및 안내 |
| P1 | 로그 구조 표준화 | `docs/ops/log-format.md` (신규) | 메시지 저장 | 전 기능 |
| P2 | 기본 운영 대시보드 초안(문서/CLI) | `docs/ops/status-check.md` | Phase 0 완료 | 관제 |

## Phase 2 (2025-11-16 ~ 2025-12-01)
| 우선순위 | 작업 | 산출물 | 선행 조건 | 연관 기능 |
| --- | --- | --- | --- | --- |
| P0 | 방송 큐/스케줄러 구현 | `src/services/broadcast_scheduler.py`, `data/broadcast_queue.sqlite` | Phase 1 완료 | 방송 메시지 |
| P0 | 재시도/실패 복구 전략 적용 | `docs/ops/retry-policy.md`, 재시도 로직 | 방송 큐 초안 | 방송 메시지 |
| P1 | 운영 스크립트 완성 및 자동 재기동 로직 | `scripts/manage_instances.ps1` 확장 | Phase 1 운영 스크립트 | 전 기능 |
| P1 | 테스트 자동화 구축 | `tests/` 통합 테스트, CI 스크립트 | Phase 1 기능 구현 | 전 기능 |
| P2 | 로그 검증 배치 작성 | `scripts/verify_logs.py` | 메시지 저장 안정화 | 다중 방 추적 |

## Phase 3 (2025-12 이후)
| 우선순위 | 작업 | 산출물 | 선행 조건 | 연관 기능 |
| --- | --- | --- | --- | --- |
| P1 | 웹 대시보드 기획/프로토타입 | `docs/design/dashboard.md` | Phase 2 완료 | 관제 |
| P1 | 멀티 인스턴스 오케스트레이션 | `docs/ops/instance-orchestration.md`, 관리 스크립트 | Phase 2 운영 자동화 | 전 기능 |
| P2 | 메시지 분석/리포팅 자동화 | `src/services/reporting/` 초안 | 로그 안정화 | 다중 방 추적 |
| P2 | 운영자 알림(모바일/푸시) 연동 | `docs/ops/alerting.md` | Phase 2 방송 시스템 | 방송/환영 |

> 로드맵 변경 시 `docs/ssot.md`와 `docs/prd.md`를 함께 업데이트하고, `docs/todo.md`에 후속 작업을 추가합니다.
