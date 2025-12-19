# ADR-0025: Next.js Web 운영(prod) 고정 + Watchdog Web Health 자동 재시작

## Meta

- **Date**: 2025-12-13
- **Status**: Accepted
- **Authors**: PM AI, Codex CLI
- **Related**: ADR-0023(`/status` 기반 Watchdog), `windows/start_all.ps1`, `windows/start_web.ps1`, `windows/watchdog.ps1`, `web/next.config.mjs`

---

## Context

운영 중 Next.js(Web)에서 다음 장애가 반복적으로 관측됐다.

- Web UI 접속 시 흰 화면/500이 지속되고, `windows/logs/web.err.log`에 같은 에러가 폭증
  - 예: `Cannot find module './chunks/vendor-chunks/next.js'`, `Cannot find module './379.js'`
- 원인 패턴: `.next` 산출물이 “부분 삭제/불일치” 상태가 되면, Next 서버가 매 요청마다 같은 chunk require에 실패하며 장애가 계속 누적된다.
- 특히 `next dev`(개발 서버) 실행 중 `next build`가 같은 distDir(`.next`)를 덮어쓰면, 정적 chunk 경로가 깨져 UI가 연쇄적으로 404/require 실패를 낸다.

운영 원칙상 “조용히 넘어가기”는 금지이며, 장애는 명시적으로 실패 처리하고, 상주 프로그램은 **감독자(Watchdog)가 자동 복구**해야 한다.

---

## Decision

**운영(Web)은 `next dev`가 아니라 `next start`(prod)로 고정**하고, distDir을 분리해 `.next` 충돌을 제거한다. 또한 watchdog가 Web health를 별도로 감지해 **Web만 자동 재시작**한다.

### 1) distDir 분리

- Next.js의 distDir을 phase에 따라 분리한다.
  - dev: `.next`
  - prod(build/start): `.next-prod`

### 2) 운영 실행 경로 SSOT

- 운영 기동은 `windows/start_all.ps1` → `windows/start_web.ps1 -Mode prod`(내부적으로 `next start`)를 SSOT로 둔다.
- dev 모드는 개발 작업에만 사용하며, 운영 상주 프로세스에서 `next dev`를 사용하지 않는다.

### 3) Watchdog Web Health

- watchdog는 API `/status`와 별개로 Web health를 체크한다.
- API는 정상인데 Web만 죽는 경우 Web만 재시작한다.
- 반복 실패 시 `.next-prod` 산출물 파손 가능성이 높으므로 **CleanBuild(삭제 후 재빌드)** 를 단계적으로 시도한다.

#### Health 기준(2025-12-18 보강)

- `/api/ping(200)`만으로는 “정적 자산 404로 인한 빈 화면(남색 배경)”을 놓칠 수 있으므로,
  watchdog는 다음을 함께 확인한다.
  - `/api/ping` 200
  - `/` HTML 200
  - HTML에서 참조하는 `/_next/static/*.(css|js)` 중 1개가 200

---

## Invariants (불변식)

1. **운영 Web은 prod로 고정**: `next dev`는 개발용이며 운영 상주 경로에 포함하지 않는다.
2. **distDir 충돌 금지**: dev와 prod 출력 디렉터리를 분리해 `.next` 덮어쓰기/부분 삭제로 인한 chunk 깨짐을 방지한다.
3. **폴백 금지**: “깨진 산출물로 일단 띄우기” 같은 조용한 진행을 금지한다.
4. **자동 복구는 명시적 근거 기반**: Web은 `/api/ping` + 정적 자산 검증 실패를 근거로만 재시작한다.
5. **산출물은 커밋 금지**: `.next`, `.next-prod`는 build output이며 Git에 포함하지 않는다.

---

## Implementation

- `web/next.config.mjs`
  - dev/prod distDir 분리(`.next` vs `.next-prod`)
- `web/src/app/api/ping/route.ts`
  - 의존성 없는 최소 health endpoint(`/api/ping`)
- `windows/start_web.ps1`
  - `-Mode prod|dev` 지원(기본 prod)
  - prod는 `.next-prod` 기반으로 `next start` 실행
  - `.next-prod` 산출물 누락 감지 시 자동으로 삭제 후 재빌드(부분 파손 복구)
- `windows/watchdog.ps1`
  - Web health(`/api/ping` + 정적 자산) 연속 실패 시 Web만 자동 재시작
  - 반복 실패 시 CleanBuild로 단계적 복구
- `windows/start_all.ps1`
  - Web은 기본 `-Mode prod`로 기동
  - `cd web && npm run build`로 운영 산출물을 직접 덮어쓰지 않도록, `start_web.ps1` 내부에서 필요 시 build를 수행한다.

---

## Consequences

### 긍정적 효과

- dev/build 충돌로 인한 `.next` 산출물 파손이 구조적으로 사라진다.
- Web 장애가 “로그 폭증”으로 누적되기 전에 watchdog가 Web만 자동 복구해 상시 운영 안정성이 높아진다.

### 부정적 효과 / 리스크

- CleanBuild는 시간이 걸릴 수 있어 Web 다운타임이 발생할 수 있다(대신 무한 오류 누적을 방지).
- `/api/ping`는 운영의 단일 health 기준이므로, 해당 엔드포인트는 가볍게 유지해야 한다.

---

## Update (2025-12-18) — 재발 방지(빌드 가드 + watchdog 인자 버그 수정)

- `web/scripts/prebuild_guard.ps1`:
  - 운영 UI(`next start`)가 실행 중인 상태에서 `npm run build`를 실행하면 산출물이 덮어써져 빈 화면(정적 자산 404)이 발생할 수 있어,
    **UI 실행 중 build를 차단**한다.
  - 운영 반영은 `windows/start_web.ps1 -CleanBuild` 경로로만 수행한다.
- `windows/watchdog.ps1`:
  - `windows/start_web.ps1` 호출은 문자열 배열(`"-Port" "3100"`)로 전달하면 Port 바인딩이 깨질 수 있어,
    **명시적 파라미터 호출로 고정**한다.

---

## Links

- `web/next.config.mjs`
- `web/src/app/api/ping/route.ts`
- `windows/start_web.ps1`
- `windows/watchdog.ps1`
- `windows/start_all.ps1`

