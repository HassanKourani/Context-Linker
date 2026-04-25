# ctx-link Sellability Features Design

**Date:** 2026-04-25
**Goal:** Increase open-source adoption through automation, visibility, and viral onboarding.
**Strategy:** Three independent features on separate branches, mergeable in any order.

---

## Feature 1: Auto-Sync Bundles (`feat/auto-sync`)

Eliminate manual push/pull for cloud bundles. Context flows automatically between connected sessions.

### Auto-Push

**Trigger logic — push on generation settle, not on a fixed timer:**

- Track "last hook activity" timestamp (updated on every `Write`/`Edit`/`Bash` hook event)
- When no hook event fires for 20 seconds, consider the generation settled → trigger consolidate + push
- **Minimum interval:** Never push more than once every 3 minutes (prevents rapid-fire pushes during quick one-off edits)
- **No maximum cap:** If a generation runs 10+ minutes continuously, wait until it settles before pushing
- The 3-minute number is a floor, not a ceiling

**Scope:**

- Cloud bundles only. Local bundles stay manual
- Only sessions connected to a cloud bundle participate
- Runs in the MCP server process (already long-lived per session)

### Heuristic Consolidation

Before pushing, deduplicate entries accumulated since last push:

- **Per-file dedup:** Multiple edits to the same file within the window → 1 entry with the latest state
- **Commits stay separate:** Each `git commit` is its own entry
- **PR entries stay separate:** PR creation is its own entry
- **Different files stay separate:** Edits to `auth.ts` and `routes.ts` → 2 entries

Example: 3 edits to `auth.ts`, 1 edit to `routes.ts`, 1 commit → 3 entries (not 5).

Consolidation produces multiple entries, never one giant blob.

### Auto-Pull

- On MCP session boot, if the project has a connected cloud bundle, automatically pull latest entries
- Uses existing `context_pull` logic
- Controlled by `auto_sync` field in `.ctx-link.json` (default `true` for cloud bundles)

### Exclusion List

Prevents auto-sync from re-pushing entries a user explicitly removed from a bundle.

**Cloud (Supabase):**

- New table: `excluded_entry_refs`
  - `bundle_id` (FK → bundles)
  - `entry_id` (FK → cloud_session_entries)
  - `excluded_at` (timestamptz)
  - `excluded_by_session_id` (text)

**Local:**

- New file: `~/.ctx-link/local/<bundle_id>/excluded_refs.json`
- Array of `{ entry_id, excluded_at, excluded_by_session_id }`

**Behavior:**

- `bundle_remove_entry` creates an exclusion record (in addition to deleting the ref)
- Auto-push checks exclusions before adding refs — excluded entries are skipped
- New `bundle_include_entry` tool/API to re-include (deletes the exclusion record)

### Project Config

New field in `.ctx-link.json`:

```json
{
  "bundle_id": "...",
  "auto_sync": true
}
```

`auto_sync` defaults to `true` for cloud bundles. Set to `false` to disable auto-push/pull and use manual mode only.

### Manual Push/Pull Coexistence

Manual push/pull remains for:

- **Curated pushes with summaries** — `context_push --summary "..."` creates a consolidated editorial entry
- **Local bundles** — no auto-sync, always manual
- **One-off sharing** — pushing to a bundle you're not auto-connected to
- **Intentional pull** — explicitly asking "what did the other sessions do?"

Auto-sync is the ambient background mode. Manual is the precision tool. They coexist.

---

## Feature 2: Live Context Feed (`feat/live-feed`)

Real-time activity feed showing what's happening across your Claude Code sessions. Team-scoped, cloud-only.

### Scope Rules

- Only events from sessions connected to cloud bundles within a team
- Users see activity only from teams they belong to
- Purely local sessions or sessions not connected to any cloud bundle generate zero feed events
- The trigger is bundle connection, not session creation

### Data Model

New Supabase table: `team_activity_feed`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `team_id` | uuid | FK → teams |
| `event_type` | text | `entry_pushed`, `session_connected`, `session_disconnected`, `bundle_created`, `bundle_deleted` |
| `payload` | jsonb | Event-specific data (project name, machine ID, bundle name, entry preview, etc.) |
| `created_at` | timestamptz | Event timestamp |

### Events Written

Core functions write feed events as side effects:

- **`entry_pushed`** — when entries are added to a cloud bundle (auto or manual). Payload: project name, entry count, bundle name
- **`session_connected`** — when a session connects to a cloud bundle. Payload: project name, machine ID, bundle name
- **`session_disconnected`** — when a session disconnects. Payload: project name, bundle name
- **`bundle_created`** — when a cloud bundle is created in a team. Payload: bundle name, creator machine ID
- **`bundle_deleted`** — when a cloud bundle is deleted. Payload: bundle name

### API

- `GET /api/teams/:id/feed` — paginated, newest first. Query params: `limit` (default 50), `offset`
- Uses existing team membership auth check

### UI

- **Button** in the top bar (e.g., activity/bell icon) to open the feed panel
- **Slide-out sheet** (same pattern as EntryPanel and QuestionsPanel)
- Vertical timeline, grouped by day, newest first
- Each event shows: timestamp, project name, machine ID, event type, brief content preview
- Clicking an event navigates to the relevant bundle/session in the graph view
- Polls on the existing 30s TanStack Query refresh cycle
- Append-only, no edit/delete

---

## Feature 3: Viral Onboarding (`feat/viral-onboarding`)

Make the first 5 minutes magic. One command to set up, one command to join.

### `ctxl init` Wizard

A single CLI command that handles the full setup:

1. Prompts for bundle name
2. Prompts for mode (local or cloud) and team (if cloud)
3. Creates the bundle
4. Connects the current session to it
5. Installs hooks (copies hook scripts, updates Claude Code `settings.json`)
6. Writes `.ctx-link.json` to the project root
7. Prints a join command for teammates: `ctxl join <short-code>`

If a `.ctx-link.json` already exists, offers to reconnect or create a new bundle.

### Short Join Codes

Replace UUID + token with short, shareable codes.

**Data model (Supabase):**

New table: `bundle_join_codes`

| Column | Type | Description |
|--------|------|-------------|
| `code` | text | Primary key, short alphanumeric (e.g., `ctx-abc123`) |
| `bundle_id` | uuid | FK → bundles |
| `token` | text | The full join token |
| `created_at` | timestamptz | Creation time |
| `expires_at` | timestamptz | Default: created_at + 7 days |

**Behavior:**

- Generated automatically on cloud bundle creation (alongside the existing UUID token)
- Format: `ctx-` prefix + 6 alphanumeric chars (e.g., `ctx-a3f9k2`)
- `ctxl join ctx-a3f9k2` resolves the short code → gets `(bundle_id, token)` → joins the bundle, connects the session, installs hooks
- Codes expire after 7 days by default. Configurable on creation
- `ctxl regenerate-code <bundle_id>` to create a new code (invalidates the old one)
- Cloud bundles only (local bundles don't need shareable codes)

### First-Pull Welcome

When `context_pull` returns entries for the first time in a session:

- MCP response includes a header line: `"Context shared from [project(s)] via ctx-link — [N] entries from [M] sessions"`
- Makes the value immediately visible to Claude and the user
- Only shown once per session (tracked via a flag in the active session file)

---

## What's NOT in Scope

- Q&A system changes (parked, deciding separately)
- E2E encryption for cloud entries
- LLM-powered consolidation (using heuristic approach instead)
- Mobile/responsive UI
- Windows support
- Offline sync queue

---

## Branch Strategy

| Branch | Feature | Dependencies |
|--------|---------|-------------|
| `feat/auto-sync` | Auto-push, auto-pull, consolidation, exclusion list | None |
| `feat/live-feed` | Activity feed table, API, UI panel | None |
| `feat/viral-onboarding` | `ctxl init`, short codes, first-pull welcome | None |

All three are independent. No branch depends on another. Can be built and merged in any order.
