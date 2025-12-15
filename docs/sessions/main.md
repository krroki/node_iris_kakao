# 세션 로그: main

> 이 파일은 `C:\dev\12.kakao` 단일 워킹트리를 여러 세션이 공유하는 운영 환경을 전제로 한다.  
> 따라서 이 워킹트리에서는 **브랜치 체크아웃/생성 없이 `main`에서만 작업**하고, 변경은 `main`에 커밋으로 누적한다.

---

## 2025-12-14

- 결론: “node 전체 종료” 사고의 근본 원인(범용 패턴 매칭 kill)을 제거하고, bot/worker 재기동은 **status.json PID 기반 + 절대경로 엔트리 확인**으로만 수행하도록 정렬.
- 문서: `agents.md`에 main-only 워킹트리 규칙과 운영 재기동(부분 재기동 우선) 원칙을 명시.

---

## 2025-12-15

- 오픈채팅 멤버(전체) Google Sheets **자동 동기화 워커** 도입:
  - 워커: `scripts/openchat_members_sheets_worker.py`
  - 기동: `windows/start_openchat_members_sheets_worker.ps1`, `windows/start_all.ps1` 조건부 자동 기동
  - watchdog 자동 복구: `windows/watchdog.ps1`에 stage 추가(단, `worker.enabled=false`면 스킵)
  - UI(3100): 상단 “오픈채팅 멤버(전체) Sheets 동기화” 카드 + 방 카드 “멤버 Sheets 자동”으로 roomId별 설정/상태 확인
  - 결정 문서: `docs/adr/ADR-0033-openchat-members-sheets-worker.md`
- 완전성 원칙 유지: `loadedMembersCount < activeMembersCount`이면 폴백 없이 스킵/실패(스크롤 로딩 필요)로 기록.
- 검증: `cd web && npm run build` PASS, Python 스크립트 문법 체크(`py_compile`) PASS.
