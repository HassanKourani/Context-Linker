-- Add optional name column to cloud_sessions for user-defined session labels
alter table cloud_sessions add column if not exists name text;
