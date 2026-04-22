-- ctx-link: initial schema
-- Bundles are private; addressable only by ID + bearer token.

create extension if not exists "pgcrypto";

create table if not exists bundles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null,
  created_at timestamptz not null default now(),
  created_by text
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references bundles(id) on delete cascade,
  project_name text not null,
  machine_id text,
  joined_at timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references bundles(id) on delete cascade,
  session_id uuid references sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  event_type text not null check (event_type in ('commit','pr_open','manual','session_end')),
  trigger_ref text,
  summary text not null,
  files_touched text[] default '{}',
  decisions jsonb default '[]'::jsonb,
  raw_context text
);

create index if not exists entries_bundle_created_idx
  on entries (bundle_id, created_at desc);

create index if not exists sessions_bundle_idx
  on sessions (bundle_id);

-- RLS: deny everything by default; the app uses the service role key
-- and does auth via bearer token comparison in application code.
alter table bundles  enable row level security;
alter table sessions enable row level security;
alter table entries  enable row level security;
