-- Tracks entries explicitly removed from a bundle so auto-sync won't re-add them.
create table if not exists excluded_entry_refs (
  bundle_id uuid not null references bundles(id) on delete cascade,
  entry_id uuid not null references cloud_session_entries(id) on delete cascade,
  excluded_at timestamptz not null default now(),
  excluded_by_machine_id text,
  primary key (bundle_id, entry_id)
);

create index idx_excluded_entry_refs_bundle on excluded_entry_refs(bundle_id);
