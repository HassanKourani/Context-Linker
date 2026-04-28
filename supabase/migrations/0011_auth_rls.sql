-- ctx-link: Supabase Auth + Row Level Security cutover
--
-- Replaces "machine_id + service_role key" with "auth.uid() + anon key + RLS".
-- Existing cloud test data is wiped (Hassan confirmed: testing-only data).
--
-- After this migration, the only path to mutate teams/team_members is via the
-- two SECURITY DEFINER RPCs at the bottom (`team_create_v2`, `team_join_with_code`).
-- All other tables are gated by RLS policies keyed off team membership.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Wipe existing test data (clean slate)
-- ──────────────────────────────────────────────────────────────────────────
-- Order respects FK dependencies; CASCADE handles the rest.
truncate
  public.team_activity_feed,
  public.bundle_join_codes,
  public.excluded_entry_refs,
  public.bundle_entry_refs,
  public.cloud_session_entries,
  public.cloud_sessions,
  public.rewind_log,
  public.bundles,
  public.team_members,
  public.teams
  cascade;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Schema changes
-- ──────────────────────────────────────────────────────────────────────────

-- team_members: machine_id → user_id (auth.users FK)
alter table public.team_members
  drop constraint if exists team_members_team_id_machine_id_key;
alter table public.team_members
  drop column if exists machine_id;
alter table public.team_members
  add column if not exists user_id uuid not null references auth.users(id) on delete cascade;
alter table public.team_members
  add constraint team_members_team_user_uniq unique (team_id, user_id);

drop index if exists public.team_members_machine_idx;
create index if not exists team_members_user_idx on public.team_members (user_id);

-- bundles.team_id is no longer nullable — every cloud bundle MUST be in a team
alter table public.bundles
  alter column team_id set not null;

-- teams.password_hash now stores a bcrypt hash (pgcrypto's crypt() format) instead
-- of argon2. Existing rows were truncated; future rows go through team_create_v2().
-- Column type unchanged (text) but semantics shifted; rename for clarity.
alter table public.teams rename column password_hash to join_code_hash;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Enable RLS on tables that didn't have it (others already enabled)
-- ──────────────────────────────────────────────────────────────────────────
alter table public.excluded_entry_refs enable row level security;
alter table public.team_activity_feed  enable row level security;
alter table public.bundle_join_codes   enable row level security;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Helper: returns set of team_ids the calling user belongs to
-- ──────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so it can read team_members without triggering RLS recursion
-- on team_members's own policy. STABLE so Postgres can inline / cache.
create or replace function public.user_team_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tm.team_id
  from public.team_members tm
  where tm.user_id = auth.uid()
$$;

revoke all on function public.user_team_ids() from public;
grant execute on function public.user_team_ids() to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Drop any old policies that might exist from prior schema iterations
-- ──────────────────────────────────────────────────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'teams','team_members','bundles','cloud_sessions',
        'cloud_session_entries','bundle_entry_refs','rewind_log',
        'excluded_entry_refs','team_activity_feed','bundle_join_codes'
      )
  loop
    execute format('drop policy if exists %I on %I.%I',
                   r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 6. RLS policies
--    Pattern: SELECT/UPDATE/DELETE gated on team membership; INSERT enforces
--    the row's team_id (or derived team_id) is one the user belongs to.
--    teams + team_members INSERT is denied; only the RPCs can write them.
-- ──────────────────────────────────────────────────────────────────────────

-- ---- teams ----
create policy "teams_select_members" on public.teams
  for select to authenticated
  using (id in (select public.user_team_ids()));

-- No INSERT policy → direct INSERT denied. team_create_v2() is the only path.

create policy "teams_update_members" on public.teams
  for update to authenticated
  using (id in (select public.user_team_ids()))
  with check (id in (select public.user_team_ids()));

create policy "teams_delete_members" on public.teams
  for delete to authenticated
  using (id in (select public.user_team_ids()));

-- ---- team_members ----
create policy "team_members_select_in_team" on public.team_members
  for select to authenticated
  using (team_id in (select public.user_team_ids()));

-- Members can leave (delete their own row); RPCs handle additions.
create policy "team_members_delete_self" on public.team_members
  for delete to authenticated
  using (user_id = auth.uid());

-- ---- bundles ----
create policy "bundles_select_team" on public.bundles
  for select to authenticated
  using (team_id in (select public.user_team_ids()));

create policy "bundles_insert_team" on public.bundles
  for insert to authenticated
  with check (team_id in (select public.user_team_ids()));

create policy "bundles_update_team" on public.bundles
  for update to authenticated
  using (team_id in (select public.user_team_ids()))
  with check (team_id in (select public.user_team_ids()));

create policy "bundles_delete_team" on public.bundles
  for delete to authenticated
  using (team_id in (select public.user_team_ids()));

-- ---- cloud_sessions ----
create policy "cloud_sessions_select_team" on public.cloud_sessions
  for select to authenticated
  using (team_id in (select public.user_team_ids()));

create policy "cloud_sessions_insert_team" on public.cloud_sessions
  for insert to authenticated
  with check (team_id in (select public.user_team_ids()));

create policy "cloud_sessions_update_team" on public.cloud_sessions
  for update to authenticated
  using (team_id in (select public.user_team_ids()))
  with check (team_id in (select public.user_team_ids()));

create policy "cloud_sessions_delete_team" on public.cloud_sessions
  for delete to authenticated
  using (team_id in (select public.user_team_ids()));

-- ---- cloud_session_entries (team derived via session_id → cloud_sessions) ----
create policy "cse_select_team" on public.cloud_session_entries
  for select to authenticated
  using (
    session_id in (
      select id from public.cloud_sessions
      where team_id in (select public.user_team_ids())
    )
  );

create policy "cse_insert_team" on public.cloud_session_entries
  for insert to authenticated
  with check (
    session_id in (
      select id from public.cloud_sessions
      where team_id in (select public.user_team_ids())
    )
  );

create policy "cse_update_team" on public.cloud_session_entries
  for update to authenticated
  using (
    session_id in (
      select id from public.cloud_sessions
      where team_id in (select public.user_team_ids())
    )
  )
  with check (
    session_id in (
      select id from public.cloud_sessions
      where team_id in (select public.user_team_ids())
    )
  );

create policy "cse_delete_team" on public.cloud_session_entries
  for delete to authenticated
  using (
    session_id in (
      select id from public.cloud_sessions
      where team_id in (select public.user_team_ids())
    )
  );

-- ---- bundle_entry_refs (team derived via bundle_id → bundles) ----
create policy "ber_select_team" on public.bundle_entry_refs
  for select to authenticated
  using (
    bundle_id in (
      select id from public.bundles
      where team_id in (select public.user_team_ids())
    )
  );

create policy "ber_insert_team" on public.bundle_entry_refs
  for insert to authenticated
  with check (
    bundle_id in (
      select id from public.bundles
      where team_id in (select public.user_team_ids())
    )
  );

create policy "ber_delete_team" on public.bundle_entry_refs
  for delete to authenticated
  using (
    bundle_id in (
      select id from public.bundles
      where team_id in (select public.user_team_ids())
    )
  );

-- ---- rewind_log (team via bundle_id OR session_id; both nullable) ----
create policy "rewind_log_select_team" on public.rewind_log
  for select to authenticated
  using (
    bundle_id in (select id from public.bundles where team_id in (select public.user_team_ids()))
    or
    session_id in (select id from public.cloud_sessions where team_id in (select public.user_team_ids()))
  );

create policy "rewind_log_insert_team" on public.rewind_log
  for insert to authenticated
  with check (
    bundle_id in (select id from public.bundles where team_id in (select public.user_team_ids()))
    or
    session_id in (select id from public.cloud_sessions where team_id in (select public.user_team_ids()))
  );

-- ---- excluded_entry_refs (team via bundle_id) ----
create policy "eer_select_team" on public.excluded_entry_refs
  for select to authenticated
  using (
    bundle_id in (
      select id from public.bundles
      where team_id in (select public.user_team_ids())
    )
  );

create policy "eer_insert_team" on public.excluded_entry_refs
  for insert to authenticated
  with check (
    bundle_id in (
      select id from public.bundles
      where team_id in (select public.user_team_ids())
    )
  );

create policy "eer_delete_team" on public.excluded_entry_refs
  for delete to authenticated
  using (
    bundle_id in (
      select id from public.bundles
      where team_id in (select public.user_team_ids())
    )
  );

-- ---- team_activity_feed ----
create policy "feed_select_team" on public.team_activity_feed
  for select to authenticated
  using (team_id in (select public.user_team_ids()));

create policy "feed_insert_team" on public.team_activity_feed
  for insert to authenticated
  with check (team_id in (select public.user_team_ids()));

-- ---- bundle_join_codes (team via bundle_id) ----
create policy "bjc_select_team" on public.bundle_join_codes
  for select to authenticated
  using (
    bundle_id in (
      select id from public.bundles
      where team_id in (select public.user_team_ids())
    )
  );

create policy "bjc_insert_team" on public.bundle_join_codes
  for insert to authenticated
  with check (
    bundle_id in (
      select id from public.bundles
      where team_id in (select public.user_team_ids())
    )
  );

create policy "bjc_delete_team" on public.bundle_join_codes
  for delete to authenticated
  using (
    bundle_id in (
      select id from public.bundles
      where team_id in (select public.user_team_ids())
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 7. RPCs: the only way to create teams or join them
-- ──────────────────────────────────────────────────────────────────────────

-- team_create_v2: caller must be authenticated; creator becomes first member.
-- Hashes the join code with bcrypt (pgcrypto, schema-qualified for safety).
-- search_path is locked to public + extensions (covers both Supabase placement
-- of pgcrypto). No user-controlled schemas.
create or replace function public.team_create_v2(
  p_name text,
  p_join_code text
)
returns json
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_team_id uuid;
  v_hash text;
begin
  if v_uid is null then
    raise exception 'authentication required'
      using errcode = '42501', hint = 'sign in first';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'team name required' using errcode = '22023';
  end if;

  if p_join_code is null or length(p_join_code) < 1 then
    raise exception 'join code required' using errcode = '22023';
  end if;

  v_hash := crypt(p_join_code, gen_salt('bf', 12));

  insert into public.teams (name, join_code_hash, created_by)
    values (trim(p_name), v_hash, v_uid::text)
    returning id into v_team_id;

  insert into public.team_members (team_id, user_id)
    values (v_team_id, v_uid);

  return json_build_object('team_id', v_team_id, 'name', trim(p_name));

exception
  when unique_violation then
    raise exception 'team name already exists'
      using errcode = '23505';
end
$$;

revoke all on function public.team_create_v2(text, text) from public;
grant execute on function public.team_create_v2(text, text) to authenticated;

-- team_join_with_code: caller must be authenticated; verifies join code via bcrypt.
-- Returns team_id + name on success; raises on invalid code / missing team.
create or replace function public.team_join_with_code(
  p_name text,
  p_join_code text
)
returns json
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_team_id uuid;
  v_team_name text;
  v_hash text;
begin
  if v_uid is null then
    raise exception 'authentication required'
      using errcode = '42501', hint = 'sign in first';
  end if;

  select id, name, join_code_hash
    into v_team_id, v_team_name, v_hash
    from public.teams
    where name = trim(p_name);

  if v_team_id is null then
    raise exception 'team not found'
      using errcode = 'P0002';
  end if;

  if crypt(p_join_code, v_hash) <> v_hash then
    raise exception 'invalid join code'
      using errcode = '42501';
  end if;

  insert into public.team_members (team_id, user_id)
    values (v_team_id, v_uid)
    on conflict (team_id, user_id) do nothing;

  return json_build_object('team_id', v_team_id, 'name', v_team_name);
end
$$;

revoke all on function public.team_join_with_code(text, text) from public;
grant execute on function public.team_join_with_code(text, text) to authenticated;
