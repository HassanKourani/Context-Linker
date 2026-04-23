# Architecture

## System Overview

```
Claude Code (Project A)
    │
    │ git commit / ask Claude
    ▼
PostToolUse hook / MCP tool
    │
    │ ctx-link push
    ▼
Bundle (shared context)
    │
    │  local → ~/.ctx-link/local/<id>/entries.json
    │  cloud → Supabase (teams, bundles, sessions, entries)
    ▼
Claude Code (Project B)
    │
    │ ctx-link pull / ask Claude
    ▼
Claude sees what Project A did
```

## Package Dependency Graph

```
packages/cli ────────────────→ @ctx-link/core
packages/mcp-server ─────────→ @ctx-link/core
packages/ui/server.ts ───────→ @ctx-link/core
packages/ui/src/ (browser) ──→ (no core import — types only, defined locally)
```

The browser code NEVER imports from `@ctx-link/core`. All data flows through the HTTP API proxy (`server.ts` on port 5174). This keeps the browser bundle free of Node.js dependencies (argon2, fs, etc.).

## Data Model

```
teams
  ├── id (uuid)
  ├── name (unique)
  ├── password_hash (argon2)
  └── created_by (machine_id)

team_members
  ├── team_id → teams
  └── machine_id

bundles
  ├── id (uuid)
  ├── name
  ├── team_id → teams (cloud only)
  └── created_by

sessions (one per project-machine-bundle)
  ├── id (uuid)
  ├── bundle_id → bundles (CASCADE)
  ├── project_name
  ├── machine_id
  └── last_active_at

entries (the context handoff notes)
  ├── id (uuid)
  ├── bundle_id → bundles (CASCADE)
  ├── session_id → sessions (SET NULL)
  ├── event_type (commit | pr_open | manual | session_end)
  ├── trigger_ref (commit SHA, PR#)
  ├── summary (Claude-generated)
  ├── files_touched (text[])
  ├── decisions (jsonb)
  ├── superseded_at (soft-delete for rewind)
  └── superseded_reason

rewind_log (audit trail)
  ├── bundle_id, project_name
  ├── strategy_kind, strategy_detail
  ├── affected_entry_ids, affected_count
  ├── reason, performed_by
  └── performed_at
```

### Key Relationships
- Deleting a **bundle** cascades to sessions and entries
- Deleting a **session** (unlinking) sets entries' session_id to NULL — entries survive
- **Rewind** soft-deletes entries (sets superseded_at), never hard-deletes
- **Restore** clears superseded_at

## UI Architecture

```
Browser (localhost:5173)
  │
  │ fetch("/api/graph")
  │ fetch("/api/bundles/:id/entries")
  │ POST("/api/unlink-session")
  │ etc.
  ▼
Vite proxy → /api/* → localhost:5174
  │
  ▼
server.ts (Bun.serve)
  │
  │ imports @ctx-link/core
  ▼
Core functions → Supabase / local filesystem
```

### React Flow Graph

```
╔══ Team Group ═══════════════════════╗
║                                     ║
║  [ProjectNode]     [BundleNode]     ║
║  ├─ session ─────→ name             ║
║  ├─ session ──┐    entry count      ║
║  └─ +         │    last activity    ║
║               │                     ║
║  [ProjectNode]│                     ║
║  ├─ session ──┘                     ║
║                                     ║
╚═════════════════════════════════════╝
```

- **TeamGroupNode**: dashed border container, colored by team name hash
- **ProjectNode**: lists session rows with draggable handles (source)
- **BundleNode**: target handle, click opens entry panel, dropdown for delete
- **DeletableEdge**: bezier curve, red + X button on hover

### State Management

- **TanStack Query**: server state (graph data, entries, rewinds, teams). 30s auto-refresh.
- **Zustand**: UI state (selected bundle, active modal, entry selection, hovered edge).
- **Optimistic updates**: mutations update cache immediately, roll back on error.

## Security Model

- **Cloud bundles**: gated by team membership (argon2 password hash)
- **Local bundles**: filesystem access only (no auth)
- **Service role key**: hardcoded in supabase.ts (shared backend for all users)
- **API proxy**: binds to 127.0.0.1 only, CORS restricted to localhost:5173
- **Summaries**: plaintext in Supabase (E2E encryption is future work)
