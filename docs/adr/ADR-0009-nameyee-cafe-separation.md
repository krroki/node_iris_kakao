# ADR-0009: nameyee 카페 분리 (도메인 경계 설계)

## Meta

- **Date**: 2025-12-02
- **Status**: Accepted (설계 확정, 구현 보류)
- **Authors**: 운영자, Claude
- **Related ADR**: ADR-0006, ADR-0008

## Context (배경)

### 두 카페의 역할 구분
- **dinohighclass (cafe_id: 30819883)**: 디하클 서비스 대상 카페
  - 무료/정규 강의, 꿀팁, 커뮤니티 게시판
  - KB/RAG 챗봇의 주요 데이터 소스
  - 사용자 대상 모든 기능의 기준

- **nameyee**: 기술 레퍼런스용 카페
  - IRIS, 루팅, 챗봇 개발 관련 기술 문서
  - 운영자/개발자 참고용
  - 서비스 대상 아님

### 현재 상태
- `cafe_id` 필터로 dinohighclass만 검색 대상으로 고정
- nameyee 데이터는 수집/저장 경로 없음
- 향후 "기술 질문"에 대한 RAG 답변이 필요할 수 있음

### 문제
- nameyee 데이터를 dinohighclass와 동일 테이블에 저장하면 도메인 혼란 발생
- "디하클 강의 질문"에 "IRIS 루팅 팁"이 섞여 나올 위험
- 명확한 분리 정책 없이 구현하면 유지보수 복잡도 증가

## Decision (결정)

**nameyee는 별도 도메인으로 완전 분리하되, 구현은 실제 사용 케이스가 확정될 때 진행한다.**

### 1. 도메인 분리 원칙

| 항목 | dinohighclass | nameyee |
|------|---------------|---------|
| cafe_id | 30819883 | (별도 ID) |
| 용도 | 서비스 (사용자 대상) | 레퍼런스 (개발자 참고) |
| KB 검색 | 기본 대상 | 명시적 요청 시만 |
| RAG 답변 | 기본 | opt-in |

### 2. 스키마 설계 (구현 시점에 적용)

```sql
-- Option A: obj_type으로 구분
-- embeddings.obj_type = 'nameyee_post' | 'nameyee_manual'

-- Option B: 별도 테이블
-- nameyee_post, nameyee_manual, nameyee_embeddings

-- Option C: profile로 구분 (권장)
-- kb_nameyee_post, kb_nameyee_manual (ADR-0006 패턴 따름)
-- profile = 'nameyee' 추가
```

**권장: Option C** - ADR-0006의 profile 기반 구조와 일관성 유지

### 3. 도메인 라우팅 규칙

```
사용자 질문 → 도메인 분류 → 해당 프로필 검색

분류 규칙:
- 디하클 질문: 강의, 특강, 수익, 성장, 꿀팁 등 → profile: main/free/paid/tips/community
- 기술 질문: IRIS, 루팅, ADB, 안드로이드, 챗봇 개발 등 → profile: nameyee (향후)

분류 방법 (구현 시 선택):
1. 키워드 기반 규칙
2. LLM 분류기 (간단한 프롬프트)
3. 임베딩 유사도 기반
```

### 4. API 설계

```python
# /ask_llm 확장 (향후)
class AskLlmRequest(BaseModel):
    query: str
    profile: str | None = None  # 명시적 지정
    domain: str | None = None   # 'dino' | 'nameyee' | 'auto'
```

- `domain=None` 또는 `domain='dino'`: dinohighclass만 검색 (기본)
- `domain='nameyee'`: nameyee만 검색
- `domain='auto'`: 질문 분석 후 자동 라우팅

## Invariants (불변식)

1. **디하클 검색에 nameyee 혼입 금지**: dinohighclass 프로필 검색 시 nameyee 데이터가 절대 포함되지 않음
2. **명시적 요청 원칙**: nameyee 데이터는 사용자가 명시적으로 요청하거나, 도메인 라우팅이 "기술 질문"으로 판단한 경우에만 사용
3. **SSOT 분리**: nameyee 메뉴 정의는 별도 SSOT 파일 (`config/menus_nameyee.json`)로 관리
4. **UI 분리**: 서비스 UI(/kb 등)에서는 dinohighclass만 노출, nameyee는 별도 관리 UI

## Consequences (결과)

### 긍정적 효과
- 도메인 경계 명확화로 데이터 혼입 방지
- 향후 기술 KB 추가 시 일관된 패턴 적용 가능
- 사용자 경험 보호 (엉뚱한 답변 방지)

### 부정적 효과 / 리스크
- 구현 복잡도 증가 (별도 수집/임베딩/검색 경로)
- 도메인 분류 오류 가능성 (auto 모드 사용 시)

### 후속 작업 (구현 시점에)
- [ ] `config/menus_nameyee.json` SSOT 생성
- [ ] `kb_nameyee_post`, `kb_nameyee_manual` 테이블 생성
- [ ] `profiles.yaml`에 `nameyee` 프로필 추가
- [ ] `kb/ingest.py`에 nameyee 수집 경로 추가
- [ ] 도메인 라우팅 로직 구현
- [ ] 관리 UI (nameyee 전용) 추가

## AI Context (AI 협업 메모)

- Phase 4 완료 후 설계 확정, 구현은 실제 사용 케이스 확정 시 진행
- CLAUDE.md에 "디하클=서비스, nameyee=레퍼런스" 원칙 명시 필요
- 키워드 기반 도메인 분류가 초기 구현으로 적합 (LLM 호출 비용 없음)

## Links

- Related ADR: ADR-0006 (KB Profile/Backfill), ADR-0008 (Menu SSOT)
- Code (향후): `kb/profiles.yaml`, `config/menus_nameyee.json`
- Spec: CLAUDE.md "대상 카페 구분" 섹션
