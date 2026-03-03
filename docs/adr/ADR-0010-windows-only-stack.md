# ADR-0010: Windows 전용 스택 및 IRIS_URL SSOT 확립

## Meta

- **Date**: 2025-12-03
- **Status**: Accepted
- **Authors**: 사용자, Claude (Opus 4.5)
- **Related Session**: IRIS 연결 장애 해결 세션

## Context (배경)

### 문제 상황
1. **다중 .env 파일 혼란**: 프로젝트에 여러 .env 파일이 존재하며, 각각 다른 IRIS_URL 값을 가지고 있었음
   - 루트 `.env`: `IRIS_URL=http://127.0.0.1:8765` (레거시)
   - `node-iris-app/.env`: `IRIS_URL=http://127.0.0.1:5050`
   - WSL 경로의 .env 파일들: 별도 값들

2. **WSL vs Windows 경로 혼동**: Windows 경로(`c:\dev\...`)와 WSL 경로(`//wsl$/Ubuntu/...`)가 서로 다른 파일시스템이라는 점이 간과됨

3. **Hyper-V VM vs WSL 혼동**: IRIS/Redroid가 실행되는 Hyper-V VM(`redroid`)과 개발용 WSL Ubuntu는 완전히 별개 환경

4. **포트 충돌**: 8765(레거시)와 5050(신규) 포트가 혼재하여 연결 장애 발생

### 제약 조건
- IRIS는 Hyper-V VM 내부 Docker에서 실행 (포트 3000)
- Windows에서 VM으로 접근하려면 portproxy 필요
- 개발 도구(Codex, Claude Code 등)가 Node.js로 실행 중

## Options Considered (고려한 대안)

### Option A: WSL + Windows 혼용 유지
- 설명: 기존처럼 WSL bash 스크립트와 Windows PowerShell 혼용
- 장점: 기존 코드 변경 불필요
- 단점: 경로 혼란, .env 파일 동기화 문제 지속

### Option B: WSL 전용
- 설명: 모든 스크립트를 WSL bash로 통일
- 장점: Unix 표준 도구 활용
- 단점: Windows 네이티브 도구(PowerShell, netsh) 접근 어려움, portproxy 관리 복잡

### Option C: Windows 전용 (선택됨)
- 설명: PowerShell 스크립트만 사용, WSL 의존성 제거
- 장점: 단일 경로 체계, portproxy 직접 제어, 명확한 실행 환경
- 단점: bash 스크립트 재작성 필요 (이미 완료됨)

## Decision (결정)

**우리는 Windows 전용 스택(Option C)을 선택했다.**

### 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│  Windows Host (개발 환경)                                │
│  ┌─────────────────────────────────────────────────────┐│
│  │ node-iris-app (봇)                                  ││
│  │ IRIS_URL=http://127.0.0.1:5050                      ││
│  └────────────────────┬────────────────────────────────┘│
│                       │                                  │
│  ┌────────────────────▼────────────────────────────────┐│
│  │ Windows Portproxy (netsh)                           ││
│  │ 127.0.0.1:5050 → VM_IP:3000                         ││
│  └────────────────────┬────────────────────────────────┘│
└───────────────────────┼─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│  Hyper-V VM "redroid" (별도 네트워크)                    │
│  ┌─────────────────────────────────────────────────────┐│
│  │ Docker: IRIS Container                              ││
│  │ 내부 포트: 3000                                      ││
│  │ Redroid: 5555 (ADB)                                 ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘

※ WSL Ubuntu는 위 구조와 완전히 별개 (개발 참고용만)
```

### IRIS_URL SSOT (Single Source of Truth)

| 환경 | 값 | 용도 |
|------|-----|------|
| Windows 봇/앱 | `http://127.0.0.1:5050` | 모든 클라이언트 코드 |
| VM 내부 | `127.0.0.1:3000` | Docker 컨테이너 직접 접근 |
| Portproxy | `127.0.0.1:5050 → VM_IP:3000` | Windows→VM 라우팅 |

### 폐기된 값
- ❌ `8765` 포트: 완전 폐기, 모든 .env 및 portproxy에서 제거
- ❌ WSL용 스크립트 (`scripts/serve_web.sh` 등): 사용 중단

### Invariants (불변식)

1. **IRIS_URL은 반드시 `http://127.0.0.1:5050`**
   - VM IP 직접 사용 금지
   - portproxy를 통해서만 접근

2. **Windows 스크립트만 공식 경로**
   - `windows/start_all.ps1` - 전체 스택 시작
   - `windows/start_web.ps1` - 웹 서버만 시작
   - `C:\Users\Public\run_node_iris_bot.ps1` - 봇 시작
   - `C:\Users\Public\stop_node_iris_bot.ps1` - 봇 중지

3. **Node 프로세스 관리 주의**
   - ❌ `Stop-Process -Name node -Force` 금지 (Codex 등 다른 앱도 종료됨)
   - ✅ `stop_node_iris_bot.ps1`로 봇만 종료

4. **Hyper-V VM ≠ WSL**
   - VM 이름: `redroid`
   - VM 접속: `ssh iris@<VM_IP>`
   - VM Docker: IRIS, Redroid 실행
   - WSL: 개발 참고용, 서비스 실행에 사용하지 않음

## Consequences (결과)

### 긍정적 효과
- .env 파일 혼란 해소 (Windows 경로만 관리)
- portproxy 관리 단순화
- 스크립트 실행 환경 통일

### 부정적 효과 / 리스크
- 기존 WSL 기반 문서/스크립트 정리 필요
- bash 친화적 개발자에게 러닝 커브

### 후속 작업
- [x] 모든 .env 파일 IRIS_URL=http://127.0.0.1:5050으로 통일
- [x] 8765 portproxy 규칙 삭제
- [x] CLAUDE.md에 프로세스 관리 규칙 추가
- [ ] WSL용 스크립트 정리/아카이브

## AI Context (AI 협업 메모)

> 이 결정은 봇 재시작 시 "socket hang up" 오류가 반복되면서 도출되었습니다.

- **근본 원인**: 루트 .env에 레거시 값(8765)이 남아있었고, 봇이 이를 읽어 잘못된 포트로 연결 시도
- **교훈**: Windows/WSL 경로 차이를 항상 인식하고, .env 편집 시 어느 파일시스템인지 확인 필수
- **주의사항**: AI가 `Stop-Process -Name node -Force` 같은 광범위한 프로세스 종료 명령을 사용하지 않도록 CLAUDE.md에 명시

## Links

- Related ADR: ADR-0002 (Hyper-V 도입)
- Code: `node-iris-app/.env`, `windows/*.ps1`
- Config: `C:\Users\Public\set_env_windows_safe.ps1`
