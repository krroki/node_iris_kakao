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

---

## Update (2025-12-19) — 공지 이미지 “성공 보고/실제 미발신” 핫픽스

### 문제
- 공지(이미지 포함) 전파에서 **텍스트는 정상 발신**되지만,
  이미지가 “성공”으로 집계/보고된 뒤에도 **일부 타겟 방에 실제 이미지가 누락**되는 케이스가 발생했다.

### 근본 원인
1. Talk-API `dispatch_raw`로 이미지(type=27, `attachment.imageUrls`) 발신을 시도했으나, Talk-API가 `status=-500`으로 실패하는 환경이 있었다.
2. 실패 시 IRIS `/reply_media`로 폴백했지만, IRIS는 HTTP 200을 빠르게 반환해도 실제 UI 발신이 **비동기/지연**으로 처리될 수 있다.
   이때 여러 방에 연속 발신 속도가 너무 빠르면, 일부 요청이 **성공으로 응답되더라도 실제 전송이 누락**될 수 있었다.
3. broadcast-worker는 기존에 IRIS 응답(HTTP 200/ok)만으로 성공 처리하여 “성공 보고”와 “실제 발신”이 불일치했다.

### 조치
- broadcast-worker는 IRIS 이미지 폴백 시:
  - 이미지 URL→base64 다운로드를 **타겟마다 반복하지 않고 1회 캐시**한다(동일 공지의 여러 방 전파 속도 개선).
  - IRIS `/reply_media` 전송은 **배치(일괄)로 1차 시도**하고, MessageStore 로그(`node-iris-app/data/logs/<roomId>/*.log`)에서 “IRIS가 보낸 이미지” 에코를 **방별로 확인한 뒤에만 성공**으로 판정한다.
  - 에코가 관측되지 않은 방만 **느린 간격으로 재시도(최대 2회)** 하며, 재시도 시도 간격은 단계적으로 늘린다(기본: 1s → 2.5s → 5s).
  - 공지 결과 메시지는 기존 `[공지 전파 결과]` 외에 `📣 공지 전송 결과` 프리픽스도 루프 방지 대상으로 포함하며, 결과 포맷을 “성공/실패 방 목록 + 발송 정보” 형태로 가독성 개선했다.

### 영향
- 공지 이미지 전파의 성공/실패 집계가 실제 발신과 일치하도록 개선되며,
  IRIS 폴백 경로에서도 누락 가능성을 낮춘다(완전 제거는 IRIS 내부 구현에 의존).
