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
teams → bundles → sessions → entries
                              ↳ rewind_log (audit trail)
```

- **Team**: access control container. Cloud bundles require team membership.
- **Bundle**: shared context container. Has entries + sessions.
- **Session**: (bundle, project, machine) tuple. The link between a project and a bundle.
- **Entry**: a context handoff note — summary, files touched, decisions, event type.
- **Rewind**: soft-delete (sets `superseded_at`), never hard-deletes. Audit via `rewind_log`.

## Core Functions (packages/core/src/)

All exported from `@ctx-link/core`:

### Bundles (bundles.ts)
- `createBundle(name, mode?, teamId?)` → `{ bundle_id, name, join_token }`
- `joinBundle(bundleId, token, projectName, mode?)` → `{ bundle_id, name }`
- `deleteBundle(bundleId, mode?)` → void
- `bundleStatus(bundleId, mode?, skipAuth?)` → `{ bundle_id, name, session_count, entry_count, last_entry_at }`
- `listBundleSessions(bundleId, skipAuth?)` → `SessionInfo[]`
- `deleteSession(sessionId)` → void (removes session row only, keeps entries)
- `listLocalBundles()` → `LocalBundleInfo[]`

### Entries (entries.ts)
- `pushEntry(input)` → `PushResult` — auto-creates/updates session. Also saves to active session's entry log if one exists.
- `pullEntries(input)` → `EntryRow[]` — filters by since/limit/project, hides rewound
- `renderEntriesForClaude(entries)` → string (markdown format for LLM context)
- `removeSourceEntry(bundleId, entryId, sourceEntryId)` → void — removes a source entry from a consolidated entry

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
- `getUnpushedSessionEntries(sessionId)` / `markSessionEntriesPushed(sessionId, entryIds)`
- `deleteSessionEntry(sessionId, entryId)` — remove entry from session log

### Local Store (local-store.ts)
- Mirrors cloud functions for `mode: "local"`: `localCreateBundle`, `localJoinBundle`, `localPushEntry`, `localPullEntries`, etc.
- `listAllLocalBundleDetails()` → bundle + project list derived from entries
- `localDeleteProjectFromBundle(bundleId, projectName)` → removes entries for a project
- `localRemoveSourceEntry(bundleId, entryId, sourceEntryId)` → remove source from consolidated entry

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
- `GET/POST /api/bundles/:id/entries` — fetch/push entries
- `POST /api/bundles/:id/rewind` — rewind entries
- `POST /api/bundles/:id/restore` — restore entries
- `GET /api/bundles/:id/rewinds` — rewind history
- `POST /api/unlink-session` — remove session link (local or cloud)
- `GET /api/sessions/:id/entries` — get entries for a session
- `DELETE /api/sessions/:id` — delete active session + its context entries
- `POST /api/sessions/:id/connect` — connect active session to a bundle
- `POST /api/sessions/:id/push-to-bundle` — consolidate session entries and push to bundle
- `DELETE /api/sessions/:id/entries/:entryId` — delete a single session entry

### Mutation Hooks (optimistic updates)
All write operations use TanStack Query mutations with optimistic updates:
- `useCreateBundle` — adds bundle to graph
- `useJoinBundle` — instantly adds edge
- `useDeleteBundle` — instantly removes bundle node
- `useDeleteSession` — instantly removes edge from graph
- `useConnectSession` — connects active session to bundle
- `usePushEntry` — instantly prepends entry to timeline
- `usePushSessionToBundle` — consolidates session entries and pushes to bundle
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
      entries.json     Array of entries
```

## Supabase Schema

Tables: `teams`, `team_members`, `bundles`, `sessions`, `entries`, `rewind_log`

Migrations: 0001_init (core tables), 0002_rewind (soft-delete + audit), 0003_teams (access control), 0004_source_entries (consolidation tracking)

- Entries have `superseded_at` for soft-delete (rewind)
- Entries have `source_entries` (jsonb) for tracking consolidated session entries
- Sessions have `ON DELETE CASCADE` from bundles
- Entries have `ON DELETE SET NULL` from sessions (entries survive session removal)
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
- **Local bundle "sessions"** — local bundles derive project lists from entries, not sessions. Joining a local bundle pushes a placeholder entry.
- **`@/` alias** — resolves to `packages/ui/src/` (tsconfig paths + vite alias).
- **Optimistic updates** — mutations snapshot cache in `onMutate`, roll back in `onError`, refetch in `onSettled`.
- **Mode is server-resolved** — UI API endpoints operating on existing bundles do NOT require `mode`. The server checks `isLocalBundle(bundleId)` to determine local vs cloud. Only `POST /api/bundles` (create) takes `mode` since the bundle doesn't exist yet.
- **Local and cloud behave identically** — same user-facing behavior for connect, disconnect, delete, push. Only the storage backend differs.
- **Every push saves to the active session** — `pushEntry` and `localPushEntry` both auto-save to `~/.ctx-link/session-entries/{session_id}.json` if an active session exists (via `.cxtl-active-session` marker). This means clicking a session in the UI shows all context accumulated during that session.
- **Interactive CLI** — CLI commands prompt for options when flags aren't provided (mode, team, bundle, strategy, etc.) via `@inquirer/prompts`. Flags still work for scripting. `connect` and `join` auto-detect mode via `isLocalBundle()`.
