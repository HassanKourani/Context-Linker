# API Reference

The UI API proxy runs at `localhost:5174` via `bun packages/ui/server.ts`. Vite proxies `/api/*` from port 5173.

All responses include CORS headers for `http://localhost:5173`. Errors return `{ error: string }` with status 500.

## Graph

### GET /api/graph

Returns the complete graph data for rendering.

**Response:**
```json
{
  "machine_id": "a3pv705r5afp",
  "teams": [{
    "team_id": "uuid",
    "team_name": "dev-team",
    "bundles": [{
      "bundle_id": "uuid",
      "bundle_name": "feature-xyz",
      "entry_count": 12,
      "last_entry_at": "2026-04-22T10:00:00Z",
      "sessions": [{
        "session_id": "uuid",
        "project_name": "frontend",
        "machine_id": "a3pv705r5afp",
        "last_active_at": "2026-04-22T10:00:00Z"
      }]
    }]
  }],
  "local": {
    "bundles": [{
      "bundle_id": "uuid",
      "bundle_name": "local-test",
      "entry_count": 3,
      "last_entry_at": "2026-04-22T09:00:00Z",
      "projects": [{
        "project_name": "my-app",
        "last_entry_at": "2026-04-22T09:00:00Z"
      }]
    }]
  },
  "sessions": [{
    "session_id": "uuid",
    "project_name": "ctx-link",
    "project_path": "/path/to/project",
    "bundles": [{ "bundle_id": "uuid", "mode": "cloud" }],
    "started_at": "2026-04-22T08:00:00Z",
    "branch": "main"
  }]
}
```

## Teams

### GET /api/teams
Returns teams the current machine has joined.

### POST /api/teams
Create a new team. Body: `{ name: string, password: string }`

### POST /api/teams/join
Join an existing team. Body: `{ name: string, password: string }`

## Bundles

### POST /api/bundles
Create a bundle. Body: `{ name: string, mode: "local" | "cloud", team_id?: string }`

### DELETE /api/bundles/:id
Delete a bundle permanently. Mode is resolved server-side.

### POST /api/bundles/:id/join
Link a project to a bundle. Body: `{ project_name: string }`

Mode is resolved server-side. Also pushes a placeholder entry to establish the project in the bundle.

## Entries

### GET /api/bundles/:id/entries?limit=&since=&exclude_project=
Pull entries from a bundle. Mode is resolved server-side.

### POST /api/bundles/:id/entries
Push a manual entry. Body:
```json
{
  "project_name": "string",
  "event_type": "commit | pr_open | manual | session_end",
  "summary": "string",
  "files_touched": ["string"],
  "decisions": [{ "decision": "string", "affects": ["string"] }]
}
```

## Rewind / Restore

### POST /api/bundles/:id/rewind
Soft-delete entries. Body:
```json
{
  "project_name": "string",
  "strategy": { "kind": "entry_ids", "ids": ["uuid", "uuid"] },
  "reason": "optional string",
  "dry_run": false,
  "force": false
}
```

Strategies: `{ kind: "since", since: "ISO" }`, `{ kind: "last_n", count: N }`, `{ kind: "entry_ids", ids: [...] }`, `{ kind: "after_ref", trigger_ref: "sha" }`

### POST /api/bundles/:id/restore
Restore rewound entries. Body:
```json
{
  "project_name": "string",
  "rewind_log_id": "uuid"
}
```

### GET /api/bundles/:id/rewinds?project_name=&limit=
List rewind history.

## Sessions

### POST /api/unlink-session
Remove a session's connection to a bundle. Body:
```json
{
  "session_id": "string",
  "bundle_id": "string"
}
```

Removes the bundle from the active session's bundles array. Same behavior for local and cloud — only the link is removed, session and entries are preserved.

### DELETE /api/sessions/:id
Delete an active session and its accumulated context entries.

### GET /api/sessions
List active Claude Code sessions (from `~/.ctx-link/active-sessions/`).
