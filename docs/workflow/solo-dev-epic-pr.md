# 12.kakao 솔로 개발 워크플로

본 문서는 12.kakao 저장소에서 모든 세션이 따라야 할 표준 작업 흐름을 정의합니다. 기본 원칙은 기능 브랜치에서 Draft PR을 열고, 충분한 검증 이후 main에 머지하는 것입니다.

## 목표
- 세션이 중단되어도 단일 PR로 전체 맥락을 복구할 수 있도록 기록을 남긴다.
- 작은 단위로 자주 검증하고 머지하여 충돌과 롤백 위험을 줄인다.
- 테스트 및 로그를 통해 “다음 행동”이 무엇인지 명확히 유지한다.

## 핵심 규칙
- 원칙: `feat/*`, `fix/*`, `chore/*` 브랜치에서 Draft PR → 검증 후 main 머지
- PR 본문은 Goal/Scope/Invariants/AC/Docs/Tasks/Decision Log를 포함한다.
- 작성 중인 결정 사항은 SSOT와 세션 로그에 즉시 반영한다.
- PR 템플릿: `.github/PULL_REQUEST_TEMPLATE.md`

### (중요) 공유 워킹트리(main-only) 예외
이 PC의 `C:\\dev\\12.kakao` 워킹트리는 여러 세션이 공유하므로, 여기서는 브랜치 체크아웃/`git pull/merge/rebase`를 하지 않는다.
PR이 필요하면 “main에서 커밋 → 패치 생성 → 별도 clone/worktree에서 브랜치/PR” 패턴을 사용한다(아래 참고).

## 표준 흐름(권장: 별도 clone/worktree에서 진행)
1. **브랜치 생성**: `git switch -c feat/<주요-기능>`
2. **Draft PR 작성**
   - PR 템플릿을 채운다: `.github/PULL_REQUEST_TEMPLATE.md`
   - 큰 기능이면 Epic Draft PR(선택): 제목 `EPIC: <기능>` + 하위 PR 연결
3. **검증(변경 범위만)**
   - Python 변경: `pytest`
   - Playwright 스크립트 변경: `npx playwright test` (또는 관련 전용 스크립트)  
   - Node 스크립트/실행파일 변경: `node <script>` 로 스모크 테스트
   - 문서 전용 PR(`docs/**`, `README*.md`, `**/*.md`)은 실행 테스트 생략 가능   
4. **Draft → Ready 전환**
   - Acceptance Criteria 충족 여부, 테스트 통과 여부를 점검한다.
   - 주요 로그/스크린샷/테스트 결과는 PR 코멘트로 첨부한다.
5. **Merge & Clean up**
   - Reviewer 합의 후 main에 Merge commit으로 반영한다.
   - 브랜치 삭제는 자유지만 세션 로그와 PR 링크는 보존한다.

## 표준 흐름(이 워킹트리 예외: main에서 작업 후 PR 올리기)
> 이 PC의 `C:\\dev\\12.kakao`에서는 브랜치를 만들지 않는다. PR은 아래 패턴으로 만든다.

1. `main`에서 변경을 작은 커밋 단위로 만든다.
2. 패치 생성: `git format-patch -1 <commit> -o C:\\dev\\patches_<name>`
3. 별도 clone/worktree에서 PR 브랜치 생성 + 패치 적용
   - `git clone --no-checkout <repo> <dir>` → `git checkout -f main`
   - `git switch -c feat/<name>`
   - `git am <patch>`
4. 푸시/PR 생성: `git push -u origin <branch>` + `gh pr create ...`
5. 머지 후 브랜치 정리(원격/로컬)까지 포함해 종료

## 세션 로그 운영
- 경로: `docs/sessions/<branch>.md` (브랜치 당 1개 파일 유지)
- 템플릿
  ```
  # 세션 로그 – <branch>
  ## Goal
  ## 진행 현황
  ## 주요 결정 / 이유
  ## 남은 일 / Blocker
  ## 참고 링크(Commit / PR / 로그 등)
  ```
- 세션 시작 시: 직전 항목을 검토하고 업데이트할 계획을 적는다.
- 세션 종료 시: 진행 상황/다음 행동을 갱신하고 관련 문서(PRD, SSOT, ADR)에 링크한다.

## 문서 & 결정 관리
- 기술적 결정 변경 시 `docs/adr/`에 ADR을 작성하거나 갱신하고, PR에서 참조한다.
- `docs/ssot.md`는 항상 최신 상태를 유지하며 진행 로그/결정 사항을 추가한다.
- 제품 범위 변경은 `docs/prd.md`, `docs/roadmap.md`를 함께 업데이트한다.
- 세션에서 작성된 로그나 근거 자료는 `docs/journal/` 디렉터리에 날짜별 파일로 남긴다.

## 테스트 & 품질 게이트
- 커밋 전 기본: `pytest` → `npx playwright test`(필요 시)  
  - 선택적으로 `python -m compileall src`로 빠른 문법 검사를 수행한다.
- 실패한 테스트가 있으면 근본 원인을 해결한 뒤 재실행한다. 임시 우회 금지.
- 주요 스크립트/프로세스 수정 시에는 가능한 한 자동화된 테스트를 추가한다.

## PR 템플릿 요약
```
## 🎯 Goal
- 왜 이 작업을 하는가

## 🧾 Scope
- 포함/제외 범위

## 🔒 Invariants
- 절대 깨지면 안 되는 조건

## ✅ Acceptance Criteria
- [ ] 체크리스트

## 🔗 Docs / ADR
- 관련 문서 링크

## 🧩 Tasks
- [ ] 코드
- [ ] 문서
- [ ] 테스트

## 🧠 Decision Log
- yyyy-mm-dd: 결정 요약
```

## 보안 & 환경 변수
- `.env`, 토큰, API 키는 저장소에 커밋하지 않는다.
- 필요 시 `config/local.env` 기반 복제본을 사용하고, 변경 이력은 SSOT/PR에 기록한다.
- 외부 서비스 연결 정보는 PR 코멘트나 문서에 평문으로 노출하지 않는다.

## 참고 체크리스트
- [ ] 세션 시작 전 `docs/ssot.md`/`docs/prd.md`/ADR 최신 내용 확인
- [ ] 작업 중 세션 로그(`docs/sessions/<branch>.md`) 갱신
- [ ] PR 본문 섹션 누락 없음
- [ ] 테스트 결과 첨부 및 문제 발생 시 재현 로그 공유
- [ ] main 브랜치에는 PR Merge로만 반영

---

세션을 시작할 때마다 본 문서를 확인하고, 필요한 경우 프로젝트 특성에 맞게 업데이트한다.
