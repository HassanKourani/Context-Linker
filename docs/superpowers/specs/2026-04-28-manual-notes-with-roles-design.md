# Manual Notes with Agent Roles — Design

**Date:** 2026-04-28
**Goal:** Let humans (and agents) attach manual notes to a bundle that don't require a project session, tagged with a role so consumers read each note with the right intent.

---

## Motivation

Today, a manual note added from the UI must be hosted in an existing project session. The "Add Note" dialog forces the user to pick a project, and creation fails if no session exists for that project. This makes the bundle (the natural unit of cross-repo context) the wrong place to attach things like:

- The ticket description / scope anchor
- A failed QA report
- A design spec or constraint hand-off
- An ADR-style decision the agent should respect

Notes also need a `role` so agents can read them in priority order — e.g. tickets first to anchor scope, constraints next to know what not to touch, QA/bug last as failure signals to fix.

---

## Roles & Priority

Fixed enum, priority-driven read order. Lower priority = read first.

| Role          | Priority | Intent                                                                 |
|---------------|---------:|------------------------------------------------------------------------|
| `ticket`      |        1 | Goal/scope anchor — read first so the agent knows what they're building. |
| `constraint`  |        2 | Hard rules: don't touch X, must use Y, perf/security limits.           |
| `design`      |        3 | UI/UX spec, API contract, or behavior requirements.                    |
| `decision`    |        4 | Prior architectural decisions (ADR-lite). Agent should not relitigate. |
| `bug`         |        5 | Reported bug to investigate / fix.                                     |
| `qa`          |        6 | Failed QA run — reproduce + fix.                                       |
| `note`        |       99 | General context, no special handling. Default for legacy entries.      |

Priority is **derived in code** from role, not stored. Adding/changing roles = code change, no DB migration.

Within a single priority, sort by `created_at` desc (most recent first).

---

## Data Model

### Concept: per-bundle "notes session"

A bundle gets a hidden synthetic session whose only purpose is to host manual notes. Reuses all the existing entry/ref/rewind plumbing — manual notes are just `cloud_session_entries` (or local `SessionEntry`) refs into the bundle, sourced from this special session.

**Why a session and not a new table:** rewind, refs, deletion cascade, push, pull, and renderings already work on session entries. A new top-level entity would duplicate all of that.

### Schema changes

**Supabase migration `0010_notes_and_roles.sql`:**

```sql
-- Hide notes sessions from normal session listings
alter table cloud_sessions
  add column kind text not null default 'project'
  check (kind in ('project','notes'));

-- Bundle's pointer to its hidden notes session (lazy-created on first note)
alter table bundles
  add column notes_session_id uuid references cloud_sessions(id) on delete set null;

-- Role tag on entries
alter table cloud_session_entries
  add column role text
  check (role in ('ticket','constraint','design','decision','bug','qa','note'));
```

No backfill. `role IS NULL` is treated as `note`/priority 99 by core.

**Local store:**

- `~/.ctx-link/local/<bundle_id>/meta.json` gains optional `notes_session_id?: string`.
- `ActiveSession` interface gains optional `kind?: "project" | "notes"` (default `"project"` when absent).
- `SessionEntry` interface gains optional `role?: Role` (undefined = `note`).
- All three are added lazily; existing files don't need rewriting.

### Filtering

`listActiveSessions()` and `listTeamSessions()` filter out sessions where `kind === "notes"` by default. A new internal helper `getNotesSession(bundleId)` is the only path that returns them.

---

## Core API

New functions in `packages/core/src/`:

```ts
// notes.ts (new file)
export type Role =
  | "ticket" | "constraint" | "design" | "decision"
  | "bug"    | "qa"         | "note";

export const ROLE_PRIORITY: Record<Role, number> = {
  ticket: 1, constraint: 2, design: 3, decision: 4,
  bug:    5, qa:         6, note:   99,
};

export interface AddBundleNoteInput {
  bundle_id: string;
  summary: string;
  role?: Role;            // default "note"
  trigger_ref?: string | null;
  files_touched?: string[];
  decisions?: Array<{ decision: string; rationale?: string; affects: string[] }>;
}

export interface AddBundleNoteResult {
  bundle_id: string;
  notes_session_id: string;
  entry_id: string;
  role: Role;
}

export async function addBundleNote(input: AddBundleNoteInput): Promise<AddBundleNoteResult>;
```

`addBundleNote` replaces the existing project-coupled `addBundleNote` from this morning's bug-fix work. Behavior:

1. Resolve bundle mode (local/cloud).
2. Get-or-create the bundle's notes session:
   - **Local bundle:** read `meta.json#notes_session_id`. If missing, create a new `ActiveSession` with `kind: "notes"`, `project_name: ""`, persist to `~/.ctx-link/active-sessions/`, write the id back into `meta.json`.
   - **Cloud bundle:** read `bundles.notes_session_id`. If null, insert a new `cloud_sessions` row in the bundle's team with `kind: "notes"`, `project_name: ""`, then update `bundles.notes_session_id`.
3. Create the entry in that notes session with the given role.
4. Reference it from the bundle (`localAddEntriesToBundle` / `addEntriesToBundle`).

**Pull ordering:**

- `pullEntries` and `localPullEntries` sort by `(ROLE_PRIORITY[role ?? "note"], -created_at)`.
- `renderEntriesForClaude` groups by role with markdown headings:
  ```
  ## Ticket
  …
  ## Constraints
  …
  ## Design spec
  …
  ## Decisions
  …
  ## Bugs
  …
  ## QA
  …
  ## Notes
  …
  ```
  Empty groups are omitted.

---

## Transport surface

### UI server (`packages/ui/server.ts`)

`POST /api/bundles/:id/notes`
- Body: `{ summary: string; role?: Role }`
- Calls `addBundleNote`. Returns `AddBundleNoteResult`.

The current project-scoped behavior is replaced. Existing callers (the "Add Note" dialog) update accordingly.

### MCP server (`packages/mcp-server/src/index.ts`)

New tool `bundle_add_note`:
- Args: `{ bundle_id: string, summary: string, role?: Role }`
- Description nudges agents toward the right role (e.g. "Use `ticket` to anchor scope before code work.").

Existing `session_log` is unchanged — it still writes to project sessions.

### CLI (`packages/cli/src/index.ts`)

New command `note`:
- `ctxl note --bundle <id> --role <role> --summary "..."`
- Interactive prompts for missing flags, role dropdown via `@inquirer/prompts`.

---

## UI changes

`PushEntryDialog` (renamed `AddBundleNoteDialog` for clarity):

- **Drop** the project dropdown and `projectNames` derivation logic.
- **Add** a role dropdown (the seven roles), default `note`.
- Title becomes `Add Note`. Submit button: `Add note`.
- Optimistic update keeps using the entries query key for the bundle; the optimistic row carries `role` and the entry-row rendering surfaces a small role pill (e.g. `TICKET`, `QA`).

`EntryPanel`:

- Render a small colored pill next to each entry showing the role.
- Group/sort entries by role priority when displaying bundle entries (matches pull order).

Notes sessions are not shown anywhere in the graph or session pickers because `listActiveSessions()` / `listTeamSessions()` already filter them out.

---

## Agent behavior

The MCP `context_pull` tool's response uses the new role-grouped markdown rendering. Agent prompt in the MCP tool description nudges:

> Read entries top-down by section. Tickets anchor scope; constraints define guardrails; design/decisions describe the target; bugs/QA describe failures to fix.

No new tool mode flags. Existing `context_pull` consumers automatically benefit.

---

## Migration & compatibility

- Existing entries (no `role`) render in the `## Notes` section, sorted last.
- Existing sessions (no `kind`) are treated as `kind: "project"`.
- Existing bundles (no `notes_session_id`) lazily get one on first note.
- `usePushEntry` mutation in the UI is rewritten to call the new endpoint with role; project_name is no longer sent.

The local-bundle change is entirely additive — old `meta.json` files keep working.

---

## Out of scope (v1)

- Per-role rewind controls (rewind still operates on project_name + strategy; notes sessions can be rewound by passing the synthetic project).
- UI for editing a note's role after creation.
- Notes attached to multiple bundles (each bundle has its own notes session; notes don't fan out).
- Custom roles beyond the fixed enum.

---

## Testing

- **Core:** unit tests for `addBundleNote` (local + cloud, lazy session creation, role default, invalid role), priority sort, role-grouped render.
- **MCP:** tool registration + happy-path call.
- **UI:** dialog renders role dropdown, mutation hits new endpoint, optimistic row shows role pill.
- **CLI:** `note` command interactive prompts and flags.

---

## Files touched (summary)

- `supabase/migrations/0010_notes_and_roles.sql` — new
- `packages/core/src/notes.ts` — new (role enum, priority map, `addBundleNote`)
- `packages/core/src/session-actions.ts` — remove old `addBundleNote` stub from earlier patch
- `packages/core/src/local-store.ts` — `meta.json` `notes_session_id` field, getter/setter
- `packages/core/src/config.ts` — `kind` on `ActiveSession`, filtered listing
- `packages/core/src/cloud-sessions.ts` — `kind` on `CloudSession`, filtered listing, notes-session insert helper
- `packages/core/src/entries.ts` — `role` in `EntryRow`, priority-aware sort
- `packages/core/src/index.ts` — re-export `notes.ts`
- `packages/ui/server.ts` — `/api/bundles/:id/notes` rewritten to call new helper
- `packages/ui/src/hooks/mutations/usePushEntry.ts` — send role, drop project
- `packages/ui/src/components/PushEntryForm.tsx` → `AddBundleNoteForm.tsx` — UI changes
- `packages/ui/src/components/EntryPanel.tsx` — role pills, role-grouped order
- `packages/mcp-server/src/index.ts` — new `bundle_add_note` tool, role-grouped pull rendering
- `packages/cli/src/index.ts` — `note` command
- Tests across `packages/core/src/__tests__/`
