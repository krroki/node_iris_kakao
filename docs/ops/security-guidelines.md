# 루팅 단말 + Hyper-V IRIS 보안 지침 (초안)

## 1. 자산 구분
- **루팅 안드로이드 단말**: Iris 앱 설치, 카카오톡 운영 계정 로그인.
- **Hyper-V 리눅스 VM**: `irispy-client` 봇, 로그/비밀정보 저장.
- **관리 PC (Windows)**: Hyper-V 및 ADB 제어.

## 2. 계정 및 접근 제어
- 루팅 단말, Hyper-V VM 모두 **전용 운영 계정** 사용.
- Hyper-V VM SSH 계정은 `sudo` 권한 최소화, 키 기반 인증 적용.
- 루팅 단말 ADB는 필요 시에만 TCP 포트를 열고 작업 후 `adb tcpip 0`으로 닫는다.
- IRIS 대시보드(`:3000`)는 사설망 또는 VPN(WireGuard 등)에서만 접근.

## 3. 비밀정보 관리
- IRIS 토큰, 카카오 계정, 외부 API 키는 `config/local.env`가 아닌 **암호화된 비밀 저장소**(예: Bitwarden, Vault)에 보관 후 세션별 로드.
- Hyper-V VM 내 `.env` 파일 권한을 `chmod 600`으로 제한하고, Git에 커밋 금지.
- 루팅 단말에서 추출 가능한 로그에는 개인 식별 정보가 포함되지 않도록 `iris` 설정 시 로그 레벨 조정.

## 4. 장비 보안
- 루팅 단말: 지문/얼굴 인식 등 화면 잠금 사용, 분실 시 원격 초기화 가능하도록 Google/MDM 등록.
- Hyper-V 호스트: Windows BitLocker 활성화, 관리자 계정 다중 인증.
- Hyper-V 스냅샷은 암호화 저장소에 백업하고, 주기적으로 복구 테스트.

## 5. 네트워크 보안
- Hyper-V External vSwitch는 전용 VLAN 또는 방화벽 규칙으로 제한.
- `/reply`, `/query` 요청 시 HTTPS 역프록시(Nginx+Let's Encrypt) 고려, 내부망이라도 mTLS 옵션 검토.
- VPN 터널 사용 시 터널 계정 분리, 접속 로그 90일 이상 보관.

## 6. 운영 프로세스
- 배포 전후 체크리스트에 보안 항목(ADB 포트 상태, 대시보드 노출 여부, 토큰 갱신 주기) 포함.
- 정기 점검(월 1 회)으로 루팅 단말 루트 상태, Hyper-V 패치 레벨, Iris 최신 버전 확인.
- 사고 대응 플로우: 분실/침해 감지 시 → 단말 원격 초기화 → 토큰 폐기 → SSOT 및 저널 기록 → 리포트.

## 7. 로그 및 감사
- Hyper-V VM에서 `journalctl`/`syslog`를 중앙 수집(예: Loki, Elastic)하여 90일 보관.
- IRIS API 호출 로그는 민감 정보 마스킹 후 저장, 운영자 접근 권한 기록 유지.
- 모든 관리 명령(ADB, SSH)은 PowerShell/SSH history를 비활성화하지 않고 감사 로그를 백업.

## 8. 교육 및 문서화
- 운영자에게 루팅 단말 보안 위험을 교육하고, SOP(Standard Operating Procedure)를 `docs/ops` 폴더에 일괄 보관.
- 보안 지침 변경 시 `docs/ssot.md` 히스토리에 날짜와 근거 문서 링크 추가.

> 본 지침은 1차 초안이며, 실장비 도입 후 세부 설정(방화벽 정책, 백업 경로 등)을 구체화해야 한다.
