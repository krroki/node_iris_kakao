# 2025-10-28 IRIS 엔드포인트 캡처 점검

## 요약
- Hyper-V VM ↔ 루팅 단말 간 `/config`, `/reply` 엔드포인트 및 `adb devices` 출력 캡처를 확보하려 했으나, 현재 세션 환경에서는 루팅 단말과 Hyper-V VM 접속 권한이 제공되지 않아 진행 불가.

## 상세 상황
- **요구 작업**: IRIS 대시보드에서 `/config`, `/reply` 호출 결과 캡처, `adb devices` CLI 로그 확보 후 저장.
- **현재 상태**: 로컬 개발 환경(Windows)에서 루팅 단말 연결 및 Hyper-V VM 접근 권한 미제공.
- **차단 요인**
  - 루팅 단말 물리 접속 및 ADB 포트 포워딩 정보 미확인.
  - Hyper-V VM 네트워크 정보(External vSwitch IP, SSH 자격) 부재.

## 후속 요청
1. 루팅 단말 ADB 접속 정보(USB/wifi, 포트, 인증) 및 Hyper-V VM IP/접속 계정 공유.
2. `/config`, `/reply` 호출 시 사용할 인증/토큰 여부 확인.
3. 캡처 저장 경로 합의 (`artifacts/` 하위 등) 후 재시도 예정.

## TODO 연계
- `docs/todo.md` 긴급 항목 “루팅 단말 + IRIS + Hyper-V 연결 실기 검증”은 외부 장비 접근 권한 확보 후 재진행.
