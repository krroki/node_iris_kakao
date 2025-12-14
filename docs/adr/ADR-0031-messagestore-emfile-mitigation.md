# ADR-0031: MessageStore EMFILE(too many open files) 완화 및 자동복구 정렬

## Meta

- **Date**: 2025-12-15
- **Status**: Accepted
- **Authors**: [사용자], GPT-5.2 (Codex CLI)
- **Related Session**: `docs/sessions/fix-kb-routing-and-schedule.md`

## Context (배경)

- 운영 중 Node 봇의 파일 로그 저장(`MessageStore`)에서 `EMFILE: too many open files`가 발생하며 **로그 기록이 중단**되는 장애가 관측되었다.
- 코어 봇은 이벤트를 수신하더라도 로그 기록이 멈추면, `/logs/stream`(파일 로그 기반)을 구독하는 기능 워커(예: `welcome-worker`)는 **트리거 이벤트를 받지 못해 기능이 멈춘 것처럼 보이는** 문제가 발생한다.
- 운영 요구사항:
  - welcome/ai/broadcast 등은 “코어(logStore) 상시 가동 + 워커 분리(ADR-0027/0028/0029)” 구조를 따르므로, **로그 저장이 단일 장애점(SPOF)** 이 되지 않도록 해야 한다.
  - 조용한 폴백 금지(원인/조치가 상태·로그로 드러나야 함).
  - 서버가 꺼졌다가 다시 시작되어도 자동으로 복구/재개되어야 함(watchdog 연동).

## Options Considered (고려한 대안)

### Option A: watchdog 재기동에만 의존(현상 유지)
- 설명: `EMFILE` 발생 시 `/status` 감지 → watchdog가 봇 재시작으로 복구하도록만 둔다.
- 장점: 구현 최소.
- 단점: 로그 기록 중단~재시작 사이의 이벤트는 유실될 수 있고, 기능 워커는 그동안 오동작처럼 보인다.

### Option B: MessageStore I/O burst 완화 + EMFILE 백오프 재시도(선택됨)
- 설명:
  - MessageStore의 동시 디스크 기록을 보수적으로 제한(기본값 하향).
  - `fs.appendFile`이 `EMFILE`일 때 백오프 재시도(짧은 시간 내 자체 복구 시도).
  - `EMFILE` 발생/해제 상태를 파일로 표기하여(`/status`에 반영) 운영자가 즉시 원인을 파악할 수 있게 한다.
  - 운영 스크립트에서 기본 ENV를 명시하여 재발 리스크를 낮춘다.
- 장점: 장애 전파(로그 중단→워커 트리거 끊김)를 완화하고, 자동복구(자체 재시도/재기동) 가능성이 커진다.
- 단점: burst 상황에서 로그 기록 지연이 증가할 수 있다.

### Option C: 파일 로그를 “서버 단일 라이터”로 통합
- 설명: 코어가 파일을 직접 쓰지 않고 Realtime API(서버)가 단일 writer로 저장(또는 큐/DB 기반 저장).
- 장점: 프로세스 간 파일 핸들/동시 append 문제를 근본적으로 제거 가능.
- 단점: 설계/구현/이관 범위가 커서 이번 장애 즉시 대응으로는 과도하다.

## Decision (결정)

**우리는 Option B(동시성 제한 + EMFILE 백오프 재시도 + 상태 가시화 + 운영 기본값 정렬)를 선택했다.**

그 이유는:
1. 워커 분리 구조에서 `/logs/stream`은 핵심 트리거 경로이므로 “로그 기록 중단”이 기능 중단으로 전파되지 않게 해야 한다.
2. 운영 중 즉시 적용 가능한 범위 내에서(대규모 아키텍처 변경 없이) 재발 확률을 낮추고 복구 시간을 단축할 수 있다.
3. EMFILE을 “숨기지 않고” `/status`/health 파일로 드러내 watchdog/운영자 액션을 유도할 수 있다.

### Invariants (불변식)

- `/logs/stream`은 파일 로그 기반이므로 **코어(LogStore)의 로그 기록은 항상 최우선으로 유지**되어야 한다.
- `EMFILE`/로그 기록 중단 같은 장애는 **상태(`/status`)와 로그로 가시화**되어야 하며, 조용히 무시하면 안 된다.
- 운영 기본값은 “안정성 우선”이며, 동시성 상향은 명시적 환경변수로만 한다.

## Consequences (결과)

### 긍정적 효과

- `EMFILE`로 인해 로그가 완전히 멈추는 확률이 낮아지고, 짧은 순간의 핸들 고갈은 자체 백오프로 흡수 가능.
- 장애 발생 시 `node-iris-app/data/bot_health.json` 및 `/status`로 원인 파악이 쉬워지고, watchdog 자동 복구와 정렬된다.
- welcome/ai/broadcast 등 기능 워커의 “토글 ON인데 안 돎” 체감이 줄어든다.

### 부정적 효과 / 리스크

- 로그 기록 동시성 제한으로 burst 상황에서 로그 기록 지연이 증가할 수 있다.
- 근본적으로는 “프로세스 단일 라이터” 구조가 아니라서, 극단적인 폭주/핸들 누수 상황에서는 여전히 재발 가능성이 있다.

### 후속 작업

- [ ] (선택) Option C 검토: 서버 단일 라이터/큐 기반으로 로그 저장 경로를 정리(파일 핸들 문제 근본 제거).
- [ ] 운영 관측 강화: 봇 프로세스 handle count를 주기적으로 수집/알람(Windows 환경에 맞는 방식으로).

## Links

- Related ADR: `docs/adr/ADR-0019-log-pipeline-hardening.md`, `docs/adr/ADR-0027-core-logstore-and-feature-workers.md`
- Code: `node-iris-app/src/services/messageStore.ts`, `windows/start_bot.ps1`
