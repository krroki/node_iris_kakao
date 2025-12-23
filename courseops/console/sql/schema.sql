create table if not exists courseops_courses (
  id text primary key,
  course_key text not null unique,
  club_id text,
  sheet_id text not null,
  actions_tab text not null default 'ACTIONS',
  cafe_url text,
  openchat_chat_room_id text,
  openchat_notice_room_id text,
  premium_enabled boolean not null default true,
  openchat_premium_room_id text,
  vip_enabled boolean not null default false,
  openchat_vip_room_id text,
  created_at timestamptz not null default now()
);

alter table courseops_courses add column if not exists club_id text;
alter table courseops_courses add column if not exists cafe_url text;
alter table courseops_courses add column if not exists openchat_chat_room_id text;
alter table courseops_courses add column if not exists openchat_notice_room_id text;
alter table courseops_courses add column if not exists premium_enabled boolean not null default true;
alter table courseops_courses add column if not exists openchat_premium_room_id text;
alter table courseops_courses add column if not exists vip_enabled boolean not null default false;
alter table courseops_courses add column if not exists openchat_vip_room_id text;

create table if not exists courseops_action_state (
  action_key text primary key,
  course_id text not null references courseops_courses(id) on delete cascade,
  status text not null,
  handled_by text,
  handled_at timestamptz,
  memo text,
  created_at timestamptz not null default now()
);

create table if not exists courseops_jobs (
  id text primary key,
  course_id text not null references courseops_courses(id) on delete cascade,
  kind text not null,
  status text not null,
  requested_by text not null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz,
  agent_name text,
  last_heartbeat_at timestamptz,
  progress_pct int,
  progress_message text,
  payload jsonb not null default '{}'::jsonb,
  result_message text
);

create index if not exists courseops_jobs_status_idx on courseops_jobs(status, requested_at);

create table if not exists courseops_job_events (
  id text primary key,
  job_id text not null references courseops_jobs(id) on delete cascade,
  level text not null,
  message text not null,
  ts timestamptz not null default now()
);
