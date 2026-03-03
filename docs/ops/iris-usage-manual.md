# IRIS 사용 메뉴얼 (2025-10-28)

## 1. 수집 개요
- Playwright 스크립트 `scripts/iris_board_collector.py`로 네이버 카페 *카카오톡 봇 커뮤니티* → `IRIS 가이드` 게시판 2페이지(31건)를 자동 수집했습니다.
- 최신 수집 일시(KST): **2025-10-28 16:31:27** (`data/naver_cafe/iris_guides.json` `crawl_time` 기준, UTC→KST 변환).
- 게시글 요약 31건과 상세 본문 3건(회원 혜택·통합 규정·등업 안내)을 확보했습니다. 상세 본문은 `NAVER_DETAIL_LIMIT` 값과 게시판 접근 권한, iframe 로딩 지연에 따라 가변입니다.
- 동일 스크립트 재실행 시 결과가 덮어쓰이므로, 재수집 시점과 사용한 환경 변수(`NAVER_MAX_PAGES`, `NAVER_DETAIL_LIMIT`)를 SSOT 또는 저널에 남겨 추적하세요. (2025-10-28 기준: 2페이지·상세 15건 요청 → 3건 성공)
- 상세 수집 안정화를 위해 `NAVER_DETAIL_RETRY`(기본 3회), `NAVER_IFRAME_WAIT_MS`(기본 7000ms), `NAVER_PAGE_TIMEOUT_MS`(기본 15000ms), `NAVER_FRAME_WAIT_MS`(기본 5000ms)를 조정할 수 있으며, 실행 결과 `meta.detail_success/detail_targets`에 요약됩니다.

## 2. 게시판 트렌드 요약 (2025-10-28 16:31 수집)
- **주제별 게시글 분포(31건)**
  - 기타: 11건 — 이벤트/후기 등 분류 불가 항목.
  - 라이브러리/소스 공유: 7건 — `52697`, `52592`, `52111` 등 코드 공유·레퍼런스 공지.
  - 설치/환경 구성: 5건 — `52109`, `52108`, `50564` 등 설치 가이드.
  - 모바일/Termux: 4건 — `52388`, `52372`, `52150` 등 노루팅/모바일 운용 사례.
  - 운영 정책/공지: 3건 — `52693`, `46857`, `39556` 등 필독 공지.
  - 명령어/자동화: 3건 — `50786`(닉변 감지) 등 자동화 사례.
- **최근 공지 5건 하이라이트**
  - 2025-10-27: `[접수][ 강의영상 업로드 이벤트 접수 안내 (총 30만 원 + α) ]`
  - 2025-10-21: `[공지]카페 유료 회원 혜택 안내(+가입 안내)` — 가입 프로세스/등급 혜택.
  - 2025-10-22: `[사전공고]코드 공유로 보상 받는 게시판을 신설합니다. (11/5 ~ )`
  - 2025-10-21: `카페 가을맞이 시험기간 이벤트`
  - 2025-08-01: `[공지]📌2025 카페 통합 규정📌 ✅️` — 제재 프로세스·규정 개정.
- **설치/환경 구성 레퍼런스**: “25년 7월 기준 Iris 설치 방법”(52109), “Iris 설치 가이드.youtube”(52108), “[스압] Iris 가이드 따라서 설치해보기”(50564).
- **라이브러리/레퍼런스**: `irispy-client 레퍼런스`(52111), `휴대폰에서 irispy-client 봇 돌리기.youtube`(52150), `node-iris 레퍼런스`(게시판 검색 필요).
- **노루팅 운영**: `Hayul+Termux를 이용한 노루팅 Iris 돌리기.youtube`(52388), `Hayul을 이용한 노루팅 Iris 실행.youtube`(52372).
- **운영 정책**: 유료 회원 혜택(52693), 통합 규정(46857), 중수 등업 절차(39556)는 필수 참고 문서로 SSOT/TODO에 연계합니다.

## 3. 설치 및 기본 환경 (요약)
- **Termux 초기 설정** (`핸드폰에서 irispy-client 봇 돌리기.youtube` 참고)
  1. `pkg update && pkg upgrade`
  2. `pkg install android-tools` (adb), `pkg install wget`
- **iris_control 설치/실행**
  ```bash
  wget https://github.com/dolidolih/Iris/releases/latest/download/iris_control -O iris_control
  chmod +x iris_control
  ./iris_control install
  ./iris_control start
  ./iris_control status
  ```
- **루트 권한 및 ADB 활성화**
  ```bash
  su
  setprop service.adb.tcp.port 5555
  stop adbd
  start adbd
  exit
  adb connect 127.0.0.1:5555
  adb devices
  ```
- **DashBoard 접속**: `http://127.0.0.1:3000/dashboard`
- Hyper-V/루팅 단말 운영과 병행할 경우 `docs/setup/iris-hyperv.md`의 Termux 보조 절차를 싱크하세요.

## 4. 노루팅 & 모바일 운영 팁
- 필수 준비물: 루팅된 기기, Termux 0.118+, 로컬 ADB 포트(5555) 개방.
- `adb devices`에서 127.0.0.1이 `offline`이면 `setprop → stop adbd → start adbd` 후 Wi-Fi 재연결 및 `adb connect`를 반복합니다.
- Hayul + Termux 운영 사례는 강좌 형식이므로, 운영 문서에는 주요 명령·주의사항(루팅, su 권한, adb 포트)을 요약하고 원문 링크를 남깁니다.

## 5. 운영 자동화 가이드 (닉네임 감지)
1. **스크립트 위치 제안**
   - 새 모듈: `src/services/automation/nickname_watcher.py`
   - 의존성: `requests`, IRIS HTTP API (`/query`, `/reply`)
2. **게시글 기반 로직** (`닉변감지[python]`, ID 50786)
   ```python
   request_json = {"query": "select enc,nickname,user_id,involved_chat_id from db2.open_chat_member", "bind": []}
   detect_rooms = ["18398338829933617"]
   base_url = "http://<IRIS_HOST>:3000"
   refresh_second = 3
   while True:
       query_result = requests.post(f"{base_url}/query", headers=headers, json=request_json).json()["data"]
       # user_id → nickname 매핑 비교 후 변경 시 /reply 전송
   ```
3. **구현 체크리스트**
   - DB 스키마(`db2.open_chat_member`)와 API 인증 키를 환경 변수로 분리 (`NICKWATCH_QUERY`, `IRIS_TOKEN`).
   - `detect_rooms`를 환경이나 설정(`config/nickname_watcher.json`)으로 분리해 재배포 시 수정 없이 운영.
   - 예외 처리: API 실패 시 지수 백오프, `requests` 예외 로깅.
   - 테스트: `tests/services/test_nickname_watcher.py`에서 `requests_mock`으로 변경 감지 검증.
4. **배포/운영**
   - `scripts/run_nickname_watcher.sh` 또는 `systemd` 서비스로 상시 실행.
   - 이벤트 로그는 `logs/automation/nickname_watcher.log`에 기록하고, 실패 시 Slack/메일 알림을 트리거.

## 6. 멤버십 및 규정 요약
- **유료 회원 혜택** (`52693`: https://cafe.naver.com/f-e/cafes/29537083/articles/52693?menuid=383)
  - 준회원: 이벤트 참가, 봇 구매·임대 10% 지원(최대 2,000원), 전용 게시판 400+ 열람.
  - 중수(정회원): 지원율 20%(최대 10,000원), 중급 게시판 포함 4,000+ 열람.
  - 고수: 지원율 40%(최대 15,000원), 전 게시글·강좌 열람. 소스 공유 5건 제출 시 후원료 환급.
- **통합 규정 핵심** (`46857`: https://cafe.naver.com/f-e/cafes/29537083/articles/46857?menuid=383, 2025-08-07 개정)
  - 경고제 운영, 규정 변경은 30일 전 사전 공지, 소급 적용 금지.
  - 제재 이의 신청은 카카오톡 공식 채널(litt.ly/kakaotalk_bot)에서만 처리.
- **중수 등업 체크리스트** (`39556`: https://cafe.naver.com/f-e/cafes/29537083/articles/39556?menuid=383)
  1. 가입비 20,000원 납부.
  2. 자랑 게시판에 봇 기능 3가지 이상 소개(단순 GPT 대화형은 1개로만 인정).
  3. 게시글 3개·댓글 5개·방문 5회 이상.
  4. 조건 미충족 신청 반복 시 경고 1회 부여.

## 7. 후속 권장 사항
- 설치/운영 문서(`docs/setup/iris-hyperv.md`)와 본 메뉴얼을 상호 링크하고 최신 수집 일자를 함께 갱신합니다.
- 닉네임 감지 등 자동화 스크립트는 `src/services/automation/` 네임스페이스로 정리하고, 운영 전 단위 테스트를 통과시킵니다.
- 멤버십/규정 업데이트는 `docs/ssot.md` → `docs/todo.md` 순으로 기록하고, 변경 근거 링크를 명시합니다.
- 추가 본문 확보가 필요하면 `NAVER_DETAIL_LIMIT`을 조정하거나 `NAVER_DETAIL_RETRY`/`NAVER_IFRAME_WAIT_MS` 값을 높이고 `--slowmo`, `page.wait_for_timeout`으로 iframe 로딩 대기 시간을 늘린 뒤 재수집합니다. 수집 성공·실패 여부는 JSON `meta.detail_*` 필드를 참고하세요.
- 상세 크롤링 실패 사례(logs/collector-*.log 예정)를 수집해 재현 스크립트/대기 정책을 보완하세요.
