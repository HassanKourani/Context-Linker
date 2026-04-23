# Cloud Sessions — Design Spec

## Problem

Sessions are currently local-only files (`~/.ctx-link/active-sessions/`). They only become visible in the cloud as a side-effect of pushing entries to a bundle. This means:

- Teammates can't see what sessions exist until entries are pushed to a bundle
- Sessions without bundle connections are invisible in the UI beyond the local machine
- There's no way to browse sessions per project/team and then decide which to connect to bundles

## Goal

Make sessions first-class cloud objects that exist independently of bundles. Sessions start local, get promoted to cloud under a team on user action, and are fully visible to all team members. Bundles reference session entries instead of copying them.

## Key Decisions

- **Local-first**: Sessions always start as local files. "Push to Cloud" promotes them under a team.
- **Single source of truth**: Entries live in the session. Bundles hold references, not copies.
- **Cascading deletes**: Delete entry from session → removed from all bundles. Remove entry from bundle → only that reference is deleted.
- **No consolidation**: Entries are pushed individually. Users curate which entries go to a bundle (pick final decisions, not the iteration trail).
- **Identical behavior**: Local and cloud use the same model — sessions own entries, bundles reference them.
- **Team-scoped**: Cloud sessions belong to a team. Full visibility within team, invisible outside.

## Database Schema

### New Tables

**`cloud_sessions`** — independent of bundles, owned by a team

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| team_id | uuid | FK → teams, NOT NULL |
| project_name | text | NOT NULL |
| project_path | text | |
| machine_id | text | NOT NULL |
| branch | text | |
| started_at | timestamptz | NOT NULL |
| last_active_at | timestamptz | NOT NULL, DEFAULT now() |

**`cloud_session_entries`** — the single source of truth for all entries

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| session_id | uuid | FK → cloud_sessions ON DELETE CASCADE |
| event_type | text | NOT NULL |
| trigger_ref | text | |
| summary | text | NOT NULL |
| files_touched | jsonb | DEFAULT '[]' |
| decisions | jsonb | DEFAULT '[]' |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| superseded_at | timestamptz | Soft-delete for rewind |

**`bundle_entry_refs`** — junction table, bundles reference session entries

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| bundle_id | uuid | FK → bundles ON DELETE CASCADE |
| entry_id | uuid | FK → cloud_session_entries ON DELETE CASCADE |
| added_at | timestamptz | NOT NULL, DEFAULT now() |
| | | UNIQUE(bundle_id, entry_id) |

### Dropped Tables

- `sessions` (old bundle-scoped sessions)
- `entries` (old copied entries)

### Modified Tables

- `rewind_log` — references `cloud_session_entries` IDs instead of old `entries` IDs

## Data Flow & Lifecycle

### Session Lifecycle

1. **Claude Code starts** → local session created in `~/.ctx-link/active-sessions/` with entries in `~/.ctx-link/session-entries/`. No team required. The `ActiveSession` type gains a `cloud_session_id: string | null` field (null until pushed to cloud) and a `team_id: string | null` field.

2. **User works** → entries accumulate locally in the session (via MCP `session_log`, hooks, CLI).

3. **User clicks "Push to Cloud"** → session + all entries written to `cloud_sessions` + `cloud_session_entries` under a team. Local session gets a `cloud_session_id` field so future entries sync to cloud.

4. **User continues working** → new entries saved locally AND synced to cloud (session is now cloud-enabled). No duplicates — each entry has a stable UUID created locally, reused as the cloud PK.

5. **User connects session to bundle** → all session entries get `bundle_entry_refs` rows. Selection dialog lets user deselect entries they don't want. Tracks which entries have been pushed to which bundles.

6. **User pushes again to same bundle** → only entries without an existing `bundle_entry_refs` row for that bundle get added.

7. **User deletes entry from session** → local delete + cloud delete + all `bundle_entry_refs` CASCADE removed.

8. **User removes entry from bundle** → only the `bundle_entry_refs` row deleted. Session entry and other bundle refs untouched. The session-bundle connection stays — only that one entry ref is removed.

### Local Bundle Flow

Local storage mirrors the cloud model with JSON files:

- `~/.ctx-link/local/<bundle_id>/entry_refs.json` — array of `{ entry_id, session_id }` references
- Pulling from a local bundle resolves refs → reads entries from the session's entry file
- Same cascade semantics: delete session entry removes refs, remove ref from bundle keeps entry

## Core Functions

### New: `cloud-sessions.ts`

- `pushSessionToCloud(sessionId, teamId)` → creates `cloud_sessions` + `cloud_session_entries` rows, returns `cloud_session_id`
- `syncSessionEntry(sessionId, entry)` → if session is cloud-enabled, writes entry to both local and cloud
- `deleteCloudSession(cloudSessionId)` → deletes session (cascades entries → cascades bundle refs)
- `listTeamSessions(teamId)` → all cloud sessions for a team

### Modified: `entries.ts`

- `deleteEntry(sessionId, entryId)` → deletes from local + cloud + all bundle refs cascade
- Remove consolidation logic — entries are always individual
- `pullEntries(bundleId)` → JOINs `bundle_entry_refs` → `cloud_session_entries`, filters `superseded_at IS NULL`

### Modified: `bundles.ts`

- `addEntriesToBundle(bundleId, entryIds)` → creates `bundle_entry_refs` rows (skips existing via UNIQUE constraint)
- `removeEntryFromBundle(bundleId, entryId)` → deletes single `bundle_entry_refs` row
- `getUnpushedEntries(sessionId, bundleId)` → session entries without a ref for this bundle

### Modified: `local-store.ts`

- Same function signatures, file-based implementation
- `entry_refs.json` per bundle instead of copying entries
- Resolves refs to read actual entries from session files
- Same cascade logic as cloud

## API Endpoints

### New

- `POST /api/sessions/:id/push-to-cloud` — promote local session to cloud under a team
- `GET /api/teams/:id/sessions` — list all cloud sessions for a team

### Modified

- `GET /api/graph` — includes cloud sessions per team (not just per bundle), active local sessions listed separately
- `POST /api/sessions/:id/push-to-bundle` — creates `bundle_entry_refs` instead of copying entries, supports entry selection, skips already-pushed entries
- `DELETE /api/sessions/:id/entries/:entryId` — cascades through bundle refs

### MCP Tools

- `session_push_to_cloud` — new, promotes session to cloud
- `context_push` — modified to create refs instead of copies
- `source_entry_delete` — modified to cascade through refs

## UI Changes

### Graph Structure

- **Team group nodes** show all cloud sessions organized by project — connected to bundles or not
- **Project nodes** show session rows with: branch, entry count, started_at, "You" badge, cloud/local indicator
- **Unconnected sessions** appear in project nodes with no edges to bundles
- **Drag handle** on session rows for connecting to bundles (existing pattern)

### Session Panel (Right-Side Sheet)

- Entry list shows all session entries
- Each entry shows badge like "in 2 bundles" if it has bundle refs
- "Push to Cloud" button at top if session is local-only (prompts for team selection)
- "Connect to Bundle" button — opens selection dialog: pick bundle, then pick entries (default all selected, user deselects unwanted)

### Entry Management

- Delete entry from session panel → confirmation noting removal from N bundles
- Remove entry from bundle panel → removes ref only, no cascade warning
- Push indicator: when session has unpushed entries for a connected bundle, show "3 new" badge
- "Push New Entries" action in session panel per connected bundle

## Rewind System

- Rewind operates on `cloud_session_entries.superseded_at` — unchanged in concept
- A rewound entry is hidden from all bundles simultaneously (JOIN filters `superseded_at IS NOT NULL`)
- Restore clears `superseded_at` — entry reappears in all referencing bundles
- `rewind_log` tracks audit trail, references `cloud_session_entries` IDs
- Local rewind: same behavior, `superseded_at` field on local entries, bundle pulls skip them
