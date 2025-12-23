# CourseOps v2 (go.yoorang.kr)

12.kakao의 “강의 운영 v2” 결과를 **웹 콘솔(UI)** 로 제공하기 위한 별도 구성이다.

## 목표

- 운영진이 **어디서든(네트워크 제한 없이)** 같은 화면을 동시에 보며 조치/확인한다.
- 카카오/Redroid 연동(수집)은 **12.kakao 1대(로컬 에이전트)** 가 수행한다.
- 외부 웹은 카카오에 직접 붙지 않고, **결과/상태만** 다룬다.

## 구성

- `courseops/console/`
  - Vercel 배포용 Next.js 콘솔
  - 로그인: `이름 + 공용 비밀번호`(쿠키 자동 로그인)
  - 기능: 작업 대기열(ACTIONS), 대시보드, 전체 명단(추후), 설정, 동기화/재검증 트리거
- `courseops/agent/`
  - 12.kakao(로컬)에서 실행되는 에이전트
  - 콘솔에서 요청한 “전체 동기화 / 빠른 재검증” 작업을 받아 실행하고 진행도를 보고한다.

## 참고 문서

- ADR: `docs/adr/ADR-0046-courseops-v2-web-console-go-yoorang.md`
- 운영 워크플로우: `docs/reference/course-ops-v2-web-console.md`

