# 단일 정보 출처 (SSOT)

## 프로젝트 개요
- 이름: 14.kakao
- 목적: 루팅 안드로이드 + IRIS + Hyper-V 리눅스 봇 서버 조합으로 카카오톡 오픈채팅(명령어, 환영, 방송)을 안정적으로 운영.
- 현재 상태: Hyper-V/루팅 단말 기반 설치 가이드 정리 및 요구사항 문서 갱신 완료 (2025-10-28).

- 2025-10-28: IRIS 엔드포인트 캡처 작업이 장비 미제공으로 보류됨(`docs/journal/2025-10-28-iris-endpoint-check.md` 기록) 및 보안 지침 초안 작성(`docs/ops/security-guidelines.md`).
- 2025-10-28: 루팅 안드로이드 + Hyper-V 리눅스 구조 채택, 설치 가이드 `docs/setup/iris-hyperv.md` 반영.
- 2025-10-28: IRIS 봇 엔트리 재구성(명령어·방송·환영 통합) 및 Playwright 상세 재시도 파라미터 도입.
- 2025-10-28: Playwright 재수집(31건) 및 `docs/ops/iris-usage-manual.md`/`docs/ops/feature-design.md` 업데이트, 상세 본문 수집 한계(3건) 이슈 기록.
- 2025-10-28: IRIS 가이드 게시판 Playwright 수집 및 `docs/ops/iris-usage-manual.md` 초안 작성.
- 2025-10-27: IRIS 이벤트 스켈레톤 및 파일 로그 스토어 작성, dry-run으로 샘플 로그 검증.
- 2025-10-27: PRD 및 로드맵에 핵심 요구사항 상세화 반영.
- 2025-10-27: PC UIA 대신 LDPlayer+IRIS 채택 (ADR 0001). ※ 2025-10-28 기준 폐기, ADR 0002로 대체.
- 2025-10-27: 새 저장소 구조 수립, 문서 골격/스크립트/설정 디렉터리 생성.

## 기술 결정 요약
| 날짜 | 결정 | 참고 |
| --- | --- | --- |
| 2025-10-28 | 루팅 안드로이드 + Hyper-V 리눅스 + IRIS 구조 채택 | `docs/adr/0002-adopt-rooted-android-hyperv.md` |
| 2025-10-27 | (폐기) LDPlayer + IRIS 채택 | `docs/adr/0001-adopt-iris-ldplayer.md` |
| 2025-10-27 | SSOT/PRD/ADR 업데이트 프로세스 정의 | 이 문서, `agents.md` |

## 미완료 사항
- Hyper-V VM ↔ 루팅 단말 간 엔드포인트 검증 및 캡처 확보 (대시보드, `/config`, `/reply` 응답).
- 루팅 단말 보안 지침 및 분실 대응 절차 수립.
- IRIS WebSocket 상시 연결 및 오류 복구 경로 검증 (실서버 엔드포인트 필요).
- 닉네임 감지 자동화 통합 테스트 및 운영 배포 플로우 정리 (`tests/test_iris_connection.py` 보강).
- IRIS API 인증 값 확보 및 브로드캐스트 스케줄러 실환경 검증 (URL/토큰/테스트 방 ID 필요).
- 로그 표준 및 운영 지침 문서화 (`docs/ops/log-format.md`, `docs/ops/status-check.md`).
- 운영 자동화 스크립트 고도화 및 재기동 로직 구현 (`scripts/manage_instances.ps1`).
- Playwright 상세 본문 수집 실패(iframe 로딩) 재현 및 안정화 전략 수립 (`scripts/iris_board_collector.py` 재시도 옵션 검토).

## 업데이트 지침
- **주요 작업 완료 혹은 의사결정 직후**, 해당 내용과 날짜를 위 표 또는 히스토리 섹션에 추가한다.
- 새로운 결정일 경우 ADR을 작성하고 여기서 링크를 갱신한다.
- 범위/요구 변경 시 PRD 수정 후 `최근 히스토리`에 기록한다.

### 업데이트 트리거 체크리스트
- 기능/스크립트/테스트 구현이 완료되었을 때 (코드 변경).
- 의존성, 환경 변수, 인프라 설정이 바뀌었을 때.
- 제품 범위/우선순위/로드맵이 조정되었을 때.
- 리스크·장애·회고에서 새 인사이트가 발견되었을 때.

### 업데이트 절차
1. `docs/journal/`에 세션 로그를 남기면서 변경 요약을 기록한다.
2. SSOT 히스토리/결정 표를 업데이트하고 관련 문서 링크를 추가한다.
3. 추가 ADR/PRD/로드맵 수정이 필요하면 동시 반영하고, `docs/todo.md`에 후속 액션을 적는다.
4. PR 작성 전 SSOT와 Agents 체크리스트를 다시 확인하여 누락된 항목이 없는지 검증한다.

## 다음 점검 예정
- 2025-10-29: Hyper-V VM ↔ Iris 엔드포인트 호출 캡처 (`curl`, `/reply`) 확보.
- 2025-10-29: 루팅 단말에서 `iris_control status` 및 `/dashboard` 스크린샷 확보.
- 2025-10-29: IRIS 이벤트 스켈레톤에서 메시지 로그 생성 여부 확인.
- 2025-10-31: Phase 0 마일스톤 리뷰 및 문서 싱크 점검.
