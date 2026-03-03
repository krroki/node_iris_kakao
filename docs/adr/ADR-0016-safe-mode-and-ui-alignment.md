# ADR-0016 – SAFE_MODE 동작 및 웹 UI 정렬

## Status
- Accepted – 2025-12-06

## Context

- 프로젝트의 핵심 불변식 중 하나는 **“기본 모드는 SAFE_MODE=true (발신 차단)”** 이다.
- 그러나 구현이 다음과 같이 둘로 갈라져 있었다.
  - 환경 변수 `SAFE_MODE`:
    - `node-iris-app/src/app.ts`에서 컨트롤러 등록 여부를 제어.
    - `windows/start_bot.ps1`에서 항상 `SAFE_MODE=false`로 덮어써서 사실상 무력화.
  - 런타임 설정 `node-iris-app/config/runtime.json.safeMode`:
    - FastAPI `/runtime` API와 웹 UI(`/settings`)에서 관리.
    - 일부 컨트롤러에서는 `isSafeMode()`로 읽지만, AI 응답 등은 허용 방일 경우 계속 발신.
- 그 결과:
  - 기능별 관리에서 SAFE MODE를 ON으로 설정해도 허용 방에서는 메시지가 발송되는 혼란이 발생했다.
  - SAFE_MODE의 단일 소스(Single Source of Truth)가 불명확했다.
  - 템플릿/공지/방별 기능 토글은 모두 runtime.json을 기준으로 움직이는데, SAFE_MODE만 예외적으로 env와 섞여 있었다.

또한 웹 대시보드 측면에서는 다음 문제가 있었다.

- 템플릿:
  - 실시간 서버(`server/log_utils.py`)가 `node-iris-app/config/templates/**`를 SSOT로 사용하도록 변경되었지만,
  - 스트림릿/기존 경로에 있던 템플릿은 마이그레이션되지 않아 “템플릿이 사라진 것처럼” 보이는 현상이 있었다.
- 썸네일(아바타):
  - `/avatar/{roomId}`에서 이미지가 없으면 404를 반환하고, `RoomCard`의 `<img>`는 onError 시 `display:none` 처리되면서
  - 아바타 파일이 없는 방은 완전히 빈 상태로 보여 UX가 나빠졌다.

## Decision

1. SAFE_MODE 단일 소스 통일
   - SAFE_MODE의 **단일 소스**는 `node-iris-app/config/runtime.json.safeMode`로 한다.
   - FastAPI `/runtime` API와 웹 UI(`/settings`)에서만 SAFE MODE를 토글한다.
   - 환경 변수 `SAFE_MODE`는 컨트롤러 등록 여부에 사용하지 않으며, 존재하더라도 런타임 설정이 우선한다.

2. 컨트롤러 등록 방식 변경
   - `node-iris-app/src/app.ts`:
     - 더 이상 `SAFE_MODE` 환경변수를 확인하여 일부 컨트롤러를 등록하지 않는 방식(하드 차단)을 사용하지 않는다.
     - 모든 컨트롤러를 항상 등록하고, 각 컨트롤러 내부에서 `isSafeMode()`를 통해 발신을 차단한다.

3. SAFE_MODE 시 발신 완전 차단
   - `node-iris-app/src/utils/guard.ts`:
     - `isSafeMode()`는 `runtime.json.safeMode`를 우선 읽고, 값이 없을 때만 env `SAFE_MODE`를 참고한다.
   - `CustomMessageController.aiQuery`:
     - 함수 초입에서 `if (await isSafeMode())`를 호출하여 SAFE_MODE가 켜진 경우 AI 질의를 즉시 스킵한다(허용 방/ai 토글 여부와 무관).
     - 기존에 SAFE_MODE가 켜져도 `allowedRoomIds`에 포함된 방에서는 계속 발신되던 로직을 제거한다.
   - 다른 컨트롤러(`CustomBatchController`, `CustomNewMemberController`, `CustomMessageControllerBang`)는 이미 `isSafeMode()`를 통해 발신을 차단하고 있으므로, SAFE_MODE 의미가 전역적으로 일관되게 적용된다.

4. start_bot 스크립트에서 SAFE_MODE 강제 해제 제거
   - `windows/start_bot.ps1`:
     - `$env:SAFE_MODE = 'false'` 설정을 제거한다.
     - IRIS_URL, REALTIME_API_BASE 등 실행에 필요한 값만 설정하고, SAFE_MODE는 런타임 설정(runtime.json)에 위임한다.

5. 템플릿/썸네일 UI 개선
   - 템플릿:
     - 템플릿의 SSOT는 `node-iris-app/config/templates/**`를 유지한다.
     - 웹 UI(`/templates`)는 해당 경로에서 읽어온 템플릿만 보여주며:
       - 카테고리 선택 드롭다운에 각 카테고리별 템플릿 개수(`(N개)`)를 함께 표시하고,
       - 리스트가 비어 있을 때는 “해당 카테고리에 템플릿이 없습니다.” 메시지를 명시적으로 보여준다.
     - 기존(WSL/Streamlit) 템플릿은 필요 시 수동으로 SSOT 위치로 마이그레이션한다.
     - 기능별 관리(`/settings`)에서는:
       - 카테고리별 템플릿 개수를 함께 표시하고,
       - `runtime.json.templateByFeature`에 설정되어 있지만 실제 템플릿 목록에는 존재하지 않는 이름이 있을 경우 경고 박스를 통해 알려준다.
   - 썸네일:
     - `RoomCard`에서 `/avatar/{roomId}` 요청이 404로 실패할 경우 `<img>`를 숨기는 대신, 방 이름 첫 글자를 보여주는 fallback 뱃지를 렌더링한다.
     - 아바타 파일이 없는 방도 이제는 통일된 썸네일 UI를 가진다.

## Consequences

### 긍정적 효과

- SAFE_MODE 의미가 코드/스크립트/UI에서 일관되게 정리된다.
  - “SAFE_MODE=true = 발신 완전 차단(수신/로그 전용)”이라는 프로젝트 불변식이 구현과 정확히 대응한다.
  - 기능별 관리(Settings)에서 SAFE MODE를 ON으로 했는데도 메시지가 발송되는 혼란이 사라진다.
- SAFE_MODE 토글 경로가 단일화된다.
  - 운영자는 웹 UI(`/settings`)만으로 SAFE MODE를 관리하면 되고, PowerShell 스크립트는 실행/빌드에만 집중한다.
- 템플릿/썸네일 UX가 개선된다.
  - 템플릿이 없을 때 “없는 것인지, 로딩 실패인지”가 명확해진다.
  - 썸네일이 없는 방도 기본 아바타(첫 글자)로 표시되어, 대시보드 가독성이 향상된다.

### 부정적/주의점

- SAFE_MODE를 env로만 제어하던 레거시 스크립트/환경이 있다면, 이제 `runtime.json`을 통해 제어하도록 마이그레이션해야 한다.
- SAFE_MODE를 잘못 끄면(OFF) 모든 발신이 허용되므로, 운영 프로세스 상에서 SAFE_MODE 토글에 대한 추가 경계(리뷰, 체크리스트)가 필요하다.
- 템플릿 SSOT가 하나로 고정되었기 때문에, 과거 다른 위치에 저장된 템플릿은 자동으로 보이지 않는다.
  - 필요한 템플릿은 `node-iris-app/config/templates/<category>/*.json` 위치로 수동 이전해야 한다.

## Links

- `AGENTS.md` – SAFE_MODE 단일 소스 및 Next.js/Realtime 구조 반영.
- `claude.md` – UI 전환 지침 및 SAFE_MODE 정책 정렬.
- `windows/start_bot.ps1` – SAFE_MODE 환경변수 강제 해제 제거.
- `node-iris-app/src/app.ts` – 컨트롤러 등록 로직 단순화.
- `node-iris-app/src/controllers/CustomMessageController.ts` – SAFE_MODE 시 AI 응답 전역 차단.
- `web/src/components/RoomCard.tsx`, `web/src/app/dashboard.css` – 방 썸네일 fallback UI 추가.
