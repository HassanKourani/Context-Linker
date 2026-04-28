-- Hide notes sessions from normal session listings
alter table cloud_sessions
  add column kind text not null default 'project'
  check (kind in ('project','notes'));

-- Bundle's pointer to its hidden notes session (lazy-created on first note)
alter table bundles
  add column notes_session_id uuid references cloud_sessions(id) on delete set null;

-- Role tag on entries
alter table cloud_session_entries
  add column role text
  check (role in ('ticket','constraint','design','decision','bug','qa','note'));

create index if not exists cloud_session_entries_role_idx
  on cloud_session_entries (role)
  where role is not null;
