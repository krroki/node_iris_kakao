# ADR-0023: `/status` 기반 Watchdog 자동 재시작(봇/파이프라인)

## Meta

- **Date**: 2025-12-13
- **Status**: Accepted
- **Authors**: PM AI, Codex CLI
- **Related**: ADR-0011(Bot Singleton), ADR-0017(Status API), ADR-0019(Log pipeline hardening), `agents.md`, `docs/ssot.md`

---

## Context

운영 중 간헐적으로 다음 문제가 재발했다.

- 대시보드에서 로그가 더 이상 올라오지 않음
- `/status` 또는 `/health`에서 bot pid/lastEvent가 비거나, bot/logStore stage가 실패로 표시됨
- 원인 유형은 다양하나 공통적으로 “봇이 죽었거나, 이벤트는 들어오는데 로그 기록이 깨져 UI가 멈춘 것처럼 보이는 상태”로 귀결됨

또한 운영 원칙상 **조용한 폴백(문제 은폐)** 는 금지이며, 장애 감지/조치/결과가 명확히 남아야 한다(agents 가드레일).

---

## Decision

Windows에서 상주 실행되는 watchdog를 도입해 **장애를 자동 감지하고 봇/파이프라인을 자동 재시작**한다.

### 운영 원칙(중요): 운영자가 수동 명령을 치지 않는다

- 정상 운영에서는 운영자가 `start_all`/`start_bot` 같은 명령을 수동 실행하지 않아도 되도록,
  **Watchdog가 자동 감지/자동 복구**하는 것을 기본 전제로 한다.
- 전제 조건(1회 설정):
  - Windows Task Scheduler에 `windows/register_watchdog_task.ps1`로 ensure 작업을 등록한다.
  - 기본값으로 **1분 주기 + 로그인(ONLOGON)** 2개의 작업을 만들고, 두 작업 모두 `windows/run_ensure_watchdog.vbs`(`wscript.exe`)로 실행해 **PowerShell 창이 뜨지 않게** 한다.
  - ensure 작업은 `windows/ensure_watchdog.ps1`를 실행해 watchdog를 “항상 켜진 상태”로 유지한다.

### 1) 상태 소스: FastAPI `/status`

- watchdog는 `http://127.0.0.1:8650/status`(기본)를 주기적으로 폴링한다.
- 판단은 `stages.bot`, `stages.logStore`를 우선 사용한다.

### 2) 재시작 규칙(명시적)

1. **API `/status` 연결 실패**
   - `windows/start_all.ps1`로 파이프라인 재가동(API+KB+Bot+Web).
2. **`stages.bot.ok == false`**
   - 봇 자동 재시작.
   - IRIS(`127.0.0.1:5050/config`)가 죽어있으면 `windows/smart_restart_bot.ps1`를 우선 사용(포트프록시/봇 재시작).
3. **logStore 지연(“이벤트는 최근인데 로그가 뒤처짐”)**
   - `/status`의 `stages.logStore.extra`를 근거로 감지(예: `lastEventAgeSec`는 작고 `logAgeSec`는 큰 상태, 혹은 `lastEventTs - latestLogTs > 60s`).
   - 이 경우 봇 자동 재시작.

※ 단순한 “채팅이 없어서 로그가 오래된 상태”는 자동 재시작 트리거로 사용하지 않는다(불필요한 재시작 방지).

### 3) 재시작 폭주 방지(Cooldown)

- Bot 재시작: 기본 120s
- Pipeline 재기동: 기본 300s
- IRIS repair: 기본 300s, 연속 실패 기준치(기본 3회) 이상일 때만 실행

cooldown으로 인해 조치를 “스킵”하는 경우에도 **스킵 사유와 남은 시간**을 로그로 남긴다(폴백 금지).

### 4) 단일 인스턴스 보장

- watchdog는 Windows Mutex(`Local\\12kakao_watchdog`)로 **중복 실행을 차단**한다.

### 5) 로깅/가시화(운영 필수)

- 모든 감지/조치/결과는 `windows/watchdog.log`에 UTF-8로 기록한다.
- Web UI는 `/api/watchdog`로 최근 로그(마지막 80줄)를 표시해 운영자가 즉시 확인 가능해야 한다.

### 6) 인코딩 원칙(Windows PowerShell 5.1)

- 한글이 포함된 `.ps1`은 **UTF-8 BOM 저장을 강력 권장**한다.
  - BOM이 없으면 PowerShell 5.1이 ANSI로 오인해 스크립트 파싱/문자열이 깨질 수 있다.

---

## Implementation

- `windows/watchdog.ps1`: `/status` 기반 감지 + 자동 재시작 + cooldown + 단일 인스턴스 + 로그 기록
- `windows/start_all.ps1`: 기본으로 watchdog를 백그라운드 기동(필요 시 `-NoWatchdog`)
- `docs/ssot.md`, `docs/sessions/*`: 운영 변경사항 기록

---

## Invariants

1. **조용한 폴백 금지**: 감지/조치/스킵은 모두 `windows/watchdog.log`에 남는다.
2. **자동 재시작은 명시적 규칙과 근거(/status)로만 수행**한다.
3. **재시작 폭주 방지**: cooldown 없이 무한 루프 재가동을 하지 않는다.
4. **UI에서 확인 가능**해야 한다(`/api/watchdog`).

---

## Update (2025-12-18) — Web 재시작/BRIDGE DOWN 오탐 보강

- Web 재시작(`windows/watchdog.ps1` → `windows/start_web.ps1`)은 **문자열 배열로 `"-Port" "3100"` 형태를 전달하면 안 된다.**
  - PowerShell은 런타임 문자열을 “파라미터 토큰”으로 재해석하지 않아, `Port([int])`에 `"-Port"` 문자열이 바인딩되는 오류가 발생한다.
  - 해결: `start_web.ps1` 호출은 **명시적 파라미터** 또는 **해시테이블 splat**으로 수행한다.
- “BRIDGE DOWN” 판단은 단순 `lastEventTs`(채팅 이벤트) 기준이면 **채팅이 잠시 없는 방에서 오탐**이 잦다.
  - FastAPI `/status`의 bot stage는 **heartbeatTs freshness 기반으로 ok**를 판단하고,
  - UI의 상태바는 `/health`의 `heartbeatAgeSec`를 기준으로 BRIDGE 상태를 표시한다.
- BRIDGE OK인데 “로그 저장이 멈춘 상태”(LOG LAG)를 구분하기 위해, `/health`에 `logStore.latestLogTs/logAgeSec`를 추가하고 UI에서 별도 배지로 표시한다.
- `windows/ensure_watchdog.ps1`는 `ensure_watchdog.ps1` 자체가 `watchdog.ps1` 서브스트링에 매칭되는 오탐을 피하기 위해,
  “watchdog.ps1” 단독 문자열 매칭이 아니라 **watchdog 스크립트의 전체 경로**로 프로세스를 판별한다.

---

## Update (2025-12-19) — start_all 비동기 실행 + hung 감지 재기동 + UI 재시작 버튼

- watchdog가 `start_all.ps1`을 **동일 프로세스에서 동기 호출**하면, start_all이 장시간 블록될 때 watchdog 루프가 멈춰 자동 복구가 중단될 수 있다.
  - 해결: `start_all.ps1`은 `Start-Process`로 **별도 PowerShell 프로세스로 spawn**하고, watchdog는 루프를 계속 돌도록 한다.
- `windows/ensure_watchdog.ps1`는 watchdog 프로세스가 살아있더라도 `windows/watchdog.log` 갱신이 오래 멈추면(hung) **자동 재기동**한다.
  - 기준: `-MaxLogAgeSec` (기본 900초)
- Web UI(3100):
  - `Watchdog 재시작` 버튼(`/api/watchdog` POST)으로 `ensure_watchdog.ps1 -Restart`를 실행해 자동 복구 루프를 즉시 재개한다.
  - `봇/워커 프로세스` 카드에서 미실행/하트비트 경고 워커를 `-Restart`로 재기동 요청할 수 있다(`/api/bot/workers/restart`).

