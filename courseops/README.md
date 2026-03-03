# CourseOps v2 (go.yoorang.kr)

`12.kakao`의 강의 운영 v2(멤버십 점검) 결과를 **외부 웹 콘솔(UI)**로 제공하기 위한 구성입니다.

## 목표

- 운영진이 **어디서든 동시접속**으로 “해야 할 일(ACTIONS)”을 보고 조치/재검증합니다.
- 카카오/Redroid 연동(수집/판정)은 **12.kakao 1대(에이전트)**만 수행합니다. (세션 충돌 방지)
- 웹은 카카오에 직접 붙지 않고 **결과(스냅샷) + 조치 상태**만 다룹니다.

## 구성

- `courseops/console/`
  - Vercel 배포용 Next.js 콘솔
  - 로그인: `이름 + 공용 비밀번호`(쿠키 자동 로그인)
  - 관리자 기능: 새 강의 등록 + 계정 관리(`/accounts`, 관리자만 노출)
  - 기능: 작업 대기열(ACTIONS) / 대시보드 / 전체 명단 / 설정 / 동기화(전체/빠른 재검증)
- `courseops/agent/`
  - 12.kakao(로컬)에서 실행되는 에이전트
  - 콘솔의 작업(SYNC_FULL/REVERIFY)을 받아 워커를 실행하고,
    워커가 만든 스냅샷을 콘솔로 업로드합니다.

## 참고 문서

- ADR: `docs/adr/ADR-0046-courseops-v2-web-console-go-yoorang.md`
- 운영/워크플로: `docs/reference/course-ops-v2-web-console.md`
