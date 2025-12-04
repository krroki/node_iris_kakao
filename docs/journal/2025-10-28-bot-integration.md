# 2025-10-28 IRIS 봇 통합 & Playwright 재시도 개선 로그

## 수행 작업
- `scripts/iris_board_collector.py`에 iframe/페이지 타임아웃 재시도 옵션을 추가(`NAVER_DETAIL_RETRY`, `NAVER_IFRAME_WAIT_MS`, `NAVER_PAGE_TIMEOUT_MS`, `NAVER_FRAME_WAIT_MS`)하고 실행 요약(`meta.detail_*`)을 기록하도록 수정.
- `src/bot/main.py`를 재구성해 명령어 라우터, 환영 핸들러, 브로드캐스트 스케줄러를 통합하고 기본 명령(`!ping`, `!help`, `!rooms`)을 등록.
- 브로드캐스트 큐 폴링 워커를 추가하고 IRIS 전송 함수 탐지/로깅 로직 도입.
- 문서 동기화: `docs/ops/iris-usage-manual.md`, `docs/ops/feature-design.md`, `docs/ssot.md`, `docs/todo.md`, `docs/setup/ldplayer.md` 업데이트.

## 한계 및 추후 조치
- 실제 IRIS 전송 API 연동 및 실계정 방송 테스트는 보류됨 → 실서버 환경에서 `send_text`(또는 대체 함수) 확인 필요.
- Playwright 상세 본문 재시도 로직은 코드 레벨에서 강화했으나, 실측 수치 확인을 위해 추가 수집 테스트 & 로그 분석 필요.
- LDPlayer/Termux 캡처는 현재 환경에서 확보할 수 없어 캡처 체크리스트만 정리. 운영 장비에서 캡처 획득 후 SSOT/TODO 갱신 필요.

## 후속 TODO
1. 실 IRIS 환경에서 봇 실행 → 브로드캐스트 전송 성공/실패 로그 검증, 재시도 동작 확인.
2. Playwright 수집 스크립트 재실행 후 `meta.detail_success/detail_targets` 값 확인 및 iframe 타임아웃 재현 로그 확보.
3. LDPlayer/Termux 캡처 수집 진행 → `artifacts/` 경로에 저장하고 `docs/journal/` 및 SSOT에 반영.
