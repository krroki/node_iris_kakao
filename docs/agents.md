# 에이전트 작업 지침서

---

## 🚨 제1원칙: FALLBACK 절대 금지 (최우선 준수)

### 불변식
**어줍잖은 fallback은 시스템을 망가뜨린다. 절대 사용 금지.**

### 원칙
1. **모든 코딩은 목적과 결과가 분명해야 한다**
   - 입력 → 처리 → 출력의 모든 경로가 명확해야 함
   - "혹시 모르니까" 식의 fallback 금지

2. **fallback이 필요해 보이는 상황 = 엣지케이스 분석 부족**
   - fallback을 넣고 싶다면, 그 상황이 왜 발생하는지 근본 원인을 먼저 파악
   - 모든 엣지케이스를 열거하고 각각에 대한 명시적 처리 로직 작성

3. **"일단 fallback으로 처리" 금지**
   - ❌ `catch (e) { return defaultValue }` - 에러 원인 은폐
   - ❌ `value ?? fallbackValue` - 왜 null인지 모르는 상태로 진행
   - ❌ `try { ... } catch { /* 무시 */ }` - 문제 숨기기

### 올바른 접근
```typescript
// ❌ 금지: 어줍잖은 fallback
const result = riskyOperation() ?? "default";

// ✅ 권장: 명시적 에러 처리
const result = riskyOperation();
if (result === null) {
  throw new Error("riskyOperation returned null: [구체적 원인 분석]");
}
```

### 예외 (명시적 승인 필요)
- 사용자가 "이 경우는 fallback 써도 된다"고 명시적으로 지시한 경우에만 허용
- 그 경우에도 로그에 fallback 발동 사실을 남겨야 함

---

## 운영 핫픽스/패치 요청 템플릿

- 목표: “원하는 동작/금지사항/검증 방법”을 먼저 합의해서, 핫픽스가 엇나가지 않게 한다.
- 대상 컴포넌트: `bot` / `welcome-worker` / `ai-worker` / `broadcast-worker` / `command-worker` / `web` / `watchdog` 등
- 적용 범위: **방 이름만**(roomId/userId 숫자 노출 금지 원칙 유지)
- 트리거 조건: 예) “신규 입장 시”, “입장 후 5분”, “15분 내 이미지 업로드”
- 원하는 메시지/이미지:
  - 텍스트(멘션/Reply 여부 포함), 첨부 이미지(개수/순서), 발신 채널(Talk-API/IRIS 폴백)까지 명시
  - 기존 문구 변경이면 “정확한 문장”으로 제공(추측/임의 대체 금지)
- 중복/재발 방지: dedup 키(예: 24h 1회), 상태 저장 파일/TTL, 스킵 사유 기록 정책
- 검증 방법: 테스트 방에서 `!welcome:test`/`!reply:test` 등 **허용된 커맨드만**으로 재현/검증
- 운영 반영: 변경된 컴포넌트만 `windows/start_*.ps1 -Restart`로 부분 재기동(전역 node 종료 금지)

---

## 운영 장애: EMFILE(too many open files)

### 핵심
`EMFILE`은 “잠깐 오류”가 아니라 **로그/상태 기록이 멈추며 welcome/worker 트리거까지 끊길 수 있는 운영 장애**다.

### 원인 분류(자주 재발하는 2가지)
1. **MessageStore append burst**(ADR-0031)
   - 증상: `/status extra.emfile=true` 또는 `node-iris-app/data/bot_health.json` 존재
2. **node-iris Logger 파일 핸들 누수**(ADR-0042)
   - 증상: `Get-Process -Id <PID> | Select HandleCount`가 수천 단위로 증가
   - 핸들이 `node-iris-app/logs/app.log`, `node-iris-app/logs/error*.log`에 과다하게 잡힘

### 복구(운영 원칙: 부분 재기동 우선)
1. Bot 재기동: `windows/start_bot.ps1 -Restart` (빠른 재기동은 `-SkipBuild`)
2. 재발 시(핫픽스/패치 확인):
   - `node-iris-app/package.json`에서 `@tsuki-chat/node-iris=1.6.41` 고정 여부 확인
   - `cd node-iris-app && npx patch-package --error-on-fail`
   - 참고(SSOT): `docs/adr/ADR-0042-node-iris-logger-handle-leak-emfile-hotfix.md`

---

## 운영 장애: 워커 미실행(Watchdog hung)

### 증상(대표)
- UI에서 여러 kind가 **미실행/하트비트 경고(3분+)** 로 표시됨
- bot은 살아있는데 worker status 파일의 `heartbeatTs` 갱신이 멈춘 상태가 길게 지속됨

### 원인(대표)
- watchdog 프로세스가 살아있더라도, 내부 루프가 블록되면(예: `start_all.ps1` 동기 호출로 장시간 대기) 자동 복구가 멈출 수 있음

### 복구(권장)
1. watchdog 재기동(자동 복구 루프 재개): `windows/ensure_watchdog.ps1 -Restart`
2. 필요 시 개별 워커 재기동: `windows/start_<worker>_worker.ps1 -Restart`

### UI(3100)에서 복구
- 홈 상단 `Watchdog` 카드의 **Watchdog 재시작** 버튼 = `ensure_watchdog.ps1 -Restart`
- 홈 상단 `봇/워커 프로세스` 카드의 **미실행/하트비트 재시작** 또는 kind별 **재시작** 버튼 사용

---

## 운영 장애: 공지 이미지 “성공 보고/실제 미발신”

### 증상
- 공지(이미지 포함) 전파에서 “성공”으로 집계/보고되지만, 실제 타겟 방에 이미지가 누락됨

### 근본 원인(대표)
- Talk-API raw 이미지 발신이 `status=-500`으로 실패하는 환경에서 IRIS `/reply_media` 폴백으로 전환되며,
  IRIS 응답이 HTTP 200이어도 실제 UI 발신은 비동기/지연 처리라 “연속 발신 속도”가 빠르면 누락될 수 있음

### 조치(현재 기본 동작)
- broadcast-worker는 공지 이미지 전파 시:
  - 이미지 URL→base64 다운로드를 **1회 캐시**하고(타겟마다 반복 다운로드 금지)
  - Talk-API raw 이미지 발신은 불안정한 환경이 있어, **IRIS 단일 경로**를 기본으로 유지한다.
  - 이미지 전송은 Realtime API `/send/iris/reply_media` 경유로 수행한다.
    - server는 IRIS `/reply` 호출을 `_IRIS_REPLY_LOCK`으로 직렬화해 UI automation 경합을 방지한다.
    - `/send/iris/reply_media`는 **MessageStore 이미지 echo + `chat_sending_logs` 비움(전송 완료) 확인 후에만** `ok=true`를 반환한다. (성공 판정 SSOT)
    - echo/sendlog 확인 기본 타임아웃은 **25초**이며, 필요 시 환경변수로 조정한다:
      - `IRIS_REPLY_ECHO_TIMEOUT_MS`, `IRIS_REPLY_ECHO_POLL_MS`, `IRIS_REPLY_POST_ECHO_DELAY_MS`, `IRIS_REPLY_LOG_SCAN_BYTES`
      - `IRIS_REPLY_SENDLOG_TIMEOUT_MS`, `IRIS_REPLY_SENDLOG_POLL_MS`
  - **재전송(리트라이)은 기본 비활성화**(`IRIS_REPLY_MAX_RETRIES=0`) 상태로 운영한다. (중복 이미지 전송 방지)
  - 전송 순서는 `node-iris-app/data/iris_media_health.json` 이력(최근 실패는 뒤로)을 참고해 정렬한다.
  - 공지 결과 메시지 프리픽스는 `📣 공지 전송 결과`(루프 방지 스킵 대상)이다.

### 운영 복구
1. `broadcast-worker` 재기동: `windows/start_broadcast_worker.ps1 -Restart`
2. (필요 시) Watchdog 재기동: `windows/ensure_watchdog.ps1 -Restart` 또는 UI(3100) 홈의 **Watchdog 재시작**

---

## Welcome 운영: 오픈프로필 닫기 안내(첫 이미지 트리거)

### 오픈프로필 닫기 안내

- 트리거: 신규 입장 후 `welcome.followUp.windowMs` 내 “첫 이미지 업로드”가 감지된 경우에만 실행
- 판별 기준(SSOT): IRIS DB `db2.open_chat_member` 기준
  - `profile_type == 16` → 오픈프로필(오픈채팅 프로필)
  - `profile_link_id != 0` → **오픈채팅방 열려있음**(닫기 안내 대상)
  - `profile_type == 16` 이더라도 `profile_link_id == 0`이면 “오픈채팅방 열려있음”이 아닌 케이스가 있어 닫기 안내를 스킵한다.
  - 런타임 설정은 `welcome.openProfileCloseGuide.match=profileLinkIdNonZero`로 운영한다.
- 발신 설정(SSOT): `node-iris-app/config/runtime.json` → `welcome.openProfileCloseGuide`
  - 텍스트: `text` (멘션, Talk-API 우선)
  - 가이드 이미지: `images` (IRIS `/reply_media`로만 발신, 1장)
  - 닫힘 확인 멘트: `confirmText` (프로필이 닫힌 것이 감지되면 즉시 1회 멘션 발신)
    - 단, 닫힘 확인 시점의 닉네임이 “카카오 기본 닉네임”이면 `confirmTextKakaoDefaultNickname`를 우선 사용한다.
  - 폴링: `confirmWindowMs`(최대 대기), `confirmCheckIntervalMs`(체크 주기)
- 가이드 이미지(1장):
  - `node-iris-app/config/templates/welcome/assets/profile_close_guide/KakaoTalk_20251219_021112774.png`

### Welcome 후속 Reply(감사합니다)

- 오픈프로필이 아닌 경우: 첫 이미지 업로드에 Reply(type=26)로 `welcome.followUp.replies` 중 1개를 1회 발신
- 오픈프로필인 경우: 감사 Reply는 스킵(가이드 + 닫힘 확인 멘트만)

### 제거된 항목(잔재 금지)

- 5분 기본닉 닉네임 변경 리마인더(`welcome.nicknameChangeReminder`): 사용하지 않음(ADR-0045)
- 15분 미업로드 경고(`welcome.followUp.timeoutMention`): 사용하지 않음(ADR-0045)

---

## 네이버 카페 접속 지침

### 로그인 절차

1. **자동 로그인 시도**
   - 환경변수에서 NAVER_ID, NAVER_PW 로드
   - Playwright로 네이버 로그인 페이지 접속
   - 아이디/비밀번호 자동 입력 및 로그인 시도

2. **모바일 인증 대기**
   - 2단계 인증(모바일) 필요시 사용자 수동 처리 대기
   - 로그인 성공 확인 후 다음 단계 진행

3. **카페 글 접속**
   - 로그인 성공 후 목표 카페 글 URL로 이동
   - 글 내용 확인 및 스크린샷 저장

### 사용 방법

```bash
python scripts/naver_cafe_checker.py
```

### 환경변수 설정

```
NAVER_ID=your_naver_id
NAVER_PW=your_naver_password
NAVER_CAFE_URL=https://cafe.naver.com/cafe_name
```

### 주의사항

- 모바일 인증 필요시 수동 처리 필요
- 인증 후 스크립트가 자동으로 진행됨
