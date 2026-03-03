# ADR-0019: 로그 파이프라인 안정성(SAVE_CHAT_LOGS / /status logStore) 강화

## Status

- Accepted – 2025-12-07

## Context

### 증상

- 카카오톡 방에서는 메시지가 잘 오가는데, 대시보드 로그가 어느 시점부터 더 이상 갱신되지 않는 현상이 반복적으로 발생했다.
- FastAPI `/logs`, Next `/api/bulk`는 같은 마지막 로그를 보고 있지만, **실제 최신 톡 메시지보다 과거 시점에서 멈춘 상태**가 될 수 있었다.

### 근본 원인 후보

1. **SAVE_CHAT_LOGS 플래그 의존**
   - `node-iris-app/src/app.ts`:
     - `saveChatLogs: process.env.SAVE_CHAT_LOGS === "true"` 로 설정되어 있었다.
   - `node-iris-app/.env` 기본값은 `SAVE_CHAT_LOGS=false` 로 되어 있었고,
     `windows/start_bot.ps1` / `start_all.ps1` 어디에서도 이 값을 강제하지 않았다.
   - 결과적으로, 어떤 세션에서는 SAVE_CHAT_LOGS=false 상태로 봇이 띄워져 **IRIS 이벤트는 받는데 로그 파일은 전혀 쓰지 않는** 구간이 생길 수 있었다.

2. **다단계 + 폴백 구조로 인한 SSOT 약화**
   - 로그 파이프라인은 다음과 같이 여러 계층을 거친다.
     1) node-iris → `node-iris-app/data/logs/**` 파일 쓰기  
     2) FastAPI `/logs`, `/logs/bulk` → 파일 tail  
     3) Next `/api/bulk` → FastAPI 프록시(실패 시 파일 폴백)
   - 이 구조에서 한 레이어(예: node-iris → 파일)가 멈춰도,
     다른 레이어는 “200 OK”와 캐시된 데이터를 그대로 반환할 수 있어, 운영자가 **어디에서 파이프라인이 끊겼는지 바로 인지하기 어렵다.**

3. **/status logStore 스테이지 설계 한계**
   - 기존 구현은 `status.json.lastEventTs`를 `logStore` 스테이지의 기준 시각으로 사용하고,
     디렉터리/파일 mtime은 “보강용”으로만 사용했다.
   - SAVE_CHAT_LOGS=false 상태에서도 node-iris는 status.json 의 `lastEventTs`를 갱신하므로,
     실제 로그 파일이 갱신되지 않아도 `logStore.ok == True` 로 보일 수 있는 설계였다.

위 원인들이 합쳐져 “톡은 살아 있는데 대시보드 로그가 과거에서 멈춘 것처럼 보이는” 사고 가능성이 구조적으로 존재했다.

## Decision

### 1. SAVE_CHAT_LOGS 기본값을 항상 true 로 고정

1. **node-iris-app App 기본값 변경**
   - `node-iris-app/src/app.ts`:

   ```ts
   const saveChatLogsEnv = process.env.SAVE_CHAT_LOGS;
   const saveChatLogs =
     saveChatLogsEnv === undefined ? true : saveChatLogsEnv === "true";

   this.bot = new Bot(appName, irisUrl, {
     saveChatLogs,
     autoRegisterControllers: false,
     ...
   });
   ```

   - 환경변수가 **없으면 무조건 true**, 명시적으로 `"false"` 일 때만 비활성화된다.

2. **.env.example 기본값 수정**

   - `node-iris-app/.env.example`:

   ```env
   # 로그/디버깅 설정
   # NOTE: (로그 파이프라인 안정성) 기본값은 항상 true.
   # 필요 시 테스트 환경에서만 명시적으로 false 로 설정한다.
   SAVE_CHAT_LOGS=true
   LOG_LEVEL=debug
   ```

3. **start_bot.ps1 에서 환경변수 강제**

   - `windows/start_bot.ps1`:

   ```powershell
   # Always set IRIS_URL explicitly to avoid WSL/5050 portproxy
   $env:IRIS_URL = $IrisUrl
   # Always enable chat logging for this bot instance to keep dashboard/RAG in sync.
   # 테스트 환경에서만 SAVE_CHAT_LOGS=false 를 명시적으로 덮어쓰도록 한다.
   if (-not $env:SAVE_CHAT_LOGS -or [string]::IsNullOrWhiteSpace($env:SAVE_CHAT_LOGS)) {
     $env:SAVE_CHAT_LOGS = 'true'
   }
   ```

   - 운영/개발에서 공식 스크립트로 봇을 띄우는 한, **로그 저장은 기본 ON** 이다.

4. **로컬 .env 기본값 정렬**

   - `node-iris-app/.env` (커밋 대상 아님, 로컬 설정): `SAVE_CHAT_LOGS=true` 로 수정.
   - SSOT는 `.env.example` 및 start 스크립트. 로컬 `.env`는 이를 덮어쓰는 용도이므로,
     테스트용으로만 `false` 를 허용한다.

### 2. /status logStore 스테이지에서 bot vs log 타임라인 비교

1. **status.json 과 로그 mtime을 분리해 사용**

   - `server/app.py` 의 `_log_stage()` 를 다음과 같이 변경:
     - `status.json.lastEventTs` → **봇 이벤트 유무 / 타임라인 비교용**.
     - `logs_dir` 내 로그 파일 mtime → **로그 신선도 판단의 단일 기준**.

2. **케이스별 판단 로직**

   1) **로그 파일 없음**

      - `latest_ms == 0` 인 경우:
        - `lastEventTs`가 최근이라면:
          - `ok = False`, detail:
            > "봇 이벤트는 들어오지만 로그 파일이 생성되지 않았습니다 (SAVE_CHAT_LOGS 또는 파일 권한을 확인하세요)."
        - `lastEventTs`도 없으면:
          - `ok = False`, detail:
            > "로그 파일이 없거나, 아직 어떤 메시지도 기록되지 않았습니다."

   2) **봇 이벤트 vs 로그 타임라인 불일치**

      - `lastEventTs` 는 매우 최근인데, 로그 mtime 이 그보다 **60초 이상 과거**인 경우:
        - `ok = False`, detail:
          > "봇 이벤트는 최근까지 들어오지만 로그 파일 업데이트가 지연되고 있습니다 (SAVE_CHAT_LOGS 설정 또는 디스크/권한 문제를 확인하세요)."
        - `extra` 에 `lastEventTs`, `latestLogTs`, `lastEventAgeSec`, `logAgeSec` 를 함께 노출.

   3) **정상 TTL 체크**

      - 로그 mtime 기준으로 `age_ms < 15분` 이면 `ok = True`,
        그렇지 않으면 `ok = False` + `"로그가 N초 동안 기록되지 않았습니다."` 메시지.

3. **/status 응답 구조 유지**

   - 상위 `/status` 응답 구조는 그대로 유지하되,
     `stages.logStore.extra` 에 `lastEventTs` / `latestLogTs` / ageSec 정보를 포함한다.

### 3. 로그 파이프라인 회귀 테스트 추가

- `tests/test_log_pipeline_status.py` 신규 작성:

1. **최근 로그 정상 케이스**

   - `IRIS_LOGS_DIR` 를 `tmp_path / "logs"` 로 지정.
   - `logs/room1/test.log` 에 현재 시각 기준 단일 로그 레코드 생성.
   - `GET /status` 호출 → `logStore.ok is True` 이고, detail 에 `"최근 로그"` 문구 포함.

2. **봇 이벤트 vs 로그 타임라인 불일치 케이스**

   - 같은 임시 로그 디렉터리에서:
     - 로그 파일 mtime 은 **30분 전**.
     - 상위 디렉터리에 `status.json.lastEventTs = now` 로 기록.
   - `GET /status` 호출 → `logStore.ok is False` 이고,
     detail 에 `"로그 파일 업데이트가 지연"` 문구 포함.

이 테스트는 IRIS/봇 자체를 띄우지 않고도 **설계가 의도대로 동작하는지** 보장한다.

## Invariants

1. **봇이 이벤트를 받는 동안에는 항상 로그가 기록되어야 한다.**
   - SAVE_CHAT_LOGS 가 기본 true 이며, 운영 스크립트에서 이 값을 강제한다.
2. **status.json.lastEventTs 가 최신인데 로그 파일 mtime 이 60초 이상 과거라면, /status.logStore.ok 는 반드시 False 이어야 한다.**
3. **FastAPI `/status` 는 로그 파일 신선도를 status.json 이 아닌 실제 파일 mtime 기반으로 판단해야 한다.**
4. **IRIS_LOGS_DIR 를 변경하여도 /status 의 semantics 는 동일하게 유지된다.**

## Consequences

### 긍정적 효과

- SAVE_CHAT_LOGS 기본값이 항상 true 이기 때문에, “로그가 꺼진 채로 봇이 뜨는” 위험을 크게 줄였다.
- /status.logStore 스테이지가 **봇 이벤트 vs 로그 타임라인 불일치**를 명시적으로 감지하여,
  대시보드에서 바로 “로그 파이프라인 이상”을 인지할 수 있다.
- IRIS_LOGS_DIR 를 이용한 회귀 테스트로, 향후 리팩토링 시 동일 문제가 재발하는 것을 막을 수 있다.

### 부정적/트레이드오프

- 로그가 항상 켜져 있으므로 디스크 사용량이 늘어난다. (이미 로그 로테이션/용량 관리는 별도 이슈)
- 테스트에서 /status 를 호출하기 위해 FastAPI 앱을 함께 import 하므로,
  테스트 시간이 소폭 증가한다. (현재 2개 테스트, < 1초 수준)

## Links

- Code
  - `node-iris-app/src/app.ts` – SAVE_CHAT_LOGS 기본값 로직
  - `node-iris-app/.env.example` – SAVE_CHAT_LOGS 기본값 true
  - `windows/start_bot.ps1` – SAVE_CHAT_LOGS 강제 true 설정
  - `server/app.py` – `/status` logStore 스테이지 개선
  - `tests/test_log_pipeline_status.py` – 로그 파이프라인 회귀 테스트
- Related ADR
  - ADR-0013 – 빌드 파이프라인 / 파서 하드닝
  - ADR-0017 – Status API 와 FS decoupling
  - ADR-0016 – SAFE_MODE 및 UI 정렬

