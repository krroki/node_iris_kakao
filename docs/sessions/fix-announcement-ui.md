# 세션 로그: fix/announcement-ui

- 시작: 2025-12-14
- 목적: 공지 관리(UI) 복구, 방 검색/이름 표시, 공지 전파 결과 요약(1회) 템플릿, 중복 발신(워커 중복 실행) 재발 방지 점검

> 주의: 현재 `C:\\dev\\12.kakao`는 단일 워킹트리를 여러 세션이 공유하므로, 실작업은 `main`에서만 수행한다. (브랜치 체크아웃/생성 금지)

## 진행 상황

- [x] 전체 재기동/부분 재기동 후 상태 점검(API 8650, Web 3100)
- [x] `/announcement` UI 정상 로딩 확인 + 공지 설정 검색 입력 추가
- [x] 공지 전파 결과 요약(공지방 1회, 타겟방 전파 금지) 전제 조건 보강
  - `/rooms/resolve`가 IRIS meta 뿐 아니라 **로그 스냅샷 기반 roomName 보정**을 하도록 수정(공지 결과에 방 이름 표시 강화)
- [x] watchdog/worker 중복 실행 방지 재검증
  - ai-worker 싱글톤 락 추가(`node-iris-app/data/locks/ai_worker.lock`)
  - start_*_worker.ps1의 상대경로 실행 케이스 매칭 보강(ai/welcome)
  - watchdog 문법 오류 수정 및 roster-worker(미설정) 자동 재기동 스킵
- [x] 공지 메시지에 노출되는 `[MF:...]` 마커 제거
  - broadcast-worker는 더 이상 텍스트 끝에 숨김 마커를 붙이지 않는다(카톡에서 zero-width가 제거되어 마커가 노출되는 문제)
  - 대신 워커가 보낸 텍스트/이미지는 TTL 기반 “에코 감지”로 재처리를 방지
- [x] 공지 UI에서 타겟을 늘렸는데 발송/결과에 반영되지 않는 문제 보강
  - `/runtime` 저장 시 공지 route의 source/targets를 allowlist(`allowedRoomIds`)에 자동 포함(단, `excludedRoomIds`는 항상 제외)

## 검증

- `node-iris-app`: `npm test`, `npm run build` 통과
- `server`: `python -m compileall server` 통과

## 결정/메모

- 운영 중인 다른 프로젝트까지 종료될 수 있는 `taskkill /im node.exe` 류 전역 종료는 금지(부분 재기동 스크립트 사용).
