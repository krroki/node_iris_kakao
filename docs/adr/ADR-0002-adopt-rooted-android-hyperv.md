# ADR-0002: 루팅 안드로이드 + Hyper-V 리눅스 + IRIS 구조 채택

## Meta

- **Date**: 2025-10-28
- **Status**: Accepted
- **Authors**: 사용자
- **Supersedes**: ADR-0001

## 핵심 아키텍처 (AI 필독)

```
┌─────────────────────────────────────────────────────────────┐
│  Windows Host                                               │
│    └─ Hyper-V VM (이름: redroid, Ubuntu)                   │
│         ├─ IRIS 서버 (./iris_control, 포트 3000)           │
│         │    → VM 호스트에서 실행되는 프로세스             │
│         │    → 안드로이드 앱이 아님!                        │
│         │                                                   │
│         └─ Docker: Redroid 컨테이너 (안드로이드 11)        │
│              └─ 카카오톡 앱 (com.kakao.talk)               │
│                   → IRIS가 카카오톡 DB를 읽어 이벤트 전달  │
└─────────────────────────────────────────────────────────────┘
```

**IRIS는 안드로이드 앱이 아니다.** IRIS는 VM(Ubuntu) 호스트에서 실행되는 서버 프로세스이며, Redroid 내부의 카카오톡 DB에 접근하여 메시지 이벤트를 HTTP API로 제공한다.

- IRIS 상태 확인: `ssh kakao@<VM_IP>` → `./iris_control status`
- IRIS API 확인: `curl http://<VM_IP>:3000/config`
- 카카오톡 앱 실행: `adb shell am start -p com.kakao.talk` (Redroid 내부)

## Context (배경)

- LDPlayer 에뮬레이터를 활용한 IRIS 운용은 실 단말 API 호환성과 네트워크 구성이 상이함
- 공식 가이드(H43VTOsKDXY) 기반의 루팅 단말 + 리눅스 VM 구조로 전환이 필요함
- 커뮤니티 실전 사례가 루팅 단말 + 리눅스 조합을 기준으로 제공됨

## Options Considered (고려한 대안)

### Option A: LDPlayer + IRIS (기존, ADR-0001)
- 설명: Windows에서 LDPlayer 에뮬레이터 사용
- 장점: 별도 하드웨어 불필요
- 단점: 실 단말 DB 구조 호환성 낮음, 민감 API 실패율 높음

### Option B: 루팅 안드로이드 + Hyper-V Ubuntu VM (선택됨)
- 설명: Hyper-V로 구동하는 Ubuntu VM을 봇 서버로, 루팅된 안드로이드 단말과 연동
- 장점: 공식 가이드 기준, 실제 단말 호환성 높음, systemd 연계 가능
- 단점: 루팅 단말 보안/운영 이슈 별도 관리 필요

### Option C: Redroid (Docker 안드로이드) + Hyper-V (현재 운영 중)
- 설명: 실제 단말 대신 Redroid 컨테이너 사용
- 장점: 물리 단말 없이 가상화로 운영 가능
- 단점: 일부 API 제약 있을 수 있음

## Decision (결정)

**Hyper-V로 구동하는 Ubuntu 리눅스 VM에서 IRIS 서버를 실행하고, 같은 VM 내의 Redroid(Docker 안드로이드) 컨테이너에서 카카오톡을 구동한다.**

- IRIS 서버: VM 호스트(Ubuntu)에서 `./iris_control`로 실행되는 프로세스 (포트 3000)
- 카카오톡: Redroid 컨테이너 내부의 안드로이드 앱
- IRIS가 ADB를 통해 Redroid 내 카카오톡 DB에 접근하여 메시지 이벤트를 HTTP API로 노출

### Invariants (불변식)

- **IRIS는 안드로이드 앱이 아님** - VM 호스트에서 실행되는 서버 프로세스
- Redroid는 Hyper-V VM 내부의 Docker 컨테이너로 실행됨 (로컬 Windows Docker가 아님)
- VM 이름: `redroid`
- SAFE_MODE=true가 기본값이어야 한다 (수신 전용)
- 모든 IRIS API 호출은 VM IP를 통해 이루어져야 한다 (예: `http://192.168.116.60:3000`)

## Consequences (결과)

### 긍정적 효과
- 공식 Iris 가이드 및 커뮤니티 실전 사례 활용 가능
- 에뮬레이터 대비 실제 단말 DB 구조 호환성 높음
- `/query`, `/decrypt` 등 민감 API 활용 시 실패율 낮음
- Hyper-V External vSwitch로 네트워크 단순화
- systemd 연계 가능

### 부정적 효과 / 리스크
- 루팅 단말 보안·운영 이슈 별도 관리 필요
- VM 관리 오버헤드

### 후속 작업
- [x] 기존 LDPlayer 기반 문서를 `docs/setup/iris-hyperv.md`로 교체
- [x] `docs/ssot.md`, `docs/prd.md` 기술 결정 업데이트
- [x] 운영 스크립트 Hyper-V VM/서비스 재시작 관점으로 재설계
- [ ] 루팅 단말 분실 대응, ADB 접근 통제 등 보안 절차 문서화

## AI Context (AI 필독 - 흔한 오해 방지)

### IRIS는 안드로이드 앱이 아니다

**잘못된 이해**: "IRIS 앱을 Redroid에 설치해야 한다", "`adb install iris.apk`", "`pm list packages | grep iris`"
**올바른 이해**: IRIS는 VM(Ubuntu) 호스트에서 실행되는 서버 프로세스이다.

| 구성요소 | 실행 위치 | 확인 방법 |
|---------|----------|----------|
| IRIS 서버 | VM 호스트 (Ubuntu) | `ssh kakao@<VM_IP>` → `./iris_control status` |
| 카카오톡 | Redroid 컨테이너 (안드로이드) | `adb shell pm list packages \| grep kakao` |

### AI가 해야 할 일 vs 하지 말아야 할 일

**"앱 띄워줘" 요청 시 해야 할 일:**
1. VM이 켜져 있는지 확인
2. IRIS 상태 확인: `curl http://<VM_IP>:3000/config` 또는 SSH로 `./iris_control status`
3. 카카오톡 앱 실행: `adb shell am start -p com.kakao.talk`
4. (웹 대시보드 요청 시) FastAPI + Next.js 기동

**절대 하지 말아야 할 일:**
- `adb install`로 IRIS를 설치하려고 시도 (IRIS는 안드로이드 앱이 아님!)
- `pm list packages | grep iris`로 IRIS를 찾으려고 시도
- Redroid 이미지 재빌드 (사용자 명시 요청 없이)

### IRIS가 동작하지 않을 때

IRIS는 VM 호스트의 프로세스이므로:
1. SSH 접속: `ssh kakao@<VM_IP>`
2. 상태 확인: `./iris_control status`
3. 재시작: `./iris_control restart`

Runbook 참고: `docs/runbook/quickstart_vm_iris_adb.md`

## Links

- Supersedes: [ADR-0001](ADR-0001-adopt-iris-ldplayer.md)
- Setup Guide: `docs/setup/iris-hyperv.md`
- Runbook: `docs/runbook/quickstart_vm_iris_adb.md`
- Code: `windows/setup_iris_port.ps1`, `scripts/probe_iris.sh`
