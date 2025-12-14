# ADR-0006: KB 프로필(무료/유료) 분리 및 백필(Backfill) 전략

## Meta

- **Date**: 2025-12-02
- **Status**: Accepted
- **Authors**: 사용자, Claude
- **Related**: ADR-0004 (KB 서비스 아키텍처), ADR-0005 (KB 시스템 개요)
- **Target Cafe**: https://cafe.naver.com/dinohighclass (cafe_id: 30819883)

## 핵심 개요 (AI 필독)

```
┌─────────────────────────────────────────────────────────────────┐
│  KB 프로필 분리 구조                                             │
│                                                                 │
│  /kb/free (무료강의)     /kb/paid (유료강의)     /kb (통합)     │
│       │                       │                     │          │
│       ▼                       ▼                     ▼          │
│  kb_free_post            kb_paid_post          kb_main_post    │
│  kb_free_manual          kb_paid_manual        kb_main_manual  │
│       │                       │                     │          │
│       └───────────────────────┴─────────────────────┘          │
│                               │                                 │
│                               ▼                                 │
│                    embeddings (obj_type으로 구분)               │
│                               │                                 │
│                               ▼                                 │
│                         kb_cursor                               │
│              (프로필별 마지막 수집 시점 추적)                    │
└─────────────────────────────────────────────────────────────────┘
```

**프로필(profile)**: `main`, `free`, `paid`, `tips`, `community` 5가지로 KB 데이터를 분리 관리
**대상 카페**: dinohighclass (cafe_id: 30819883) - 게시판 구조는 `config/menus_dinohighclass.json` 참조

## Context (배경)

- 현재 KB 시스템은 모든 카페 게시글을 단일 `sources_post` 테이블에 저장
- 유료강의/무료강의를 별도 UI와 저장소로 분리하여 관리하고 싶음
- 서비스 중단 후 재시작 시 (예: 11/28 → 12/02) 공백 기간의 글을 자동으로 채우고 싶음
- 수동으로 날짜를 입력하지 않고, 시스템이 마지막 수집 시점을 기억하고 이어서 수집

## Decision (결정)

### 1. 프로필 기반 테이블 분리

```sql
-- 프로필별 게시글 테이블
kb_main_post (...)   -- 기존 sources_post 역할 (일반/통합)
kb_free_post (...)   -- 무료강의 전용
kb_paid_post (...)   -- 유료강의 전용

-- 프로필별 매뉴얼 테이블
kb_main_manual (...)
kb_free_manual (...)
kb_paid_manual (...)

-- 임베딩은 단일 테이블, obj_type으로 구분
embeddings (
  id, obj_type, obj_id, embedding, created_at
  -- obj_type: 'main_post', 'free_post', 'paid_post',
  --           'main_manual', 'free_manual', 'paid_manual'
)
```

### 2. 프로필 설정 파일

```yaml
# kb/profiles.yaml
# 대상 카페: dinohighclass (cafe_id: 30819883)
# 참조: config/menus_dinohighclass.json
profiles:
  main:
    description: "통합 KB - 전체 수집 대상 게시판"
    cafe_id: 30819883  # dinohighclass
    menu_ids: []  # 모든 메뉴

  free:
    description: "무료 특강 KB"
    cafe_id: 30819883
    menu_ids: [23, 32]  # 무료 특강 신청, 무료 특강 후기

  paid:
    description: "정규 강의 KB"
    cafe_id: 30819883
    menu_ids: [42]  # 정규 강의 신청

  tips:
    description: "꿀팁 KB"
    cafe_id: 30819883
    menu_ids: [48, 136, 51]  # 주차별 하이라이트, 디하클 회원 꿀팁, 운영자 꿀팁

  community:
    description: "커뮤니티 KB"
    cafe_id: 30819883
    menu_ids: [33, 206, 62, 245]  # 자유 게시판, 수익 인증, 성장일기, 수강생 인터뷰

backfill:
  max_days: 30           # 최대 백필 기간 (일)
  max_pages: 50          # 최대 백필 페이지
  chunk_size: 100        # 한 번에 처리할 글 수
```

### 3. 수집 커서 (kb_cursor)

```sql
CREATE TABLE kb_cursor (
  id SERIAL PRIMARY KEY,
  profile VARCHAR(20) NOT NULL,      -- 'main', 'free', 'paid'
  cafe_id BIGINT NOT NULL,
  menu_id BIGINT NOT NULL,
  last_post_id BIGINT,               -- 마지막으로 수집한 post_id
  last_created_at TIMESTAMP,         -- 마지막으로 수집한 글의 작성일
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(profile, cafe_id, menu_id)
);
```

### 4. 백필 알고리즘

```python
def backfill(profile: str) -> BackfillResult:
    """
    1. kb_cursor에서 해당 profile의 모든 cursor 조회
    2. 각 (cafe_id, menu_id)에 대해:
       - 카페 API에서 last_created_at 이후 글 목록 조회
       - 이미 있는 post_id는 스킵
       - 새 글은 kb_{profile}_post에 insert
    3. cursor 업데이트
    4. job_log에 task='backfill' 기록
    """
```

**백필 트리거 조건:**
- 서비스 시작 시 자동 체크
- UI에서 "백필 실행" 버튼 클릭
- 스케줄러에서 주기적 체크 (예: 1시간마다)
- 공백 > 1일이면 UI에 경고 배지 표시

### 5. API 확장

| 엔드포인트 | 변경 사항 |
|-----------|----------|
| `GET /stats?profile=free` | 프로필별 통계 |
| `POST /run` | `{ task: "backfill", profile: "paid" }` 지원 |
| `GET /schedule?profile=free` | 프로필별 스케줄 |
| `GET /posts?profile=paid` | 프로필별 포스트 목록 |

### 6. UI 구조

```
/kb           → 통합 관리 (profile=main)
/kb/free      → 무료강의 전용 (profile=free)
/kb/paid      → 유료강의 전용 (profile=paid)
```

공통 컴포넌트: `KbDashboard({ profile: 'main' | 'free' | 'paid' })`

**백필 상태 UI:**
```
┌─────────────────────────────────────────┐
│ 무료강의 KB                              │
│ ├─ 마지막 수집: 2025-11-28 15:30        │
│ ├─ 공백: 4일                            │
│ └─ [⚠️ 백필 필요] [백필 실행]            │
└─────────────────────────────────────────┘
```

## Invariants (불변식)

1. **프로필 격리**: `/kb/free`는 `profile=free` 데이터만 조회, 다른 프로필과 섞이지 않음
2. **커서 기반 백필**: 백필은 항상 `kb_cursor` 기준으로 range 계산 (수동 날짜 입력 X)
3. **백필 범위 제한**: 최대 30일, 최대 50페이지로 제한 (무한 백필 방지)
4. **기존 테이블 관계**: `sources_post`는 유지하되, 새 기능은 `kb_*` 테이블만 사용한다. 기존 데이터는 필요 시 수동 마이그레이션 스크립트로 이관.
5. **임베딩 테이블 정책**: 1단계에서는 `embeddings` 단일 테이블 + `obj_type`으로만 구분한다. 프로필별 분리(`embeddings_{profile}`)가 필요하면 별도 ADR을 작성한다.
6. **동시 백필 금지**: 동일 `(profile, menu_id)`에 대해 백필은 한 번에 하나만 실행. `job_log`에서 running 상태 체크로 중복 방지.
7. **백필 에러 시 정책**: 백필 중 오류 발생 시 cursor를 롤백하지 않는다. 다음 실행에서 `created_at` 조건으로 idempotent하게 재시도.

## AI Context (AI 필독)

### 프로필별 요청 처리

| 요청 | 처리 |
|------|------|
| "/kb/free 페이지 데이터가 없어요" | `profile=free`로 수집 실행 필요 |
| "백필 실행해줘" | `/run { task: "backfill", profile: "..." }` 호출 |
| "무료강의만 수집해줘" | `profile=free`로 ingest 실행 |

### 코드 레벨 변경 요약

```python
# 함수 시그니처에 profile 추가
def ingest(profile: Literal["main", "free", "paid"] = "main"):
    table = f"kb_{profile}_post"
    ...

def backfill(profile: str, max_days: int = 30):
    cursors = get_cursors(profile)
    for cursor in cursors:
        new_posts = fetch_since(cursor.last_created_at)
        insert_posts(table=f"kb_{profile}_post", posts=new_posts)
        update_cursor(cursor)
```

### 테이블 네이밍 규칙

```
kb_{profile}_post     → kb_main_post, kb_free_post, kb_paid_post
kb_{profile}_manual   → kb_main_manual, kb_free_manual, kb_paid_manual
```

## Consequences (결과)

### 긍정적 효과
- 유료/무료 강의를 완전히 분리하여 관리 가능
- 서비스 재시작 시 공백 기간 자동 백필
- 프로필별 독립적인 수집/임베딩/스케줄링
  - KB 서비스 in-process 스케줄러(`/schedule`)는 **기동 시 env(KB_SCHED_*)를 우선** 읽고, 비어 있으면 `secrets.KB_SCHEDULE_JSON`에 저장된 주기를 복원한다. 둘 다 없을 때는 기본값(collect/embed=30분, manual/backfill=60분)을 자동 적용하며, 재시작 직후 1회 즉시 실행 후 주기 루프로 진입한다.
  - Windows 작업 스케줄러(`windows/schedule_kb.ps1`)는 OS 차원의 백그라운드 실행을 제공하며, in-process 스케줄러와 병행 사용 가능하다.

### 부정적 효과 / 리스크
- 테이블 수 증가 (3 profiles × 2 types = 6개 추가)
- 코드 복잡도 증가 (profile 파라미터 전파)
- 마이그레이션 과정에서 데이터 정합성 주의 필요

### 후속 작업
- [ ] `kb/profiles.yaml` 생성 및 menu_id 매핑 확정
- [ ] `kb_cursor` 테이블 생성 마이그레이션
- [ ] `kb_{profile}_post`, `kb_{profile}_manual` 테이블 생성
- [ ] `kb/db.py` profile 파라미터 추가
- [ ] `kb/ingest.py` backfill 함수 구현
- [ ] `kb/service.py` API profile 지원
- [ ] `/kb/free`, `/kb/paid` UI 페이지 추가
- [ ] `docs/runbook/kb_backfill.md` 작성

## Links

- Related: [ADR-0004 - KB 서비스 아키텍처](ADR-0004-kb-service-architecture.md)
- Related: [ADR-0005 - KB 시스템 개요](ADR-0005-kb-knowledge-base-system.md)
- Config: `kb/profiles.yaml`
- Code: `kb/ingest.py`, `kb/service.py`, `kb/db.py`
- UI: `web/src/app/kb/free/page.tsx`, `web/src/app/kb/paid/page.tsx`
