# ADR-0017 – 상태/룸 정보 FS 결합 해소 및 API 단일화

## Status
- Accepted – 2025-12-06

## Context

- Next.js 대시보드(`web/`)는 현재 다음과 같은 방식으로 Node-IRIS 봇/로그 상태를 읽고 있다.
  - `/api/status`:
    - `web/src/app/api/status/route.ts`에서 `../node-iris-app/data/status.json`과 `../node-iris-app/data/logs/**`를 직접 읽어 상태를 계산한다.
    - 일부 단계(Realtime)는 FastAPI `/health`를 호출하지만, 나머지(device, bot, logStore)는 파일 시스템에 직접 의존한다.
  - `/api/rooms`:
    - `web/src/app/api/rooms/route.ts`에서 FastAPI `/rooms` 호출에 실패할 경우, `listRoomsSummary()`(로컬 파일 요약)를 사용해 방 목록을 돌려준다.
- 이 구조는 다음과 같은 문제를 낳는다.
  1. **디렉터리 결합**: `web`이 `node-iris-app/data` 경로를 전제로 하므로, 디렉터리 구조가 바뀌면 UI가 깨진다.
  2. **경쟁 조건**: 봇이 `status.json`을 쓰는 동안 Next API가 읽으면, 부분 읽기/JSON 파싱 오류가 발생할 수 있다.
  3. **SSOT 위반**:
     - 동일한 상태 정보를 FastAPI(`/health`/`/rooms`)와 Next API가 서로 다른 경로로 계산한다.
     - `/api/rooms`는 FastAPI 실패 시 오래된 파일 기반 요약으로 fallback하여, 실제와 다른 방 목록을 보여줄 수 있다.
  4. **보안/경계 모호**: 프론트엔드 계층(Next API)이 봇 데이터 디렉터리 전체를 읽을 수 있는 권한을 가진다.

프로젝트 전반의 원칙(ADR-0010/0012/0016, CLAUDE.md)에서는 다음을 강조한다.

- SAFE_MODE, 템플릿, 런타임 설정 등은 **단일 소스(runtime.json + FastAPI)**로 노출해야 한다.
- FALLBACK는 가능하면 피하고, “데이터 없음/서비스 다운” 상태를 명시적으로 노출해야 한다.

따라서 상태/룸 정보 역시 FastAPI를 통해서만 읽는 방향으로 정리할 필요가 있다.

## Decision

1. **상태 요약의 단일 소스: FastAPI `/status`**
   - FastAPI 서버(`server/app.py`)에 `GET /status` 엔드포인트를 추가한다. (**구현 완료**)
   - 이 엔드포인트는 다음 정보를 집계하여 JSON으로 반환한다.
     - device: `windows/device_health_cache.json` 기반 Redroid/IRIS 단말 상태
     - bot: `node-iris-app/data/status.json` 기반 Node-IRIS 봇 상태(heartbeat/lastEvent)
     - logStore: 로그 디렉터리(`node-iris-app/data/logs/**`)의 최신 mtime 기반 최근 로그 시각
     - realtime: FastAPI 내부 상태(`/health`와 동일한 ok/rooms/bot age)
   - Next.js의 `/api/status`는 더 이상 파일 시스템을 직접 읽지 않고, FastAPI `/status`만 호출해 결과를 프록시한다.

2. **룸 목록의 단일 소스: FastAPI `/rooms`**
   - `/api/rooms`는 FastAPI `GET /rooms` 응답만 사용한다. (**구현 완료**)
   - FastAPI 호출이 실패할 경우, 로컬 파일 요약(`listRoomsSummary`)으로 fallback하지 않고, HTTP 503과 명시적 에러(payload:{ ok:false,error:"realtime_unavailable" })를 반환한다. (**구현 완료: `web/src/app/api/rooms/route.ts`**)
   - “방 목록이 오래된 상태로 보이는 것”보다 “서비스가 내려갔다고 명시적으로 알려주는 것”을 우선시한다.

3. **파일 시스템 접근 경계 정리**
   - `node-iris-app/data/status.json` 및 로그 파일에 대한 읽기/쓰기는 다음으로 제한한다.
     - 작성(write): Node-IRIS 봇(`node-iris-app/src/index.ts`, 컨트롤러들)
     - 읽기(read): FastAPI (`server/app.py` 및 `server/log_utils.py`)
   - Next.js(`web/`)는 운영 시점에 `node-iris-app/data/**` 경로를 직접 읽지 않는다.
   - 개발/디버그 용도로 파일을 읽어야 할 경우, 별도 스크립트(`scripts/` 하위)나 FastAPI 디버그 엔드포인트를 사용한다.

## Consequences

### 긍정적 효과

- **FS 결합 감소**: Next.js 코드가 디렉터리 구조에 묶이지 않고, FastAPI URL만 알면 되므로 이동/패키징이 쉬워진다.
- **SSOT 강화**:
  - 상태/룸 정보의 유일한 진실 공급원(SSOT)이 FastAPI(`/status`, `/rooms`)로 명확해진다.
  - SAFE_MODE·템플릿·런타임 설정과 동일한 패턴으로 “모든 상태/설정은 API 계층을 통한다”는 규칙을 유지할 수 있다.
- **에러 시 동작이 명시적**:
  - Realtime API가 다운되면, UI는 오래된 상태를 조용히 보여주는 대신 “realtime_unavailable” 에러를 명시적으로 보여준다.
  - 운영자는 문제를 더 빨리 감지할 수 있다.
- **경계/보안 개선**:
  - Next.js가 봇 데이터 디렉터리를 마음대로 읽지 않으므로, 권한/경계가 더 명확해진다.

### 부정적/주의점

- FastAPI `/status` 구현이 복잡해질 수 있다.
  - `server/app.py`에 status.json/logs/device cache를 읽는 코드가 추가되며, 이 부분도 추후 테스트/리팩토링 대상이 된다.
- 기존 `/api/status`가 제공하던 디테일(예: UI 자체 상태 등)은 FastAPI에서 알기 어렵기 때문에,
  - UI 단계에 대한 상태 정보는 Next 측에서 별도의 stage로 추가하거나, `/status` 응답에 포함하지 않을 수 있다.
- `/api/rooms`에서 로컬 파일 fallback을 제거하므로,
  - Realtime API가 내려갔을 때는 “방 목록이 안 보인다”는 UX가 발생할 수 있다.
  - 이는 대신 “서비스 이상 알림”으로 처리해야 한다.

## Status / Migration Plan

- 1단계 (**완료**):
  - `server/app.py`에 `GET /status` 추가해 device/bot/logStore/realtime/ui 단계를 집계.
  - `web/src/app/api/status/route.ts`를 FastAPI `/status` 프록시로 단순화.
- 2단계 (**완료**):
  - `web/src/app/api/rooms/route.ts`에서 `listRoomsSummary()` 파일 기반 fallback 제거.
  - 에러 응답(`503 + {ok:false,error:"realtime_unavailable"}`)을 UI에서 처리하도록 page.tsx를 보완.
- 3단계 (**진행 중, 원칙 확정**):
  - 상태/룸 정보와 관련된 향후 변경은 항상 FastAPI 계층부터 수정하고, Next.js는 해당 API를 프록시/소비하는 패턴을 유지한다.

## Links

- `server/app.py` – FastAPI `/health`, `/logs`, `/rooms`, `/runtime` 구현
- `web/src/app/api/status/route.ts` – Next.js 상태 API (기존 FS 접근 → FastAPI 프록시로 변경 예정)
- `web/src/app/api/rooms/route.ts` – 룸 목록 API (FastAPI `/rooms`만 사용, 파일 fallback 제거)
- `docs/ARCHITECTURE.md` – Windows-only 스택 및 Realtime API 구조 개요
