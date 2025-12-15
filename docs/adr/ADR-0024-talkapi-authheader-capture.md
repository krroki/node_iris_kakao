# ADR-0024: Talk-API authHeader 캡처(Frida) 및 저장/반영 가드레일

## Meta

- **Date**: 2025-12-13
- **Status**: Accepted
- **Authors**: PM AI, Codex CLI
- **Related**: ADR-0016(SAFE_MODE), docs/ops/send-guardrails.md, docs/reference/verification-commands.md

---

## Context

카카오톡 “실제 멘션(@태그)”은 단순히 메시지 텍스트에 `@이름`을 넣는 것으로는 동작하지 않으며, 발신 payload에 `attachment.mentions`와 대상 `userId`가 포함되어야 한다.

본 프로젝트는 오픈채팅방에서 “실제 멘션”을 구현하기 위해 Talk-API(외부 서버) 경유 발신 경로를 도입했는데, 이때 Talk-API는 인증값을 `Authorization: accessToken-deviceUUID`(이하 authHeader) 형태로 받는다.

문제는 운영 환경(루팅 단말/Redroid, IRIS 기반)에서 다음이 반복적으로 발생했다.

- Talk-API 문서/레퍼런스만으로는 authHeader를 안정적으로 확보하기 어렵다.
- 로컬 저장소에서 토큰/UUID를 “추측”하거나 “대충 스캔”하는 방식은 암호화/난독화/저장 위치 변경으로 자주 깨진다.
- 프로젝트 불변식(특히 `docs/agents.md`의 “FALLBACK 절대 금지”) 때문에, authHeader가 없는데도 조용히 진행하거나 임의 값으로 대체하는 방식은 허용되지 않는다.

따라서 “KakaoTalk이 실제로 보내는 Authorization/Duuid 값”을 런타임에서 **결정적으로** 캡처해 authHeader를 재구성하는 방법이 필요하다.

---

## Options Considered

### Option A: 공식 API/정상 인증 경로만으로 구현

- 설명: 카카오 공식 API/SDK 범위 안에서 멘션/발신을 구현한다.
- 장점: 정책/호환성/유지보수 리스크가 낮다.
- 단점: 오픈채팅방의 “실제 멘션” payload/대상 `userId` 기반 발신을 공식 API만으로 해결하기 어렵다(현 요구를 충족하지 못함).

### Option B: 로컬 파일 스캔/DB(DataStore)에서 토큰/UUID 추출

- 설명: `/data/data/com.kakao.talk/...` 등 로컬 파일을 스캔해 accessToken/deviceUUID 후보를 찾아 authHeader를 구성한다.
- 장점: 네트워크 훅 없이 자동화 가능, 한 번 성공하면 빠르다.
- 단점: 암호화/키체인/난독화/저장 위치 변경에 취약. 실패 시 “추측”을 유도하기 쉬워 운영 가드레일과 충돌할 수 있다.

### Option C: MITM/pcap 기반 네트워크 캡처

- 설명: 트래픽을 중간자 프록시/패킷 캡처로 관찰해 Authorization/Duuid 값을 확보한다.
- 장점: 앱 내부 구조에 덜 의존하는 것처럼 보인다.
- 단점: TLS/핀닝/암호화로 실패 가능성이 높고, 환경 구축 비용이 크며 재현성이 낮다.

### Option D: Frida 동적 훅(선택)

- 설명: KakaoTalk 프로세스 내부(Java/OkHttp/내부 네트워크 빌더)를 훅해 Authorization/Duuid 값을 런타임에서 캡처한다.
- 장점: “실제로 사용되는 값”을 직접 얻어 authHeader를 결정적으로 재구성 가능. 실패 시에도 조용히 넘어가지 않고 훅 성공/실패를 명시적으로 판별할 수 있다.
- 단점: root + frida-server 필요. 카카오톡 업데이트/난독화로 훅 포인트가 깨질 수 있다.

---

## Decision

**우리는 Option D(Frida 동적 훅)를 authHeader 확보의 표준 경로로 채택한다.**

보조 수단으로 Option B(로컬 스캔/수동 주입)를 제공하되, 어디까지나 “명시적 실패/명시적 성공”만 허용하고,
조용한 폴백은 금지한다.

### 캡처 방식(요약)

1. KakaoTalk 내부에서 네트워크 요청을 구성하는 시점에 **Authorization / Duuid 헤더**를 캡처한다.
2. 캡처된 두 값을 `accessToken-deviceUUID`로 합쳐 authHeader를 만든다.
3. authHeader는 콘솔에 원문을 출력하지 않고, `data/talkapi_auth.txt`에만 저장한다(커밋 금지).

### 왜 “Authorization/Duuid”를 캡처하는가?

Talk-API는 입력으로 authHeader(`accessToken-deviceUUID`)를 받지만,
실제 Kakao 내부 요청에서는 아래처럼 분리된 헤더가 사용된다.

- `Authorization: <accessToken>`
- `Duuid: <deviceUUID>`

따라서 **분리된 실제 헤더 값**을 캡처해 재조합하는 것이 가장 명확하다.

---

## Implementation

### 1) Frida 캡처 스크립트

- `scripts/capture_talkapi_auth_frida.py`
  - ADB로 디바이스 ABI를 확인해 frida-server 바이너리를 선택/푸시/기동한다.
  - frida-tools의 Java bridge를 선행 로드하여 Python에서 Java 훅이 안정적으로 동작하도록 한다.
  - 다음과 같은 훅 포인트를 조합해 캡처 성공률을 높인다.
    - OkHttp 계열: `Request.Builder`, `RealInterceptorChain.proceed(...)` 등 (헤더 주입 지점)
    - LOCO 컨텍스트: `LocoJob.i()` 반환 객체 및 `Fp.U0.<init>` 등 (oauthToken/duuid 보유 객체)
    - 내부 네트워크 빌더: `duuid`/`oauthtoken` 파라미터 주입 지점(난독화 클래스)
  - 초기화 과정에서 너무 짧은 토큰이 먼저 잡히는 케이스를 피하기 위해 최소 길이 검증(min_len)을 적용한다.
  - 캡처 결과는 `data/talkapi_auth.txt`에 저장하며, 콘솔에는 레드랙트만 출력한다.

### 2) 보조: 로컬 스캔/수동 주입

- `scripts/extract_talkapi_auth.ps1`
  - (가능하면) DataStore/로컬 파일에서 후보를 스캔하되, 실패 시 명시적으로 종료한다(조용한 폴백 금지).
  - 운영자가 이미 accessToken/deviceUUID를 알고 있다면 인자로 주입하여 authHeader를 저장할 수 있다.

### 3) 검증(실발송, 명시적 확인 필요)

- `scripts/verify_talkapi_auth_candidates.py`
  - `--confirm-send`가 없으면 실발송을 하지 않는다.
  - 테스트 방에서 1회 발송으로 `status==0` 성공 여부를 검증한다.

### 4) 런타임 반영

authHeader 반영은 다음 중 한 방식으로 수행한다.

- Web UI(`/settings`)의 “파일에서 자동 적용” 버튼: `data/talkapi_auth.txt`를 읽어 `/runtime`에 `talkApi.enabled=true` + `talkApi.authHeader`를 반영한다.
- CLI: `/runtime`에 `talkApi.authHeader`를 POST한다(필요 시 `talkApi.enabled=true`도 함께 설정).

추가(운영 자동화, 캡처는 수동):

- **스냅샷 보관**: authHeader를 저장할 때마다 `data/talkapi_auth_snapshots/`에 타임스탬프 스냅샷을 남긴다(값은 미출력).
  - PowerShell: `scripts/snapshot_talkapi_auth.ps1`
  - Frida 캡처/추출 스크립트에서도 best-effort로 스냅샷을 남긴다.
- **드리프트 자동 복구(파일 → 런타임)**: `data/talkapi_auth.txt`가 갱신되면 운영 중에도 `/runtime`에 자동 반영해 “재기동 때만 반영/잊어버림”을 줄인다.
  - PowerShell: `scripts/ensure_talkapi_auth_applied.ps1` (상태 파일: `node-iris-app/data/talkapi_auth_apply_status.json`)
  - `windows/start_all.ps1` 부팅 시 1회 best-effort 실행 + `windows/watchdog.ps1`에서 주기적으로 실행(기본 30분)

---

## Invariants (불변식)

1. **토큰/UUID 원문 콘솔 출력 금지**: 로그/터미널/웹 응답에는 레드랙트만 허용한다.
2. **비밀 값은 `data/` 하위에만 저장**하고 Git에 커밋하지 않는다.
3. **조용한 폴백 금지**: 캡처/스캔 실패 시 명시적으로 실패 처리한다(임의 값 대체 금지).
4. **SAFE_MODE 가드레일 유지**:
   - 기본은 `runtime.json.safeMode=true`.
   - 실제 발신(`/send/talkapi/dispatch`)은 SAFE_MODE에서 차단되어야 한다.
5. **실발송은 명시적 동의 기반**: 검증 스크립트는 `--confirm-send` 없이는 발송하지 않는다.

---

## Consequences

### 긍정적 효과

- authHeader 확보가 “추측/운”이 아니라 **결정적 절차**가 된다.
- Talk-API 멘션 발신(E2E)을 테스트 방에서 재현 가능해진다.
- 토큰 노출/폴백 같은 운영 리스크를 문서/스크립트로 강하게 방지한다.

### 부정적 효과 / 리스크

- 카카오톡 업데이트/난독화로 훅 포인트가 깨질 수 있어 유지보수가 필요하다.
- root/frida-server 등 환경 의존성이 증가한다.
- 사용/운영 과정에서 서비스 약관/정책 및 보안 이슈에 각별한 주의가 필요하다(디버깅 목적 한정).

---

## Links

- Code:
  - `scripts/capture_talkapi_auth_frida.py`
  - `scripts/extract_talkapi_auth.ps1`
  - `scripts/verify_talkapi_auth_candidates.py`
  - `server/app.py` (`/send/talkapi/*`, `/runtime`)
  - `node-iris-app/src/utils/talkapi.ts`
  - `node-iris-app/src/utils/sender.ts` (mentions attachment 경로)
  - `web/src/app/api/talkapi/auth-from-file/route.ts`
- Docs:
  - `docs/ops/send-guardrails.md`
  - `docs/reference/verification-commands.md`
