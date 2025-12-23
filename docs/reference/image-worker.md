# 이미지 생성/수정 워커(`image-worker`) – Gemini 웹 연동

## 목적

- 오픈채팅에서 아래 명령으로 **이미지 생성/수정**을 수행한다.
  - 생성: `!사진 <프롬프트>` (동의어: `!그림`, `!이미지`)
  - 수정: (이미지에 답장으로) `!사진수정 <수정 프롬프트>` (동의어: `!그림수정`, `!이미지수정`)

## 외부 이미지 수정(지원 범위)

- **채팅에 업로드된 이미지**(다른 사람이 올린 이미지 포함)
  - 해당 이미지에 **답장**으로 `!사진수정 <수정 내용>`을 보내면 된다.
- **이미지 URL**(외부 링크)
  - URL이 포함된 메시지에 답장으로 `!사진수정 <수정 내용>`을 보내면 된다.
  - 또는 명령에 URL을 같이 넣을 수도 있다:
    - `!사진수정 https://... <수정 내용>`
  - 운영 안전을 위해 **http/https만 허용**, **사설/로컬 IP 차단**, **용량 12MB 제한**이 걸려 있다.

## 동시 요청 처리(대기열)

- 여러 명이 동시에 요청해도 **대기열(FIFO)** 로 순서대로 처리한다.
  - 같은 방/다른 방 요청 모두 **전역 1개 대기열**로 합쳐 처리(기본 동시 처리 3건).
  - 동시 처리(2~3)를 켜면 **시작 순서**는 FIFO지만, **완료/발신 순서**는 앞뒤가 바뀔 수 있다.
  - 2번째 이후 요청에는 “대기열 몇 번째” 안내가 답장으로 표시된다.
- 대기열이 너무 길면(`IMAGE_WORKER_QUEUE_MAX`, 기본 30) 신규 요청은 안내 후 스킵한다.

### 동시 처리 수(슬롯)

- 기본값: `IMAGE_WORKER_MAX_CONCURRENCY=3` (허용: 1~3)
- 동시 처리 2~3을 켜면 Gemini 웹 세션도 분리해서 사용한다(프로필 분리):
  - 1번: `node-iris-app/data/gemini_web_profile`
  - 2번: `node-iris-app/data/gemini_web_profile_2`
  - 3번: `node-iris-app/data/gemini_web_profile_3`
- `windows/start_image_worker.ps1`는 2~3번 프로필이 없으면 **1번 프로필을 복제**해 자동 생성한다.

## 전제 조건(운영 가드)

- `safeMode=false`여야 발신이 가능하다. (`node-iris-app/config/runtime.json.safeMode`)
- allowlist에 포함된 방에서만 동작한다. (`runtime.json.allowedRoomIds`)
- 방별 토글:
  - `runtime.features[roomId].imageGen=true`

## Gemini 웹 세션(로그인) 준비

> 쿠키/크롬 프로필을 “추출”하는 방식이 아니라, **자동화 전용 Playwright 프로필 디렉터리**에 1회 로그인 상태를 만들어 재사용한다.

1) (한 번만) 세션 초기화(수동 로그인)
- PowerShell/터미널에서 실행:
  - `node node-iris-app/dist/workers/image_worker.js --init-gemini-session`
- 브라우저가 뜨면 Gemini에 로그인까지 완료한 뒤 터미널에서 Enter를 누른다.
 - 동시 처리(2~3)를 켠 경우, 필요하면 2~3번 세션도 따로 초기화할 수 있다:
   - `node node-iris-app/dist/workers/image_worker.js --init-gemini-session --gemini-session-id 2`
   - `node node-iris-app/dist/workers/image_worker.js --init-gemini-session --gemini-session-id 3`

2) 평소 운영 기동
- `windows/start_image_worker.ps1 -Restart`

### (중요) 브라우저 창을 닫아버린 경우

- Playwright가 띄운 Chrome 창을 실수로 닫아도, 다음 요청에서 **세션/컨텍스트를 자동으로 재생성**해 복구한다.
- 다만 연속 실패가 반복되면 아래 순서로 복구한다.
  1) `windows/start_image_worker.ps1 -Restart`
  2) (로그인 필요 시) `node node-iris-app/dist/workers/image_worker.js --init-gemini-session`

## 환경 변수(선택)

- `IMAGE_WORKER_MAX_CONCURRENCY`
  - 기본값: `3` (허용: 1~3)
  - 동시에 처리할 이미지 작업 수(슬롯)
- `GEMINI_WEB_USER_DATA_DIR`
  - 기본값: `node-iris-app/data/gemini_web_profile`
  - 자동화 전용 프로필 저장 위치(세션 유지)
- `GEMINI_WEB_URL`
  - 기본값: `https://gemini.google.com/app`
- `GEMINI_WEB_HEADLESS`
  - 기본값: `true` (단, `windows/start_image_worker.ps1`는 기본으로 `0`을 설정해 브라우저가 보이게 실행한다)
- `GEMINI_WEB_CHANNEL`
  - 예: `chrome` (설치된 Chrome 채널 사용)
- `GEMINI_WEB_FORCE_FAST_MODE`
  - 기본값: `true`
  - 이미지 생성은 모델이 `Pro`로 잡혀 있으면 실패하는 케이스가 있어, 기본으로 `빠른 모드`로 전환을 시도한다.
- `GEMINI_WEB_MAX_IMAGES`
  - 기본값: `1` (최대 6)
- `GEMINI_WEB_SEND_KEY`
  - 기본값: `Enter`
  - 입력창이 “Enter=줄바꿈”인 UI로 바뀌면 `Control+Enter`가 필요할 수 있다.
- `GEMINI_WEB_NAV_TIMEOUT_MS`, `GEMINI_WEB_JOB_TIMEOUT_MS`
  - 네트워크/생성 지연 시 타임아웃 튜닝용
- `GEMINI_WEB_OVERALL_TIMEOUT_MS`
  - 기본값: `navTimeout + jobTimeout + 90초` (최대 15분, 최소 30초)
  - Playwright 탭이 멈춰 `page.evaluate` 등이 무기한 대기하는 케이스를 **강제 종료(탭 닫기)**로 끊어 “뻗음”을 방지한다.
- `GEMINI_WEB_EVAL_TIMEOUT_MS`
  - 기본값: `10000` (ms)
  - DOM 스캔(`page.evaluate`)이 응답하지 않으면 작업을 실패 처리해 재시도/복구가 가능하게 한다.
- `GEMINI_WEB_FILECHOOSER_TIMEOUT_MS`
  - 파일 업로드 메뉴/파일 선택창 대기 타임아웃(편집/수정 플로우에서 중요)
- `GEMINI_WEB_ATTACH_PREVIEW_WAIT_MS`
  - 기본값: `2500` (ms)
  - 이미지 첨부 후 프리뷰가 로드되기까지의 대기(첨부 프리뷰를 “결과 이미지”로 오탐하는 것을 줄임)
- `GEMINI_WEB_REUSE_CONTEXT`
  - 기본값: `true`
  - (슬롯별) 브라우저 프로세스를 재사용해 **요청마다 Chrome을 다시 띄우는 비용을 줄인다**(특히 `!사진수정` 체감 속도 개선).
  - `GEMINI_WEB_PROMPT_SELECTORS`, `GEMINI_WEB_FILE_INPUT_SELECTORS`
  - UI 변경 시 selector 오버라이드(쉼표로 복수 지정)

## 구현 위치

- 워커: `node-iris-app/src/workers/image_worker.ts`
- Gemini 웹 자동화: `node-iris-app/src/services/geminiWebImage.ts`
- 기동 스크립트: `windows/start_image_worker.ps1`
