/**
 * KB Service API Types
 *
 * SSOT: docs/api-contract.md
 * 이 파일은 KB Service API 응답 타입의 TypeScript 정의입니다.
 * 변경 시 반드시 docs/api-contract.md와 동기화해야 합니다.
 */

// ==================== 공통 타입 ====================

export interface BaseResponse {
  ok: boolean;
}

export interface ErrorResponse extends BaseResponse {
  ok: false;
  code?: string;
  detail?: string;
  error?: string;
}

export interface JobLogEntry {
  job_id: string;
  job_type: string;
  status: 'running' | 'success' | 'failed' | 'done';  // 'done' is legacy for 'success'
  started_at: string;
  finished_at: string | null;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
}

// ==================== /health ====================

export interface HealthResponse extends BaseResponse {
  ok: true;
}

// ==================== /ask ====================

export interface AskRequest {
  query: string;
  top_k?: number;
}

export interface SearchHit {
  doc_id?: number;
  post_id?: number;
  title: string;
  dist: number;
}

export interface AskResponse extends BaseResponse {
  ok: true;
  query: string;
  manuals: SearchHit[];
  posts: SearchHit[];
}

// ==================== /ask_llm ====================

export interface AskLlmRequest {
  query: string;
  top_k?: number;
  model?: string;
}

export interface ManualDoc {
  doc_id: number;
  title: string;
  summary: string | null;
  body_md: string | null;
  level: string | null;
  status: string;
  updated_at: string;
}

export interface PostDoc {
  post_id: number;
  menu_id: number;
  title: string;
  url: string;
  norm_text: string | null;
  author: string | null;
  created_at: string;
  status: string;
}

export interface AskLlmResponse extends BaseResponse {
  ok: true;
  query: string;
  answer: string;
  model: string | null;
  manuals: ManualDoc[];
  posts: PostDoc[];
  link_hint: string;
  took: number;
}

// ==================== /stats ====================

export interface StatsResponse extends BaseResponse {
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
    updated_at: string | null;
  };
}

// ==================== /reindex ====================

export interface ReindexRequest {
  mode?: 'incremental' | 'full';
}

export interface ReindexResponse extends BaseResponse {
  ok: true;
  status: 'queued';
}

// ==================== /run ====================

export type TaskType = 'collect' | 'embed' | 'manual';

export interface RunTaskRequest {
  task: TaskType;
  pages?: number;
}

export interface RunTaskResponse extends BaseResponse {
  ok: true;
  status: 'started';
  via: 'powershell' | 'python';
  task: string;
}

// ==================== /run_cookie ====================

export interface RunCookieResponse extends BaseResponse {
  ok: true;
  status: 'started';
  pid: number;
}

// ==================== /schedule ====================

export interface ScheduleResponse extends BaseResponse {
  ok: true;
  schedule: {
    [task: string]: {
      interval_minutes: number;
      next: string | null;
    };
  };
}

export interface ScheduleSetRequest {
  task: TaskType;
  interval_minutes: number;
}

export interface ScheduleSetResponse extends BaseResponse {
  ok: true;
  task: string;
  interval_minutes: number;
}

// ==================== /posts ====================

export interface PostSummary {
  post_id: number;
  menu_id: number;
  title: string;
  url: string;
  created_at: string;
  status: string;
}

export interface PostsResponse extends BaseResponse {
  ok: true;
  posts: PostSummary[];
}

// ==================== /manuals ====================

export interface ManualSummary {
  doc_id: number;
  title: string;
  status: string;
  summary: string | null;
  updated_at: string;
}

export interface ManualsResponse extends BaseResponse {
  ok: true;
  manuals: ManualSummary[];
}

// ==================== /menus ====================

export interface MenuItem {
  menu_id: number;
  name: string;
  profile: string;
}

export interface MenuGroup {
  label: string;
  menuIds: number[];
}

export interface MenusResponse extends BaseResponse {
  ok: true;
  cafe_id: number;
  menus: MenuItem[];
  groups: {
    [profile: string]: MenuGroup;
  };
  names: {
    [menuId: string]: string;
  };
}

// ==================== /posts/by_menu ====================

export interface MenuPostStats {
  count: number;
  oldest_at: string | null;
  newest_at: string | null;
  posts: PostSummary[];
}

export interface PostsByMenuResponse extends BaseResponse {
  ok: true;
  menus: {
    [menuId: string]: MenuPostStats;
  };
}

// ==================== /backfill/status ====================

export interface BackfillStatusResponse extends BaseResponse {
  ok: true;
  running: JobLogEntry | null;
  last_completed: JobLogEntry | null;
}

// ==================== /jobs/running ====================

export interface JobsRunningResponse extends BaseResponse {
  ok: true;
  jobs: JobLogEntry[];
  count: number;
}

// ==================== /login ====================

export interface LoginRequest {
  id?: string;
  pw?: string;
  headless?: boolean;
  channel?: string;
}

export interface LoginResponse extends BaseResponse {
  ok: true;
}

// ==================== /creds ====================

export interface CredsGetResponse extends BaseResponse {
  ok: true;
  saved: boolean;
  updated_at: string | null;
}

export interface CredsPostRequest {
  id: string;
  pw: string;
}

export interface CredsPostResponse extends BaseResponse {
  ok: true;
}

// ==================== /cookies ====================

export interface CookiesRequest {
  cookies: string;
}

export interface CookiesResponse extends BaseResponse {
  ok: true;
}

// ==================== Bot Process Manager Types ====================

export interface BotProcess {
  pid: number;
  cmd: string;
  startTime: string;
}

export interface BotProcessesResponse extends BaseResponse {
  ok: true;
  processes: BotProcess[];
  count: number;
}

export interface BotKillResponse extends BaseResponse {
  ok: true;
  killed: number;
  stdout: string;
}
