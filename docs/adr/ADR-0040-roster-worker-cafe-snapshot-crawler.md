# ADR-0040: roster-worker 카페 데이터 소스 — CSV(레거시) → 크롤러(JSON 스냅샷) 기본값

## Meta

- **Date**: 2025-12-18
- **Status**: Accepted
- **Authors**: PM, Codex CLI
- **Related**: ADR-0032(강의 운영 v1), ADR-0039(강의 운영 v2), `docs/reference/course-roster-worker.md`

---

## Context(배경)

roster-worker(ADR-0032)는 “입장자 이벤트” 기준으로 카페 가입 여부/닉네임 규칙을 검증하고, 15분/24시간 정책으로 안내를 발송한다.

초기 구현은 카페 멤버 소스를 **CSV 스냅샷**(`naver-cafe-member-crawler`가 생성)으로 두었다.

하지만 운영 측면에서 아래 문제가 있었다:

1. CSV 파일 경로를 방별 설정(UI)로 관리해야 해서 **사용자 UX가 나쁘고**, 누락/오타로 장애가 자주 발생한다.
2. CSV 갱신이 외부 수동/별도 작업에 의존하면, 운영이 끊긴다.
3. 같은 프로젝트에서 이미 `naver-cafe-member-crawler`의 Playwright 기반 크롤링을 “워커가 주기적으로 호출”하는 흐름(ADR-0039)을 도입했으므로, roster-worker도 같은 패턴으로 통일하는 것이 자연스럽다.

---

## Decision(결정)

roster-worker의 카페 데이터 소스 기본값을 **크롤러(JSON 스냅샷)**로 전환한다.

### 1) 설정 스키마(방별)

- 기본/권장:
  - `cafeSource=crawler`
  - `cafeUrl`(선택): `clubid=<숫자>` 또는 `search.clubid=<숫자>`가 포함된 URL이면 clubId를 자동 추출할 수 있다.
  - `cafeClubId=<NAVER_CAFE_CLUB_ID>`
  - (옵션) `crawlerRepoPath`, `crawlerPythonExe`, `crawlerSettingsPath`
- 레거시(비권장):
  - `cafeSource=csv`
  - `cafeCsvPath=<CSV_PATH>`

### 2) 동작(캐시/갱신)

- roster-worker는 크롤러 스냅샷을 로컬 파일로 저장하고 캐시한다.
- `--cafe-cache-sec`는 “카페 스냅샷 갱신 최소 간격(초)”으로 해석한다.
  - 크롤러 모드에서는 이 주기보다 자주 크롤링하지 않는다.
- 크롤러 브리지(`scripts/crawl_naver_cafe_members.py`)는 Playwright `storage_state`로 로그인 세션을 저장/재사용한다.
  - 기본 경로: `%LOCALAPPDATA%\\NaverCafeMemberCrawler\\profile\\storage_state.json`
  - 운영 워커에서 호출될 때는 `--headless`를 강제해 주기 실행 중 브라우저 창이 뜨지 않도록 한다.

### 3) 실패 처리(불변식 준수)

- 카페 스냅샷 로딩/크롤링이 실패하면 `SNAPSHOT_ERROR`로 기록하고, 해당 상태에서는 오발신을 막기 위해 안내 발신을 스킵한다.
- SAFE_MODE 및 Talk-API 가드레일은 그대로 유지한다.

---

## Consequences(결과)

### 긍정

- UI에서 CSV 경로를 직접 관리할 필요가 없어져 “강의 운영” 설정 UX가 단순해진다.
- 카페 멤버 데이터 갱신이 워커 내부 책임으로 이동해 운영 단절 리스크가 줄어든다.

### 부정/리스크

- 크롤러(Playwright)는 계정 제한/차단/세션 만료 등으로 실패할 수 있으므로,
  스냅샷 실패 시 오발신을 차단하고 운영자가 시트/로그로 상태를 확인할 수 있어야 한다.

---

## Implementation Links

- Worker:
  - `scripts/course_roster_worker.py`
- 크롤러 브리지:
  - `scripts/crawl_naver_cafe_members.py`
  - 외부 레포(로컬): `C:\dev\naver-cafe-member-crawler`
- UI/API:
  - `web/src/components/RoomCard.tsx`
  - `web/src/app/api/course-roster/config/route.ts`
- 예시 설정:
  - `config/course_roster_worker.example.json`
  - `data/course_roster_worker.json` (gitignore, UI에서 저장)
