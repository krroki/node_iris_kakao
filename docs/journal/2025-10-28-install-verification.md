# 2025-10-28 설치 경로 점검 로그

## 개요
- Termux 및 LDPlayer 기반 IRIS 설치 절차를 docs/setup/ldplayer.md에 병합했습니다.
- 실제 기기/에뮬레이터 캡처는 현재 환경 제한으로 확보하지 못했으며, 운영 장비에서 별도 검증이 필요합니다.

## 점검 항목
| 항목 | 수행 여부 | 비고 |
| --- | --- | --- |
| LDPlayer 최신 버전 설치 및 카카오톡 로그인 | 준비안됨 | 운영 PC에서 수행 예정 |
| LDPlayer db connect → IRIS 이벤트 수집 확인 | 준비안됨 | 캡처 및 로그 확보 필요 |
| Termux 초기 패키지 설치 (pkg update, pkg install android-tools) | 문서 정리 | 루팅 기기에서 검증 예정 |
| iris_control install/start/status 실행 | 문서 정리 | 실제 실행 캡처 필요 |
| ADB 127.0.0.1:5555 연결 및 DashBoard 접속 | 문서 정리 | 모바일 환경에서 테스트 예정 |

## 후속 계획
1. 운영 PC에서 LDPlayer 인스턴스를 실행하고 db devices 결과 및 DashBoard 접속 화면 캡처 확보.
2. 루팅된 테스트 기기에서 Termux 명령 실행 로그를 수집하고 문서에 캡처 추가.
3. 검증이 완료되면 TODO 항목 “LDPlayer/모바일 실기 설치 검증”을 완료 처리하고 SSOT에 결과를 기록합니다.
