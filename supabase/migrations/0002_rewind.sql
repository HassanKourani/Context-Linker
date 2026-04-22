-- ctx-link: rewind support (soft-delete + audit log)

alter table entries
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_reason text;

-- Partial index keeps "live entry" queries fast as rewound entries accumulate.
create index if not exists entries_active_idx
  on entries (bundle_id, created_at desc)
  where superseded_at is null;

-- Audit log for rewinds. Cheap, and invaluable when you wonder
-- "why is this entry missing from the timeline?"
create table if not exists rewind_log (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references bundles(id) on delete cascade,
  project_name text not null,
  strategy_kind text not null,
  strategy_detail jsonb not null,
  affected_entry_ids uuid[] not null default '{}',
  affected_count int not null default 0,
  reason text,
  performed_by text,
  performed_at timestamptz not null default now()
);

create index if not exists rewind_log_bundle_idx
  on rewind_log (bundle_id, performed_at desc);

alter table rewind_log enable row level security;
