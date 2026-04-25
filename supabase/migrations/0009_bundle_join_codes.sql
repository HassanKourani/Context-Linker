-- Short join codes for easy bundle sharing.
create table if not exists bundle_join_codes (
  code text primary key,
  bundle_id uuid not null references bundles(id) on delete cascade,
  token text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create index idx_bundle_join_codes_bundle on bundle_join_codes(bundle_id);
