# 영상 생성 워커(`video-worker`) – Gemini 웹 연동

## 목적

- 오픈채팅에서 아래 명령으로 **영상 생성**을 수행한다.
  - 생성: `!영상 <프롬프트>` (동의어: `!동영상`, `!비디오`)

## 이미지 기반 영상(Reply/URL)

- **채팅에 업로드된 이미지**(다른 사람이 올린 이미지 포함)
  - 해당 이미지에 **답장**으로 `!영상 <프롬프트>`를 보내면 이미지→영상 입력으로 사용한다.
- **이미지 URL**(외부 링크)
  - URL이 포함된 메시지에 답장으로 `!영상 <프롬프트>`를 보내면 된다.
  - 또는 명령에 URL을 같이 넣을 수도 있다:
    - `!영상 https://... <프롬프트>`
  - 운영 안전을 위해 **http/https만 허용**, **사설/로컬 IP 차단**, **용량 12MB 제한**이 걸려 있다.

## 동시 요청 처리(대기열)

- 여러 명이 동시에 요청해도 **대기열(FIFO)** 로 순서대로 처리한다.
  - 같은 방/다른 방 요청 모두 **전역 1개 대기열**로 합쳐 처리(기본 동시 처리 3건).
  - 동시 처리(2~3)를 켜면 시작 순서는 FIFO지만 완료/발신 순서는 앞뒤가 바뀔 수 있다.
  - 2번째 이후 요청에는 “대기열 몇 번째” 안내가 답장으로 표시된다.
- 대기열이 너무 길면(`VIDEO_WORKER_QUEUE_MAX`, 기본 15) 신규 요청은 안내 후 스킵한다.

### 동시 처리 수(슬롯)

- 기본값: `VIDEO_WORKER_MAX_CONCURRENCY=3` (허용: 1~3)
- 동시 처리 2~3을 켜면 Gemini 웹 세션도 분리해서 사용한다(프로필 분리):
  - 1번: `node-iris-app/data/gemini_web_video_profile`
  - 2번: `node-iris-app/data/gemini_web_video_profile_2`
  - 3번: `node-iris-app/data/gemini_web_video_profile_3`
- `windows/start_video_worker.ps1`는 2~3번 프로필이 없으면 **1번 프로필을 복제**해 자동 생성한다.

## 전제 조건(운영 가드)

- `safeMode=false`여야 발신이 가능하다. (`node-iris-app/config/runtime.json.safeMode`)
- allowlist에 포함된 방에서만 동작한다. (`runtime.json.allowedRoomIds`)
- 방별 토글:
  - `runtime.features[roomId].videoGen=true`

## Gemini 웹 세션(로그인) 준비

> 이미지 워커(`image-worker`)와 동시 실행될 수 있으므로, video-worker는 **별도 프로필 디렉터리**를 사용한다(프로필 락 충돌 방지).

1) (권장) 이미지 워커 세션 복제
- `windows/start_video_worker.ps1`는 기본으로 **이미지 워커 프로필**(`node-iris-app/data/gemini_web_profile`)이 있으면
  이를 `node-iris-app/data/gemini_web_video_profile`로 복제해, **추가 로그인 없이** 시작하려고 시도한다.

2) (한 번만) 세션 초기화(수동 로그인)
- PowerShell/터미널에서 실행:
  - `node node-iris-app/dist/workers/video_worker.js --init-gemini-session`
- 브라우저가 뜨면 Gemini에 로그인까지 완료한 뒤 터미널에서 Enter를 누른다.
- 동시 처리(2~3)를 켠 경우, 필요하면 2~3번 세션도 따로 초기화할 수 있다:
  - `node node-iris-app/dist/workers/video_worker.js --init-gemini-session --gemini-session-id 2`
  - `node node-iris-app/dist/workers/video_worker.js --init-gemini-session --gemini-session-id 3`

3) 평소 운영 기동
- `windows/start_video_worker.ps1 -Restart`

## 환경 변수(선택)

- `VIDEO_WORKER_MAX_CONCURRENCY`
  - 기본값: `3` (허용: 1~3)
  - 동시에 처리할 영상 작업 수(슬롯)
- `VIDEO_WORKER_QUEUE_MAX`
  - 기본값: `15`
  - 대기열 최대 길이
- `GEMINI_WEB_VIDEO_USER_DATA_DIR`
  - 기본값: `node-iris-app/data/gemini_web_video_profile`
  - 자동화 전용 프로필 저장 위치(세션 유지)
- `GEMINI_WEB_VIDEO_URL`
  - 기본값: `https://gemini.google.com/app`
- `GEMINI_WEB_VIDEO_HEADLESS`
  - 기본값: `true` (단, `windows/start_video_worker.ps1`는 기본으로 `0`을 설정해 브라우저가 보이게 실행한다)
- `GEMINI_WEB_CHANNEL`
  - 예: `chrome` (설치된 Chrome 채널 사용)
- `GEMINI_WEB_VIDEO_NAV_TIMEOUT_MS`, `GEMINI_WEB_VIDEO_JOB_TIMEOUT_MS`
  - 네트워크/생성 지연 시 타임아웃 튜닝용
- `GEMINI_WEB_VIDEO_OVERALL_TIMEOUT_MS`
  - Playwright 탭이 멈춰 무기한 대기하는 케이스를 **강제 종료(탭 닫기)**로 끊어 “뻗음”을 방지한다.
- `GEMINI_WEB_VIDEO_EVAL_TIMEOUT_MS`
  - DOM 스캔(`page.evaluate`)이 응답하지 않으면 작업을 실패 처리해 재시도/복구가 가능하게 한다.
- `GEMINI_WEB_VIDEO_FILE_INPUT_SELECTORS`, `GEMINI_WEB_VIDEO_FILECHOOSER_TIMEOUT_MS`, `GEMINI_WEB_VIDEO_ATTACH_PREVIEW_WAIT_MS`
  - 이미지→영상(첨부) 플로우에서 UI selector/타임아웃 튜닝용
- `GEMINI_WEB_VIDEO_REUSE_CONTEXT`
  - 기본값: `true`
  - (슬롯별) 브라우저 프로세스를 재사용해 요청마다 Chrome을 다시 띄우는 비용을 줄인다.

## 구현 위치

- 워커: `node-iris-app/src/workers/video_worker.ts`
- Gemini 웹 자동화: `node-iris-app/src/services/geminiWebVideo.ts`
- 기동 스크립트: `windows/start_video_worker.ps1`
