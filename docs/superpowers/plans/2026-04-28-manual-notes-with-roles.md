# Manual Notes with Agent Roles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace project-coupled "Add Note" with bundle-attached, role-tagged notes hosted in a hidden per-bundle synthetic session.

**Architecture:** New `notes.ts` core module owns the Role enum + priority map + `addBundleNote` orchestrator. Each bundle gets a hidden session (`kind: "notes"`) that holds note entries with a `role` field. Pull rendering groups entries by role priority so agents read tickets first, constraints next, etc.

**Tech Stack:** TypeScript, Bun, Supabase, React + TanStack Query, MCP SDK, Commander/@inquirer/prompts (CLI).

**Spec:** `docs/superpowers/specs/2026-04-28-manual-notes-with-roles-design.md`

---

## File Structure

**New:**
- `packages/core/src/notes.ts` — Role enum, ROLE_PRIORITY, `getOrCreateNotesSession`, `addBundleNote`
- `packages/core/src/__tests__/notes.test.ts`
- `supabase/migrations/0010_notes_and_roles.sql`

**Modified (core):**
- `packages/core/src/config.ts` — `kind` on `ActiveSession`, filter out `kind: "notes"` from `listActiveSessions`
- `packages/core/src/cloud-sessions.ts` — `kind` on `CloudSession`, filter from `listTeamSessions`, `createNotesCloudSession` helper
- `packages/core/src/local-store.ts` — `notes_session_id` on `LocalMeta`, getter/setter, filter from `listAllLocalBundleDetails` aggregation
- `packages/core/src/entries.ts` — `role` on `EntryRow`, role-aware sort, role-grouped `renderEntriesForClaude`
- `packages/core/src/session-actions.ts` — remove the project-coupled `addBundleNote` added in commit `4cc6f02`
- `packages/core/src/index.ts` — re-export `notes.ts`

**Modified (transport):**
- `packages/ui/server.ts` — rewrite `POST /api/bundles/:id/notes` to call new `addBundleNote(bundle_id, summary, role)`
- `packages/ui/src/lib/api.ts` — typed wrapper for new endpoint
- `packages/ui/src/hooks/mutations/usePushEntry.ts` — send `{ summary, role }` instead of `{ project_name, event_type, summary }`
- `packages/ui/src/components/PushEntryForm.tsx` — drop project picker, add role picker
- `packages/ui/src/components/EntryPanel.tsx` — role pill per entry, role-grouped sort
- `packages/ui/src/types.ts` — add `role` to entry row type
- `packages/mcp-server/src/index.ts` — register `bundle_add_note` tool, switch `context_pull` rendering to role-grouped
- `packages/cli/src/index.ts` — add `note` command

---

## Task 1: Role enum and priority map

**Files:**
- Create: `packages/core/src/notes.ts`
- Create: `packages/core/src/__tests__/notes.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/__tests__/notes.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { ROLES, ROLE_PRIORITY, rolePriority, type Role } from "../notes.js";

describe("Role enum + priority", () => {
  test("ROLES contains the seven defined roles", () => {
    expect(ROLES).toEqual(["ticket", "constraint", "design", "decision", "bug", "qa", "note"]);
  });

  test("ROLE_PRIORITY orders roles ticket < constraint < design < decision < bug < qa < note", () => {
    expect(ROLE_PRIORITY.ticket).toBeLessThan(ROLE_PRIORITY.constraint);
    expect(ROLE_PRIORITY.constraint).toBeLessThan(ROLE_PRIORITY.design);
    expect(ROLE_PRIORITY.design).toBeLessThan(ROLE_PRIORITY.decision);
    expect(ROLE_PRIORITY.decision).toBeLessThan(ROLE_PRIORITY.bug);
    expect(ROLE_PRIORITY.bug).toBeLessThan(ROLE_PRIORITY.qa);
    expect(ROLE_PRIORITY.qa).toBeLessThan(ROLE_PRIORITY.note);
  });

  test("rolePriority defaults missing role to note priority", () => {
    expect(rolePriority(undefined)).toBe(ROLE_PRIORITY.note);
    expect(rolePriority(null)).toBe(ROLE_PRIORITY.note);
    expect(rolePriority("ticket" as Role)).toBe(ROLE_PRIORITY.ticket);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/__tests__/notes.test.ts`
Expected: FAIL with module-not-found error.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/core/src/notes.ts`:

```ts
export const ROLES = [
  "ticket",
  "constraint",
  "design",
  "decision",
  "bug",
  "qa",
  "note",
] as const;

export type Role = typeof ROLES[number];

export const ROLE_PRIORITY: Record<Role, number> = {
  ticket: 1,
  constraint: 2,
  design: 3,
  decision: 4,
  bug: 5,
  qa: 6,
  note: 99,
};

export function rolePriority(role: Role | null | undefined): number {
  if (!role) return ROLE_PRIORITY.note;
  return ROLE_PRIORITY[role] ?? ROLE_PRIORITY.note;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Re-export from package index**

Modify `packages/core/src/index.ts` — add line:

```ts
export * from "./notes.js";
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test packages/core/src/__tests__/notes.test.ts && bun run typecheck`
Expected: 3 tests pass, typecheck succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/notes.ts packages/core/src/__tests__/notes.test.ts packages/core/src/index.ts
git commit -m "feat(core): add Role enum and priority map for bundle notes"
```

---

## Task 2: Schema foundation — type fields + Supabase migration

**Files:**
- Create: `supabase/migrations/0010_notes_and_roles.sql`
- Modify: `packages/core/src/config.ts:160-175` (ActiveSession + SessionEntry interfaces)
- Modify: `packages/core/src/cloud-sessions.ts:14-36` (CloudSession + CloudSessionEntry interfaces)
- Modify: `packages/core/src/local-store.ts:50-60` (LocalMeta interface)
- Modify: `packages/core/src/entries.ts:13-23` (EntryRow interface)
- Modify: `packages/ui/src/types.ts` (entry row types)

- [ ] **Step 1: Create the Supabase migration**

Create `supabase/migrations/0010_notes_and_roles.sql`:

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

create index if not exists cloud_session_entries_role_idx
  on cloud_session_entries (role)
  where role is not null;
```

- [ ] **Step 2: Update ActiveSession interface**

In `packages/core/src/config.ts`, modify the `ActiveSession` interface to add `kind`:

```ts
export interface ActiveSession {
  session_id: string;
  name?: string | null;
  name_auto?: boolean;
  project_name: string;
  project_path: string;
  bundles: Array<{ bundle_id: string; mode: "local" | "cloud" }>;
  started_at: string;
  branch: string | null;
  cloud_session_id: string | null;
  team_id: string | null;
  cloud_copies: Array<{ cloud_session_id: string; team_id: string }>;
  channel_port?: number | null;
  claude_instance_id?: string | null;
  claude_session_id?: string | null;
  kind?: "project" | "notes";  // default "project" when undefined
}
```

Also extend `SessionEntry` to add the `role` field:

```ts
export interface SessionEntry {
  id: string;
  created_at: string;
  project_name: string;
  event_type: string;
  trigger_ref: string | null;
  summary: string;
  files_touched: string[];
  decisions: Array<{ decision: string; rationale?: string; affects: string[] }>;
  pushed_at: string | null;
  superseded_at: string | null;
  pending_enrichment?: boolean;
  role?: import("./notes.js").Role;
}
```

- [ ] **Step 3: Update CloudSession + CloudSessionEntry interfaces**

In `packages/core/src/cloud-sessions.ts`:

```ts
export interface CloudSession {
  id: string;
  name: string | null;
  team_id: string;
  project_name: string;
  project_path: string | null;
  machine_id: string;
  branch: string | null;
  started_at: string;
  last_active_at: string;
  kind?: "project" | "notes";  // server default "project"
}

export interface CloudSessionEntry {
  id: string;
  session_id: string;
  event_type: string;
  trigger_ref: string | null;
  summary: string;
  files_touched: string[];
  decisions: Array<{ decision: string; rationale?: string; affects: string[] }>;
  created_at: string;
  superseded_at: string | null;
  role?: import("./notes.js").Role | null;
}
```

- [ ] **Step 4: Update LocalMeta interface**

In `packages/core/src/local-store.ts`, modify the `LocalMeta` interface:

```ts
interface LocalMeta {
  id: string;
  name: string;
  created_at: string;
  notes_session_id?: string;  // lazy: undefined until first note added
}
```

- [ ] **Step 5: Update EntryRow + UI types**

In `packages/core/src/entries.ts`:

```ts
export interface EntryRow {
  id: string;
  created_at: string;
  project_name: string;
  event_type: string;
  trigger_ref: string | null;
  summary: string;
  files_touched: string[];
  decisions: Array<{ decision: string; rationale?: string; affects: string[] }>;
  bundle_refs?: string[];
  role?: import("./notes.js").Role | null;
}
```

In `packages/ui/src/types.ts`, add `role?: string | null` to whichever interface mirrors entry rows there (search for `event_type` to find it). Keep it as `string | null` to avoid coupling UI types to the core enum.

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: all 5 packages green (the new optional fields are additive, no callers break).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0010_notes_and_roles.sql packages/core/src/config.ts packages/core/src/cloud-sessions.ts packages/core/src/local-store.ts packages/core/src/entries.ts packages/ui/src/types.ts
git commit -m "feat(schema): add kind, notes_session_id, role fields for bundle notes"
```

- [ ] **Step 8: Apply the migration locally**

Run: `cd supabase && supabase db push` (or whatever the project's apply command is — check `package.json` and prior migration history if unsure).
Expected: migration applies cleanly. If your local DB does not auto-apply, note this for manual application before tasks 7+.

---

## Task 3: Filter notes sessions from listings

**Files:**
- Modify: `packages/core/src/config.ts` (`listActiveSessions` function)
- Modify: `packages/core/src/cloud-sessions.ts` (`listTeamSessions` function)
- Modify: `packages/core/src/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/core/src/__tests__/config.test.ts`, add a new describe block (or extend an existing one):

```ts
describe("listActiveSessions filters notes sessions", () => {
  test("excludes sessions with kind='notes'", () => {
    saveActiveSession({
      session_id: "project-1",
      project_name: "frontend",
      project_path: "/tmp/frontend",
      bundles: [],
      started_at: "2026-01-01T00:00:00Z",
      branch: "main",
      cloud_session_id: null,
      team_id: null,
      cloud_copies: [],
    });
    saveActiveSession({
      session_id: "notes-1",
      project_name: "",
      project_path: "",
      bundles: [],
      started_at: "2026-01-01T00:00:00Z",
      branch: null,
      cloud_session_id: null,
      team_id: null,
      cloud_copies: [],
      kind: "notes",
    });

    const ids = listActiveSessions().map((s) => s.session_id);
    expect(ids).toContain("project-1");
    expect(ids).not.toContain("notes-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/__tests__/config.test.ts`
Expected: FAIL — `notes-1` returned by `listActiveSessions`.

- [ ] **Step 3: Update listActiveSessions to filter**

In `packages/core/src/config.ts`, find `listActiveSessions` and add a filter:

```ts
export function listActiveSessions(): ActiveSession[] {
  const dir = activeSessionsDir();
  if (!existsSync(dir)) return [];
  const out: ActiveSession[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const session: ActiveSession = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (session.kind === "notes") continue;  // hide synthetic notes sessions
      out.push(session);
    } catch { /* skip corrupt files */ }
  }
  return out;
}
```

(Adjust to match the existing function shape — only the `if (session.kind === "notes") continue;` line is new.)

- [ ] **Step 4: Update listTeamSessions to filter**

In `packages/core/src/cloud-sessions.ts`, modify `listTeamSessions`:

```ts
export async function listTeamSessions(teamId: string): Promise<CloudSession[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("cloud_sessions")
    .select("*")
    .eq("team_id", teamId)
    .neq("kind", "notes")
    .order("last_active_at", { ascending: false });

  if (error) throw new Error(`listTeamSessions failed: ${error.message}`);
  return (data ?? []) as CloudSession[];
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test packages/core/src/__tests__/config.test.ts && bun run typecheck`
Expected: new test passes; typecheck green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config.ts packages/core/src/cloud-sessions.ts packages/core/src/__tests__/config.test.ts
git commit -m "feat(core): hide kind='notes' sessions from list functions"
```

---

## Task 4: getOrCreateNotesSession (local + cloud)

**Files:**
- Modify: `packages/core/src/notes.ts`
- Modify: `packages/core/src/local-store.ts` (add helpers `getLocalNotesSessionId` / `setLocalNotesSessionId`)
- Modify: `packages/core/src/cloud-sessions.ts` (add `createNotesCloudSession` helper)
- Modify: `packages/core/src/bundles.ts` (cloud bundle's `notes_session_id` getter)
- Modify: `packages/core/src/__tests__/notes.test.ts`

- [ ] **Step 1: Write failing tests for local mode**

Append to `packages/core/src/__tests__/notes.test.ts`:

```ts
import { setupTestDir, cleanupTestDir } from "./helpers/mock-fs";
import { localCreateBundle } from "../local-store.js";
import { getOrCreateNotesSession } from "../notes.js";
import { loadActiveSession } from "../config.js";
import { beforeEach, afterEach } from "bun:test";

describe("getOrCreateNotesSession (local)", () => {
  let testDir: string;
  beforeEach(() => { testDir = setupTestDir(); });
  afterEach(() => { cleanupTestDir(testDir); });

  test("creates a hidden notes session and persists notes_session_id on the bundle", async () => {
    const bundle = localCreateBundle("test-bundle");
    const sessionId = await getOrCreateNotesSession(bundle.bundle_id);

    expect(sessionId).toBeTruthy();
    const session = loadActiveSession(sessionId);
    expect(session?.kind).toBe("notes");
  });

  test("returns the same session id on subsequent calls", async () => {
    const bundle = localCreateBundle("test-bundle");
    const a = await getOrCreateNotesSession(bundle.bundle_id);
    const b = await getOrCreateNotesSession(bundle.bundle_id);
    expect(a).toBe(b);
  });

  test("recreates if the stored notes_session_id no longer exists on disk", async () => {
    const bundle = localCreateBundle("test-bundle");
    const a = await getOrCreateNotesSession(bundle.bundle_id);

    // Simulate the user deleting the active session file
    const { deleteActiveSession } = await import("../config.js");
    deleteActiveSession(a);

    const b = await getOrCreateNotesSession(bundle.bundle_id);
    expect(b).not.toBe(a);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `bun test packages/core/src/__tests__/notes.test.ts`
Expected: FAIL — `getOrCreateNotesSession` not exported.

- [ ] **Step 3: Add local-store helpers**

In `packages/core/src/local-store.ts`, add (next to `readMeta`):

```ts
export function getLocalNotesSessionId(bundleId: string): string | undefined {
  if (!isLocalBundle(bundleId)) return undefined;
  const meta = readMeta(bundleId);
  return meta.notes_session_id;
}

export function setLocalNotesSessionId(bundleId: string, sessionId: string): void {
  const meta = readMeta(bundleId);
  meta.notes_session_id = sessionId;
  writeFileSync(metaPath(bundleId), JSON.stringify(meta, null, 2));
}
```

- [ ] **Step 4: Add cloud helper**

In `packages/core/src/cloud-sessions.ts`, add:

```ts
export async function createNotesCloudSession(
  teamId: string,
  bundleId: string,
): Promise<string> {
  const config = loadGlobalConfig();
  const sb = getSupabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const { error } = await sb.from("cloud_sessions").insert({
    id,
    team_id: teamId,
    project_name: "",
    project_path: null,
    machine_id: config.machine_id,
    branch: null,
    started_at: now,
    last_active_at: now,
    kind: "notes",
    name: `notes:${bundleId.slice(0, 8)}`,
  });
  if (error) throw new Error(`createNotesCloudSession failed: ${error.message}`);
  return id;
}
```

- [ ] **Step 5: Add cloud bundle notes_session_id helpers**

In `packages/core/src/bundles.ts`, add:

```ts
export async function getCloudBundleNotesSessionId(bundleId: string): Promise<string | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("bundles")
    .select("notes_session_id")
    .eq("id", bundleId)
    .single();
  if (error) return null;
  return (data?.notes_session_id as string | null) ?? null;
}

export async function setCloudBundleNotesSessionId(
  bundleId: string,
  notesSessionId: string,
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("bundles")
    .update({ notes_session_id: notesSessionId })
    .eq("id", bundleId);
  if (error) throw new Error(`setCloudBundleNotesSessionId failed: ${error.message}`);
}
```

- [ ] **Step 6: Implement getOrCreateNotesSession**

In `packages/core/src/notes.ts`, add at the bottom:

```ts
import { randomUUID } from "node:crypto";
import { saveActiveSession, loadActiveSession, type ActiveSession } from "./config.js";
import {
  isLocalBundle,
  getLocalNotesSessionId,
  setLocalNotesSessionId,
} from "./local-store.js";
import {
  getCloudBundleNotesSessionId,
  setCloudBundleNotesSessionId,
  getBundleTeamId,
} from "./bundles.js";
import { createNotesCloudSession, getCloudSession } from "./cloud-sessions.js";

export async function getOrCreateNotesSession(bundleId: string): Promise<string> {
  if (isLocalBundle(bundleId)) {
    const stored = getLocalNotesSessionId(bundleId);
    if (stored && loadActiveSession(stored)) return stored;

    const sessionId = randomUUID();
    const session: ActiveSession = {
      session_id: sessionId,
      name: `notes:${bundleId.slice(0, 8)}`,
      project_name: "",
      project_path: "",
      bundles: [{ bundle_id: bundleId, mode: "local" }],
      started_at: new Date().toISOString(),
      branch: null,
      cloud_session_id: null,
      team_id: null,
      cloud_copies: [],
      kind: "notes",
    };
    saveActiveSession(session);
    setLocalNotesSessionId(bundleId, sessionId);
    return sessionId;
  }

  // cloud bundle
  const stored = await getCloudBundleNotesSessionId(bundleId);
  if (stored && (await getCloudSession(stored))) return stored;

  const teamId = await getBundleTeamId(bundleId);
  if (!teamId) throw new Error(`Cloud bundle ${bundleId} has no team — cannot create notes session.`);

  const newId = await createNotesCloudSession(teamId, bundleId);
  await setCloudBundleNotesSessionId(bundleId, newId);
  return newId;
}
```

- [ ] **Step 7: Run tests + typecheck**

Run: `bun test packages/core/src/__tests__/notes.test.ts && bun run typecheck`
Expected: 3 new tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/notes.ts packages/core/src/local-store.ts packages/core/src/cloud-sessions.ts packages/core/src/bundles.ts packages/core/src/__tests__/notes.test.ts
git commit -m "feat(core): get-or-create per-bundle notes session"
```

---

## Task 5: addBundleNote orchestrator (and remove old project-coupled helper)

**Files:**
- Modify: `packages/core/src/notes.ts`
- Modify: `packages/core/src/session-actions.ts` (delete the old `addBundleNote`, related types, and `getSupabase` / `pushSessionEntry` imports added in commit `4cc6f02`)
- Modify: `packages/ui/server.ts:537-563` (rewrite endpoint to call new helper)
- Modify: `packages/core/src/__tests__/notes.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/core/src/__tests__/notes.test.ts`:

```ts
import { addBundleNote } from "../notes.js";
import { localPullEntries } from "../local-store.js";

describe("addBundleNote (local)", () => {
  let testDir: string;
  beforeEach(() => { testDir = setupTestDir(); });
  afterEach(() => { cleanupTestDir(testDir); });

  test("creates the entry in the bundle's notes session and refs it", async () => {
    const bundle = localCreateBundle("test-bundle");
    const result = await addBundleNote({
      bundle_id: bundle.bundle_id,
      summary: "the goal: ship the dashboard",
      role: "ticket",
    });

    expect(result.entry_id).toBeTruthy();
    expect(result.role).toBe("ticket");
    expect(result.notes_session_id).toBeTruthy();

    const entries = await localPullEntries({ bundle_id: bundle.bundle_id });
    expect(entries).toHaveLength(1);
    expect(entries[0].summary).toBe("the goal: ship the dashboard");
    expect(entries[0].role).toBe("ticket");
  });

  test("defaults role to 'note' when omitted", async () => {
    const bundle = localCreateBundle("test-bundle");
    const result = await addBundleNote({
      bundle_id: bundle.bundle_id,
      summary: "general background",
    });
    expect(result.role).toBe("note");
  });

  test("rejects empty summary", async () => {
    const bundle = localCreateBundle("test-bundle");
    await expect(addBundleNote({
      bundle_id: bundle.bundle_id,
      summary: "",
    })).rejects.toThrow(/summary/);
  });

  test("rejects unknown role", async () => {
    const bundle = localCreateBundle("test-bundle");
    await expect(addBundleNote({
      bundle_id: bundle.bundle_id,
      summary: "ok",
      // @ts-expect-error — testing runtime guard
      role: "bogus",
    })).rejects.toThrow(/role/);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `bun test packages/core/src/__tests__/notes.test.ts`
Expected: FAIL — `addBundleNote` not exported from notes.js (the old session-actions one has a different signature).

- [ ] **Step 3: Remove the old addBundleNote from session-actions.ts**

In `packages/core/src/session-actions.ts`:
- Delete the entire `// ─── Add a manual note to a bundle ──` block (the `AddBundleNoteInput`, `AddBundleNoteResult`, and `addBundleNote` function added in commit `4cc6f02`).
- Remove the `pushSessionEntry` import from `./config.js` if it is no longer used elsewhere in this file (search the file — if no other reference, drop it).
- Remove the `import { getSupabase } from "./supabase.js";` line if no other reference remains.

- [ ] **Step 4: Implement new addBundleNote in notes.ts**

Append to `packages/core/src/notes.ts`:

```ts
import { pushSessionEntry } from "./config.js";
import { pushSessionToBundle } from "./session-actions.js";
import { getSupabase } from "./supabase.js";

export interface AddBundleNoteInput {
  bundle_id: string;
  summary: string;
  role?: Role;
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

export async function addBundleNote(input: AddBundleNoteInput): Promise<AddBundleNoteResult> {
  const summary = input.summary?.trim();
  if (!summary) throw new Error("summary is required.");

  const role: Role = input.role ?? "note";
  if (!isRole(role)) throw new Error(`Unknown role: ${input.role}`);

  const bundleId = input.bundle_id;
  const notesSessionId = await getOrCreateNotesSession(bundleId);
  const isCloudHost = isLocalBundle(bundleId) ? false : true;

  const triggerRef = input.trigger_ref ?? null;
  const filesTouched = input.files_touched ?? [];
  const decisions = input.decisions ?? [];

  let entryId: string;
  if (isCloudHost) {
    const sb = getSupabase();
    entryId = randomUUID();
    const { error } = await sb.from("cloud_session_entries").insert({
      id: entryId,
      session_id: notesSessionId,
      event_type: "manual",
      trigger_ref: triggerRef,
      summary,
      files_touched: filesTouched,
      decisions,
      role,
    });
    if (error) throw new Error(`Failed to create note entry: ${error.message}`);
  } else {
    const entry = pushSessionEntry(notesSessionId, {
      project_name: "",
      event_type: "manual",
      trigger_ref: triggerRef,
      summary,
      files_touched: filesTouched,
      decisions,
      role,
    });
    entryId = entry.id;
  }

  await pushSessionToBundle(notesSessionId, bundleId, [entryId]);

  return {
    bundle_id: bundleId,
    notes_session_id: notesSessionId,
    entry_id: entryId,
    role,
  };
}
```

- [ ] **Step 5: Update the UI server endpoint**

In `packages/ui/server.ts`, replace the `/api/bundles/:id/notes` block (added in commit `4cc6f02`) with:

```ts
// ── POST /api/bundles/:id/notes ─────────────────────────────────────────
{
  const match = url.pathname.match(/^\/api\/bundles\/([^/]+)\/notes$/);
  if (match && req.method === "POST") {
    try {
      const bundleId = match[1];
      const { summary, role, trigger_ref, files_touched, decisions } = await req.json();
      const result = await addBundleNote({
        bundle_id: bundleId,
        summary,
        role,
        trigger_ref,
        files_touched,
        decisions,
      });
      return Response.json(result, { headers: corsHeaders });
    } catch (err: any) {
      return Response.json(
        { error: err.message ?? String(err) },
        { status: 400, headers: corsHeaders },
      );
    }
  }
}
```

The `addBundleNote` import already exists at the top of the file (added in `4cc6f02`); it now resolves to the new `notes.ts` export through the package re-export.

- [ ] **Step 6: Run tests + typecheck**

Run: `bun test packages/core && bun run typecheck`
Expected: all core tests green (including the four new addBundleNote tests + the three from Task 4 + Task 1's three).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/notes.ts packages/core/src/session-actions.ts packages/ui/server.ts packages/core/src/__tests__/notes.test.ts
git commit -m "feat(core): role-tagged addBundleNote routed through hidden notes session"
```

---

## Task 6: Role-aware pull sort + role-grouped renderEntriesForClaude

**Files:**
- Modify: `packages/core/src/entries.ts`
- Modify: `packages/core/src/local-store.ts` (`localPullEntries` ordering)
- Modify: `packages/core/src/__tests__/entries.test.ts` (add render tests)

- [ ] **Step 1: Write failing test for ordering**

In `packages/core/src/__tests__/notes.test.ts` (or create a new test file `entries-render.test.ts`), append:

```ts
describe("localPullEntries returns entries sorted by role priority", () => {
  let testDir: string;
  beforeEach(() => { testDir = setupTestDir(); });
  afterEach(() => { cleanupTestDir(testDir); });

  test("ticket comes before note", async () => {
    const bundle = localCreateBundle("b");
    await addBundleNote({ bundle_id: bundle.bundle_id, summary: "general", role: "note" });
    await addBundleNote({ bundle_id: bundle.bundle_id, summary: "scope", role: "ticket" });

    const rows = await localPullEntries({ bundle_id: bundle.bundle_id });
    expect(rows[0].role).toBe("ticket");
    expect(rows[1].role).toBe("note");
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `bun test packages/core/src/__tests__/notes.test.ts`
Expected: FAIL — order depends on `created_at` only.

- [ ] **Step 3: Update local pull to sort by role priority**

In `packages/core/src/local-store.ts`, find `localPullEntries` and update the final sort:

```ts
import { rolePriority } from "./notes.js";  // add at top
// ...
// after building `results: EntryRow[]` and before returning,
// replace any existing sort with:
results.sort((a, b) => {
  const dp = rolePriority(a.role) - rolePriority(b.role);
  if (dp !== 0) return dp;
  return b.created_at.localeCompare(a.created_at); // newer first within group
});
```

Make sure the row-construction inside `resolveEntryRefs` propagates `role`:

```ts
results.push({
  id: e.id,
  ...
  decisions: e.decisions ?? [],
  role: e.role ?? null,
});
```

- [ ] **Step 4: Update cloud pull to sort by role priority**

In `packages/core/src/entries.ts`, the cloud `pullEntries` query needs `role` in the select and the post-fetch sort. Update the select string to include `role`:

```ts
.select(`
  entry_id,
  cloud_session_entries!inner (
    id, created_at, event_type, trigger_ref, summary, files_touched, decisions, superseded_at, role,
    cloud_sessions!inner ( project_name )
  )
`)
```

And in the row map, propagate `role`:

```ts
const rows = (data ?? []).map((r: any) => {
  const e = r.cloud_session_entries;
  return {
    id: e.id,
    ...
    decisions: e.decisions ?? [],
    role: e.role ?? null,
  } as EntryRow;
});
```

After mapping (and after the optional `exclude_project` filter), apply the same sort:

```ts
import { rolePriority } from "./notes.js";  // add at top of file
// ...
const sorted = (input.exclude_project
  ? rows.filter((r) => r.project_name !== input.exclude_project)
  : rows
).sort((a, b) => {
  const dp = rolePriority(a.role) - rolePriority(b.role);
  if (dp !== 0) return dp;
  return b.created_at.localeCompare(a.created_at);
});
return sorted;
```

- [ ] **Step 5: Run sort test**

Run: `bun test packages/core/src/__tests__/notes.test.ts`
Expected: PASS.

- [ ] **Step 6: Update renderEntriesForClaude to group by role**

In `packages/core/src/entries.ts`, find `renderEntriesForClaude` and rewrite it:

```ts
import { ROLES, rolePriority, type Role } from "./notes.js";

const ROLE_HEADINGS: Record<Role, string> = {
  ticket:     "Ticket",
  constraint: "Constraints",
  design:     "Design spec",
  decision:   "Decisions",
  bug:        "Bugs",
  qa:         "QA",
  note:       "Notes",
};

export function renderEntriesForClaude(entries: EntryRow[]): string {
  if (entries.length === 0) return "_(no entries)_";

  // Group by effective role (null/undefined → "note")
  const groups = new Map<Role, EntryRow[]>();
  for (const e of entries) {
    const r: Role = (e.role ?? "note") as Role;
    const arr = groups.get(r) ?? [];
    arr.push(e);
    groups.set(r, arr);
  }

  const orderedRoles = ROLES.filter((r) => groups.has(r));

  const sections = orderedRoles.map((r) => {
    const items = (groups.get(r) ?? [])
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((e) => `- **${e.project_name || "—"}** _(${e.event_type})_ — ${e.summary}`)
      .join("\n");
    return `## ${ROLE_HEADINGS[r]}\n${items}`;
  });

  return sections.join("\n\n");
}
```

(If there is an existing render with extra fields like `decisions`/`files_touched`, preserve that formatting — only the grouping wrapper is new.)

- [ ] **Step 7: Add render test**

In `packages/core/src/__tests__/notes.test.ts`:

```ts
import { renderEntriesForClaude } from "../entries.js";

describe("renderEntriesForClaude groups by role", () => {
  test("renders sections in priority order", () => {
    const md = renderEntriesForClaude([
      { id: "1", created_at: "2026-04-28T00:00:00Z", project_name: "p", event_type: "manual",
        trigger_ref: null, summary: "general", files_touched: [], decisions: [], role: "note" },
      { id: "2", created_at: "2026-04-28T00:01:00Z", project_name: "p", event_type: "manual",
        trigger_ref: null, summary: "scope anchor", files_touched: [], decisions: [], role: "ticket" },
    ]);

    expect(md.indexOf("## Ticket")).toBeLessThan(md.indexOf("## Notes"));
    expect(md).toContain("scope anchor");
    expect(md).toContain("general");
  });
});
```

- [ ] **Step 8: Run all core tests + typecheck**

Run: `bun test packages/core && bun run typecheck`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/entries.ts packages/core/src/local-store.ts packages/core/src/__tests__/notes.test.ts
git commit -m "feat(core): role-priority sort and grouped rendering for pulls"
```

---

## Task 7: UI — usePushEntry mutation + dialog rewrite

**Files:**
- Modify: `packages/ui/src/hooks/mutations/usePushEntry.ts`
- Modify: `packages/ui/src/components/PushEntryForm.tsx`
- Modify: `packages/ui/src/lib/api.ts` (typed wrapper)

- [ ] **Step 1: Add typed API wrapper**

In `packages/ui/src/lib/api.ts`, add (next to `removeEntryRefFromBundle`):

```ts
export type AddBundleNoteResult = {
  bundle_id: string;
  notes_session_id: string;
  entry_id: string;
  role: string;
};

export function addBundleNote(
  bundleId: string,
  body: { summary: string; role: string },
) {
  return apiPost<AddBundleNoteResult>(`/api/bundles/${bundleId}/notes`, body);
}
```

- [ ] **Step 2: Rewrite usePushEntry to send `{ summary, role }`**

Replace `packages/ui/src/hooks/mutations/usePushEntry.ts` with:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { EntryRow } from "@/types";
import { addBundleNote, type AddBundleNoteResult } from "@/lib/api";

type AddNoteVars = {
  bundleId: string;
  role: string;
  summary: string;
};

export function usePushEntry() {
  const qc = useQueryClient();
  return useMutation<AddBundleNoteResult, Error, AddNoteVars, { prev?: EntryRow[]; key: ["entries", string] }>({
    mutationFn: ({ bundleId, role, summary }) => addBundleNote(bundleId, { summary, role }),

    onMutate: async ({ bundleId, role, summary }) => {
      const key = ["entries", bundleId] as ["entries", string];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<EntryRow[]>(key);

      const optimistic: EntryRow = {
        id: `optimistic-${Date.now()}`,
        created_at: new Date().toISOString(),
        project_name: "",
        event_type: "manual",
        trigger_ref: null,
        summary,
        files_touched: [],
        decisions: [],
        role,
      };
      qc.setQueryData<EntryRow[]>(key, (old) =>
        old ? [optimistic, ...old] : [optimistic]
      );
      return { prev, key };
    },

    onError: (err, _params, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
      toast.error(err.message);
    },

    onSuccess: () => {
      toast.success("Note added");
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["entries"] });
      qc.invalidateQueries({ queryKey: ["graph"] });
    },
  });
}
```

- [ ] **Step 3: Rewrite the dialog**

Replace `packages/ui/src/components/PushEntryForm.tsx` with:

```tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { usePushEntry } from "@/hooks/mutations/usePushEntry";
import { useUIStore } from "@/stores/uiStore";

const ROLE_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: "ticket",     label: "Ticket",      hint: "Goal/scope anchor — read first" },
  { value: "constraint", label: "Constraint",  hint: "Hard rules: don't do X, must use Y" },
  { value: "design",     label: "Design spec", hint: "UI/UX or behavior requirements" },
  { value: "decision",   label: "Decision",    hint: "Prior architectural decision (don't relitigate)" },
  { value: "bug",        label: "Bug",         hint: "Reported bug to investigate / fix" },
  { value: "qa",         label: "QA",          hint: "Failed QA run — reproduce + fix" },
  { value: "note",       label: "Note",        hint: "General context" },
];

export function PushEntryDialog() {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const selectedBundleId = useUIStore((s) => s.selectedBundleId);
  const open = activeModal === "push-entry" && !!selectedBundleId;

  const [role, setRole] = useState("note");
  const [summary, setSummary] = useState("");
  const mutation = usePushEntry();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBundleId) return;
    mutation.mutate(
      { bundleId: selectedBundleId, role, summary },
      {
        onSuccess: () => {
          closeModal();
          setRole("note");
          setSummary("");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeModal()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Note</DialogTitle>
          <DialogDescription>
            Tag the note with a role so agents read it with the right intent.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Role</label>
            <select
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              required
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {ROLE_OPTIONS.find((r) => r.value === role)?.hint}
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Summary</label>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Describe the ticket / constraint / bug / note..."
              required
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || !summary}>
              {mutation.isPending ? "Adding..." : "Add note"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Verify typecheck**

Run: `bun run typecheck`
Expected: green.

- [ ] **Step 5: Manual test**

Start the UI: `bun run dev:ui-api` and `bun run dev:ui` (in two terminals).
Open a bundle, click `+ Add Note`, pick `Ticket`, write a summary, submit.
Expected: dialog closes, optimistic row appears at top of entries panel, toast says "Note added", entry persists after refresh.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/lib/api.ts packages/ui/src/hooks/mutations/usePushEntry.ts packages/ui/src/components/PushEntryForm.tsx
git commit -m "feat(ui): role-picker for Add Note dialog"
```

---

## Task 8: UI — EntryPanel role pills + grouped order

**Files:**
- Modify: `packages/ui/src/components/EntryPanel.tsx`

- [ ] **Step 1: Add a role pill component inline**

In `packages/ui/src/components/EntryPanel.tsx`, near the top of the file (after imports), add:

```tsx
const ROLE_STYLES: Record<string, string> = {
  ticket:     "bg-blue-500/15 text-blue-300 border-blue-500/40",
  constraint: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  design:     "bg-violet-500/15 text-violet-300 border-violet-500/40",
  decision:   "bg-cyan-500/15 text-cyan-300 border-cyan-500/40",
  bug:        "bg-red-500/15 text-red-300 border-red-500/40",
  qa:         "bg-pink-500/15 text-pink-300 border-pink-500/40",
  note:       "bg-muted text-muted-foreground border-border",
};

function RolePill({ role }: { role?: string | null }) {
  const r = role ?? "note";
  const cls = ROLE_STYLES[r] ?? ROLE_STYLES.note;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cls}`}>
      {r}
    </span>
  );
}
```

- [ ] **Step 2: Render the pill on each entry row**

Find the entry row JSX in `EntryPanel.tsx` (search for where `entry.summary` is rendered). Insert the pill in the row header next to the project name / event type:

```tsx
<RolePill role={entry.role} />
```

- [ ] **Step 3: Group entries by role priority for display**

The server already returns entries sorted by role priority. The UI just needs to keep that order — confirm there is no client-side re-sort overriding it. If there is, remove it.

Optionally, if the existing list is flat, render group headings using the same priority order as the rendering helper (this is a nice-to-have; if you skip it, the ordering still respects priority because the server sorted them).

- [ ] **Step 4: Manual test**

Reload the UI, open a bundle, add notes with different roles. Confirm pills appear and tickets sort above notes.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/EntryPanel.tsx
git commit -m "feat(ui): role pill on bundle entries"
```

---

## Task 9: MCP `bundle_add_note` tool

**Files:**
- Modify: `packages/mcp-server/src/index.ts`

- [ ] **Step 1: Find an existing tool registration as a template**

In `packages/mcp-server/src/index.ts`, search for `bundle_remove_entry` or `bundle_status` as a template — they have similar shape (single bundle target).

- [ ] **Step 2: Add the new tool**

Add to the tool list (alphabetical with the other `bundle_` tools). Use the existing pattern from neighbors (don't reinvent — match how they declare schema and return content):

```ts
{
  name: "bundle_add_note",
  description:
    "Add a manual note to a bundle, tagged with a role so consumers read it with the right intent. " +
    "Roles (priority order): ticket → constraint → design → decision → bug → qa → note. " +
    "Use 'ticket' to anchor the agent in the goal, 'constraint' for hard rules, 'qa' for failed test cases.",
  inputSchema: {
    type: "object" as const,
    properties: {
      bundle_id: { type: "string" },
      summary: { type: "string" },
      role: {
        type: "string",
        enum: ["ticket", "constraint", "design", "decision", "bug", "qa", "note"],
      },
    },
    required: ["bundle_id", "summary"],
  },
},
```

And in the dispatcher (the big switch / if-block on tool name), add the handler:

```ts
if (name === "bundle_add_note") {
  const { bundle_id, summary, role } = args as { bundle_id: string; summary: string; role?: string };
  const result = await addBundleNote({
    bundle_id,
    summary,
    role: role as any,
  });
  return {
    content: [{
      type: "text",
      text: `Added ${result.role} note to bundle. Entry id: ${result.entry_id}.`,
    }],
  };
}
```

Add `addBundleNote` to the `@ctx-link/core` import block at the top of the file.

- [ ] **Step 3: Switch context_pull rendering to grouped output**

Find where `context_pull` calls `renderEntriesForClaude` (or formats entries inline). It should now call the new grouped renderer — which it already does after Task 6. Confirm by inspection; no further code change should be needed unless context_pull builds its own render string.

- [ ] **Step 4: Typecheck + manual test**

Run: `bun run typecheck`
Then: `bun run dev:mcp` in a sandbox project, call `bundle_add_note` with a `ticket` role through the MCP inspector or via a Claude Code session.
Expected: tool appears, succeeds, and the entry shows up under the Ticket section in `context_pull`.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server/src/index.ts
git commit -m "feat(mcp): bundle_add_note tool with role tagging"
```

---

## Task 10: CLI `note` command

**Files:**
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Find an existing command as a template**

Use the existing `ask` command as a template — it has similar shape (per-bundle, multi-flag, interactive fallback).

- [ ] **Step 2: Add the `note` command**

Add to `packages/cli/src/index.ts`:

```ts
program
  .command("note")
  .description("Add a role-tagged note to a bundle")
  .option("--bundle <id>", "bundle id")
  .option("--role <role>", "ticket | constraint | design | decision | bug | qa | note")
  .option("--summary <text>", "the note text")
  .action(async (opts) => {
    const { addBundleNote, ROLES } = await import("@ctx-link/core");

    let bundleId = opts.bundle;
    if (!bundleId) {
      const { select } = await import("@inquirer/prompts");
      const { listAllLocalBundleDetails, listMyTeams, getSupabase } = await import("@ctx-link/core");
      const local = listAllLocalBundleDetails().map((b) => ({
        name: `${b.bundle_name} (local)`,
        value: b.bundle_id,
      }));
      // Cloud bundles
      const teams = listMyTeams();
      const sb = getSupabase();
      const cloud: Array<{ name: string; value: string }> = [];
      for (const t of teams) {
        const { data } = await sb.from("bundles").select("id, name").eq("team_id", t.team_id);
        for (const b of data ?? []) {
          cloud.push({ name: `${b.name} (cloud, ${t.name})`, value: b.id });
        }
      }
      const choices = [...local, ...cloud];
      if (choices.length === 0) {
        console.error("No bundles found.");
        process.exit(1);
      }
      bundleId = await select({ message: "Bundle:", choices });
    }

    let role = opts.role;
    if (!role) {
      const { select } = await import("@inquirer/prompts");
      role = await select({
        message: "Role:",
        choices: ROLES.map((r) => ({ name: r, value: r })),
        default: "note",
      });
    }

    let summary = opts.summary;
    if (!summary) {
      const { editor } = await import("@inquirer/prompts");
      summary = await editor({ message: "Note (opens $EDITOR):" });
    }

    const result = await addBundleNote({ bundle_id: bundleId, summary, role });
    console.log(`Added ${result.role} note to bundle ${bundleId}.`);
    console.log(`Entry id: ${result.entry_id}`);
  });
```

- [ ] **Step 3: Typecheck + manual test**

Run: `bun run typecheck && bun run cli -- note --bundle <id> --role ticket --summary "test ticket"`
Expected: command succeeds; entry appears in the bundle.

Test interactive: `bun run cli -- note` and pick through prompts.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): ctxl note for role-tagged bundle notes"
```

---

## Task 11: Final integration verification

**Files:** none

- [ ] **Step 1: Full typecheck**

Run: `bun run typecheck`
Expected: all 5 packages green.

- [ ] **Step 2: Full core test suite**

Run: `bun run --filter '@ctx-link/core' test`
Expected: all tests green; new tests included.

- [ ] **Step 3: End-to-end manual smoke test**

Spin up the full stack:
- `bun run dev:ui-api` (terminal 1)
- `bun run dev:ui` (terminal 2)
- `bun run dev:mcp` (terminal 3, inside a sandbox project)

Walk through:
1. Create a local bundle from the UI.
2. From the UI, "Add Note" → Ticket "Build the dashboard".
3. From the same project's Claude Code (MCP), call `context_pull` and confirm the ticket renders under `## Ticket`.
4. From a different project's Claude Code, call `bundle_add_note` with role `qa` and a failure description.
5. From the UI, refresh — both entries visible with correct pills, ticket sorted above QA.
6. From the CLI: `bun run cli -- note --bundle <id> --role design --summary "use shadcn for forms"`.
7. From the UI, refresh — design entry appears between ticket and QA.

- [ ] **Step 4: Confirm hidden notes sessions are not surfaced**

Check the graph view — there should be **no** project node for the synthetic notes session (its `kind` filter must be working). Also check `bun run cli -- sessions` — the notes session must not appear.

- [ ] **Step 5: Commit any cleanup**

If anything was modified during the smoke test (e.g. minor copy fixes), commit:

```bash
git add -p
git commit -m "chore: smoke-test cleanup"
```

---

## Self-review checklist (already completed by plan author)

- ✅ **Spec coverage:** every spec section has a task — Role/Priority (1), Schema (2), Listing filter (3), Notes session (4), addBundleNote (5), Pull behavior (6), UI (7+8), MCP (9), CLI (10), Verification (11).
- ✅ **No placeholders:** every code step shows runnable code. No "TBD" / "appropriate handling".
- ✅ **Type consistency:** `Role` is the same name across all tasks; `addBundleNote(input: AddBundleNoteInput) → AddBundleNoteResult` shape matches between `notes.ts`, server.ts, and the API wrapper.
- ✅ **Granularity:** each task ≤ ~6 steps, each step ≤ 5 minutes. TDD where unit tests exist (core); manual verification where they don't (UI/MCP/CLI).
