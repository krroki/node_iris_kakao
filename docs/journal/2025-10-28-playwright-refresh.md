# 2025-10-28 Playwright 재수집 & 문서 싱크 로그

## 수행 작업
- `python scripts/iris_board_collector.py` 재실행 (NAVER_MAX_PAGES=2, NAVER_DETAIL_LIMIT=15) → 게시글 31건, 상세 본문 3건 확보.
- `docs/ops/iris-usage-manual.md`를 최신 데이터(2025-10-28 16:31 KST) 기준으로 재작성하고 주제별 분포/대표 글을 정리.
- `docs/ops/feature-design.md`를 명령어·환영·방송·닉네임 감지 설계와 카페 레퍼런스 ID로 업데이트.
- SSOT(`docs/ssot.md`) 히스토리 및 미완료 항목 갱신, TODO 리스트에 Playwright 안정화 작업을 추가.

## 실행 결과
- `data/naver_cafe/iris_guides.json` 갱신(31건). iframe 로딩 지연으로 상세 본문은 3건만 추출됨 → 재시도 정책 필요.
- 명령어 라우터/환영 파이프라인/닉네임 감지 등 핵심 기능 문서가 카페 글 ID와 직접 연결됨.
- 닉네임 감지 모듈과 테스트 항목을 TODO에서 완료 처리.

## 차기 액션
1. Playwright collector에 iframe 로딩 대기/재시도 옵션 추가 후 상세 본문 15건 이상 확보 검증.
2. `src/bot/main.py`에 `command_router`, `welcome_handler`, `broadcast_scheduler`를 순차적으로 통합하고 통합 테스트 설계.
3. Termux·LDPlayer 실기 캡처 확보 후 설치 문서/SSOT/TODO 상태 업데이트.
