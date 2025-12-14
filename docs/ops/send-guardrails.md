# 발신(송신) 가드레일

## 목적
- 수신 전용에서 발신(방송/명령어 응답/스케줄 발송)으로 기능을 확장하되, 안전하게 통제·감사 가능한 절차를 확립한다.

## 게이트 플래그
- `SAFE_MODE=true` (기본): 발신 차단. 수신/로그만 허용.
- `SAFE_MODE=false` + `ALLOW_SEND=true`: 발신 허용(아래 통제 필수).

## 통제 항목
- 허용 범위
  - 방: `ALLOWED_ROOM_IDS`(집합)
  - 명령: `ALLOWED_COMMANDS`(집합)
- 속도 제한
  - 글로벌/방별 RPS 한도, 버스트/토큰버킷 적용
- 중복/재시도
  - 메시지 ID 기반 멱등 처리, 재시도 최대 횟수·백오프
- 감사로그
  - `who/when/what/where` 전건 기록, 보존기간 설정
- 롤백
  - 이상 감지 시 즉시 `SAFE_MODE=true`로 전환 가능한 운영 플로우

## 운영 체크리스트
- [ ] 플래그/화이트리스트가 코드/환경에 일치
- [ ] 감사로그가 디스크/외부 스토리지에 정상 적재
- [ ] 속도 제한/오류 복구가 통합 테스트로 검증됨
- [ ] UI 상에 발신 상태 표시 및 강제 차단 토글 제공
# 발신(SEND) 가드레일 운영 가이드

> 목적: 어떤 코드/스크립트에서도 **SAFE_MODE 규칙을 우회하여 실제 발신이 나가지 않도록** 보장하고,
>       회귀 시 빠르게 탐지할 수 있는 절차를 정리한다.

---

## 1. 개념 정리

- **SAFE_MODE**
  - 단일 소스(SSOT): `node-iris-app/config/runtime.json.safeMode`
  - 기본값: `true` (발신 차단, 수신/로그만 허용)
  - UI(`/settings`) → FastAPI `/runtime` → `runtime.json.safeMode` 순으로만 변경한다.
  - PowerShell/환경변수의 `SAFE_MODE` 값은 보조(백업) 용도로만 사용하며, 운영 기본은 아니다.

- **허용 범위**
  - SAFE_MODE = `true`
    - Kakao 방으로의 **모든 실제 발신 금지**
    - 허용: 로그 저장, 템플릿 미리보기, Talk-API payload 준비(prepare) 등 “시뮬레이션/미리보기”
  - SAFE_MODE = `false`
    - 추가 플래그/화이트리스트(allowedRoomIds, 기능 플래그 등)를 모두 통과한 경우에만 발신 허용

---

## 2. 발신 경로(서피스) 일람

### 2.1 node-iris-app (봇)

- 일반 텍스트/이미지 응답
  - `src/utils/sender.ts`
    - `safeReply()`
    - `safeReplyImageUrls()`
    - `safeReplyWithMentions()`
    - `safeBotReplyWithMentions()`
- AI 응답
  - `src/controllers/CustomMessageController.ts`
    - `aiQuery()` 내부에서 `isSafeMode()` / `isFeatureEnabledForRoomId("ai")` 확인 후 `askKb()` 호출
- 새 멤버 환영
  - `src/controllers/CustomNewMemberController.ts`
    - `onNewMember()` 진입 시 `isSafeMode()` / `isRoomAllowed()` / `isFeatureEnabledForContext("welcome")`
- 스케줄/브로드캐스트
  - `src/controllers/CustomBatchController.ts`
    - `generateDailySummary`, `dispatchBroadcasts`, `dailyReport`, `weeklyReport`, `monthlyCleanup` 등
    - 각 메서드 시작부에서 `if (await isSafeMode()) return`
- 공지 미러링
  - `src/controllers/AnnouncementController.ts`
  - `src/utils/guard.ts`
    - `isAnnouncementAllowed()` (SAFE_MODE 최우선, 예외 없음)
    - `isRoomIdAllowedForAnnouncement()` (allowedRoomIds / excludedRoomIds)

### 2.2 FastAPI Realtime API (server/)

- Talk-API 경유 발신
  - `server/app.py:/send/talkapi/dispatch`
    - `cfg = load_runtime()`
    - `if cfg.get("safeMode", True): raise HTTPException(403, "SAFE_MODE")`
    - SAFE_MODE=true 상태에서는 항상 403
    - Talk-API 문서(OpenAPI): `https://talk-api.naijun.dev/swagger/documentation.yaml`
      - `Authorization` 헤더 포맷: `accessToken-deviceUUID`
        - TalkApi 서버는 이를 분해하여 Kakao 내부 API에 `Authorization: <accessToken>`, `Duuid: <deviceUUID>`로 전달한다.
      - Realtime 설정: `runtime.json.talkApi.authHeader`
      - 보조 스크립트:
        - `scripts/extract_talkapi_auth.ps1` (자동 스캔/수동 주입, 기본값은 토큰 미출력 + `data/` 저장)
        - `scripts/capture_talkapi_auth_frida.py` (Frida로 KakaoTalk의 실제 Authorization/Duuid 캡처)
    - 서버는 Talk-API 응답 `body.status == 0` 일 때만 200을 반환하고, 그 외는 502로 실패 처리한다(“조용한 텍스트 폴백” 금지).

#### 자주 보는 Talk-API 실패 원인(운영 팁)

- `talkStatus = -822`: **관리자만 채팅(Admin Chat Only)** 옵션이 켜진 방
  - 봇(현재 Talk-API 계정)이 관리자가 아니면 발신이 차단된다.
  - 해결: 해당 오픈채팅 설정에서 “관리자만 채팅”을 끄거나, 봇 계정을 관리자/부관리자로 지정.
- `server/app.py:/send/talkapi/dispatch_raw`
    - raw 발신(고급): `{ roomId, message, type, attachment }` 를 그대로 Talk-API에 전달한다(Reply/특수 타입 테스트용).
    - Reply(`type=26`)의 경우, Talk-API가 `attachment.src_userId/src_linkId/src_type`를 **int(number)** 로 요구하는 케이스가 확인되어
      Realtime API에서 숫자형 문자열을 int로 강제 변환(coerce) 후 전달한다. (미변환 시 `INVALID_ARGUMENT(-203)` 가능)
- IRIS `/reply` 경유 이미지 발신(Welcome 템플릿 이미지)
  - `server/app.py:/send/iris/reply_media`
    - `cfg = load_runtime()` + `safeMode=true`면 **항상 403(SAFE_MODE)** 로 최종 차단한다.
    - Body: `{ roomId, imagesBase64: [base64, ...] }`
      - base64만 허용(서버는 URL fetch를 하지 않음: SSRF 가드)
      - 최대 6장, 1장 8MB 제한(Realtime API에서 413/400으로 차단)
    - 내부적으로 `IRIS_URL(/IRIS_BRIDGE_URL)/reply`에 `type=image|image_multiple`로 전달해 이미지 메시지를 발신한다.
- 템플릿 관련
  - `/templates/{category}/{name}/prepareSend`
    - payload(텍스트/mentions/images/safeMode) **준비만** 하고 실제 발송은 하지 않는다.

---

## 3. SAFE_MODE 동작 규칙 (요약)

1. **SSOT**
   - 운영 기준값은 항상 `runtime.json.safeMode`를 따른다.
   - `load_runtime()` → 기본값 `True`, 누락 시에도 발신 차단 쪽으로 보수적으로 동작.

2. **Node 컨트롤러 입구에서의 차단**
   - `CustomMessageController.aiQuery`:
     - `if (await isSafeMode()) { logger.warn("[ai] skip: SAFE_MODE on", ...); return; }`
   - `CustomNewMemberController.onNewMember`:
     - `if (await isSafeMode()) { logger.warn("SAFE_MODE on: skip welcome", ...); return; }`
   - `CustomBatchController`의 모든 스케줄/메시지 핸들러:
     - `if (await isSafeMode()) return;`

3. **서버(Talk-API/IRIS reply) 단에서의 최종 차단**
   - `server/app.py:/send/talkapi/dispatch`:
      - `safeMode=true` → 무조건 403 (`detail='SAFE_MODE'`)
      - `safeMode=false` → Talk-API 설정(talkApi.enabled 등)에 따라 2xx/4xx/5xx 결정 (Talk-API 본문 `status!=0`인 경우 서버는 502로 실패 처리)
   - `server/app.py:/send/iris/reply_media`:
      - `safeMode=true` → 무조건 403 (`detail='SAFE_MODE'`)
      - `safeMode=false` → IRIS `/reply` HTTP 200이면 ok 처리, 그 외는 502

4. **공지(Announcement) 규칙**
   - SAFE_MODE=true → **예외 없이 발신 금지** (공지/브로드캐스트/환영/AI 모두 동일)
   - SAFE_MODE=false → allowlist + route 조건을 만족할 때만 공지 미러링/브로드캐스트가 동작한다.
   - 전파 완료 후 소스 방에 `[공지 전파 결과]` 요약 메시지를 1회 남긴다. 이 prefix로 시작하는 메시지는 공지 미러링에서 제외한다(결과 메시지 재전파 방지).
   - 대량 공지 운영 팁:
     - 동일 문구를 10개+ 방에 한 번에 뿌릴 때는 `appendTargetIndex` 옵션을 켜서 타겟별로 끝에 번호를 붙인다.
       - 예: `공지 1`, `공지 2` … (시작 번호는 `targetIndexStart`, 기본 1)

---

## 4. 회귀 테스트 스크립트

### 4.1 `scripts/test_safe_mode.py`

**목적**  
SAFE_MODE 설정에 따라 `/send/talkapi/dispatch`가 기대한 상태 코드(403/비-403)를 반환하는지 자동 검증한다.

**전제 조건**
- FastAPI Realtime API(포트 8650)가 실행 중 (`windows/start_api.cmd`).
- `IRIS_APP_BASE` / `IRIS_LOGS_DIR` 등은 `windows/start_api.cmd`가 자동 설정.

**실행 방법**

```bash
cd C:\dev\12.kakao
python scripts/test_safe_mode.py
```

**검증 내용**

1. `/runtime`에서 현재 `safeMode` 값을 읽어 초기 상태를 기록한다.
2. `safeMode=true`로 설정 후:
   - `/send/talkapi/dispatch`를 더미 payload로 호출
   - **반드시 403 (detail='SAFE_MODE')**이 나와야 한다.
3. `safeMode=false`로 설정 후:
   - `/send/talkapi/dispatch`를 다시 호출
   - **403이 아닌 상태 코드**가 나와야 한다.  
     (현재 구현에서는 Talk-API가 비활성이라 400이 떨어지는 것이 정상)
4. 테스트 종료 후:
   - `/runtime`을 통해 `safeMode`를 1단계의 초기값으로 복원한다.

**로그 예시**

```text
[SAFE_MODE] 서버: http://127.0.0.1:8650
[SAFE_MODE] 초기 safeMode=True
[SAFE_MODE] safeMode=true 로 설정 중...
[SAFE_MODE] safeMode=true 상태에서 /send/talkapi/dispatch 호출 테스트...
[SAFE_MODE] safeMode=false 로 설정 중...
[SAFE_MODE] safeMode=false 상태에서 /send/talkapi/dispatch 호출 테스트...
[SAFE_MODE] safeMode=false 상태에서 status=400 (403 아님이면 OK)
[SAFE_MODE] 테스트 통과
[SAFE_MODE] 원래 safeMode=True 로 복원 중...
```

---

## 5. 운영 체크리스트 (체크박스)

새 기능 추가/배포 전에 아래 항목을 모두 확인한다.

- [ ] `node-iris-app/config/runtime.json.safeMode` 값이 운영 정책과 일치하는지 확인  
      (기본값: `true`, SAFE_MODE 해제는 제한된 세션에서만 허용)
- [ ] `scripts/test_safe_mode.py` 실행 결과가 “테스트 통과”인지 확인
- [ ] SAFE_MODE=true 상태에서:
  - [ ] `CustomMessageController.aiQuery` 관련 로그에 `[ai] skip: SAFE_MODE on`이 찍히고,
        실제 카카오톡 방에는 응답이 전혀 발송되지 않는지 눈으로 확인
  - [ ] `CustomNewMemberController` 웰컴, `CustomBatchController` 브로드캐스트/스케줄이 모두 멈춰 있는지 확인
  - [ ] `/send/talkapi/dispatch` 수동 호출 시 항상 403이 반환되는지 확인
- [ ] SAFE_MODE=false 상태에서 (테스트 환경 한정):
  - [ ] 허용된 방(allowedRoomIds)에서만 AI/웰컴/브로드캐스트가 발동되는지 확인
  - [ ] Talk-API 설정(talkApi.enabled 등)이 없는 경우 400/5xx가 떨어져도 **403(SAFE_MODE)** 는 더 이상 발생하지 않는지 확인

---

## 6. 향후 보완 과제

- [ ] CI 파이프라인에 `python scripts/test_safe_mode.py`를 포함하여, PR/배포 전에 SAFE_MODE 회귀를 자동 검증
- [ ] `/runtime` 변경 로그를 별도 파일 또는 DB에 기록해서, SAFE_MODE 토글 이력이 항상 추적 가능하도록 개선
- [ ] Talk-API를 실제 운영에 사용할 경우, 테스트용 dummy endpoint와 운영 endpoint를 분리하고,
      SAFE_MODE 해제 시에도 **허용된 roomId/command 화이트리스트**를 한 번 더 적용하는 2차 가드레일 추가
