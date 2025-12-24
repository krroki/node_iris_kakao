create table if not exists courseops_courses (
  id text primary key,
  course_key text not null unique,
  club_id text,
  sheet_id text,
  actions_tab text not null default 'ACTIONS',
  archived boolean not null default false,
  archived_at timestamptz,
  archived_by text,
  cafe_url text,
  openchat_chat_room_id text,
  openchat_notice_room_id text,
  premium_enabled boolean not null default true,
  openchat_premium_room_id text,
  vip_enabled boolean not null default false,
  openchat_vip_room_id text,
  payment_sheet_id text,
  payment_sheet_name text,
  payment_header_row int not null default 19,
  payment_grade_col text not null default '카페 등급',
  payment_nickname_col text not null default '닉네임',
  payment_name_col text not null default '성함',
  payment_id_col text not null default '아이디',
  payment_kind_col text not null default '구분',
  payment_exclude_kinds text not null default '환불',
  created_at timestamptz not null default now()
);

alter table courseops_courses add column if not exists club_id text;
alter table courseops_courses add column if not exists archived boolean not null default false;
alter table courseops_courses add column if not exists archived_at timestamptz;
alter table courseops_courses add column if not exists archived_by text;
alter table courseops_courses add column if not exists cafe_url text;
alter table courseops_courses add column if not exists openchat_chat_room_id text;
alter table courseops_courses add column if not exists openchat_notice_room_id text;
alter table courseops_courses add column if not exists premium_enabled boolean not null default true;
alter table courseops_courses add column if not exists openchat_premium_room_id text;
alter table courseops_courses add column if not exists vip_enabled boolean not null default false;
alter table courseops_courses add column if not exists openchat_vip_room_id text;
alter table courseops_courses add column if not exists payment_sheet_id text;
alter table courseops_courses add column if not exists payment_sheet_name text;
alter table courseops_courses add column if not exists payment_header_row int not null default 19;
alter table courseops_courses add column if not exists payment_grade_col text not null default '카페 등급';
alter table courseops_courses add column if not exists payment_nickname_col text not null default '닉네임';
alter table courseops_courses add column if not exists payment_name_col text not null default '성함';
alter table courseops_courses add column if not exists payment_id_col text not null default '아이디';
alter table courseops_courses add column if not exists payment_kind_col text not null default '구분';
alter table courseops_courses add column if not exists payment_exclude_kinds text not null default '환불';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='courseops_courses'
      and column_name='sheet_id'
      and is_nullable='NO'
  ) then
    execute 'alter table courseops_courses alter column sheet_id drop not null';
  end if;
end $$;

create table if not exists courseops_action_state (
  action_key text primary key,
  course_id text not null references courseops_courses(id) on delete cascade,   
  status text not null,
  handled_by text,
  handled_at timestamptz,
  hidden boolean not null default false,
  hidden_by text,
  hidden_at timestamptz,
  memo text,
  created_at timestamptz not null default now()
);

alter table courseops_action_state add column if not exists hidden boolean not null default false;
alter table courseops_action_state add column if not exists hidden_by text;
alter table courseops_action_state add column if not exists hidden_at timestamptz;

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

create table if not exists courseops_users (
  name text primary key,
  enabled boolean not null default true,
  can_sync boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists courseops_course_snapshots (
  course_id text primary key references courseops_courses(id) on delete cascade,
  fetched_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists courseops_course_snapshots_updated_at_idx on courseops_course_snapshots(updated_at desc);
