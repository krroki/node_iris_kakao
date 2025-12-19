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
- broadcast-worker는 IRIS 이미지 폴백 시:
  - 타겟 간 최소 간격을 강제하고
  - MessageStore 로그 에코를 확인한 뒤에만 성공으로 판정(미관측 시 1회 재시도)

### 운영 복구
1. `broadcast-worker` 재기동: `windows/start_broadcast_worker.ps1 -Restart`
2. (필요 시) Watchdog 재기동: `windows/ensure_watchdog.ps1 -Restart` 또는 UI(3100) 홈의 **Watchdog 재시작**

---

## Welcome 운영: 오픈프로필 닫기 안내 + 5분 기본닉 리마인더

### 오픈프로필 닫기 안내

- 판별 기준(SSOT): `db2.open_chat_member.profile_link_id != 0` → 오픈프로필(별도 프로필)로 참여 중
- 발신 설정(SSOT): `node-iris-app/config/runtime.json` → `welcome.openProfileCloseGuide`
- 가이드 이미지(3장):
  - `node-iris-app/config/templates/welcome/assets/profile_close_guide/01.png`
  - `node-iris-app/config/templates/welcome/assets/profile_close_guide/02.png`
  - `node-iris-app/config/templates/welcome/assets/profile_close_guide/03.png`

### 5분 기본닉 닉네임 변경 리마인더

- 트리거: 신규 입장 시 닉네임이 기본닉으로 판정된 경우에만 “5분 후 재확인”
- 발신 설정(SSOT): `node-iris-app/config/runtime.json` → `welcome.nicknameChangeReminder`
- 주의(구분 필요):
  - `welcome.nicknameChangeReminder`: **신규 입장자 기준(5분)** 1회 리마인더 (welcome-worker)
  - `nickname-reminder-worker`: **방 전체 스캔 기반(24h/48h 등)** 단계적 멘션 (ADR-0041)

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
