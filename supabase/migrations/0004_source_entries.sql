-- Add source_entries column to track individual session entries
-- that were consolidated into this bundle entry.
alter table entries add column if not exists source_entries jsonb default null;
