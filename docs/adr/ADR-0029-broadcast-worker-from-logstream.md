# ADR-0029: 공지/브로드캐스트 발신을 broadcast-worker로 분리 (LogStore 구독 기반)

## Meta

- **Date**: 2025-12-14
- **Status**: Accepted
- **Authors**: 사용자, Codex CLI
- **Related**: ADR-0016(SAFE_MODE), ADR-0017(Status API), ADR-0019(로그 파이프라인), ADR-0023(Watchdog), ADR-0027(코어+워커 분리)
- **Related Session**: `docs/sessions/fix-kb-routing-and-schedule.md`

## Context (배경)

현재 공지(Announcement) 복제와 브로드캐스트(큐 기반 발송)가 Node-IRIS bot 프로세스 내부에서 함께 동작한다.
이 구조에서는 기능 변경/배포 시 bot 전체를 재기동하게 되어, **IRIS 이벤트 수신/로그 적재 코어까지 영향**을 받는다.

또한 공지/브로드캐스트는 “발신”에 해당하므로 다음 조건을 항상 만족해야 한다.

- SAFE_MODE=true이면 어떤 상황에서도 발신하지 않는다.
- allowlist(`runtime.json.allowedRoomIds`) 및 room feature flag에 의해 방 단위로 통제된다.
- 서버 재기동/작업 재시작 이후에도 자동으로 재개되어야 한다(Watchdog + 워커 상태파일 기반).

## Options Considered (고려한 옵션)

### Option A: 기존처럼 bot 내부에서 처리 유지
- 장점: 구현이 단순, 프로세스 수 증가 없음
- 단점: 공지/브로드캐스트 변경이 코어(bot) 재기동으로 이어져 운영 리스크가 큼

### Option B: 공지/브로드캐스트를 별도 워커 프로세스로 분리 (선택)
- 설명:
  - 코어(bot)는 수신/로그 적재/상태 업데이트만 담당한다.
  - `broadcast-worker`가 `/logs/stream`(SSE)을 구독해 공지 소스 메시지를 감지하고, Talk-API 브리지(`/send/talkapi/*`)로 발신한다.
  - 브로드캐스트 큐(`data/broadcast-queue.json`)의 due task를 주기적으로 디스패치한다.
- 장점:
  - 발신 기능 변경/재기동이 코어에 영향 최소
  - Watchdog가 worker 단위로 자동 복구 가능
- 단점/리스크:
  - 이미지 복제를 위해 `/logs/stream`에 최소한의 `imageUrls` 노출이 필요
  - 프로세스/스크립트/환경변수 관리가 추가됨

## Decision (결정)

**Option B를 채택한다.**

- `ANNOUNCEMENT_DISPATCHER=worker`, `BROADCAST_DISPATCHER=worker`를 기본값으로 한다.
- 레거시/롤백이 필요하면 각각 `...=bot`으로 전환한다.
- `BROADCAST_WORKER_DISABLE=1`로 worker 자체를 기동하지 않을 수 있다(디버그용).

## Invariants (불변 조건)

- **SAFE_MODE=true이면 어떤 worker도 발신하지 않는다.** (최종 차단은 Realtime API `/send/talkapi/*`)
- allowlist(`runtime.json.allowedRoomIds`)를 만족하지 않으면 발신하지 않는다.
- 브로드캐스트는 room feature flag(`runtime.json.features[roomId].broadcast=true`)가 켜진 방에서만 발신한다.
- 공지는 `runtime.json.announcement.routes` 기반으로 source/targets를 결정하며, excludedRoomIds는 발신 대상에서 제외한다.
  - 대량 공지(동일 문구를 N개 방에 발송) 시 중복/스팸 판정 리스크를 낮추기 위해, route 옵션으로 “타겟별 번호”를 붙일 수 있다:
    - `appendTargetIndex: true` → `... 1`, `... 2` 형태로 끝에 번호를 추가
    - `targetIndexStart: 1`(기본) → 시작 번호

## Consequences (결과)

### 긍정적 효과
- 공지/브로드캐스트 기능 변경이 코어(bot) 재기동을 강제하지 않는다.
- Watchdog가 공지/브로드캐스트 워커만 단독 재기동하여 운영 안정성이 개선된다.

### 부정적 효과 / 리스크
- `/logs/stream` 스키마에 `imageUrls`가 추가되어 payload가 약간 증가한다.
- worker 발신이 Talk-API에 의존하므로, Talk-API 비가용 시 브로드캐스트 큐 디스패치가 지연/재시도될 수 있다.

### 후속 작업
- [ ] 문서: 운영 엔트리포인트(start_all.cmd → start_all.ps1), 워커 재기동/로그 위치를 agents/runbook에 반영
- [ ] 테스트: 공지(텍스트/이미지), 브로드캐스트(큐) 스모크 시나리오를 verification-commands에 추가

## Links

- Code:
  - `node-iris-app/src/workers/broadcast_worker.ts`
  - `node-iris-app/src/controllers/AnnouncementController.ts` (dispatcher gate)
  - `node-iris-app/src/controllers/CustomBatchController.ts` (dispatcher gate)
  - `server/log_utils.py` (`imageUrls` 노출)
  - `windows/start_broadcast_worker.ps1`, `windows/start_all.ps1`, `windows/watchdog.ps1`
