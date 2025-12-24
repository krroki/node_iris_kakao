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

## 공유 워킹트리 멀티세션 규칙(4.pint 준용)

이 저장소는 “운영 워킹트리”를 여러 세션/프로세스가 동시에 공유할 수 있다.

- 상세 규칙(레퍼런스): `docs/reference/shared-workingtree-multi-session.md`
- 핵심:
  - “내 작업 범위 밖 파일”은 절대 건드리지 않는다.
  - `git restore .`/`git reset --hard`/`git clean -fd`/`git add -A`/`git commit -am ...` 같은 전역 조치는 금지한다.
  - 커밋/포맷/린트는 “내가 바꾼 파일만” 대상으로 수행한다.

---

## 🧭 운영 자동복구 우선(Watchdog 사고방식)

운영 중 재발 가능한 문제는 “운영자가 매번 수동으로 실행해서 복구”가 아니라, **Watchdog가 감지 → 자동 조치**하도록 해결한다.

체크리스트(핵심):

- 장애 징후를 status/state 파일에 **명확히 반영**한다(heartbeat/progress/error).
- 장시간 작업(크롤링/업서트/ADB 로딩) 중에도 watchdog가 오판하지 않도록 **heartbeat는 계속 갱신**한다.
- 자동 조치는 “전역 종료”가 아니라 **해당 컴포넌트만** 안전하게 재기동한다(PID 기반).
- 실패 원인은 운영방이 아닌 테스트 방/로그로만 남긴다.

---

## CourseOps v2: 외부 운영 콘솔(go.yoorang.kr) 작업 지침

목표: “ACTIONS(작업 대기열)”을 **웹 UI로** 제공해, 내부 운영진이 동시접속으로 조치/확인까지 끝내게 한다.

핵심 불변식:

- 카카오/Redroid 연동(수집/판정)은 **12.kakao 1대**만 수행한다(외부 웹이 카카오에 직접 붙지 않음).
- `go.yoorang.kr`에는 CourseOps 화면만 노출한다(기존 운영 UI 외부 노출 금지).

제품 규칙(필수):

- 인증: **이름 + 공용 비번** + 자동 로그인(쿠키).
- 데이터 저장: **Supabase 스냅샷(JSON)** 기반으로 화면을 구성한다. (스프레드시트는 레거시 옵션)
- 결제 SSOT(구글 시트, 읽기)는 **코스별 설정**으로 관리한다. (쓰기 금지)
- 계정 관리: `/accounts`는 관리자만 접근/노출한다(사이드바 메뉴 포함).
  - 계정을 1명이라도 등록하면(enabled=true), 이후 로그인은 **등록된 이름만** 허용한다(관리자는 예외).
- 접속은 네트워크(IP) 제한을 전제로 하지 않는다(어디서든 접속 가능). 따라서 아래 보안 가드가 필수다:
  - 로그인 실패 레이트리밋/지연(브루트포스 억제) + 실패 로그(감사)
  - 공용 비번 교체(로테이션) 가능 + 유출/의심 시 즉시 교체
- 동기화 권한: 기본은 모두 허용하되, 필요 시 **이름 allowlist** 또는 **계정별 canSync**로 제한 가능해야 한다.
- “처리 완료”는 곧바로 완료 확정이 아니라 **`확인 대기`로 전환**하는 행동이다.
- 완료 확정은 동기화 결과로만 한다(상태머신):
  - `대기` → `확인 대기` → `완료(검증됨)`/`미해결(재확인)`/`확인 불가(데이터 미완전)`
- 동기화 버튼은 2개:
  - **빠른 재검증**: `확인 대기` 항목이 참조하는 **필요한 방만** 갱신해 해당 항목만 재판정(조치 확인용).
  - **전체 동기화**: 톡방+카페+결제SSOT까지 전체 갱신 후 전체 재판정(정기 갱신용).
- 완료 기준: **워커 OK + 스냅샷 업로드 OK**까지 끝나야 “완료”로 본다(업로드 실패는 완료 처리 금지).
- 동기화는 단일 실행(락)이어야 한다(동시 클릭/중복 실행 방지).
- 대기열에서는 “예외로 두고 싶다”는 항목을 `숨김` 처리할 수 있어야 한다(기본값: 숨김 항목 미표시).

엣지케이스 처리(오판 금지):

- 톡방 멤버 로딩이 미완료면 “없다/있다”를 단정하지 말고 `확인 불가(데이터 미완전)`로 분리한다.
- 동일인 매칭은 “현재 닉네임 단일 값”에 의존하지 말고, alias/정규화/결제SSOT 힌트를 포함해 보수적으로 판정한다.

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

## 운영 장애: 네이버 카페 창이 여러 개 뜸(중복 크롤링)

### 증상(대표)
- 네이버 카페 크롤러 창이 2~3개 동시에 뜨거나, 로그인/크롤링이 반복됨
- 같은 코스의 Sheets 업서트가 짧은 간격으로 여러 번 실행됨

### 원인(대표)
- `course-membership-audit-worker` **중복 실행**(동일 워커 프로세스가 여러 개 떠 있는 상태)

### 자동 복구(원칙)
- watchdog가 아래 조건 중 하나라도 감지하면 자동으로 `start_course_membership_audit_worker.ps1 -Restart`를 호출해 **1개만 남기고 정리**한다.
  - 워커 프로세스 2개 이상(중복 실행)
  - `heartbeatTs`가 300초 이상 stale(정지/헝)

### 수동 복구(최후)
1. watchdog가 꺼져 있으면 먼저 `windows/ensure_watchdog.ps1 -Restart`
2. 그래도 정리되지 않으면 `windows/start_course_membership_audit_worker.ps1 -Restart`
3. 재발 방지: 워커는 **start 스크립트로만** 관리하고, `python scripts/course_membership_audit_worker.py` 직접 실행은 피한다

---

## 스프레드시트 출력 가드레일(중요)

### 원칙
- 워커/배치가 스프레드시트에 “새 결과”를 쓸 때는, **항상 시트 전체를 먼저 깔끔하게 정리한 뒤** 값을 써야 한다.
  - `values.clear`는 **값만** 지우며, 기존 **서식/merge/색상(검은 줄)** 은 남을 수 있다.
  - derived 탭(`OVERVIEW`, `ACTIONS`)은 “운영 화면”이므로, **아래쪽에 예전 서식이 남는 상태**를 절대 허용하지 않는다.

### 구현 규칙(코드/리뷰 기준)
- derived 탭 갱신 순서:
  1. `clear_values(...)`로 값 전체 삭제
  2. `apply_*_sheet_format(...)`에서 **시트 전체 범위(rowCount×columnCount) 서식 리셋 + unmergeCells**
  3. 그 다음 타이틀/헤더 등 필요한 서식만 다시 적용

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
    - `/send/iris/reply_media`는 **MessageStore 이미지 echo(attachment 원격 URL 확인 포함) + `chat_sending_logs` 비움(전송 완료)** 확인 후에만 `ok=true`를 반환한다. (성공 판정 SSOT)
    - echo/sendlog 확인 기본 타임아웃은 **25초**이며, 필요 시 환경변수로 조정한다:
      - `IRIS_REPLY_ECHO_TIMEOUT_MS`, `IRIS_REPLY_ECHO_POLL_MS`, `IRIS_REPLY_POST_ECHO_DELAY_MS`, `IRIS_REPLY_LOG_SCAN_BYTES`
      - `IRIS_REPLY_SENDLOG_TIMEOUT_MS`, `IRIS_REPLY_SENDLOG_POLL_MS`
    - (고급) 요청별 override: `/send/iris/reply_media` body에 `echoTimeoutMs`, `sendlogTimeoutMs`, `maxRetries`, `retryDelayMs` 전달 가능(0~2 범위로 clamp)
  - 재전송(리트라이):
    - server 기본값은 비활성화(`IRIS_REPLY_MAX_RETRIES=0`)로 운영한다. (중복 이미지 전송 방지)
    - broadcast-worker는 이미지 전파에 한해 요청별 override로 **1회 재시도**를 기본 사용한다(`IRIS_MEDIA_MAX_RETRIES=1`, 최근 실패 방은 `maxRetries=0`)
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
    - 단, 닫힘 확인 시점의 현재 닉네임이 “카카오 기본 닉네임”이면 `confirmTextKakaoDefaultNickname`를 우선 사용한다.
  - 폴링: `confirmWindowMs`(최대 대기), `confirmCheckIntervalMs`(체크 주기)
- 가이드 이미지(1장):
  - `node-iris-app/config/templates/welcome/assets/profile_close_guide/KakaoTalk_20251219_021112774.png`

### Welcome 후속 Reply(감사합니다)

- 오픈프로필인 경우: 감사 Reply는 스킵(가이드 + 닫힘 확인 멘트만)
- 오픈프로필이 아닌 경우:
  - 비기본닉: 첫 이미지 업로드에 Reply(type=26)로 `welcome.followUp.replies` 중 1개를 1회 발신
  - 기본닉: `welcome.followUp.nicknameChangeAfterImage.enabled=true`면 “감사합니다…” Reply 대신 아래 플로우로 처리
    - (요청) 첫 이미지에 Reply(type=26)로 `welcome.followUp.nicknameChangeAfterImage.requestText` 발신
    - (확인) **요청 발신 시점부터** `confirmWindowMs` 내 `feedType=2`(프로필 변경)로 닉변이 확인되면,
      Reply가 아닌 **일반 멘션**으로 `welcome.followUp.nicknameChangeAfterImage.confirmText` 발신
    - 레이스 방지: 요청 이전에 들어온 `feedType=2` 캐시는 닉변 완료로 인정하지 않는다

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
