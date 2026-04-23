-- Track which local session a cloud session was copied from.
-- Enables "Sync from Local" to pull new entries.
alter table cloud_sessions add column if not exists source_session_id text;
