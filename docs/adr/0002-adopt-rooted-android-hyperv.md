# ADR 0002: 루팅 안드로이드 + Hyper-V 리눅스 + IRIS 구조 채택

- 상태: 승인됨 (2025-10-28)
- 문맥: LDPlayer 에뮬레이터를 활용한 IRIS 운용은 실 단말 API 호환성과 네트워크 구성이 상이해, 공식 가이드(H43VTOsKDXY) 기반의 루팅 단말 + 리눅스 VM 구조로 전환이 필요하다.

## 결정
Hyper-V로 구동하는 Ubuntu 리눅스 VM을 봇 서버로 사용하고, 루팅된 안드로이드 단말에 설치한 Iris 앱과 직접 연동한다. Iris 대시보드의 Web Server Endpoint는 VM으로 지정해 이벤트를 수신하고, `irispy-client`를 통해 명령어/환영/방송 로직을 처리한다.

## 근거
- 공식 Iris 가이드 및 커뮤니티 실전 사례가 루팅 단말 + 리눅스 조합을 기준으로 제공돼 운영 참고 자료가 풍부하다.
- 에뮬레이터 대비 실제 단말 DB 구조 호환성이 높아 `/query`, `/decrypt` 등 민감 API 활용 시 실패율이 낮다.
- Hyper-V External vSwitch 구성을 통해 모바일 ↔ 봇 서버 간 네트워크를 단순화하고, 서비스 배포 자동화(`iris_bot`)와 systemd 연계를 그대로 적용할 수 있다.
- 루팅 단말 보안·운영 이슈를 별도 지침으로 정리해도 전체 시스템 복잡도가 LDPlayer 다중 인스턴스 운용보다 낮다.

## 결과
- 기존 LDPlayer 기반 설치 문서는 `docs/setup/iris-hyperv.md`로 교체하고, 관련 체크리스트/로드맵/PRD의 전제를 모두 Hyper-V + 루팅 단말 기준으로 수정한다.
- `docs/ssot.md` 및 `docs/prd.md`의 기술 결정과 범위를 업데이트하고, LDPlayer 관련 TODO는 Hyper-V/루팅 단말 검증 항목으로 전환한다.
- 운영 자동화 스크립트(`scripts/manage_instances.ps1`)는 Hyper-V VM/서비스 재시작 관점으로 재설계한다.
- 루팅 단말 분실 대응, ADB 접근 통제 등 보안 절차를 별도 문서로 추가한다.

## 다음 단계
- Hyper-V ↔ Iris 엔드포인트 캡처 확보 및 `docs/journal/`에 로그 기록.
- `docs/setup/requirements.md`, `docs/roadmap.md`, `docs/todo.md`에서 LDPlayer 전제를 제거하고 신규 환경 요구사항으로 갱신.
- 루팅 단말 보안/운영 체크리스트 초안 작성 (`docs/ops/security-guidelines.md` 예정).
