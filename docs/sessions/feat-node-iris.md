# 세션 로그 – feat/node-iris

## Goal
- Node.js(TypeScript) 기반 IRIS 봇을 운영 가능한 수준까지 끌어올린다.
- Python 봇과 동등한 기능(메시지 로깅, 브로드캐스트, 자동화)을 Node-iris 스택으로 이전한다.

## 진행 현황
- `node-iris-app/` 템플릿이 설치되어 있으며 `@tsuki-chat/node-iris`를 기반으로 동작 검증(`npm run build`, `npm run test`) 완료 문서화.
- 서비스 계층
  - `src/services/messageStore.ts`: 이벤트를 JSONL 파일로 기록하고 최근 기록 버퍼를 유지.
  - `src/services/broadcastScheduler.ts`: 파일 기반 브로드캐스트 큐, `CustomBatchController`가 주기 실행.
  - `src/services/index.ts`: 공용 싱글턴을 제공해 컨트롤러에서 서비스 재사용.
- 컨트롤러는 템플릿 구조(`CustomMessageController`, `CustomBatchController`, `CustomBootstrapController` 등)를 유지하고, 브로드캐스트/관리 명령어가 작성되어 있음.
- Vitest 단위 테스트(`npm run test`)가 메시지 저장/브로드캐스트 스케줄러를 검증하도록 구성됨.
- `.env`는 `IRIS_URL`, `MOCK_IRIS`, 로그 경로 등 핵심 값을 포함하고, MOCK 모드로 오프라인 개발 가능.
- MCP `fetch_browser` 서버가 설치되어 있어 웹 검색을 자동화에 활용 가능.

## 주요 결정 / 이유
- Python → Node 전환은 `docs/analysis/node-iris-migration.md` 기준 매핑을 따른다.
- 환경/운영 가이드는 `docs/ops/onboarding-node-iris.md` 및 `docs/setup/iris-hyperv.md`에 정리되어 있으며, 해당 문서를 먼저 검토한 뒤 작업한다.
- 향후 모노레포/Prisma/대시보드 확장 로드맵이 확정되어 있으므로, 현재는 봇 기능 안정화와 데이터 영속화 정리부터 진행한다.

## 남은 일 / Blocker
- [ ] **환경 정비**: `node-iris-app/.env.example`을 최신화하고 Python 환경 변수와 키 이름을 통일한다. (`docs/analysis/node-iris-migration.md` 4.1)
- [ ] **메시지 저장 영속화**: 현재 파일 기반인 `messageStore`를 SQLite 이상으로 전환할 설계 초안을 작성한다. (`docs/analysis/node-iris-migration.md` 3, 4.2)
- [ ] **브로드캐스트 복원**: 재시작 시 스케줄 복원이 가능하도록 `CustomBootstrapController`에서 큐를 로드하도록 구현한다. (`docs/analysis/node-iris-migration.md` 3)
- [ ] **명령어 이식 검증**: Python 명령어 세트를 Node 컨트롤러에 대응시키고, 요구사항을 `docs/implementation_tasks.md`와 싱크한다.
- [ ] **운영 문서 동기화**: `docs/ops/onboarding-node-iris.md`의 절차가 코드와 어긋나는 부분이 없는지 점검하고 수정 사항을 기록한다.
- [ ] **테스트 확대**: Vitest 환경으로 추가 서비스/컨트롤러 테스트를 작성해 기본 행동을 보호한다.
- [ ] **롤아웃 체크리스트 작성**: Hyper-V + 루팅 단말 기준 배포 절차를 점검하여 TODO/SSOT 업데이트.

## 참고 링크(Commit / PR / 로그 등)
- `docs/analysis/node-iris-migration.md`
- `docs/ops/onboarding-node-iris.md`
- `docs/setup/iris-hyperv.md`
- `node-iris-app/README.md` *(필요 시 생성 예정)*
