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
  cli/           CLI tool (`ctxl`) for manual operations
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
- `generateJoinToken()` → string
- `assertTokenValid(bundleId)` → void (throws if token invalid)
- `getBundleTeamId(bundleId)` → `string | null`

### Entries (entries.ts) — Reference Model
- `pullEntries(input)` → `EntryRow[]` — JOINs `bundle_entry_refs` → `cloud_session_entries`, filters rewound
- `addEntriesToBundle(bundleId, entryIds)` → `{ added, skipped }` — creates `bundle_entry_refs`, skips existing
- `removeEntryFromBundle(bundleId, entryId)` → void — removes single ref, entry stays in session
- `removeSessionEntriesFromBundle(bundleId, cloudSessionId)` → void — removes all refs for a cloud session from bundle
- `getUnpushedEntries(cloudSessionId, bundleId)` → `string[]` — entry IDs not yet referenced by bundle
- `renderEntriesForClaude(entries)` → string (markdown format for LLM context)

### Cloud Sessions (cloud-sessions.ts)
- `copySessionToCloud(sessionId, teamId)` → `{ cloud_session_id, entries_copied }` — create independent cloud copy of local session
- `syncSessionToCloud(sessionId, cloudSessionId)` → `{ entries_synced }` — sync new local entries to existing cloud session
- `getCloudSession(cloudSessionId)` → `CloudSession | null` — get single cloud session by ID
- `deleteCloudSession(cloudSessionId)` → void — cascades entries → bundle refs
- `deleteCloudSessionEntry(entryId)` → void — cascades bundle refs
- `renameCloudSession(cloudSessionId, name)` → void — rename cloud session
- `listTeamSessions(teamId)` → `CloudSession[]`
- `getCloudSessionEntries(cloudSessionId)` → `CloudSessionEntry[]`
- `getEntryBundleRefs(entryId)` → `{ bundle_id, added_at }[]`
- `getCloudSessionBundleIds(cloudSessionId)` → `string[]` — get bundle IDs referencing session entries

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
- `loadGlobalConfig()` / `saveGlobalConfig(cfg)` — read/write `{ machine_id }` (auto-creates on first use)
- `loadProjectConfig(cwd?)` / `saveProjectConfig(config, cwd?)` — per-project `.ctx-link.json`
- `getBundleToken(bundleId)` / `storeBundleToken(bundleId, token, name)`
- `loadSessionLog()` / `logSession(entry)` — session history across projects
- `listActiveSessions()` → active Claude Code sessions from `~/.ctx-link/active-sessions/`
- `loadActiveSession(sessionId)` / `saveActiveSession(session)` / `deleteActiveSession(sessionId)` / `renameActiveSession(sessionId, name)` — active session CRUD
- `getActiveSessionId(cwd?)` / `setActiveSessionId(sessionId, cwd?)` — per-project active session tracking
- `connectSessionToBundle(sessionId, bundleId)` / `disconnectSessionFromBundle(sessionId, bundleId)` — local session-bundle connection
- `connectCloudSessionToBundle(cloudSessionId, bundleId)` / `disconnectCloudSessionFromBundle(cloudSessionId, bundleId)` — cloud session-bundle connection
- `getCloudSessionBundleConnections(sessionId)` → cloud bundle connections for a session
- `pushSessionEntry(sessionId, entry)` / `getSessionEntries(sessionId)` — per-session entry log
- `getUnpushedSessionEntries(sessionId)` — entries not yet pushed
- `markSessionEntriesPushed(sessionId, entryIds)` — mark entries as pushed
- `deleteSessionEntry(sessionId, entryId)` — remove entry from session log

### Local Store (local-store.ts) — Reference Model
- `isLocalBundle(bundleId)` → boolean — check if bundle exists locally
- `localCreateBundle(name)` / `localJoinBundle(bundleId)` / `localDeleteBundle(bundleId)` — CRUD
- `localBundleStatus(bundleId)` → `BundleStatus`
- `localPullEntries(input)` → `EntryRow[]` — pull entries via local refs
- `localAddEntriesToBundle(bundleId, entryIds, sessionId)` → `{ added, skipped }` — creates refs in `entry_refs.json`
- `localRemoveEntryFromBundle(bundleId, entryId)` → removes single ref
- `localRemoveSessionRefsFromBundle(bundleId, sessionId)` → remove all refs for a session
- `localRemoveEntryRefsFromBundleByIds(bundleId, entryIds)` → remove refs by entry IDs
- `localRewindProject(input)` → `RewindResult` / `localRestoreRewound(input)` → `RestoreResult` / `localListRewinds(bundleId, projectName?, limit?)` → `RewindLogRow[]`
- `getLocalBundleIdsForSession(sessionId)` → `string[]` — get bundles a session is linked to
- `listAllLocalBundleDetails()` → bundle + project list derived from refs
- Local bundles use `entry_refs.json` (references to session entries) instead of copying entries

### Questions (questions.ts)
- `readQuestions(bundleId)` → `Question[]` — read all questions for a local bundle
- `askQuestion(input)` → `Question` — create a new question on a bundle
- `answerQuestion(input)` → `Answer` — answer an existing question
- `resolveQuestion(bundleId, questionId)` → void — mark question as resolved
- `listBundleQuestions(bundleId, status?, targetProject?)` → `Question[]` — filtered list
- `getQuestion(bundleId, questionId)` → `Question | undefined`
- `countOpenQuestions(bundleId)` → number

## MCP Tools (packages/mcp-server/)

The MCP server exposes 31 tools that Claude Code calls via stdio. All tools auto-detect local vs cloud mode.

### Bundle Tools
- `bundle_create` — create a bundle (local or cloud). Pass `mode: "cloud"` + `team_id` for cloud bundles
- `bundle_join` — join a bundle by ID + token
- `bundle_list` — list all bundles: local on this machine + cloud from joined teams
- `bundle_status` — entry count, last activity, linked sessions
- `bundle_delete` — permanently delete a bundle (cascade-deletes refs)
- `bundle_remove_entry` — remove a single entry ref from a bundle (entry stays in session)
- `bundle_entries` — list all entries in a bundle unfiltered (no cross-project exclusion, unlike context_pull)
- `bundle_pull_from_sessions` — pull entries from ALL sessions connected to a bundle in one shot
- `bundle_push_to_cloud` — migrate a local bundle to cloud under a team (creates cloud bundle, migrates refs, deletes local)
- `bundle_ask_question` — LAST RESORT: ask a question on a bundle after exhausting entries + code. Local bundles only
- `bundle_answer_question` — answer a question in a bundle. PROACTIVE USE on notifications
- `bundle_questions` — list questions for a bundle, filtered by status/project

### Context Tools
- `context_push` — push session entries to connected bundles as refs. Optional `summary` creates a new entry first. Optional `bundle_id` targets one bundle (default: all connected)
- `context_pull` — pull entries from a bundle. Proactive use recommended at session start. Also appends open questions for your project
- `context_rewind` — soft-delete entries by project using strategy (since, last_n, entry_ids, after_ref). Supports `dry_run`
- `context_restore` — undo a rewind, restore soft-deleted entries
- `rewind_history` — list past rewinds for a bundle

### Session Tools
- `session_start` — create or resume a session for the current project. Auto-detects project name and branch. Generates UUID if no session_id provided
- `session_info` — current session: project, branch, connected bundles, pending entries
- `session_log` — log a context entry to the session (local only, not pushed to bundles). Proactive use recommended after meaningful interactions
- `session_entries` — list accumulated entries (all or only unpushed)
- `session_connect` — connect session to a bundle. Existing entries auto-added as refs
- `session_disconnect` — disconnect session from a bundle
- `session_push_to_cloud` — copy session to cloud under a team. Future entries auto-sync
- `session_push_to_bundle` — push entries to a specific bundle. Omit `bundle_id` for discovery mode (lists available teams + bundles)
- `session_rename` — rename current session (also renames cloud copies)
- `session_delete` — delete a session and all cloud copies (cascade-deletes entries + bundle refs)
- `session_delete_entry` — delete a specific entry from the session (cascades to cloud + bundle refs)
- `session_list` — list all active sessions across all projects on this machine

### Team Tools
- `team_create` — create a team with name + password (argon2 hashed)
- `team_join` — join a team by name + password

## CLI Commands (packages/cli/)

The CLI (`ctxl`) supports 29 commands. All commands prompt interactively when flags are omitted (via `@inquirer/prompts`).

### Team Commands
- `create-team` — create a team
- `join-team` — join a team
- `my-teams` — list teams you belong to
- `team-bundles` — list bundles in a team

### Session Commands
- `info` — show current project config
- `session-start` — start/resume a session for the current project
- `sessions` — list active sessions
- `session-log` — log a context entry
- `session-entries` — list session entries
- `push-to-cloud` — push session to cloud under a team
- `connect` — connect session to a bundle
- `disconnect` — disconnect session from a bundle

### Bundle Commands
- `create` — create a bundle (local or cloud)
- `join` — join a bundle by ID + token
- `my-bundles` — list bundles
- `status` — show bundle status
- `push` — push session entries to connected bundles
- `push-to-bundle` — push entries to a specific bundle (discovery mode available)
- `pull [bundle_id]` — pull entries from a bundle
- `rewind` — soft-delete entries by strategy
- `restore` — undo a rewind
- `rewind-history` — list rewind history
- `leave` — leave a bundle
- `delete-bundle` — permanently delete a bundle

### Question Commands
- `ask` — ask a question on a bundle, optionally targeting a project
- `answer` — answer an open question
- `questions` — list questions by status and target project

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
- `GET /api/teams` — list teams
- `POST /api/teams` — create team
- `POST /api/teams/join` — join team
- `GET /api/teams/:id/sessions` — list cloud sessions for a team
- `POST /api/bundles` — create bundle (local or cloud)
- `DELETE /api/bundles/:id` — delete bundle (disconnects all sessions first)
- `POST /api/bundles/:id/join` — link project to bundle
- `GET /api/bundles/:id/entries` — fetch entries via refs
- `DELETE /api/bundles/:id/entries/:entryId` — remove entry ref from bundle (entry stays in session)
- `POST /api/bundles/:id/rewind` — rewind entries
- `POST /api/bundles/:id/restore` — restore entries
- `GET /api/bundles/:id/rewinds` — rewind history
- `POST /api/bundles/:id/pull-from-sessions` — pull entries from ALL connected sessions into bundle
- `POST /api/bundles/:id/push-to-cloud` — migrate local bundle to cloud under a team
- `GET /api/sessions` — list active sessions
- `GET /api/sessions/:id/entries` — get entries for a session (local or cloud)
- `POST /api/sessions/:id/entries` — create/log an entry to a session
- `DELETE /api/sessions/:id` — delete active session + all cloud copies
- `POST /api/sessions/:id/connect` — connect session to a bundle
- `POST /api/sessions/:id/push-to-bundle` — add session entry refs to bundle (no copying)
- `POST /api/sessions/:id/copy-to-cloud` — create independent cloud copy of session under a team
- `POST /api/sessions/:id/sync-to-cloud` — sync new local entries to existing cloud copy
- `PATCH /api/sessions/:id/rename` — rename a session (also renames cloud copies)
- `DELETE /api/sessions/:id/entries/:entryId` — delete session entry (cascades to cloud + bundle refs)
- `POST /api/unlink-session` — remove session link from bundle (removes entry refs, disconnects)
- `GET /api/bundles/:id/questions` — list questions for a bundle (filter: `status`, `target_project`)
- `POST /api/bundles/:id/questions` — create a question
- `POST /api/bundles/:id/questions/:qid/answer` — answer a question
- `POST /api/bundles/:id/questions/:qid/resolve` — mark question resolved

### Mutation Hooks (optimistic updates)
All write operations use TanStack Query mutations with optimistic updates. All roll back on error and refetch on settle.

**Bundle mutations:**
- `useCreateBundle` — adds bundle to graph
- `useDeleteBundle` — instantly removes bundle node
- `useJoinBundle` — instantly adds edge
- `useRemoveBundleEntryRef` — removes entry ref from bundle
- `usePullFromSessions` — pulls entries from all connected sessions into bundle
- `usePushBundleToCloud` — migrates local bundle to cloud under a team

**Session mutations:**
- `useConnectSession` — connects active session to bundle
- `useDeleteSession` — unlinks session from bundle (removes entry refs + disconnects)
- `useDeleteActiveSession` — deletes session and all cloud copies
- `useDeleteSessionEntry` — removes entry from session log
- `usePushSessionToBundle` — adds session entry refs to bundle
- `usePushToCloud` — creates independent cloud copy of session under a team
- `useSyncToCloud` — syncs new local entries to existing cloud copy
- `useRenameSession` — renames session (also renames cloud copies)

**Rewind mutations:**
- `useRewind` / `useRestore` — instantly removes/restores entries from list

**Team mutations:**
- `useCreateTeam` / `useJoinTeam` — team management

**Q&A mutations:**
- `useResolveQuestion` — marks a question as resolved

### State Store (Zustand)
```typescript
{
  panel,                  // { kind: "bundle", ... } | { kind: "session", ... } | { kind: "questions", bundleId, bundleName } | null
  panelTab,              // "entries" | "rewinds"
  activeModal,           // "create-bundle" | "delete-bundle" | "team-management" | "push-entry" | "push-session" | "push-to-cloud" | "push-to-cloud-prompt" | "connect-and-push" | "rewind" | "edge-action" | "push-bundle-to-cloud" | null
  deleteBundleTarget,    // { id, name } — bundle pending deletion confirmation
  selectedEntryIds,      // Set<string> — entry checkboxes (for rewind)
  pushToCloudTarget,     // session ID pending push-to-cloud
  pendingCloudConnect,   // { sessionId, bundleId } — connect after push-to-cloud completes
  pendingConnectPush,    // { sessionId, bundleId } — connect-and-push flow (drag session → bundle)
  hoveredEdgeId,         // edge hover state
  pendingEdgeAction,     // { sessionId, bundleId, action: "push"|"unlink" } — edge action confirmation
  pushBundleToCloudTarget, // { id, name } — local bundle pending cloud migration
  hideEmptySessions,     // graph filter toggle (persisted to localStorage)
  hideEmptyQuestions,    // Q&A filter toggle (persisted to localStorage)
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

## Bundle Q&A (packages/core/src/questions.ts)

Cross-session Q&A attached to local bundles. Questions are stored in `~/.ctx-link/local/<bundle_id>/questions.json`.

### Question Priority Chain
Questions are a **last resort**. Before asking, the agent MUST: (1) read all bundle entries, (2) examine the relevant code. Only ask for things code can't explain — intent, timeline, whether something is intentional vs WIP.

### Data Model
- `Question`: id, bundle_id, asked_by_session_id, asked_by_project, target_project, question, context, status (open/answered/resolved), answers[]
- `Answer`: id, question_id, answered_by_session_id, answered_by_project, answer, created_at
- All IDs are UUIDs (cloud-ready)

### Cross-Session Channel (packages/mcp-server/src/channel.ts)
Each MCP server opens an HTTP listener on a random port (saved to `channel_port` in active session file). When a question is asked or answered, it broadcasts to other sessions connected to the same bundle via HTTP POST. Receiving sessions push notifications to Claude Code via `server.sendLoggingMessage()`. Fallback: if channel delivery fails, questions surface on next `context_pull`.

### UI
- BundleNode shows amber question count badge (top-right) when open questions exist
- Click badge opens QuestionsPanel (sheet slide-out with All/Open/Resolved tabs)
- QuestionThread cards show threaded Q&A with status badges and loading states
