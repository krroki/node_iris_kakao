# ADR-0003: FastAPI + SSE + Next.js 대시보드로 전환

## Meta

- **Date**: 2025-12-02
- **Status**: Accepted
- **Authors**: 운영/문서

## Context (배경)

- 초기에는 Streamlit 기반 대시보드가 `/logs` HTTP 엔드포인트를 1초마다 폴링하여 방별 로그를 표시했다.
  - 방 수가 늘어날수록 HTTP 요청 수가 선형으로 증가하여 부하와 지연이 커졌다.
  - Streamlit 특성상 JS/DOM 제어가 제한적이라 복잡한 실시간 UI를 구현하기 어려웠다.
- `scripts/log_api.py`와 `/logs/bulk` 엔드포인트로 폴링 횟수를 줄였지만,
  - 근본적으로 **polling 모델**의 한계(지연·중복·불필요 트래픽)를 완전히 해소하지는 못했다.
- Hyper‑V + Redroid + IRIS 구조(ADR-0002) 위에 올라가는 **표준 웹 관제 레이어**가 필요해졌다.
  - 단일 SSE 스트림으로 다수 방의 로그를 전달하고,
  - 필터/검색/다중 패널 등을 유연하게 구성할 수 있는 웹 프론트엔드가 요구되었다.

## Options Considered (대안)

### Option A: Streamlit + `/logs/bulk` 폴링 유지
- 장점
  - 기존 구현 재사용, 마이그레이션 비용 최소.
  - Python 단일 스택으로 빠르게 UI를 수정할 수 있음.
- 단점
  - 복잡한 UI/상태 관리에 한계(복수 탭, 검색, 가상 스크롤 등).
  - 여전히 폴링 기반이어서 대량 방·메시지 시 네트워크·CPU 낭비.

### Option B: FastAPI + SSE 서버만 추가, UI는 Streamlit 유지
- 장점
  - 서버 단에서 SSE로 전환하여 폴링 문제를 해소.
  - 기존 Streamlit 코드 일부 재사용 가능.
- 단점
  - Streamlit이 SSE/EventSource를 1급 시민으로 다루지 못해, 브라우저에 JS를 삽입하는 식의 꼼수에 의존해야 함.
  - 장기적으로 Next.js 등 프론트엔드 프레임워크로 갈아탈 가능성이 높아 **중간 단계**에 머무르게 됨.

### Option C: FastAPI + SSE 서버 + Next.js(React) 대시보드 (**선택안**)
- 장점
  - FastAPI에서 `/logs`, `/logs/stream`, `/rooms`, `/health`를 표준화된 API/SSE로 제공.
  - Next.js(React)에서 상태 관리, 필터, 검색, 가상 스크롤, 멀티 패널 등의 UI를 유연하게 구성 가능.
  - SSE 기반으로 한 클라이언트 당 1개의 스트림으로 다중 방 로그를 전달하여 부하 감소.
  - 이후 데스크톱(Tauri/Electron) 등 다른 클라이언트에서도 동일 API를 재사용 가능.
- 단점
  - Node.js/React 스택 추가에 따른 러닝 커브와 빌드 파이프라인 관리 비용.
  - 초기 마이그레이션 동안 Streamlit과 Next.js 두 UI가 공존해야 함.

## Decision (결정)

**FastAPI 기반 Realtime API 서버 + SSE, 그리고 Next.js 기반 웹 대시보드를 기본 관제 스택으로 채택한다.**

- 서버: `server/app.py`
  - `GET /health` – 헬스 체크
  - `GET /logs` – 스냅샷 조회 (roomId, limit, include/exclude 등)
  - `GET /logs/stream` – SSE 스트림 (roomId, ts, text, sender, roomName 등)
  - `GET /rooms` – 방 목록/메타 정보
- 웹앱: `web/` (Next.js)
  - 초기 스냅샷: `GET /logs`
  - 실시간 업데이트: `EventSource(/logs/stream)` 구독
  - 시간 포맷: `ko-KR`, `Asia/Seoul`
- 로그 소스: `node-iris-app/data/logs/**.log`를 tailing하여 FastAPI가 이벤트를 생성한다.

> 운영 관점에서 “웹앱을 띄운다”는 것은 **FastAPI 서버와 Next.js 웹 UI를 기동해서 IRIS 로그를 시각화하는 것**을 의미한다.  
> IRIS 안드로이드 앱의 설치/업데이트와는 별개의 작업이다(해당 내용은 ADR-0002 및 Runbook 참조).

## Invariants (불변식)

- Realtime API 기본 베이스 URL은 `http://localhost:8600` (또는 동등한 포트프록시)이다.
  - `NEXT_PUBLIC_REALTIME_BASE` 환경변수로 오버라이드하되, 기본값은 로컬 호스트를 가정한다.
- `/logs/stream`는 **읽기 전용 SSE 엔드포인트**로 유지한다.
  - 여기에서 명령/발신을 직접 처리하지 않는다(SAFE_MODE 기본값은 ON).
- Streamlit 기반 UI(`dashboard/`)는 **보존용/백업용**이며, 기본 운영 UI는 `web/` Next.js 앱이다.
- FastAPI 서버는 `server/` 디렉터리에서만 관리하며,
  - IRIS 앱이나 Redroid 컨테이너를 재설치/재구축하지 않는다.
  - IRIS/Redroid 관련 내용은 ADR-0002 + Runbook에 위임한다.
- “웹앱 기동” 요청 시, AI/스크립트는 다음 순서를 따른다.
  1. FastAPI 서버 구동 (`scripts/serve_api_fastapi.sh` 또는 Windows 포트프록시 뒤에서의 등가 스크립트).
  2. Next.js 개발/운영 서버 구동 (`scripts/serve_web.sh` 또는 `cd web && npm run dev`).
  3. 브라우저에서 Next.js URL(예: `http://localhost:3100`)과 `/health`·`/logs/stream` 정상 여부 확인.

## Consequences (결과)

### 긍정적 효과

- 폴링에서 푸시(SSE)로 전환하여 네트워크/CPU 부하와 지연을 줄인다.
- 방 개수가 늘어나도 클라이언트당 1개의 SSE 스트림만 유지하면 되므로 확장성이 좋아진다.
- Next.js/React 기반 UI로 필터링, 정렬, 다중 패널 등 UX를 자유롭게 구성 가능하다.
- 서버/클라이언트가 명확히 분리되어 테스트와 디버깅이 쉬워진다.

### 부정적 효과·리스크

- Node.js/React 빌드 파이프라인 관리 필요 (`npm install`, `npm run build`, `npm test`).
- FastAPI 서버/Next.js UI가 모두 기동되어야 완전한 UI 경험을 제공할 수 있다.
- 초기에는 Streamlit UI와 Next.js UI가 공존하면서 문서/스크립트가 혼재될 수 있다.

### 후속 작업

- `docs/REFAC_PLAN.md`에 정의된 Cutover 체크리스트를 기준으로 Streamlit UI와의 기능 동등성을 맞춘다.
- 운영 스크립트(`scripts/serve_ui.sh`, `windows/start_all.ps1`)가 기본적으로 FastAPI + Next.js 조합을 띄우도록 정리한다.
- `/logs/bulk` 기존 HTTP 엔드포인트는 디버깅/백업 용도로만 유지하고, 신규 기능은 SSE 경로를 우선한다.

## AI Context (AI 필독 - "웹앱 띄워줘" 처리 절차)

### 전체 절차 (5단계)

```
1. VM 상태 확인
   └─ Hyper-V redroid VM이 켜져 있는지 확인

2. IRIS 상태 확인 (선행 체크)
   └─ curl http://<VM_IP>:3000/config → 200 OK 확인
   └─ 문제 있으면 "IRIS 복구 필요(런북 참조)"로만 보고, 설치 시도 X

3. FastAPI 서버 기동 (server/)
   ├─ Linux/WSL: ./scripts/serve_api_fastapi.sh (포트 8600)
   └─ Windows:   windows/start_api.ps1 (포트 8650)

4. Next.js UI 기동 (web/)
   ├─ Linux/WSL: ./scripts/serve_web.sh (포트 3100)
   └─ Windows:   windows/start_web.ps1 (포트 3100)

5. 헬스/SSE 확인
   ├─ http://127.0.0.1:8650/health (또는 8600)
   └─ 브라우저에서 http://127.0.0.1:3100 → SSE 수신 확인
```

### 포트 정리

| 서비스 | Linux/WSL | Windows | 확인 방법 |
|--------|-----------|---------|----------|
| IRIS API | 3000 (VM 내부) | 3000 (포트프록시) | `curl http://<VM_IP>:3000/config` |
| FastAPI | 8600 | 8650 | `curl http://127.0.0.1:8650/health` |
| Next.js | 3100 | 3100 | 브라우저 `http://127.0.0.1:3100` |

### 해야 할 일 vs 하지 말아야 할 일

**해야 할 일:**
1. VM 켜져 있는지 확인
2. IRIS 상태 확인 (`/config` 200 OK)
3. FastAPI 서버 기동
4. Next.js UI 기동
5. `/health`, `/logs/stream` 확인

**절대 하지 말아야 할 일:**
- IRIS 설치/업데이트 시도 (IRIS는 안드로이드 앱이 아님! ADR-0002 참조)
- Redroid 이미지 재빌드 (사용자 명시 요청 없이)
- `adb install`로 뭔가 설치하려는 시도

### IRIS가 동작하지 않을 때

웹앱 계층에서 IRIS 문제를 해결하려 하지 않는다:
- "IRIS 복구 필요" 상태로만 보고
- Runbook 경로 안내: `docs/runbook/quickstart_vm_iris_adb.md`
- 코드/스크립트로 자동 설치 시도 금지

## Links

- Related ADR: [ADR-0002 – 루팅 안드로이드 + Hyper-V 구조](ADR-0002-adopt-rooted-android-hyperv.md)
- Architecture: `docs/ARCHITECTURE.md`
- Refactoring Plan: `docs/REFAC_PLAN.md`
- Scripts: `scripts/serve_api_fastapi.sh`, `scripts/serve_web.sh`

