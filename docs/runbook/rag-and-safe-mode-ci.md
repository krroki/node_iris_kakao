# RAG / SAFE_MODE 테스트·CI 운영 가이드

> 목적: KB/RAG 품질과 SAFE_MODE 가드레일이 **항상 동시에 유지**되도록,
> 개발·배포 단계에서 어떤 테스트를 어떤 순서로 돌려야 하는지 정리한다.

---

## 1. 테스트 계층 구조

- **L0 – 빠른 계약 테스트 (수 초)**
  - `pytest tests/test_kb_contract.py -q`
    - KB API 계약(/health, /ask, /menus, /stats, /posts/by_menu, /backfill/status, /jobs/running 등)을 검증한다.
  - 목적: API 스펙이 깨졌는지(필드 누락, ok 필드 등)를 가장 먼저 확인.

- **L1 – SAFE_MODE 가드레일 (수 초)**
  - `python scripts/test_safe_mode.py`
    - `/runtime`으로 safeMode를 true/false로 토글하면서,
    - safeMode=true → `/send/talkapi/dispatch` 가 항상 403(SAFE_MODE)인지,
    - safeMode=false → 403이 아닌 코드(현재는 talkApi disabled로 400)인지 검증한다.
  - 목적: 발신 차단이 깨지지 않았는지, SAFE_MODE SSOT(runtime.json.safeMode)가 정상 동작하는지 확인.

- **L2 – 대표 RAG 시나리오 (수십 초)**
  - `python scripts/verify_rag.py --base-url http://127.0.0.1:8610`
    - 사알못 다시보기, 12월 3일 강의, 무관 질문(피자 만드는 법) 등 4가지 대표 질문에 대해,
    - `/ask_llm` 응답이 템플릿/링크/프리픽스 규칙을 지키는지 검증한다.
  - `pytest tests/test_rag_scenarios.py tests/test_rag_lecture_questions.py -q`
    - out-of-domain(일반 상식) 질문에서 GENERAL_PREFIX + URL 제거가 지켜지는지,
    - “사알못 다시보기 링크”, “12월 3일에 강의 했었어?” 같은 질문에서
      올바른 게시글(post_id 141215 등)이 선택되는지 확인한다.

- **L3 – 도메인 질문 프로빙 (수 분, 수동 확인)**
  - `PYTHONPATH=./ python scripts/probe_rag_questions.py`
    - 사알못/12월 3일/다음 사알못/유튜브 쇼츠 수익화·조회수·월 천만원 등
      실제 자주 나올만한 질문에 대해,
      - `selected_posts` 목록,
      - 선택된 게시글의 menu_id/title,
      - 답변 프리뷰를 콘솔에 출력한다.
    - 사람이 직접 눈으로 결과를 확인하는 단계.

---

## 2. 추천 실행 순서 (로컬 개발·배포 전)

- [ ] **L0**: `pytest tests/test_kb_contract.py -q`
- [ ] **L1**: `python scripts/test_safe_mode.py`
- [ ] **L2**:
  - [ ] `python scripts/verify_rag.py --base-url http://127.0.0.1:8610`
  - [ ] `pytest tests/test_rag_scenarios.py tests/test_rag_lecture_questions.py -q`
- [ ] **L3 (선택)**:
  - [ ] `PYTHONPATH=./ python scripts/probe_rag_questions.py`
  - [ ] 사알못/강의/유튜브·쇼츠 관련 질문에 대한 선택 글·답변 품질을 눈으로 점검

> L0/L1은 PR·배포 전 **항상 필수**, L2는 기능 영향이 있는 변경 시 필수, L3는 중요한 릴리스나 도메인 튜닝 작업 후에 수동 점검 권장.

---

## 3. CI에 넣는다면 (예시 전략)

CI 시스템 종류(GitHub Actions, GitLab CI, Jenkins 등)에 따라 다르지만,
다음과 같이 “빠른 스위트 / 느린 스위트”로 나누는 것을 권장한다.

- **fast 스위트 (PR마다 실행)**
  - `pytest tests/test_kb_contract.py -q`
  - `python scripts/test_safe_mode.py`

- **slow 스위트 (nightly 또는 main 브랜치에 한정)**  
  - `python scripts/verify_rag.py --base-url http://127.0.0.1:8610`
  - `pytest tests/test_rag_scenarios.py tests/test_rag_lecture_questions.py -q`
  - (선택) `PYTHONPATH=./ python scripts/probe_rag_questions.py` 를 실행하고 결과 로그를 아티팩트로 보관

> 실제 CI 설정(YAML 등)은 이 문서의 명령을 그대로 옮기면 되고,  
> LLM 호출 비용·시간을 고려해서 slow 스위트는 스케줄(job) 기반으로 돌리는 것을 추천한다.

---

## 4. 체크리스트 (릴리스 전 최종 점검)

- [ ] KB API 계약 테스트(`test_kb_contract`) 통과
- [ ] SAFE_MODE 테스트(`scripts/test_safe_mode.py`) 통과, safeMode=true/false 상태 코드가 기대와 일치
- [ ] 대표 RAG 시나리오(`scripts/verify_rag.py`, `test_rag_*`) 통과
- [ ] 사알못/12월 3일/유튜브·쇼츠 관련 질문에 대해
  - [ ] `selected_posts`에 실제 관련 게시글만 포함되는지,
  - [ ] 답변에 거짓 링크나 엉뚱한 메뉴가 섞이지 않는지 수동 확인

이 문서는 `ADR-0018`(RAG 일반 상식 경로)와 `ADR-0012`(API 계약/상태 최적화)에서 정의한 원칙을
실제 운영·테스트 절차로 풀어 쓴 것이다. 앞으로 RAG 또는 SAFE_MODE 관련 변경이 있을 때마다,
여기에 명령과 체크리스트를 함께 추가·수정한다.

