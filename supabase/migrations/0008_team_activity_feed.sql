-- Team-scoped activity feed for cloud bundles.
create table if not exists team_activity_feed (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index idx_team_activity_feed_team on team_activity_feed(team_id, created_at desc);
