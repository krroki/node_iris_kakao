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

