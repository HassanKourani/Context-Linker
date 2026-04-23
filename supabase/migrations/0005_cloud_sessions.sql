-- ctx-link: cloud sessions (reference model)
-- Sessions become independent of bundles. Entries live in sessions.
-- Bundles reference entries via a junction table.

-- 1. Create cloud_sessions (independent of bundles, owned by team)
create table if not exists cloud_sessions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  project_name text not null,
  project_path text,
  machine_id text not null,
  branch text,
  started_at timestamptz not null,
  last_active_at timestamptz not null default now()
);

create index if not exists cloud_sessions_team_idx
  on cloud_sessions (team_id);
create index if not exists cloud_sessions_machine_idx
  on cloud_sessions (machine_id);

alter table cloud_sessions enable row level security;

-- 2. Create cloud_session_entries (source of truth for all entries)
create table if not exists cloud_session_entries (
  id uuid primary key,  -- use the local UUID, not auto-generated
  session_id uuid not null references cloud_sessions(id) on delete cascade,
  event_type text not null check (event_type in ('commit','pr_open','manual','session_end')),
  trigger_ref text,
  summary text not null,
  files_touched jsonb default '[]'::jsonb,
  decisions jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  superseded_at timestamptz
);

create index if not exists cloud_session_entries_session_idx
  on cloud_session_entries (session_id, created_at desc);
create index if not exists cloud_session_entries_active_idx
  on cloud_session_entries (session_id, created_at desc)
  where superseded_at is null;

alter table cloud_session_entries enable row level security;

-- 3. Create bundle_entry_refs (junction: bundles reference session entries)
create table if not exists bundle_entry_refs (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references bundles(id) on delete cascade,
  entry_id uuid not null references cloud_session_entries(id) on delete cascade,
  added_at timestamptz not null default now(),
  unique(bundle_id, entry_id)
);

create index if not exists bundle_entry_refs_bundle_idx
  on bundle_entry_refs (bundle_id);
create index if not exists bundle_entry_refs_entry_idx
  on bundle_entry_refs (entry_id);

alter table bundle_entry_refs enable row level security;

-- 4. Drop old tables (sessions and entries were bundle-scoped copies)
-- Order matters: entries references sessions, rewind_log references entries
drop table if exists rewind_log cascade;
drop table if exists entries cascade;
drop table if exists sessions cascade;

-- 5. Recreate rewind_log pointing to cloud_session_entries
create table if not exists rewind_log (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid references bundles(id) on delete cascade,
  session_id uuid references cloud_sessions(id) on delete cascade,
  project_name text not null,
  strategy_kind text not null,
  strategy_detail jsonb not null,
  affected_entry_ids uuid[] not null default '{}',
  affected_count int not null default 0,
  reason text,
  performed_by text,
  performed_at timestamptz not null default now()
);

create index if not exists rewind_log_session_idx
  on rewind_log (session_id, performed_at desc);
create index if not exists rewind_log_bundle_idx
  on rewind_log (bundle_id, performed_at desc);

alter table rewind_log enable row level security;
