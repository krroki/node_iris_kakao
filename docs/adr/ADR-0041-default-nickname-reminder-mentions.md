# ADR-0041: 카카오 기본 닉네임 변경 요청(멘션) 워커

## Meta

- **Date**: 2025-12-18
- **Status**: Accepted
- **Authors**: PM AI, Codex CLI
- **Related**: `docs/reference/kakao-mentions-and-reply.md`, ADR-0022(기본 닉네임 분기), ADR-0023(watchdog), `agents.md`

---

## Context

오픈채팅 운영 중 “카카오 기본 닉네임”을 그대로 사용하는 인원이 주기적으로 누적되어,
운영자가 수동으로 멘션해 닉네임 변경을 안내하는 비용이 커졌다.

요구 사항:

1. 주기적으로 “카카오 기본 닉네임 사용자”를 멘션해 닉네임 변경을 요청한다.
2. 발신 전 반드시 Redroid에서 멤버 목록을 스크롤 로딩해 IRIS DB(`db2.open_chat_member`)가 **완전한 상태**여야 한다.
3. 기본 닉네임 판별(정규식)은 ADR-0022의 정책/SSOT를 1차로 사용하되,
   오탐/누락은 운영 로그 기반으로 2차 논의/개선한다(이번 ADR 범위 밖).

---

## Decision

코어(bot)와 분리된 **별도 워커** `nickname-reminder-worker`를 도입한다.

- 활성화 방식: 방별 토글
  - `node-iris-app/config/runtime.json`의 `features[roomId].nicknameReminder=true`일 때만 동작
- 멤버 완전성 전제(중요):
  - IRIS에서 `chat_rooms.active_members_count`(활성 인원)와
    `db2.open_chat_member`의 `count(distinct user_id)`(로딩된 인원)를 비교한다.
  - **총 인원(SSOT)은 `chat_rooms.active_members_count`를 기준**으로 본다.
    - 카카오 UI의 Participants 표기는 화면 진입 실패/언어/렌더링 상태에 따라 읽지 못하는 케이스가 있어 **보조 지표**로만 사용한다.
  - `loaded < active`이면 **발신하지 않고**, 먼저 Redroid에서 멤버 목록 스크롤 로딩을 수행한다.
    - 스크롤 로딩: `scripts/openchat_load_members.ps1`(송신 없음)
    - (검증/리포트) 기본닉 후보를 DB 기준으로 뽑아 “UI Participants vs DB”를 증명하려면:
      - `scripts/report_default_nickname_candidates.ps1` (JSON: `node-iris-app/data/reports/default_nickname_candidates/`)
    - 완료 확인 후에만 멘션 발신
  - `db2.open_chat_member.nickname`은 IRIS `/query` 응답에서 UTF-8 mojibake가 발생할 수 있어,
    워커는 **latin1→utf8 정규화**를 수행한 뒤 기본닉 판별을 한다.
- 멘션 제한:
  - 카카오 서버 멘션은 1메시지 최대 15명으로 제한된다(서버 `_make_mention_attachment` 기준).
  - 워커는 **한 번의 발신에서 최대 15명**만 멘션한다(도배 방지). (나머지는 다음 주기에 순차 처리)
- 경고(안내) 정책(최대 3회):
  - 사용자별로 “기본 닉네임 상태”가 유지되면 아래 순서로 안내(경고)를 누적한다.
    - 1차: 기본닉으로 **처음 관측된 이후** `afterFirstSeenSec` 경과 시
    - 2차: 1차 발신 이후 `afterLastWarnSec` 경과 시
    - 3차: 2차 발신 이후 `afterLastWarnSec` 경과 시
  - 3차까지 발신한 사용자는 `warningCount=3`으로 고정되고, 이후 워커는 더 이상 멘션하지 않는다(운영자가 수동 강퇴).
- 도배 방지(방 단위):
  - 방별로 `perRoomMinSendIntervalSec`(기본 24h) 쿨다운을 적용해, 같은 방에서 너무 자주 “기본닉 멘션”이 나가지 않게 한다.
  - 1회 스캔에서 1/2/3차 대상이 동시에 존재할 수 있으므로, 워커는 **한 번에 한 레벨(1/2/3)만** 발신하고 레벨은 라운드로빈(3→2→1)으로 순환한다.

운영 알림(중요):

- 실패/스킵 사유 등 운영 진단은 **테스트용 오픈채팅방(18462226881291012)** 으로만 발신한다(운영방 오염 금지).
- 운영 알림은 여러 건을 **1채팅으로 묶어** 발신한다(스팸 방지).
  - 특히 3차 안내 완료(수동 강퇴 후보)는 테스트방으로만 요약 알림을 보낸다(운영방 오염 금지).

---

## Implementation

- 워커:
  - `node-iris-app/src/workers/nickname_reminder_worker.ts`
  - 상태: `node-iris-app/data/nickname_reminder_worker_status.json`
  - 상태(방별/유저별 경고 누적): `node-iris-app/data/nickname_reminder_worker_state.json`
  - 싱글톤 락: `node-iris-app/data/locks/nickname_reminder_worker.lock`
- 방별 로그(JSONL): `node-iris-app/data/nickname_reminder_logs/<roomId>/<YYYY-MM-DD>.log`
  - `send_ok/send_failed`에는 닉네임 중복 이슈를 피하기 위해 `targetUserIds`(및 `escalatedUserIds`)를 함께 기록한다.
- Windows 기동/감시:
  - 기동 스크립트: `windows/start_nickname_reminder_worker.ps1`
  - `windows/start_all.ps1` 기본 포함(환경 변수 `NICKNAME_REMINDER_WORKER_DISABLE=1`이면 스킵)
  - `windows/watchdog.ps1`에서 heartbeat stale 감지 시 자동 재기동
- UI(3100):
  - 방 카드 “기본 기능”에 `기본닉 멘션` 토글 추가(방별 ON/OFF)
  - 홈(3100) 상단 카드에서 2차/3차 안내 간격(시간)을 편집해 `runtime.nicknameReminder.warningSchedule`로 저장

### Runtime 설정(예시)

> 전역 스위치는 `runtime.nicknameReminder.*`, 방별 스위치는 `runtime.features[roomId].nicknameReminder=true`가 SSOT이다.

```json
{
  "talkApi": { "enabled": true },
  "nicknameReminder": {
    "enabled": true,
    "tickSec": 60,
    "perRoomMinSendIntervalSec": 86400,
    "maxMentionsPerMessage": 15,
    "betweenMessagesDelayMs": 1500,
    "memberLoadWaitMs": 90000,
    "warningSchedule": {
      "level1": { "afterFirstSeenSec": 0 },
      "level2": { "afterLastWarnSec": 86400 },
      "level3": { "afterLastWarnSec": 172800 }
    },
    "warningMessageByLevel": {
      "1": "닉네임을 소통 편한 걸로 변경 부탁드립니다! (1차 안내)",
      "2": "닉네임 변경을 다시 한 번 부탁드립니다 🙏 (2차 안내)",
      "3": "마지막 안내입니다. 닉네임 변경 부탁드립니다. (3차 안내)"
    }
  },
  "features": {
    "18462226881291012": { "nicknameReminder": true }
  }
}
```

---

## Invariants

1. **멤버 목록 완전성 확인 없이 발신 금지** (`loadedMembersCount < activeMembersCount`이면 무조건 스킵)
2. **멘션은 Talk-API 기반만 가능** (Talk-API OFF/실패 시 텍스트 폴백으로 “가짜 멘션”을 만들지 않는다)
3. **최대 3회 안내**: 3차까지 발신한 사용자는 더 이상 멘션하지 않는다(수동 강퇴로 전환)
4. **운영 로그는 테스트방에만** (운영방에 디버그/진단 메시지 발신 금지)
