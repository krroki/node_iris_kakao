# 2025-10-28 진행 현황 정리 (연속성 문서)

## 1. 오늘까지 완료된 작업
- **Playwright 기반 카페 수집기 고도화**
  - `scripts/iris_board_collector.py`에 iframe/페이지 타임아웃 재시도 파라미터(`NAVER_DETAIL_RETRY`, `NAVER_IFRAME_WAIT_MS`, `NAVER_PAGE_TIMEOUT_MS`, `NAVER_FRAME_WAIT_MS`)를 도입하고 실행 결과를 `meta.detail_*`에 기록하도록 변경.
  - 재수집 결과(`data/naver_cafe/iris_guides.json`): 게시글 31건, 상세 본문 5/20건 성공, 실패 아티클은 `meta.detail_errors`에 기록.
- **IRIS 봇 엔트리 재구성**
  - `src/bot/main.py`에 명령어 라우터, 환영 핸들러, 브로드캐스트 스케줄러를 통합.
  - 기본 명령 `!ping`, `!help`, `!rooms` 등록 및 브로드캐스트 워커/재시도 로직 추가.
  - 드라이런 모드(`--dry-run`)로 로컬 테스트 가능. 실제 IRIS 서버 연결은 환경 변수/토큰 제공 시 진행 예정.
- **문서 및 로그 업데이트**
  - `docs/ops/iris-usage-manual.md`, `docs/ops/feature-design.md`, `docs/todo.md`, `docs/setup/ldplayer.md`, `docs/ssot.md`를 최신 코드/상태에 맞게 갱신.
  - 진행 로그: `docs/journal/2025-10-28-playwright-refresh.md`, `docs/journal/2025-10-28-bot-integration.md`.

## 2. 실행 가능한 구성 요소
| 구성 | 위치 | 실행 조건 | 비고 |
| --- | --- | --- | --- |
| 카페 수집 스크립트 | `scripts/iris_board_collector.py` | `NAVER_ID`, `NAVER_PW` 환경 변수, Playwright 설치 | 상세 본문 실패 시 `meta.detail_errors` 참고 |
| IRIS 봇 | `src/bot/main.py` | `IRIS_URL` (host:port), 브로드캐스트 DB 경로 | `--dry-run` 지원, 실서버 전송은 IRIS API 필요 |
| 브로드캐스트 큐 | `src/services/broadcast_scheduler.py` | SQLite 파일 (`data/broadcast_queue.sqlite`) | `tests/services/test_broadcast_scheduler.py` 통과 |
| 명령어 라우터 | `src/services/command_router.py` | 접두어/권한 설정 | 기본 명령 3종 등록 |

## 3. 미완료/대기 항목과 필요한 정보
| 항목 | 차단 사유 | 필요 데이터/권한 |
| --- | --- | --- |
| IRIS 실서버 연동 및 방송 검증 | IRIS URL/토큰/방 ID 미제공 | IRIS WebSocket/HTTP 주소, 인증 정보, 테스트 방 |
| LDPlayer/Termux 캡처 확보 | 장비 원격 접속 권한 없음 | AnyDesk/RDP/ADB 접속 정보 또는 사용자가 캡처 후 공유 |
| Playwright 상세 본문 100% 확보 | iframe 로딩 변동성, 접근 속도 미확인 | 추가 수집 테스트, 실패 article_id 수동 검증 |

## 4. TODO/다음 단계 (2025-10-29 이후)
1. IRIS 실서버 접근 정보 수령 → `src/bot/main.py` 실환경 테스트 (`!ping`, 방송 전송, 환영 로그) 후 결과 문서화.
2. LDPlayer/Termux 캡처 확보 또는 원격 접속 권한 전달 → `artifacts/` 경로 저장 및 `docs/setup/ldplayer.md` 체크리스트 완료 처리.
3. Playwright 수집 재시도 로그 분석 → 실패 아티클 개별 확인 및 `NAVER_*` 파라미터 최적화.
4. `docs/ops/log-format.md`, `docs/ops/status-check.md`, `docs/ops/retry-policy.md` 초안 작성 (IRIS 연동 완료 이후).

## 5. 참고 로그 및 데이터
- 최근 수집 JSON: `data/naver_cafe/iris_guides.json` (`crawl_time`: 2025-10-28T07:31:27.050563Z, `meta.detail_success`: 5).
- Pytest 결과 (2025-10-28): `tests/services/test_command_router.py`, `tests/services/test_broadcast_scheduler.py`, `tests/services/test_nickname_watcher.py`, `tests/test_message_store.py` → 8 passed.
- SSOT 최신 업데이트: 2025-10-28, IRIS 봇 엔트리 재구성 및 환경 접근 대기 상태 명시.
