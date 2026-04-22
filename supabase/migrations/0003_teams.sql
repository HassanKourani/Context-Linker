-- ctx-link: teams
-- Teams replace per-bundle tokens as the access control layer.
-- A user joins a team with name + password, then can access all bundles in that team.

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now(),
  created_by text  -- machine_id of creator
);

create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  machine_id text not null,
  joined_at timestamptz not null default now(),
  unique(team_id, machine_id)
);

-- Add team_id to bundles (nullable for backward compat with existing bundles)
alter table bundles add column if not exists team_id uuid references teams(id) on delete cascade;

-- Make token_hash nullable (teams replace per-bundle tokens for new bundles)
alter table bundles alter column token_hash drop not null;

create index if not exists team_members_team_idx on team_members (team_id);
create index if not exists team_members_machine_idx on team_members (machine_id);
create index if not exists bundles_team_idx on bundles (team_id);

alter table teams enable row level security;
alter table team_members enable row level security;
