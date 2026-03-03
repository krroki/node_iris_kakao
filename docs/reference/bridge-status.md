# BRIDGE 상태(상단 StatusBar) 기준

## 목적

UI(3100) 상단 StatusBar의 **BRIDGE**는 “로그가 안 올라오는 것처럼 보이는 상태”를 빠르게 구분하기 위한 지표다.

핵심은 다음 2가지를 분리하는 것이다.

- **채팅이 없어서 조용한 상태**(정상)
- **봇/브릿지 자체가 멈춘 상태**(비정상: 자동 복구 대상)

---

## 지표 정의

- `lastEventAgeSec`
  - 의미: 마지막으로 **채팅 이벤트/로그 이벤트를 관측**한 후 경과 초
  - 한계: 채팅이 없으면 정상이어도 계속 증가한다(오탐 위험).
- `heartbeatAgeSec`
  - 의미: Node bot이 `node-iris-app/data/status.json`에 주기적으로 기록하는 **하트비트**의 경과 초
  - 의미상 “프로세스가 살아 있고 이벤트 루프가 돌고 있다”에 더 가깝다.
- `logAgeSec`
  - 의미: `data/logs/<roomId>/<YYYY-MM-DD>.log` 파일들의 **최근 mtime** 기준 경과 초
  - 한계: 채팅이 없으면 정상이어도 증가한다(오탐 위험).
  - 포인트: `lastEventAgeSec`는 작은데 `logAgeSec`만 크면 “이벤트는 들어오는데 로그가 안 쌓임” 케이스로,
    **실제로 로그가 안 들어오는 장애** 가능성이 높다.

---

## DOWN 판정(운영 기준)

- BRIDGE **DOWN**은 `lastEventAgeSec`가 아니라 **`heartbeatAgeSec` 기준**으로 판정한다.
  - 채팅이 잠시 없는 방에서도 BRIDGE DOWN이 뜨는 오탐을 막기 위함.
- 기본 임계치:
  - OK: `heartbeatAgeSec <= 120`
  - DEGRADED: `120 < heartbeatAgeSec <= 240`
  - DOWN: `heartbeatAgeSec > 240`

임계치는 운영 환경에 따라 조정 가능하지만, **heartbeat가 업데이트되는 주기(기본 60초)**를 먼저 확인해야 한다.

---

## 데이터 소스/경로

- FastAPI:
  - `GET /health` (`server/app.py`) → `bot.lastEventAgeSec`, `bot.heartbeatAgeSec` 포함
  - `GET /status` (`server/app.py`) → `stages.bot.ok`는 heartbeat freshness 기반
- Node bot:
  - `node-iris-app/data/status.json` → `heartbeatTs`, `lastEventTs`
- Web(UI):
  - `web/src/components/StatusBar.tsx` → BRIDGE 배지 표시 로직

---

## DOWN일 때 즉시 점검 순서

1. `windows/watchdog.log`에서 원인 확인:
   - `bot.ok=false`, `WEB UI 체크 실패`, `IRIS /config 실패` 등
2. watchdog가 꺼져 있으면 재기동:

```powershell
pwsh -ExecutionPolicy Bypass -File windows/ensure_watchdog.ps1 -Restart
```

3. Web(UI)만 깨진 경우(남색 화면/정적 자산 404)는 CleanBuild로 복구:

```powershell
pwsh -ExecutionPolicy Bypass -File windows/start_web.ps1 -Mode prod -Port 3100 -ForceKillPort -CleanBuild
```

---

## “BRIDGE는 OK인데 로그가 실제로 안 들어온다” 케이스

BRIDGE(heartbeat)는 OK인데도 UI에 로그가 안 올라오는 경우가 있다. 대표적으로:

- 이벤트(lastEvent)는 최신인데, logStore(logAge)가 같이 갱신되지 않는 상태
  - 예: `lastEventAgeSec <= 60`인데 `logAgeSec >= 120`
  - 이때는 채팅이 있었음에도 로그 파일이 업데이트되지 않는 것으로,
    **실제로 로그가 안 들어오는 장애**일 가능성이 높다.

자동 복구 전제:

- watchdog(`windows/watchdog.ps1`)은 `/status`의 `logStore` stage를 근거로 “이벤트는 최근인데 로그가 뒤처짐”을 감지하면 **bot을 자동 재기동**한다.
- watchdog 자체가 꺼져 있으면, Task Scheduler의 ensure 작업(`windows/register_watchdog_task.ps1`)이 1분마다 자동으로 다시 켠다.
