# ADR-0004: KB(지식베이스) 서비스 아키텍처

## Meta

- **Date**: 2025-12-02
- **Status**: Accepted
- **Authors**: 사용자, Claude

## 핵심 아키텍처 (AI 필독)

```
┌─────────────────────────────────────────────────────────────────┐
│  Windows Host                                                   │
│                                                                 │
│  ┌─────────────────┐     ┌─────────────────┐                   │
│  │ Next.js (3100)  │────▶│ KB API (8610)   │                   │
│  │ web/src/app/kb  │     │ kb/service.py   │                   │
│  └─────────────────┘     └────────┬────────┘                   │
│                                   │                             │
│                                   ▼                             │
│                          ┌─────────────────┐                   │
│                          │ PostgreSQL+     │                   │
│                          │ pgvector (5433) │                   │
│                          │ Docker: iris_pg │                   │
│                          └─────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

**KB 서비스 스택은 IRIS/Redroid와 별개이다.** Windows Docker에서 실행되는 PostgreSQL을 사용한다.

| 구성요소 | 포트 | 실행 위치 | 확인 방법 |
|---------|------|----------|----------|
| Next.js KB 페이지 | 3100 | Windows | `http://127.0.0.1:3100/kb` |
| KB FastAPI 서비스 | 8610 | Windows | `curl http://127.0.0.1:8610/health` |
| PostgreSQL (pgvector) | 5433 | Windows Docker | `docker ps \| grep iris_pg` |

## Context (배경)

- 네이버 카페 게시글을 수집하고 임베딩하여 지식베이스를 구축하는 기능 필요
- 벡터 검색을 위해 pgvector 확장이 필요하여 별도 PostgreSQL 인스턴스 사용
- IRIS/Redroid 스택과 독립적으로 운영되어야 함

## Decision (결정)

**KB 서비스는 Windows Docker 컨테이너의 PostgreSQL(pgvector)을 사용하고, IRIS/Redroid VM과는 분리된다.**

### 서비스 구성

1. **PostgreSQL + pgvector** (Docker 컨테이너)
   - 이미지: `pgvector/pgvector:pg16`
   - 컨테이너명: `iris_pg`
   - 포트: 호스트 5433 → 컨테이너 5432
   - DATABASE_URL: `postgresql+psycopg2://iris:iris@127.0.0.1:5433/iris`

2. **KB FastAPI 서비스** (Windows 프로세스)
   - 포트: 8610
   - 실행: `windows/kb_service.ps1`
   - 엔드포인트: `/health`, `/stats`, `/posts`, `/manuals`, `/ask`, `/ask_llm`

3. **Next.js KB 페이지** (web/ 내 라우트)
   - 경로: `/kb`
   - API routes가 KB 서비스(8610)로 프록시

### Invariants (불변식)

- **KB PostgreSQL은 Windows Docker에서 실행** (Hyper-V VM 내부가 아님!)
- KB 서비스가 IRIS 상태에 영향받지 않음 (독립 운영)
- `/kb` 페이지가 비어 보이면 KB 서비스(8610) 또는 PostgreSQL(5433) 상태 확인 필요

## AI Context (AI 필독 - "/kb가 비어 보여요" 처리)

### /kb 페이지가 비어 보이는 경우 진단 순서

```
1. KB 서비스 확인
   curl http://127.0.0.1:8610/health
   ├─ 연결 안 됨 → KB 서비스 미실행
   └─ {"ok":true} → 다음 단계

2. PostgreSQL 확인
   docker ps | grep iris_pg
   ├─ 없음 → docker compose up -d postgres
   └─ 있음 → 포트 확인 (5433)

3. KB stats 확인
   curl http://127.0.0.1:8610/stats
   ├─ timeout → DB 연결 문제
   └─ {"ok":true, ...} → 정상
```

### 복구 명령어

```powershell
# 1. PostgreSQL 시작
cd C:\dev\12.kakao
docker compose up -d postgres

# 2. 컨테이너 확인
docker ps | findstr iris_pg

# 3. KB 서비스 시작
powershell -ExecutionPolicy Bypass -File .\windows\kb_service.ps1

# 4. 확인
curl http://127.0.0.1:8610/health
curl http://127.0.0.1:8610/stats
```

### 해야 할 일 vs 하지 말아야 할 일

**해야 할 일:**
1. Docker로 PostgreSQL(iris_pg) 실행
2. KB 서비스(8610) 실행
3. `/health`, `/stats` 확인

**하지 말아야 할 일:**
- Hyper-V VM 안에서 PostgreSQL을 찾으려고 시도
- IRIS 상태를 KB 문제의 원인으로 착각
- KB 서비스를 IRIS 서비스와 혼동

## Consequences (결과)

### 긍정적 효과
- IRIS/Redroid 스택과 독립적으로 KB 기능 운영 가능
- pgvector로 효율적인 벡터 검색
- Docker Compose로 간단한 PostgreSQL 관리

### 부정적 효과 / 리스크
- Windows Docker Desktop 필요
- 두 개의 분리된 스택(IRIS + KB) 관리 필요

## Links

- docker-compose.yml: PostgreSQL 서비스 정의
- kb/service.py: FastAPI KB 서비스
- web/src/app/kb/page.tsx: KB 대시보드 UI
- windows/kb_service.ps1: KB 서비스 시작 스크립트
- Related: [ADR-0003 - FastAPI + SSE 웹앱](ADR-0003-fastapi-sse-migration.md)
