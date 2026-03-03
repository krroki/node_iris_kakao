# KB Service API 계약서

> **SSOT**: 이 문서는 KB Service (`kb/service.py`) API의 단일 진실 원천(Single Source of Truth)입니다.
> 변경 시 반드시 아래 파일들도 동기화해야 합니다:
> - TypeScript 타입: `web/src/types/api.ts`
> - Python 모델: `kb/service.py` (Pydantic)
> - 테스트: `tests/test_kb_contract.py`, `web/tests/api-contract.spec.ts`

## 공통 규칙

### 응답 형식
모든 엔드포인트는 `ok: boolean` 필드를 포함합니다.

```typescript
interface BaseResponse {
  ok: boolean;
}

interface ErrorResponse extends BaseResponse {
  ok: false;
  code?: string;
  detail?: string;
  error?: string;
}
```

### HTTP 상태 코드
- `200`: 성공
- `400`: 잘못된 요청 (클라이언트 오류)
- `500`: 서버 오류
- `503`: 서비스 불가 (DB 연결 실패 등)

---

## 엔드포인트

### GET /health
헬스 체크

**응답**
```json
{ "ok": true }
```

---

### POST /ask
벡터 검색 (RAG 검색)

**요청**
```typescript
interface AskRequest {
  query: string;
  top_k?: number;  // default: 6
}
```

**응답**
```typescript
interface AskResponse {
  ok: true;
  query: string;
  manuals: SearchHit[];
  posts: SearchHit[];
}

interface SearchHit {
  doc_id?: number;   // manuals only
  post_id?: number;  // posts only
  title: string;
  dist: number;      // 벡터 거리 (낮을수록 유사)
}
```

---

### POST /ask_llm
LLM 기반 RAG 응답 생성

**요청**
```typescript
interface AskLlmRequest {
  query: string;
  top_k?: number;   // default: 4
  model?: string;   // gemini model name (default: models/gemini-2.5-flash)
}
```

**응답**
```typescript
interface AskLlmResponse {
  ok: true;
  query: string;
  answer: string;
  model: string | null;
  manuals: ManualDoc[];
  posts: PostDoc[];
  link_hint: string;
  took: number;  // 처리 시간 (초)
}
```

---

### GET /stats
시스템 통계 및 작업 로그

**응답**
```typescript
interface StatsResponse {
  ok: true;
  counts: {
    posts: number;
    manuals: number;
    emb_posts: number;
    emb_manuals: number;
  };
  jobs: JobLogEntry[];
  cookies: {
    present: boolean;
    updated_at: string | null;  // ISO 8601
  };
}

interface JobLogEntry {
  job_id: string;
  job_type: string;
  status: 'running' | 'success' | 'failed' | 'done';  // 'done' is legacy for 'success'
  started_at: string;
  finished_at: string | null;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
}
```

---

### POST /reindex
임베딩 재인덱싱 트리거

**요청**
```typescript
interface ReindexRequest {
  mode?: 'incremental' | 'full';  // default: incremental
}
```

**응답**
```typescript
interface ReindexResponse {
  ok: true;
  status: 'queued';
}
```

---

### POST /run
백그라운드 작업 실행

**요청**
```typescript
interface RunTaskRequest {
  task: 'collect' | 'embed' | 'manual' | 'backfill';
  pages?: number;
}
```

**응답**
```typescript
interface RunTaskResponse {
  ok: true;
  status: 'started';
  via: 'powershell' | 'python';
  task: string;
}
```

---

### POST /run_cookie
쿠키 수집 브라우저 실행

**응답**
```typescript
interface RunCookieResponse {
  ok: true;
  status: 'started';
  pid: number;
}
```

---

### GET /schedule
스케줄러 상태 조회

**응답**
```typescript
interface ScheduleResponse {
  ok: true;
  schedule: {
    [task: string]: {
      interval_minutes: number;
      next: string | null;  // ISO 8601
    };
  };
}
```

---

### POST /schedule
스케줄 설정

**요청**
```typescript
interface ScheduleSetRequest {
  task: 'collect' | 'embed' | 'manual';
  interval_minutes: number;  // 0 to disable
}
```

**응답**
```typescript
interface ScheduleSetResponse {
  ok: true;
  task: string;
  interval_minutes: number;
}
```

---

### GET /posts
최근 게시글 목록

**쿼리 파라미터**
- `limit`: number (default: 50, max: 200)

**응답**
```typescript
interface PostsResponse {
  ok: true;
  posts: PostSummary[];
}

interface PostSummary {
  post_id: number;
  menu_id: number;
  title: string;
  url: string;
  created_at: string;
  status: string;
}
```

---

### GET /manuals
매뉴얼 목록

**쿼리 파라미터**
- `limit`: number (default: 50, max: 200)

**응답**
```typescript
interface ManualsResponse {
  ok: true;
  manuals: ManualSummary[];
}

interface ManualSummary {
  doc_id: number;
  title: string;
  status: string;
  summary: string | null;
  updated_at: string;
}
```

---

### GET /menus
SSOT 메뉴 정보 (ADR-0008)

**응답**
```typescript
interface MenusResponse {
  ok: true;
  cafe_id: number;
  menus: MenuItem[];
  groups: {
    [profile: string]: {
      label: string;
      menuIds: number[];
    };
  };
  names: {
    [menuId: string]: string;
  };
}

interface MenuItem {
  menu_id: number;
  name: string;
  profile: string;
}
```

---

### GET /posts/by_menu
게시판별 수집 통계

**응답**
```typescript
interface PostsByMenuResponse {
  ok: true;
  menus: {
    [menuId: string]: {
      count: number;
      oldest_at: string | null;
      newest_at: string | null;
      posts: PostSummary[];  // 최근 5개
    };
  };
}
```

---

### GET /backfill/status
백필 상태 조회

**응답**
```typescript
interface BackfillStatusResponse {
  ok: true;
  running: JobLogEntry | null;
  last_completed: JobLogEntry | null;
}
```

---

### GET /jobs/running
진행 중인 작업 목록

**응답**
```typescript
interface JobsRunningResponse {
  ok: true;
  jobs: JobLogEntry[];
  count: number;
}
```

---

### POST /login
네이버 로그인 실행

**요청**
```typescript
interface LoginRequest {
  id?: string;
  pw?: string;
  headless?: boolean;
  channel?: string;
}
```

**응답**
```typescript
interface LoginResponse {
  ok: true;
}
```

---

### GET /creds
저장된 자격 증명 메타 정보

**응답**
```typescript
interface CredsResponse {
  ok: true;
  saved: boolean;
  updated_at: string | null;
}
```

---

### POST /creds
자격 증명 저장

**요청**
```typescript
interface CredsRequest {
  id: string;
  pw: string;
}
```

**응답**
```typescript
interface CredsResponse {
  ok: true;
}
```

---

### POST /cookies
쿠키 직접 설정

**요청**
```typescript
interface CookiesRequest {
  cookies: string;
}
```

**응답**
```typescript
interface CookiesResponse {
  ok: true;
}
```

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|----------|
| 2025-12-04 | 최초 작성: 모든 엔드포인트에 `ok` 필드 추가, `/backfill/status`, `/jobs/running` 신규 |
| 2025-12-04 | `/menus`에 `groups`, `names` 필드 추가 |
