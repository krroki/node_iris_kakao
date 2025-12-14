# ADR-0005: 네이버 카페 지식베이스(KB) 시스템 도입

## Meta

- **Date**: 2025-12-02
- **Status**: Accepted
- **Authors**: 사용자, Claude
- **Related**: ADR-0004 (KB 서비스 아키텍처)

## 핵심 개요 (AI 필독)

```
┌─────────────────────────────────────────────────────────────────┐
│  KB 지식베이스 시스템                                            │
│                                                                 │
│  네이버 카페 ──[수집]──▶ sources_post ──[임베드]──▶ embeddings  │
│       │                      │                         │       │
│       │                      ▼                         │       │
│       │               [매뉴얼화]                       │       │
│       │                      │                         │       │
│       │                      ▼                         │       │
│       │                manual_doc                      │       │
│       │                      │                         │       │
│       └──────────────────────┴─────────────────────────┘       │
│                              │                                  │
│                              ▼                                  │
│                    /ask, /ask_llm (RAG 검색)                   │
│                              │                                  │
│                              ▼                                  │
│                    카카오톡 봇 응답 생성                         │
└─────────────────────────────────────────────────────────────────┘
```

**KB 시스템은 IRIS/카카오톡 로그와 별개이다.** 네이버 카페 게시글을 수집하여 RAG 기반 질의응답을 제공한다.

## Context (배경)

- 카카오톡 오픈채팅방에서 "디하클(디지털 하이클래스) 카페"에 대한 질문이 반복적으로 발생
- 카페 게시글 내용을 수동으로 찾아 답변하는 것은 비효율적
- 카페 게시글을 자동 수집하고, 질문에 맞는 답변을 자동 생성하는 시스템 필요

## Decision (결정)

**네이버 카페 게시글을 수집 → 임베딩 → RAG 검색하는 지식베이스 시스템을 구축한다.**

### 파이프라인 구성

| 단계 | 작업 | 설명 |
|------|------|------|
| 1. 수집 (collect) | `kb/ingest.py` | 네이버 카페 게시글을 크롤링하여 `sources_post` 테이블에 저장 |
| 2. 임베딩 (embed) | `kb/update_embeddings.py` | 게시글 텍스트를 벡터로 변환하여 `embeddings` 테이블에 저장 |
| 3. 매뉴얼화 (manual) | `kb/manualize.py` | 게시글을 요약/정제하여 `manual_doc` 테이블에 저장 |
| 4. 검색 (ask) | `kb/search.py` | 벡터 유사도 검색으로 관련 문서 반환 |
| 5. LLM 응답 (ask_llm) | `kb/service.py` | 검색 결과 + OpenAI LLM으로 답변 생성 |

### 데이터 모델

```sql
-- 수집된 게시글
sources_post (
  post_id, menu_id, title, url, norm_text, author, created_at, status
)

-- 매뉴얼 문서
manual_doc (
  doc_id, title, summary, body_md, level, status, updated_at
)

-- 벡터 임베딩
embeddings (
  id, obj_type, obj_id, embedding, created_at
)

-- 네이버 로그인 쿠키
secrets (
  key, value, updated_at  -- key='CAFE_COOKIES'
)

-- 작업 로그
job_log (
  job_id, job_type, status, started_at, finished_at, payload, result
)
```

### 웹 UI

- **경로**: `/kb` (Next.js)
- **기능**:
  - 서비스 상태 확인 (PostgreSQL, KB API)
  - 작업 수동 실행 (수집/임베드/매뉴얼화)
  - 스케줄 설정 (자동 실행 간격)
  - 네이버 로그인/쿠키 저장
  - 수집된 포스트/매뉴얼 목록
  - 작업 히스토리

### API 엔드포인트 (KB 서비스, 8610)

| 엔드포인트 | 메서드 | 용도 |
|-----------|--------|------|
| `/health` | GET | 헬스 체크 |
| `/stats` | GET | 통계 (포스트/매뉴얼/임베딩 개수) |
| `/posts` | GET | 포스트 목록 |
| `/manuals` | GET | 매뉴얼 목록 |
| `/run` | POST | 작업 실행 (collect/embed/manual) |
| `/schedule` | GET/POST | 스케줄 조회/설정 |
| `/ask` | POST | 벡터 검색 |
| `/ask_llm` | POST | RAG + LLM 응답 생성 |
| `/login` | POST | 네이버 로그인 |
| `/cookies` | POST | 쿠키 직접 설정 |
| `/creds` | GET/POST | 자격증명 조회/저장 |

### Invariants (불변식)

- KB 시스템은 IRIS/카카오톡 로그와 독립적으로 운영
- 수집에는 네이버 로그인 쿠키가 필요 (비공개 카페)
- 임베딩은 OpenAI 또는 로컬 모델 사용
- LLM 응답은 OpenAI API 사용 (OPENAI_API_KEY 필요)

## AI Context (AI 필독)

### KB 시스템 vs IRIS 시스템 구분

| 구분 | KB 시스템 | IRIS 시스템 |
|------|-----------|-------------|
| 데이터 소스 | 네이버 카페 게시글 | 카카오톡 오픈채팅 메시지 |
| 저장소 | PostgreSQL (Windows Docker) | 로그 파일 (node-iris-app/data/logs) |
| 용도 | RAG 기반 질의응답 | 실시간 로그 모니터링 |
| 웹 UI | `/kb` | `/` (메인 대시보드) |
| 서비스 포트 | 8610 (KB API) | 8650 (FastAPI), 3000 (IRIS) |

### "/kb 페이지" 관련 요청 처리

1. **"KB 페이지가 비어 보여요"** → ADR-0004 참조 (서비스 상태 확인)
2. **"수집이 안 돼요"** → 네이버 쿠키 확인, 로그인 다시 시도
3. **"검색 결과가 없어요"** → 수집 → 임베딩 순서로 작업 실행
4. **"LLM 응답이 안 나와요"** → OPENAI_API_KEY 환경변수 확인

### 카카오톡 봇 연동

KB 시스템의 `/ask_llm` API는 카카오톡 봇이 호출하여 답변을 생성:

```
사용자 질문 (카카오톡)
    ↓
node-iris-app → /ask_llm 호출
    ↓
KB 서비스 → 벡터 검색 + OpenAI LLM
    ↓
응답 생성 → 카카오톡 전송
```

## Consequences (결과)

### 긍정적 효과
- 카페 질문에 자동 답변 가능
- 수집/임베딩/검색 파이프라인 자동화
- 스케줄링으로 최신 게시글 자동 반영

### 부정적 효과 / 리스크
- 네이버 로그인 쿠키 만료 시 수집 실패
- OpenAI API 비용 발생
- PostgreSQL + pgvector 인프라 관리 필요

## Links

- Web UI: `web/src/app/kb/page.tsx`
- KB 서비스: `kb/service.py`
- 수집: `kb/ingest.py`
- 임베딩: `kb/update_embeddings.py`
- 매뉴얼화: `kb/manualize.py`
- 검색: `kb/search.py`
- Related: [ADR-0004 - KB 서비스 아키텍처](ADR-0004-kb-service-architecture.md)
