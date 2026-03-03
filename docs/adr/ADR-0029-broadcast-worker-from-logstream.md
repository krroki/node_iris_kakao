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
- broadcast-worker는 이미지 전파 시:
  - 이미지 URL→base64 다운로드를 **타겟마다 반복하지 않고 1회 캐시**한다(동일 공지의 여러 방 전파 속도 개선).
  - 이미지 전송은 Realtime API `/send/iris/reply_media` 경유로 수행한다.
  - 성공/실패 판정은 `/send/iris/reply_media`의 응답 `ok`(MessageStore 이미지 echo(attachment 원격 URL 확인 포함) + `chat_sending_logs` 비움 확인 포함)를 **SSOT**로 사용한다.
  - `node-iris-app/data/iris_media_health.json` 이력(최근 실패는 뒤로)을 참고해 전송 순서를 정렬한다.
  - 공지 결과 메시지는 기존 `[공지 전파 결과]` 외에 `📣 공지 전송 결과` 프리픽스도 루프 방지 대상으로 포함하며, 결과 포맷을 “성공/실패 방 목록 + 발송 정보” 형태로 가독성 개선했다.

### 영향
- 공지 이미지 전파의 성공/실패 집계가 실제 발신과 일치하도록 개선되며,
  IRIS 폴백 경로에서도 누락 가능성을 낮춘다(완전 제거는 IRIS 내부 구현에 의존).

---

## Update (2025-12-20) — IRIS 이미지 전파 “1/N만 성공” 재발 방지(직렬화)

### 문제
- 이미지-only 공지를 여러 타겟 방에 전파할 때,
  IRIS `/reply_media`가 모든 요청에 HTTP 200을 반환했음에도 **실제 발신은 일부(예: 1/N)만 성공**하는 케이스가 재현됐다.

### 근본 원인
1. IRIS `/reply_media`는 **실제 UI 전송 완료 전에** HTTP 200을 반환할 수 있다.
2. 이 상태에서 여러 방으로 `/reply_media` 요청을 **짧은 간격으로 연속 호출**하면,
   IRIS 내부 UI automation이 이전 전송을 중단/덮어써 **“마지막 방만 전송”처럼 보이는 누락**이 발생할 수 있다.
3. Talk-API `dispatch_raw(photo)` 경로가 `status=-500/502`로 불안정한 환경에서는,
   이미지 전파가 사실상 IRIS 경로에 의존해 위 문제가 더 자주 드러났다.

### 조치
- Realtime API(server)에서 IRIS 이미지 발신을 **직렬화 + echo+sendlog-verified**로 SSOT화한다.
  - `/send/iris/reply_media`는 IRIS `/reply` 호출 이후 **MessageStore 이미지 echo(attachment 원격 URL 확인 포함) + `chat_sending_logs` 비움(전송 완료)**까지 확인되면 `ok=true`를 반환한다.
  - 여러 worker가 동시에 이미지를 보내도 IRIS UI 자동화가 겹치지 않도록, server에서 `_IRIS_REPLY_LOCK`으로 요청을 직렬화한다.
  - 텍스트(`/send/iris/reply_text`)도 동일 락으로 감싸, 이미지 전송 중 텍스트가 끼어드는 UI 경합을 방지한다.
  - echo/sendlog 확인 타임아웃 기본값은 **25초**이며, 운영 환경 변수로 조정 가능하다:
    - `IRIS_REPLY_ECHO_TIMEOUT_MS`, `IRIS_REPLY_ECHO_POLL_MS`, `IRIS_REPLY_POST_ECHO_DELAY_MS`, `IRIS_REPLY_LOG_SCAN_BYTES`
    - `IRIS_REPLY_SENDLOG_TIMEOUT_MS`, `IRIS_REPLY_SENDLOG_POLL_MS`
  - (고급) 요청별 override: `/send/iris/reply_media` 및 `/send/iris/reply_text` body에서 `echoTimeoutMs`, `sendlogTimeoutMs`, `maxRetries`, `retryDelayMs`를 받아 환경변수 기본값을 요청 단위로 override 할 수 있다(0~2 범위로 clamp).
    - broadcast-worker는 IRIS 이미지 전파에서 기본적으로 `IRIS_MEDIA_*`(기본 echo 18s, retry 1회)을 사용한다.
- broadcast-worker는 더 이상 MessageStore 로그를 직접 스캔/폴링하지 않고, `/send/iris/reply_media` 응답 `ok`만으로 성공을 판정한다.
- 공지 이미지 전파는 Talk-API raw 이미지 발신 경로가 불안정한 환경을 고려해, **IRIS 단일 경로**를 기본으로 유지한다.

### 영향
- 다수 타겟 이미지 전파에서 누락/오보가 크게 감소한다.
- 전체 소요시간은 “타겟 수 × (실전송 시간)”에 비례한다(안정성 우선).
