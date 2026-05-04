-- ctx-link: headers-first pull, entry edits, bundle activity tracking
--
-- Adds:
--   * cloud_session_entries.title          — short headline returned by context_pull
--   * cloud_session_entries.updated_at     — bumped on edit, lets readers see "this changed"
--   * bundles.last_activity_at             — bumped on add/edit/rewind/restore/ref-removal,
--                                            powers per-session sync state
--
-- Title backfill: first non-empty line of summary, truncated to 120 chars. The current
-- application layer also writes title on every new insert; the column becomes NOT NULL
-- once backfill is done.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. cloud_session_entries.title (NOT NULL after backfill)
-- ──────────────────────────────────────────────────────────────────────────
alter table public.cloud_session_entries
  add column if not exists title text;

update public.cloud_session_entries
set title = substring(
  trim(both E' \t\r' from split_part(summary, E'\n', 1))
  for 120
)
where title is null;

-- Defensive fallback for the (degenerate) all-whitespace summary case.
update public.cloud_session_entries
set title = '(untitled)'
where title is null or length(title) = 0;

alter table public.cloud_session_entries
  alter column title set not null;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. cloud_session_entries.updated_at (nullable: null = never edited)
-- ──────────────────────────────────────────────────────────────────────────
alter table public.cloud_session_entries
  add column if not exists updated_at timestamptz;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. bundles.last_activity_at (NOT NULL with default now())
-- ──────────────────────────────────────────────────────────────────────────
alter table public.bundles
  add column if not exists last_activity_at timestamptz;

-- Backfill from MAX(added_at) of refs, falling back to bundle created_at.
update public.bundles b
set last_activity_at = coalesce(
  (select max(added_at) from public.bundle_entry_refs r where r.bundle_id = b.id),
  b.created_at
)
where last_activity_at is null;

alter table public.bundles
  alter column last_activity_at set not null;

alter table public.bundles
  alter column last_activity_at set default now();
