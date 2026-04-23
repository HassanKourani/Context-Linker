# ctx-link — Agent Context

This file gives any AI agent (Claude Code, Copilot, etc.) the full context needed to work on this project.

## What This Project Is

ctx-link connects Claude Code sessions across repositories via shared "context bundles." When you're building a feature that spans multiple repos (e.g., frontend + backend), each Claude Code session only knows about its own project. ctx-link lets sessions share context — so Claude in the frontend repo knows what changed in the backend, and vice versa.

## Architecture

Bun monorepo with 5 packages:

```
packages/
  core/          Shared business logic (bundles, entries, teams, rewind, config, local-store)
  mcp-server/    MCP protocol wrapper (stdio) — Claude Code talks to this
  cli/           CLI tool (`cxtl`) for manual operations
  ui/            React web dashboard — node graph + interactive management
  hooks/         Git post-commit + Claude Code PostToolUse hook scripts (session-log on commit/PR)
supabase/
  migrations/    SQL schema (teams, bundles, sessions, entries, rewind_log)
```

**Key principle:** `core` has NO transport layer. All I/O happens in `mcp-server` (stdio), `cli` (commander), and `ui/server.ts` (HTTP).

## Three Modes

- **off** (default): No linking, no data stored, hooks do nothing
- **local**: Entries stored in `~/.ctx-link/local/<bundle_id>/entries.json`. Same machine only, no network
- **cloud**: Entries stored in Supabase. Cross-machine, requires team membership (name + argon2 password)

## Data Model

```
teams → cloud_sessions → cloud_session_entries
                                    ↳ bundle_entry_refs → bundles
                              ↳ rewind_log (audit trail)
```

- **Team**: access control container. Cloud sessions and bundles require team membership.
- **Session**: independent of bundles. Starts local, promoted to cloud under a team via "Push to Cloud". Has entries.
- **Entry**: lives in a session (single source of truth). Bundles reference entries, not copy them.
- **Bundle**: shared context container. References session entries via `bundle_entry_refs` junction table.
- **Rewind**: soft-delete (sets `superseded_at` on `cloud_session_entries`), never hard-deletes. Audit via `rewind_log`.

## Core Functions (packages/core/src/)

All exported from `@ctx-link/core`:

### Bundles (bundles.ts)
- `createBundle(name, mode?, teamId?)` → `{ bundle_id, name, join_token }`
- `joinBundle(bundleId, token, projectName, mode?)` → `{ bundle_id, name }`
- `deleteBundle(bundleId, mode?)` → void
- `bundleStatus(bundleId, mode?, skipAuth?)` → `{ bundle_id, name, session_count, entry_count, last_entry_at }`
- `listLocalBundles()` → `LocalBundleInfo[]`

### Entries (entries.ts) — Reference Model
- `pullEntries(input)` → `EntryRow[]` — JOINs `bundle_entry_refs` → `cloud_session_entries`, filters rewound
- `addEntriesToBundle(bundleId, entryIds)` → `{ added, skipped }` — creates `bundle_entry_refs`, skips existing
- `removeEntryFromBundle(bundleId, entryId)` → void — removes single ref, entry stays in session
- `getUnpushedEntries(cloudSessionId, bundleId)` → `string[]` — entry IDs not yet referenced by bundle
- `renderEntriesForClaude(entries)` → string (markdown format for LLM context)

### Cloud Sessions (cloud-sessions.ts)
- `pushSessionToCloud(sessionId, teamId)` → `{ cloud_session_id, entries_synced }` — promote local session to cloud
- `syncNewEntries(session)` → number — sync local entries not yet in cloud
- `syncEntryToCloud(session, entry)` → void — sync single entry
- `deleteCloudSession(cloudSessionId)` → void — cascades entries → bundle refs
- `deleteCloudSessionEntry(entryId)` → void — cascades bundle refs
- `listTeamSessions(teamId)` → `CloudSession[]`
- `getCloudSessionEntries(cloudSessionId)` → `CloudSessionEntry[]`
- `getEntryBundleRefs(entryId)` → `{ bundle_id, added_at }[]`

### Rewind (rewind.ts)
- `rewindProject(input)` → `RewindResult` — strategies: since, last_n, entry_ids, after_ref
- `restoreRewound(input)` → `RestoreResult`
- `listRewinds(bundleId, projectName?, limit?)` → `RewindLogRow[]`

### Teams (teams.ts)
- `createTeam(name, password)` → `{ team_id, name }`
- `joinTeam(name, password)` → `{ team_id, name }`
- `listMyTeams()` → `TeamInfo[]`
- `listTeamBundles(teamId)` → `TeamBundleInfo[]`
- `assertTeamMember(teamId)` / `assertBundleTeamAccess(bundleId)`

### Config (config.ts)
- `loadGlobalConfig()` → `{ machine_id }` (auto-creates on first use)
- `loadProjectConfig(cwd?)` → `ProjectConfig | null`
- `getBundleToken(bundleId)` / `storeBundleToken(bundleId, token, name)`
- `loadSessionLog()` / `logSession(entry)` — session history across projects
- `listActiveSessions()` → active Claude Code sessions from `~/.ctx-link/active-sessions/`
- `pushSessionEntry(sessionId, entry)` / `getSessionEntries(sessionId)` — per-session entry log
- `getUnpushedSessionEntries(sessionId)` — entries not yet pushed
- `deleteSessionEntry(sessionId, entryId)` — remove entry from session log

### Local Store (local-store.ts) — Reference Model
- Mirrors cloud functions for `mode: "local"`: `localCreateBundle`, `localJoinBundle`, `localPullEntries`, etc.
- `localAddEntriesToBundle(bundleId, entryIds, sessionId)` → `{ added, skipped }` — creates refs in `entry_refs.json`
- `localRemoveEntryFromBundle(bundleId, entryId)` → removes single ref
- `listAllLocalBundleDetails()` → bundle + project list derived from refs
- Local bundles use `entry_refs.json` (references to session entries) instead of copying entries

## UI Architecture (packages/ui/)

### Tech Stack
- React 19 + TypeScript + Vite
- @xyflow/react v12 (React Flow) for the node graph
- dagre for auto-layout (left-to-right)
- TanStack Query v5 for data fetching + 30s auto-refresh
- Zustand for UI state (panels, modals, selections)
- shadcn/ui (base-ui variant, NOT Radix) for dialogs, sheets, buttons
- sonner for toast notifications
- Tailwind CSS v4 with Catppuccin Mocha dark theme

### Graph Structure
- **TeamGroupNode**: dashed container with colored border, wraps children
- **ProjectNode**: card with project name header + session rows. Each session row has a draggable handle for connecting to bundles
- **BundleNode**: card with name, entry count, last activity. Click to open entry panel. Dropdown menu with delete.
- **DeletableEdge**: bezier edge from session handle → bundle. Turns red on hover, shows X delete button.

### API Proxy (server.ts, port 5174)
All data goes through a Bun HTTP server that imports `@ctx-link/core`. The browser never talks to Supabase directly. Vite proxies `/api/*` to port 5174.

Endpoints:
- `GET /api/graph` — full graph data (teams + bundles + sessions + active sessions)
- `GET/POST /api/teams` — list, create teams
- `POST /api/teams/join` — join team
- `POST /api/bundles` — create bundle
- `DELETE /api/bundles/:id` — delete bundle
- `POST /api/bundles/:id/join` — link project to bundle
- `GET /api/bundles/:id/entries` — fetch entries via refs
- `DELETE /api/bundles/:id/entries/:entryId` — remove entry ref from bundle (entry stays in session)
- `POST /api/bundles/:id/rewind` — rewind entries
- `POST /api/bundles/:id/restore` — restore entries
- `GET /api/bundles/:id/rewinds` — rewind history
- `POST /api/unlink-session` — remove session link (local or cloud)
- `GET /api/sessions/:id/entries` — get entries for a session
- `DELETE /api/sessions/:id` — delete active session + cloud session
- `POST /api/sessions/:id/connect` — connect active session to a bundle
- `POST /api/sessions/:id/push-to-bundle` — add session entry refs to bundle (no copying)
- `POST /api/sessions/:id/push-to-cloud` — promote local session to cloud under a team
- `DELETE /api/sessions/:id/entries/:entryId` — delete session entry (cascades to bundle refs)
- `GET /api/teams/:id/sessions` — list cloud sessions for a team

### Mutation Hooks (optimistic updates)
All write operations use TanStack Query mutations with optimistic updates:
- `useCreateBundle` — adds bundle to graph
- `useJoinBundle` — instantly adds edge
- `useDeleteBundle` — instantly removes bundle node
- `useDeleteSession` — instantly removes edge from graph
- `useConnectSession` — connects active session to bundle
- `usePushSessionToBundle` — adds session entry refs to bundle
- `usePushToCloud` — promotes session to cloud under a team
- `useRemoveBundleEntryRef` — removes entry ref from bundle
- `useRewind` / `useRestore` — instantly removes/restores entries from list
- `useDeleteSessionEntry` — removes entry from session log
- `useCreateTeam` / `useJoinTeam` — team management
All roll back on error and refetch on settle.

### State Store (Zustand)
```typescript
{
  panel,                  // { type: "bundle"|"session", id, mode?, tab }
  activeModal,            // which dialog is open
  deleteBundleTarget,     // bundle pending deletion confirmation
  selectedEntryIds,       // entry checkboxes (for rewind)
  hoveredEdgeId,          // edge delete hover
  hideEmptySessions,      // graph filter toggle
}
```

## Local Storage Layout

```
~/.ctx-link/
  config.json          { machine_id } (auto-generated, stable)
  tokens.json          { [bundleId]: { token, name, joined_at } }
  teams.json           { [teamId]: { team_id, name, joined_at } }
  sessions.json        Array of session log entries
  active-sessions/     One JSON per live Claude Code session
  session-entries/     Per-session entry logs
    <session_id>.json  Array of accumulated entries for that session
  local/               Local bundles
    <bundle_id>/
      meta.json        { id, name, created_at }
      entry_refs.json  Array of { entry_id, session_id, added_at } references
```

## Supabase Schema

Tables: `teams`, `team_members`, `bundles`, `cloud_sessions`, `cloud_session_entries`, `bundle_entry_refs`, `rewind_log`

Migrations: 0001_init (core tables), 0002_rewind (soft-delete + audit), 0003_teams (access control), 0004_source_entries (legacy), 0005_cloud_sessions (reference model)

- `cloud_sessions` are independent of bundles, owned by a team
- `cloud_session_entries` are the single source of truth for entries (owned by session, CASCADE delete)
- `bundle_entry_refs` is a junction table — bundles reference entries, not copy them (CASCADE delete both ways)
- `cloud_session_entries.superseded_at` for soft-delete (rewind)
- Delete entry from session → cascades to all bundle refs
- Delete bundle → cascades refs only (session entries survive)
- Teams use argon2 password hashing
- Service role key is hardcoded (shared backend, app-level auth)

## Development

```bash
bun install                    # install all workspace deps
bun run typecheck              # typecheck all 5 packages
bun run dev:ui-api             # start API proxy (port 5174)
bun run dev:ui                 # start Vite dev server (port 5173)
bun run dev:mcp                # start MCP server (watch mode)
bun run cli -- <args>          # run CLI
```

## Important Patterns

- **No `asChild` prop** — shadcn/ui in this project uses `@base-ui/react`, not Radix. Use `render` prop for composition.
- **Edge interaction** — React Flow's pane layer intercepts clicks. Use `onPointerDown` (not `onClick`) for buttons in `EdgeLabelRenderer`. Set `zIndex: 1000`.
- **Sessions are local-first** — sessions start as local files in `~/.ctx-link/active-sessions/`. "Push to Cloud" promotes them under a team to Supabase. Future entries auto-sync.
- **Entries are the source of truth** — entries live in sessions. Bundles reference them via `bundle_entry_refs`. Delete from session → cascades to all bundles. Remove from bundle → only removes the ref.
- **No entry copying** — `addEntriesToBundle` creates references, not copies. `localAddEntriesToBundle` creates refs in `entry_refs.json`.
- **`@/` alias** — resolves to `packages/ui/src/` (tsconfig paths + vite alias).
- **Optimistic updates** — mutations snapshot cache in `onMutate`, roll back in `onError`, refetch in `onSettled`.
- **Mode is server-resolved** — UI API endpoints operating on existing bundles do NOT require `mode`. The server checks `isLocalBundle(bundleId)` to determine local vs cloud. Only `POST /api/bundles` (create) takes `mode` since the bundle doesn't exist yet.
- **Local and cloud behave identically** — same user-facing behavior for connect, disconnect, delete, push. Only the storage backend differs.
- **Interactive CLI** — CLI commands prompt for options when flags aren't provided (mode, team, bundle, strategy, etc.) via `@inquirer/prompts`. Flags still work for scripting. `connect` and `join` auto-detect mode via `isLocalBundle()`.
