# Cloud Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sessions first-class cloud objects independent of bundles, with entries as the single source of truth referenced by bundles instead of copied.

**Architecture:** New Supabase tables (`cloud_sessions`, `cloud_session_entries`, `bundle_entry_refs`) replace the old `sessions`/`entries` tables. Local store mirrors the reference model with JSON files. All layers (core, MCP, CLI, UI) are updated to work with the new model.

**Tech Stack:** Bun, TypeScript, Supabase (PostgreSQL), React 19, @xyflow/react, TanStack Query, Zustand

---

## File Structure

### New Files
- `supabase/migrations/0005_cloud_sessions.sql` — schema migration
- `packages/core/src/cloud-sessions.ts` — cloud session CRUD + sync

### Modified Files
- `packages/core/src/config.ts` — `ActiveSession` type gains `cloud_session_id` and `team_id`
- `packages/core/src/entries.ts` — rewrite for reference model (`bundle_entry_refs`)
- `packages/core/src/bundles.ts` — entry counts via refs, `listBundleSessions` removed (sessions are independent now)
- `packages/core/src/local-store.ts` — reference model with `entry_refs.json`
- `packages/core/src/rewind.ts` — operate on `cloud_session_entries` instead of `entries`
- `packages/core/src/index.ts` — export new module
- `packages/mcp-server/src/index.ts` — new `session_push_to_cloud` tool, update `context_push` and `source_entry_delete`
- `packages/cli/src/index.ts` — update push/pull commands for reference model
- `packages/ui/server.ts` — new endpoints, update existing ones
- `packages/ui/src/types.ts` — new types for cloud sessions + entry refs
- `packages/ui/src/lib/api.ts` — new API functions
- `packages/ui/src/lib/buildGraph.ts` — show cloud sessions per team independent of bundles
- `packages/ui/src/hooks/useSessionEntries.ts` — update for new data shape
- `packages/ui/src/components/EntryPanel.tsx` — bundle ref badges on entries
- `packages/ui/src/components/EntryCard.tsx` — "in N bundles" badge
- `packages/ui/src/components/PushSessionToBundleDialog.tsx` — entry selection, skip already-pushed
- `packages/ui/src/stores/uiStore.ts` — add push-to-cloud modal state

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/0005_cloud_sessions.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- ctx-link: cloud sessions (reference model)
-- Sessions become independent of bundles. Entries live in sessions.
-- Bundles reference entries via a junction table.

-- 1. Create cloud_sessions (independent of bundles, owned by team)
create table if not exists cloud_sessions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  project_name text not null,
  project_path text,
  machine_id text not null,
  branch text,
  started_at timestamptz not null,
  last_active_at timestamptz not null default now()
);

create index if not exists cloud_sessions_team_idx
  on cloud_sessions (team_id);
create index if not exists cloud_sessions_machine_idx
  on cloud_sessions (machine_id);

alter table cloud_sessions enable row level security;

-- 2. Create cloud_session_entries (source of truth for all entries)
create table if not exists cloud_session_entries (
  id uuid primary key,  -- use the local UUID, not auto-generated
  session_id uuid not null references cloud_sessions(id) on delete cascade,
  event_type text not null check (event_type in ('commit','pr_open','manual','session_end')),
  trigger_ref text,
  summary text not null,
  files_touched jsonb default '[]'::jsonb,
  decisions jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  superseded_at timestamptz
);

create index if not exists cloud_session_entries_session_idx
  on cloud_session_entries (session_id, created_at desc);
create index if not exists cloud_session_entries_active_idx
  on cloud_session_entries (session_id, created_at desc)
  where superseded_at is null;

alter table cloud_session_entries enable row level security;

-- 3. Create bundle_entry_refs (junction: bundles reference session entries)
create table if not exists bundle_entry_refs (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references bundles(id) on delete cascade,
  entry_id uuid not null references cloud_session_entries(id) on delete cascade,
  added_at timestamptz not null default now(),
  unique(bundle_id, entry_id)
);

create index if not exists bundle_entry_refs_bundle_idx
  on bundle_entry_refs (bundle_id);
create index if not exists bundle_entry_refs_entry_idx
  on bundle_entry_refs (entry_id);

alter table bundle_entry_refs enable row level security;

-- 4. Drop old tables (sessions and entries were bundle-scoped copies)
-- Order matters: entries references sessions, rewind_log references entries
drop table if exists rewind_log cascade;
drop table if exists entries cascade;
drop table if exists sessions cascade;

-- 5. Recreate rewind_log pointing to cloud_session_entries
create table if not exists rewind_log (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid references bundles(id) on delete cascade,
  session_id uuid references cloud_sessions(id) on delete cascade,
  project_name text not null,
  strategy_kind text not null,
  strategy_detail jsonb not null,
  affected_entry_ids uuid[] not null default '{}',
  affected_count int not null default 0,
  reason text,
  performed_by text,
  performed_at timestamptz not null default now()
);

create index if not exists rewind_log_session_idx
  on rewind_log (session_id, performed_at desc);
create index if not exists rewind_log_bundle_idx
  on rewind_log (bundle_id, performed_at desc);

alter table rewind_log enable row level security;
```

- [ ] **Step 2: Verify the migration file exists**

Run: `ls supabase/migrations/0005_cloud_sessions.sql`
Expected: file listed

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0005_cloud_sessions.sql
git commit -m "feat(db): add cloud_sessions, cloud_session_entries, bundle_entry_refs tables"
```

---

### Task 2: Update ActiveSession Type in Config

**Files:**
- Modify: `packages/core/src/config.ts:157-164`

- [ ] **Step 1: Add cloud_session_id and team_id to ActiveSession**

In `packages/core/src/config.ts`, update the `ActiveSession` interface at line 157:

```typescript
export interface ActiveSession {
  session_id: string;
  project_name: string;
  project_path: string;
  bundles: Array<{ bundle_id: string; mode: "local" | "cloud" }>;
  started_at: string;
  branch: string | null;
  cloud_session_id: string | null;  // null until pushed to cloud
  team_id: string | null;           // team the cloud session belongs to
}
```

- [ ] **Step 2: Update saveActiveSession calls to include new fields**

Find every call to `saveActiveSession()` in the codebase. The CLI `session-start` command at `packages/cli/src/index.ts:226-233` creates new sessions:

```typescript
saveActiveSession({
  session_id: sessionId,
  project_name: projectName,
  project_path: process.cwd(),
  bundles: [],
  started_at: new Date().toISOString(),
  branch,
  cloud_session_id: null,
  team_id: null,
});
```

- [ ] **Step 3: Run typecheck to find all broken callsites**

Run: `cd /Users/hassan/Desktop/Hassan/Work/ctx-link && bun run typecheck 2>&1`
Expected: errors at every `saveActiveSession()` call missing the new fields. Fix each one by adding `cloud_session_id: null, team_id: null`.

- [ ] **Step 4: Verify typecheck passes**

Run: `bun run typecheck 2>&1`
Expected: all packages pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config.ts packages/cli/src/index.ts
git commit -m "feat(core): add cloud_session_id and team_id to ActiveSession"
```

---

### Task 3: Cloud Sessions Module

**Files:**
- Create: `packages/core/src/cloud-sessions.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create cloud-sessions.ts with pushSessionToCloud**

Create `packages/core/src/cloud-sessions.ts`:

```typescript
import { getSupabase } from "./supabase.js";
import {
  loadGlobalConfig,
  loadActiveSession,
  saveActiveSession,
  getSessionEntries,
  type ActiveSession,
  type SessionEntry,
} from "./config.js";
import { assertTeamMember } from "./teams.js";

export interface CloudSession {
  id: string;
  team_id: string;
  project_name: string;
  project_path: string | null;
  machine_id: string;
  branch: string | null;
  started_at: string;
  last_active_at: string;
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
}

/**
 * Promote a local session to cloud. Creates cloud_sessions + cloud_session_entries rows.
 * Updates the local ActiveSession with cloud_session_id and team_id.
 */
export async function pushSessionToCloud(
  sessionId: string,
  teamId: string
): Promise<{ cloud_session_id: string; entries_synced: number }> {
  await assertTeamMember(teamId);
  const cfg = loadGlobalConfig();
  const session = loadActiveSession(sessionId);
  if (!session) throw new Error(`Active session ${sessionId} not found.`);

  // If already pushed to this team, just sync new entries
  if (session.cloud_session_id && session.team_id === teamId) {
    const synced = await syncNewEntries(session);
    return { cloud_session_id: session.cloud_session_id, entries_synced: synced };
  }

  const sb = getSupabase();

  // Create cloud session
  const { data: cloudSession, error: sessionError } = await sb
    .from("cloud_sessions")
    .insert({
      team_id: teamId,
      project_name: session.project_name,
      project_path: session.project_path,
      machine_id: cfg.machine_id,
      branch: session.branch,
      started_at: session.started_at,
    })
    .select("id")
    .single();

  if (sessionError) throw new Error(`Failed to create cloud session: ${sessionError.message}`);

  // Upload all local session entries
  const localEntries = getSessionEntries(sessionId);
  let entriesSynced = 0;

  if (localEntries.length > 0) {
    const rows = localEntries.map((e) => ({
      id: e.id, // reuse local UUID
      session_id: cloudSession.id,
      event_type: e.event_type,
      trigger_ref: e.trigger_ref,
      summary: e.summary,
      files_touched: e.files_touched,
      decisions: e.decisions,
      created_at: e.created_at,
    }));

    const { error: entriesError } = await sb
      .from("cloud_session_entries")
      .upsert(rows, { onConflict: "id" });

    if (entriesError) throw new Error(`Failed to sync entries: ${entriesError.message}`);
    entriesSynced = rows.length;
  }

  // Update local session with cloud reference
  session.cloud_session_id = cloudSession.id;
  session.team_id = teamId;
  saveActiveSession(session);

  return { cloud_session_id: cloudSession.id, entries_synced: entriesSynced };
}

/**
 * Sync any local entries that don't exist in cloud yet.
 * Called automatically when new entries are created on a cloud-enabled session.
 */
export async function syncNewEntries(session: ActiveSession): Promise<number> {
  if (!session.cloud_session_id) return 0;

  const sb = getSupabase();
  const localEntries = getSessionEntries(session.session_id);

  // Get existing cloud entry IDs
  const { data: existing } = await sb
    .from("cloud_session_entries")
    .select("id")
    .eq("session_id", session.cloud_session_id);

  const existingIds = new Set((existing ?? []).map((e: any) => e.id));
  const newEntries = localEntries.filter((e) => !existingIds.has(e.id));

  if (newEntries.length === 0) return 0;

  const rows = newEntries.map((e) => ({
    id: e.id,
    session_id: session.cloud_session_id!,
    event_type: e.event_type,
    trigger_ref: e.trigger_ref,
    summary: e.summary,
    files_touched: e.files_touched,
    decisions: e.decisions,
    created_at: e.created_at,
  }));

  const { error } = await sb
    .from("cloud_session_entries")
    .upsert(rows, { onConflict: "id" });

  if (error) throw new Error(`syncNewEntries failed: ${error.message}`);

  // Update last_active_at
  await sb
    .from("cloud_sessions")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", session.cloud_session_id);

  return newEntries.length;
}

/**
 * Sync a single entry to cloud (called when session_log creates a new entry).
 */
export async function syncEntryToCloud(
  session: ActiveSession,
  entry: SessionEntry
): Promise<void> {
  if (!session.cloud_session_id) return;

  const sb = getSupabase();
  const { error } = await sb
    .from("cloud_session_entries")
    .upsert(
      {
        id: entry.id,
        session_id: session.cloud_session_id,
        event_type: entry.event_type,
        trigger_ref: entry.trigger_ref,
        summary: entry.summary,
        files_touched: entry.files_touched,
        decisions: entry.decisions,
        created_at: entry.created_at,
      },
      { onConflict: "id" }
    );

  if (error) throw new Error(`syncEntryToCloud failed: ${error.message}`);

  await sb
    .from("cloud_sessions")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", session.cloud_session_id);
}

/**
 * Delete a cloud session entry. Cascades removal from all bundle_entry_refs.
 */
export async function deleteCloudSessionEntry(entryId: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("cloud_session_entries")
    .delete()
    .eq("id", entryId);
  if (error) throw new Error(`deleteCloudSessionEntry failed: ${error.message}`);
}

/**
 * Delete a cloud session and all its entries (cascades via FK).
 */
export async function deleteCloudSession(cloudSessionId: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("cloud_sessions")
    .delete()
    .eq("id", cloudSessionId);
  if (error) throw new Error(`deleteCloudSession failed: ${error.message}`);
}

/**
 * List all cloud sessions for a team.
 */
export async function listTeamSessions(teamId: string): Promise<CloudSession[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("cloud_sessions")
    .select("*")
    .eq("team_id", teamId)
    .order("last_active_at", { ascending: false });

  if (error) throw new Error(`listTeamSessions failed: ${error.message}`);
  return (data ?? []) as CloudSession[];
}

/**
 * Get cloud session entries.
 */
export async function getCloudSessionEntries(
  cloudSessionId: string,
  includeSuperseded = false
): Promise<CloudSessionEntry[]> {
  const sb = getSupabase();
  let query = sb
    .from("cloud_session_entries")
    .select("*")
    .eq("session_id", cloudSessionId)
    .order("created_at", { ascending: false });

  if (!includeSuperseded) {
    query = query.is("superseded_at", null);
  }

  const { data, error } = await query;
  if (error) throw new Error(`getCloudSessionEntries failed: ${error.message}`);
  return (data ?? []) as CloudSessionEntry[];
}

/**
 * Get which bundles reference a given entry.
 */
export async function getEntryBundleRefs(
  entryId: string
): Promise<Array<{ bundle_id: string; added_at: string }>> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("bundle_entry_refs")
    .select("bundle_id, added_at")
    .eq("entry_id", entryId);
  if (error) throw new Error(`getEntryBundleRefs failed: ${error.message}`);
  return (data ?? []) as Array<{ bundle_id: string; added_at: string }>;
}
```

- [ ] **Step 2: Export from core index**

In `packages/core/src/index.ts`, add the new export:

```typescript
export * from "./config.js";
export * from "./bundles.js";
export * from "./entries.js";
export * from "./rewind.js";
export * from "./local-store.js";
export * from "./teams.js";
export * from "./cloud-sessions.js";
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck 2>&1`
Expected: passes (new module has no consumers yet)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/cloud-sessions.ts packages/core/src/index.ts
git commit -m "feat(core): add cloud-sessions module with push-to-cloud and sync"
```

---

### Task 4: Rewrite entries.ts for Reference Model

**Files:**
- Modify: `packages/core/src/entries.ts`

- [ ] **Step 1: Rewrite entries.ts**

Replace the entire contents of `packages/core/src/entries.ts` with:

```typescript
import { getSupabase } from "./supabase.js";
import { assertTokenValid } from "./bundles.js";
import type { SessionEntry } from "./config.js";

export interface EntryRow {
  id: string;
  created_at: string;
  project_name: string;
  event_type: string;
  trigger_ref: string | null;
  summary: string;
  files_touched: string[];
  decisions: Array<{ decision: string; rationale?: string; affects: string[] }>;
  bundle_refs?: string[]; // bundle IDs that reference this entry
}

export interface PullInput {
  bundle_id: string;
  since?: string | null;
  limit?: number;
  exclude_project?: string;
  mode?: "local" | "cloud";
  skipAuth?: boolean;
}

/**
 * Pull entries from a bundle via bundle_entry_refs → cloud_session_entries JOIN.
 */
export async function pullEntries(input: PullInput): Promise<EntryRow[]> {
  if (input.mode === "local") {
    const { localPullEntries } = await import("./local-store.js");
    return localPullEntries(input);
  }

  if (!input.skipAuth) await assertTokenValid(input.bundle_id);
  const sb = getSupabase();

  // JOIN: bundle_entry_refs → cloud_session_entries (filter superseded) → cloud_sessions
  let query = sb
    .from("bundle_entry_refs")
    .select(`
      entry_id,
      cloud_session_entries!inner (
        id, created_at, event_type, trigger_ref, summary, files_touched, decisions, superseded_at,
        cloud_sessions!inner ( project_name )
      )
    `)
    .eq("bundle_id", input.bundle_id)
    .is("cloud_session_entries.superseded_at", null)
    .order("added_at", { ascending: false })
    .limit(input.limit ?? 20);

  const { data, error } = await query;
  if (error) throw new Error(`pullEntries failed: ${error.message}`);

  let rows = (data ?? []).map((r: any) => {
    const e = r.cloud_session_entries;
    return {
      id: e.id,
      created_at: e.created_at,
      project_name: e.cloud_sessions?.project_name ?? "unknown",
      event_type: e.event_type,
      trigger_ref: e.trigger_ref,
      summary: e.summary,
      files_touched: e.files_touched ?? [],
      decisions: e.decisions ?? [],
    } as EntryRow;
  });

  // Filter by since
  if (input.since) {
    rows = rows.filter((r) => r.created_at > input.since!);
  }

  // Filter out own project
  if (input.exclude_project) {
    rows = rows.filter((r) => r.project_name !== input.exclude_project);
  }

  return rows;
}

/**
 * Add entries to a bundle by creating bundle_entry_refs.
 * Skips entries that already have a ref for this bundle (UNIQUE constraint).
 */
export async function addEntriesToBundle(
  bundleId: string,
  entryIds: string[]
): Promise<{ added: number; skipped: number }> {
  if (entryIds.length === 0) return { added: 0, skipped: 0 };

  const sb = getSupabase();

  // Check which refs already exist
  const { data: existing } = await sb
    .from("bundle_entry_refs")
    .select("entry_id")
    .eq("bundle_id", bundleId)
    .in("entry_id", entryIds);

  const existingSet = new Set((existing ?? []).map((r: any) => r.entry_id));
  const newIds = entryIds.filter((id) => !existingSet.has(id));

  if (newIds.length === 0) {
    return { added: 0, skipped: entryIds.length };
  }

  const rows = newIds.map((entryId) => ({
    bundle_id: bundleId,
    entry_id: entryId,
  }));

  const { error } = await sb.from("bundle_entry_refs").insert(rows);
  if (error) throw new Error(`addEntriesToBundle failed: ${error.message}`);

  return { added: newIds.length, skipped: existingSet.size };
}

/**
 * Remove a single entry reference from a bundle.
 * Does NOT delete the session entry — only the ref.
 */
export async function removeEntryFromBundle(
  bundleId: string,
  entryId: string
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("bundle_entry_refs")
    .delete()
    .eq("bundle_id", bundleId)
    .eq("entry_id", entryId);
  if (error) throw new Error(`removeEntryFromBundle failed: ${error.message}`);
}

/**
 * Get session entry IDs that are NOT yet referenced by a given bundle.
 */
export async function getUnpushedEntries(
  cloudSessionId: string,
  bundleId: string
): Promise<string[]> {
  const sb = getSupabase();

  // Get all active session entries
  const { data: allEntries } = await sb
    .from("cloud_session_entries")
    .select("id")
    .eq("session_id", cloudSessionId)
    .is("superseded_at", null);

  const allIds = (allEntries ?? []).map((e: any) => e.id);
  if (allIds.length === 0) return [];

  // Get entries already referenced by this bundle
  const { data: refs } = await sb
    .from("bundle_entry_refs")
    .select("entry_id")
    .eq("bundle_id", bundleId)
    .in("entry_id", allIds);

  const refSet = new Set((refs ?? []).map((r: any) => r.entry_id));
  return allIds.filter((id: string) => !refSet.has(id));
}

// Human/LLM-readable rendering of entries for context injection.
export function renderEntriesForClaude(entries: EntryRow[]): string {
  if (entries.length === 0) {
    return "No recent cross-project context.";
  }
  const parts = entries.map((e) => {
    const lines = [
      `[${e.created_at}] ${e.project_name} · ${e.event_type}${
        e.trigger_ref ? ` (${e.trigger_ref})` : ""
      }`,
      e.summary,
    ];
    if (e.files_touched.length > 0) {
      lines.push(`Files: ${e.files_touched.join(", ")}`);
    }
    if (e.decisions.length > 0) {
      lines.push("Decisions:");
      for (const d of e.decisions) {
        lines.push(
          `  - ${d.decision}${d.affects.length ? ` [affects: ${d.affects.join(", ")}]` : ""}`
        );
      }
    }
    return lines.join("\n");
  });
  return parts.join("\n\n---\n\n");
}
```

- [ ] **Step 2: Run typecheck to find downstream breakage**

Run: `bun run typecheck 2>&1`
Expected: errors in bundles.ts, rewind.ts, mcp-server, cli, ui/server.ts (they import `PushInput`, `PushResult`, `pushEntry`, `removeSourceEntry`, `deleteProjectEntriesFromBundle` which no longer exist). These will be fixed in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/entries.ts
git commit -m "feat(core): rewrite entries.ts for reference model (bundle_entry_refs)"
```

---

### Task 5: Update bundles.ts

**Files:**
- Modify: `packages/core/src/bundles.ts`

- [ ] **Step 1: Update bundleStatus to count via bundle_entry_refs**

In `packages/core/src/bundles.ts`, find the `bundleStatus` function. Replace the Supabase query that counts entries from the old `entries` table with a count from `bundle_entry_refs`:

Replace the `entry_count` and `last_entry_at` queries (currently querying `entries` table) with:

```typescript
// Count entries via refs
const { count: entryCount } = await sb
  .from("bundle_entry_refs")
  .select("*", { count: "exact", head: true })
  .eq("bundle_id", bundleId);

// Last entry time via refs → cloud_session_entries
const { data: lastEntry } = await sb
  .from("bundle_entry_refs")
  .select("cloud_session_entries(created_at)")
  .eq("bundle_id", bundleId)
  .order("added_at", { ascending: false })
  .limit(1)
  .maybeSingle();
```

Return:
```typescript
return {
  bundle_id: bundleId,
  name: bundleData.name,
  session_count: 0, // sessions are now independent — no longer tracked per bundle
  entry_count: entryCount ?? 0,
  last_entry_at: (lastEntry as any)?.cloud_session_entries?.created_at ?? null,
};
```

- [ ] **Step 2: Remove listBundleSessions or simplify it**

`listBundleSessions` currently queries the old `sessions` table which no longer exists. Remove this function entirely — sessions are now independent and fetched per team via `listTeamSessions` in `cloud-sessions.ts`.

If other code still imports `listBundleSessions`, those callsites will be updated in later tasks.

- [ ] **Step 3: Remove deleteSession**

`deleteSession` operated on the old `sessions` table. Remove it. Session deletion is now handled by `deleteCloudSession` in `cloud-sessions.ts` and `deleteActiveSession` in `config.ts`.

- [ ] **Step 4: Run typecheck to verify**

Run: `bun run typecheck 2>&1`
Expected: errors from downstream consumers of removed functions. Note them for fixing in later tasks.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/bundles.ts
git commit -m "feat(core): update bundles.ts for reference model, remove bundle-scoped sessions"
```

---

### Task 6: Update local-store.ts for Reference Model

**Files:**
- Modify: `packages/core/src/local-store.ts`

- [ ] **Step 1: Add entry_refs.json path helper**

Add after the existing path helpers (around line 36):

```typescript
function entryRefsPath(bundleId: string): string {
  return join(bundleDir(bundleId), "entry_refs.json");
}

interface LocalEntryRef {
  entry_id: string;
  session_id: string;
  added_at: string;
}

function readEntryRefs(bundleId: string): LocalEntryRef[] {
  const p = entryRefsPath(bundleId);
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8"));
}

function writeEntryRefs(bundleId: string, refs: LocalEntryRef[]): void {
  writeFileSync(entryRefsPath(bundleId), JSON.stringify(refs, null, 2));
}
```

- [ ] **Step 2: Rewrite localPushEntry → localAddEntriesToBundle**

Replace `localPushEntry` with a function that creates refs instead of copying entries:

```typescript
/**
 * Add session entry references to a local bundle.
 * Skips entries that already have a ref.
 */
export function localAddEntriesToBundle(
  bundleId: string,
  entryIds: string[],
  sessionId: string
): { added: number; skipped: number } {
  readMeta(bundleId); // validate bundle exists
  const refs = readEntryRefs(bundleId);
  const existingSet = new Set(refs.map((r) => r.entry_id));

  const newRefs: LocalEntryRef[] = [];
  for (const entryId of entryIds) {
    if (!existingSet.has(entryId)) {
      newRefs.push({
        entry_id: entryId,
        session_id: sessionId,
        added_at: new Date().toISOString(),
      });
    }
  }

  if (newRefs.length > 0) {
    refs.push(...newRefs);
    writeEntryRefs(bundleId, refs);
  }

  return { added: newRefs.length, skipped: entryIds.length - newRefs.length };
}
```

- [ ] **Step 3: Rewrite localPullEntries to resolve refs**

Replace `localPullEntries` to resolve refs through session entry files:

```typescript
import { getSessionEntries } from "./config.js";

export function localPullEntries(input: PullInput): EntryRow[] {
  readMeta(input.bundle_id);
  const refs = readEntryRefs(input.bundle_id);

  // Group refs by session to batch-read
  const sessionGroups = new Map<string, string[]>();
  for (const ref of refs) {
    if (!sessionGroups.has(ref.session_id)) sessionGroups.set(ref.session_id, []);
    sessionGroups.get(ref.session_id)!.push(ref.entry_id);
  }

  // Resolve entries from session files
  const entries: EntryRow[] = [];
  for (const [sessionId, entryIds] of sessionGroups) {
    const sessionEntries = getSessionEntries(sessionId);
    const idSet = new Set(entryIds);
    for (const e of sessionEntries) {
      if (idSet.has(e.id) && !e.pushed_at) {
        // pushed_at is repurposed: null means active, non-null is still active
        // We use superseded_at concept — but SessionEntry doesn't have it yet.
        // For local, we just include all referenced entries.
        entries.push({
          id: e.id,
          created_at: e.created_at,
          project_name: e.project_name,
          event_type: e.event_type,
          trigger_ref: e.trigger_ref,
          summary: e.summary,
          files_touched: e.files_touched,
          decisions: e.decisions,
        });
      }
    }
  }

  // Sort descending by created_at
  entries.sort((a, b) => b.created_at.localeCompare(a.created_at));

  // Apply filters
  let filtered = entries;
  if (input.since) {
    filtered = filtered.filter((e) => e.created_at > input.since!);
  }
  if (input.exclude_project) {
    filtered = filtered.filter((e) => e.project_name !== input.exclude_project);
  }

  return filtered.slice(0, input.limit ?? 20);
}
```

- [ ] **Step 4: Add localRemoveEntryFromBundle**

```typescript
export function localRemoveEntryFromBundle(bundleId: string, entryId: string): void {
  const refs = readEntryRefs(bundleId);
  const filtered = refs.filter((r) => r.entry_id !== entryId);
  writeEntryRefs(bundleId, filtered);
}
```

- [ ] **Step 5: Update localBundleStatus to count via refs**

```typescript
export function localBundleStatus(bundleId: string): BundleStatus {
  const meta = readMeta(bundleId);
  const refs = readEntryRefs(bundleId);

  return {
    bundle_id: meta.id,
    name: meta.name,
    session_count: 0,
    entry_count: refs.length,
    last_entry_at: refs.length > 0
      ? refs.sort((a, b) => b.added_at.localeCompare(a.added_at))[0].added_at
      : null,
  };
}
```

- [ ] **Step 6: Update localCreateBundle to init entry_refs.json**

In `localCreateBundle`, add after `writeFileSync(entriesPath(id), "[]")`:

```typescript
writeFileSync(entryRefsPath(id), "[]");
```

- [ ] **Step 7: Remove old functions that are no longer needed**

Remove `localPushEntry`, `localRemoveSourceEntry`, `localDeleteProjectFromBundle`. These operated on the old copy model.

- [ ] **Step 8: Update localRewindProject and localRestoreRewound**

These currently operate on `entries.json` (the bundle's own entry copies). With the reference model, rewind needs to operate on session entries. For local mode, rewind will need to mark entries in the session file as superseded. This requires adding a `superseded_at` field to `SessionEntry` in config.ts.

Add to `SessionEntry` interface in `packages/core/src/config.ts`:

```typescript
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
  superseded_at: string | null;  // soft-delete for rewind
}
```

Update `pushSessionEntry` in config.ts to include `superseded_at: null` in the new entry.

Update `localPullEntries` to filter out entries where `superseded_at` is not null.

- [ ] **Step 9: Run typecheck**

Run: `bun run typecheck 2>&1`
Expected: may have errors from removed functions. Note and fix in later tasks.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/local-store.ts packages/core/src/config.ts
git commit -m "feat(core): rewrite local-store.ts for reference model with entry_refs.json"
```

---

### Task 7: Update rewind.ts for New Tables

**Files:**
- Modify: `packages/core/src/rewind.ts`

- [ ] **Step 1: Update findCandidates to query cloud_session_entries**

The `findCandidates` function currently queries the `entries` table joined with `sessions`. Update it to query `cloud_session_entries` joined with `cloud_sessions`:

```typescript
async function findCandidates(input: RewindInput): Promise<RewindCandidate[]> {
  const sb = getSupabase();

  let query = sb
    .from("cloud_session_entries")
    .select("id, created_at, event_type, trigger_ref, summary, cloud_sessions!inner(project_name)")
    .is("superseded_at", null)
    .order("created_at", { ascending: false });

  if (input.project_name) {
    query = query.eq("cloud_sessions.project_name", input.project_name);
  }

  // If rewind is scoped to a bundle, only include entries referenced by that bundle
  if (input.bundle_id) {
    const { data: refs } = await sb
      .from("bundle_entry_refs")
      .select("entry_id")
      .eq("bundle_id", input.bundle_id);
    const refIds = (refs ?? []).map((r: any) => r.entry_id);
    if (refIds.length === 0) return [];
    query = query.in("id", refIds);
  }

  const { data, error } = await query;
  if (error) throw new Error(`findCandidates failed: ${error.message}`);

  let candidates = (data ?? []) as any[];

  // Apply strategy filter
  const strat = input.strategy;
  switch (strat.kind) {
    case "since":
      candidates = candidates.filter((e) => e.created_at >= strat.since);
      break;
    case "last_n":
      candidates = candidates.slice(0, strat.count);
      break;
    case "entry_ids": {
      const idSet = new Set(strat.ids);
      candidates = candidates.filter((e) => idSet.has(e.id));
      break;
    }
    case "after_ref": {
      const pivot = candidates.find((e) => e.trigger_ref === strat.trigger_ref);
      if (!pivot) return [];
      candidates = candidates.filter((e) => e.created_at > pivot.created_at);
      break;
    }
  }

  return candidates.map((e) => ({
    id: e.id,
    created_at: e.created_at,
    event_type: e.event_type,
    trigger_ref: e.trigger_ref,
    summary_preview: (e.summary ?? "").slice(0, 160),
  }));
}
```

- [ ] **Step 2: Update rewindProject to SET superseded_at on cloud_session_entries**

Replace the UPDATE query from:
```sql
UPDATE entries SET superseded_at = now() WHERE id IN (...)
```
to:
```sql
UPDATE cloud_session_entries SET superseded_at = now() WHERE id IN (...)
```

Update the `rewind_log` INSERT to use `session_id` instead of (or in addition to) `bundle_id`. The rewind_log now has both `bundle_id` (nullable) and `session_id` (nullable) columns per the migration.

- [ ] **Step 3: Update restoreRewound to clear superseded_at on cloud_session_entries**

Same table name change: `entries` → `cloud_session_entries`.

- [ ] **Step 4: Update listRewinds to query new rewind_log**

The schema is the same, just verify it works with the new `session_id` column.

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck 2>&1`
Expected: passes for core package

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/rewind.ts
git commit -m "feat(core): update rewind.ts for cloud_session_entries table"
```

---

### Task 8: Update UI Server Endpoints

**Files:**
- Modify: `packages/ui/server.ts`

- [ ] **Step 1: Add new imports**

Add to the imports at the top of `packages/ui/server.ts`:

```typescript
import {
  pushSessionToCloud,
  listTeamSessions,
  syncNewEntries,
  deleteCloudSession,
  deleteCloudSessionEntry,
  getCloudSessionEntries,
  getEntryBundleRefs,
  addEntriesToBundle,
  removeEntryFromBundle,
} from "@ctx-link/core";
```

- [ ] **Step 2: Add POST /api/sessions/:id/push-to-cloud**

Add new endpoint:

```typescript
// ── POST /api/sessions/:id/push-to-cloud ──────────────────────────────
{
  const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/push-to-cloud$/);
  if (match && req.method === "POST") {
    try {
      const sessionId = match[1];
      const { team_id } = await req.json();
      if (!team_id) {
        return Response.json(
          { error: "team_id is required" },
          { status: 400, headers: corsHeaders }
        );
      }
      const result = await pushSessionToCloud(sessionId, team_id);
      return Response.json(result, { headers: corsHeaders });
    } catch (err: any) {
      return Response.json(
        { error: err.message ?? String(err) },
        { status: 500, headers: corsHeaders }
      );
    }
  }
}
```

- [ ] **Step 3: Add GET /api/teams/:id/sessions**

```typescript
// ── GET /api/teams/:id/sessions ──────────────────────────────────────
{
  const match = url.pathname.match(/^\/api\/teams\/([^/]+)\/sessions$/);
  if (match && req.method === "GET") {
    try {
      const teamId = match[1];
      const sessions = await listTeamSessions(teamId);
      return Response.json(sessions, { headers: corsHeaders });
    } catch (err: any) {
      return Response.json(
        { error: err.message ?? String(err) },
        { status: 500, headers: corsHeaders }
      );
    }
  }
}
```

- [ ] **Step 4: Rewrite POST /api/sessions/:id/push-to-bundle**

Replace the existing push-to-bundle handler to use `addEntriesToBundle`:

```typescript
{
  const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/push-to-bundle$/);
  if (match && req.method === "POST") {
    try {
      const sessionId = match[1];
      const { bundle_id, entry_ids } = await req.json();
      const mode = resolveBundleMode(bundle_id);

      // Ensure session is connected to this bundle
      try {
        connectSessionToBundle(sessionId, bundle_id, mode);
      } catch { /* already connected */ }

      // Get entry IDs to push
      const allEntries = getSessionEntries(sessionId);
      const ids = entry_ids
        ? entry_ids as string[]
        : allEntries.map((e) => e.id);

      if (mode === "local") {
        const { localAddEntriesToBundle } = await import("@ctx-link/core");
        const result = localAddEntriesToBundle(bundle_id, ids, sessionId);
        return Response.json(
          { ok: true, pushed: result.added, skipped: result.skipped, total: ids.length },
          { headers: corsHeaders }
        );
      }

      // Cloud: sync entries to cloud first (if session is cloud-enabled)
      const session = loadActiveSession(sessionId);
      if (session?.cloud_session_id) {
        await syncNewEntries(session);
      }

      const result = await addEntriesToBundle(bundle_id, ids);
      return Response.json(
        { ok: true, pushed: result.added, skipped: result.skipped, total: ids.length },
        { headers: corsHeaders }
      );
    } catch (err: any) {
      return Response.json(
        { error: err.message ?? String(err) },
        { status: 500, headers: corsHeaders }
      );
    }
  }
}
```

- [ ] **Step 5: Update DELETE /api/sessions/:id/entries/:entryId**

Update to also delete from cloud if session is cloud-enabled:

```typescript
{
  const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/entries\/([^/]+)$/);
  if (match && req.method === "DELETE") {
    try {
      const sessionId = match[1];
      const entryId = match[2];

      // Delete from local session file
      deleteSessionEntry(sessionId, entryId);

      // Delete from cloud (cascades to bundle_entry_refs)
      const session = loadActiveSession(sessionId);
      if (session?.cloud_session_id) {
        try {
          await deleteCloudSessionEntry(entryId);
        } catch { /* may not exist in cloud yet */ }
      }

      return Response.json({ ok: true }, { headers: corsHeaders });
    } catch (err: any) {
      return Response.json(
        { error: err.message ?? String(err) },
        { status: 500, headers: corsHeaders }
      );
    }
  }
}
```

- [ ] **Step 6: Add DELETE /api/bundles/:bundleId/entries/:entryId**

New endpoint to remove a single entry ref from a bundle (not delete the entry itself):

```typescript
{
  const match = url.pathname.match(/^\/api\/bundles\/([^/]+)\/entries\/([^/]+)$/);
  if (match && req.method === "DELETE") {
    try {
      const bundleId = match[1];
      const entryId = match[2];
      const mode = resolveBundleMode(bundleId);

      if (mode === "local") {
        const { localRemoveEntryFromBundle } = await import("@ctx-link/core");
        localRemoveEntryFromBundle(bundleId, entryId);
      } else {
        await removeEntryFromBundle(bundleId, entryId);
      }

      return Response.json({ ok: true }, { headers: corsHeaders });
    } catch (err: any) {
      return Response.json(
        { error: err.message ?? String(err) },
        { status: 500, headers: corsHeaders }
      );
    }
  }
}
```

- [ ] **Step 7: Update GET /api/graph to include cloud sessions per team**

Update the graph endpoint to include cloud sessions under each team (not just per bundle):

```typescript
const teamData = await Promise.all(
  teams.map(async (team) => {
    const [bundles, cloudSessions] = await Promise.all([
      listTeamBundles(team.team_id),
      listTeamSessions(team.team_id),
    ]);
    const bundlesWithDetails = await Promise.all(
      bundles.map(async (b) => {
        const status = await bundleStatus(b.bundle_id, "cloud", true);
        return {
          bundle_id: b.bundle_id,
          bundle_name: b.name,
          entry_count: status.entry_count,
          last_entry_at: status.last_entry_at,
        };
      })
    );
    return {
      team_id: team.team_id,
      team_name: team.name,
      bundles: bundlesWithDetails,
      cloud_sessions: cloudSessions,
    };
  })
);
```

Note: `BundleGraphData` no longer has a `sessions` array. Sessions are listed per team.

- [ ] **Step 8: Remove old imports and references to deleted functions**

Remove imports of `listBundleSessions`, `deleteProjectEntriesFromBundle`, `localDeleteProjectFromBundle`, `markSessionEntriesPushed` (no longer needed). Update the DELETE /api/sessions/:id handler to use `deleteCloudSession` instead of `deleteProjectEntriesFromBundle`.

- [ ] **Step 9: Run typecheck**

Run: `bun run typecheck 2>&1`
Expected: UI server may still have errors from type changes — fix any remaining issues.

- [ ] **Step 10: Commit**

```bash
git add packages/ui/server.ts
git commit -m "feat(ui): update server endpoints for reference model and cloud sessions"
```

---

### Task 9: Update UI Types

**Files:**
- Modify: `packages/ui/src/types.ts`

- [ ] **Step 1: Update types for cloud sessions and reference model**

```typescript
export interface ActiveSessionData {
  session_id: string;
  project_name: string;
  project_path: string;
  bundles: Array<{ bundle_id: string; mode: "local" | "cloud" }>;
  started_at: string;
  branch: string | null;
  entry_count?: number;
  cloud_session_id?: string | null;
  team_id?: string | null;
}

export interface CloudSessionData {
  id: string;
  team_id: string;
  project_name: string;
  project_path: string | null;
  machine_id: string;
  branch: string | null;
  started_at: string;
  last_active_at: string;
}

export interface GraphData {
  machine_id: string;
  teams: TeamGraphData[];
  local: { bundles: LocalBundleGraphData[] };
  sessions?: ActiveSessionData[];
}

export interface TeamGraphData {
  team_id: string;
  team_name: string;
  bundles: BundleGraphData[];
  cloud_sessions?: CloudSessionData[];
}

export interface BundleGraphData {
  bundle_id: string;
  bundle_name: string;
  entry_count: number;
  last_entry_at: string | null;
  // sessions array removed — sessions are now per team, not per bundle
}

// Remove SessionGraphData — no longer needed

export interface LocalBundleGraphData {
  bundle_id: string;
  bundle_name: string;
  entry_count: number;
  last_entry_at: string | null;
  projects: Array<{
    project_name: string;
    last_entry_at: string | null;
  }>;
}

// Entry types
export interface EntryRow {
  id: string;
  created_at: string;
  project_name: string;
  event_type: string;
  trigger_ref: string | null;
  summary: string;
  files_touched: string[];
  decisions: Array<{ decision: string; rationale?: string; affects: string[] }>;
  bundle_refs?: string[]; // bundle IDs referencing this entry
}

// Keep PushResult, RewindResult, RestoreResult, RewindLogRow, TeamInfo, CreateTeamResult as-is
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/types.ts
git commit -m "feat(ui): update types for cloud sessions and reference model"
```

---

### Task 10: Update UI API Client

**Files:**
- Modify: `packages/ui/src/lib/api.ts`

- [ ] **Step 1: Add new API functions**

Add to `packages/ui/src/lib/api.ts`:

```typescript
// Cloud Sessions
export function pushSessionToCloud(sessionId: string, body: { team_id: string }) {
  return apiPost<{ cloud_session_id: string; entries_synced: number }>(
    `/api/sessions/${sessionId}/push-to-cloud`,
    body,
  );
}

export function fetchTeamSessions(teamId: string) {
  return apiGet<CloudSessionData[]>(`/api/teams/${teamId}/sessions`);
}

// Bundle entry ref removal (removes ref, not the entry)
export function removeEntryFromBundle(bundleId: string, entryId: string) {
  return apiDelete<{ ok: true }>(`/api/bundles/${bundleId}/entries/${entryId}`);
}
```

Add `CloudSessionData` to the imports from `../types`.

- [ ] **Step 2: Remove obsolete functions**

The `joinBundle` function currently pushes a placeholder entry. With the reference model, joining a bundle just creates the link — no entry copying. Update `joinBundle` to not pass `session_id` (the server will handle this differently now).

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/api.ts
git commit -m "feat(ui): add push-to-cloud and removeEntryFromBundle API functions"
```

---

### Task 11: Update buildGraph.ts for Independent Sessions

**Files:**
- Modify: `packages/ui/src/lib/buildGraph.ts`

- [ ] **Step 1: Update buildGroup to accept cloud sessions**

Add `cloudSessions` to `GroupInput`:

```typescript
interface GroupInput {
  groupId: string;
  groupName: string;
  color: string;
  bundles: BundleGraphData[];
  machineId: string;
  isLocal: boolean;
  activeSessions?: ActiveSessionData[];
  cloudSessions?: CloudSessionData[];
}
```

- [ ] **Step 2: Include cloud sessions in project grouping**

Inside `buildGroup`, after the active sessions loop (around line 75), add cloud sessions:

```typescript
if (cloudSessions) {
  for (const cs of cloudSessions) {
    const key = cs.project_name;
    if (!projectSessions.has(key)) projectSessions.set(key, []);
    const existing = projectSessions.get(key)!;
    // Don't duplicate if an active session already covers this cloud session
    if (!existing.some((e) => e.sessionId === cs.id)) {
      existing.push({
        sessionId: cs.id,
        machineId: cs.machine_id,
        lastActiveAt: cs.last_active_at,
        bundleId: "",
        branch: cs.branch,
        entryCount: 0, // could be enriched later
      });
    }
  }
}
```

- [ ] **Step 3: Remove bundle.sessions references**

Remove the loop at lines 40-55 that reads `bundle.sessions` (old `SessionGraphData`). Bundle nodes no longer carry sessions — sessions come from `cloudSessions` and `activeSessions`.

- [ ] **Step 4: Update buildFlowGraph to pass cloudSessions**

In `buildFlowGraph`, when building team groups, pass `cloud_sessions` from the team data:

```typescript
const { nodes, edges } = buildGroup({
  groupId: `team-${team.team_id}`,
  groupName: team.team_name,
  color: teamColor(team.team_name),
  bundles: team.bundles,
  machineId: data.machine_id,
  isLocal: false,
  activeSessions: teamActiveSessions,
  cloudSessions: team.cloud_sessions,
});
```

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck 2>&1`
Expected: passes

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/lib/buildGraph.ts
git commit -m "feat(ui): update graph builder for independent cloud sessions"
```

---

### Task 12: Update MCP Server

**Files:**
- Modify: `packages/mcp-server/src/index.ts`

- [ ] **Step 1: Add session_push_to_cloud tool definition**

Add to the tools array:

```typescript
{
  name: "session_push_to_cloud",
  description:
    "Push the current local session to the cloud under a team. " +
    "All session entries are synced. Future entries auto-sync. " +
    "Required before connecting to cloud bundles from the UI.",
  inputSchema: {
    type: "object",
    properties: {
      team_id: { type: "string", description: "Team ID to push the session under" },
    },
    required: ["team_id"],
  },
},
```

- [ ] **Step 2: Add session_push_to_cloud handler**

In the tool handler switch:

```typescript
case "session_push_to_cloud": {
  const a = z.object({ team_id: z.string() }).parse(args);
  const session = getSession();
  if (!session) return fail("No active session.");

  const { pushSessionToCloud } = await import("@ctx-link/core");
  const result = await pushSessionToCloud(session.session_id, a.team_id);
  return ok({
    cloud_session_id: result.cloud_session_id,
    entries_synced: result.entries_synced,
    message: `Session pushed to cloud. ${result.entries_synced} entries synced.`,
  });
}
```

- [ ] **Step 3: Update context_push handler**

Update the `context_push` handler to use `addEntriesToBundle` instead of `pushEntry`. When pushing to a bundle, it should:
1. Sync entries to cloud if session is cloud-enabled
2. Create `bundle_entry_refs` for the entry IDs

Replace the push loop with:

```typescript
case "context_push": {
  // ... parse args ...
  const session = getSession();
  if (!session) return fail("No active session.");

  // If consolidate mode with source_entry_ids, use those entries
  // Otherwise, push all unpushed session entries
  const entryIds = args.source_entry_ids ?? getUnpushedSessionEntries(session.session_id).map(e => e.id);

  if (entryIds.length === 0) return fail("No entries to push.");

  // Sync to cloud first if cloud-enabled
  if (session.cloud_session_id) {
    const { syncNewEntries } = await import("@ctx-link/core");
    await syncNewEntries(session);
  }

  // Push to specified bundle or all connected bundles
  const targetBundles = args.bundle_id
    ? [{ bundle_id: args.bundle_id, mode: isLocalBundle(args.bundle_id) ? "local" as const : "cloud" as const }]
    : session.bundles;

  const results = [];
  for (const b of targetBundles) {
    if (b.mode === "local") {
      const { localAddEntriesToBundle } = await import("@ctx-link/core");
      const r = localAddEntriesToBundle(b.bundle_id, entryIds, session.session_id);
      results.push({ bundle_id: b.bundle_id, added: r.added, skipped: r.skipped });
    } else {
      const { addEntriesToBundle } = await import("@ctx-link/core");
      const r = await addEntriesToBundle(b.bundle_id, entryIds);
      results.push({ bundle_id: b.bundle_id, added: r.added, skipped: r.skipped });
    }
  }

  return ok({ pushed: results });
}
```

- [ ] **Step 4: Update session_log handler**

After creating a local entry via `pushSessionEntry`, auto-sync to cloud:

```typescript
// After pushSessionEntry call:
if (session.cloud_session_id) {
  const { syncEntryToCloud } = await import("@ctx-link/core");
  await syncEntryToCloud(session, entry);
}
```

- [ ] **Step 5: Remove source_entry_delete tool or update it**

The `source_entry_delete` tool removed a source entry from a consolidated bundle entry's `source_entries` JSONB. With the reference model, there are no consolidated entries. This tool should be replaced with a tool that removes a single entry ref from a bundle:

```typescript
{
  name: "bundle_remove_entry",
  description: "Remove a single entry reference from a bundle. The session entry itself is NOT deleted.",
  inputSchema: {
    type: "object",
    properties: {
      bundle_id: { type: "string" },
      entry_id: { type: "string" },
    },
    required: ["bundle_id", "entry_id"],
  },
}
```

Handler:
```typescript
case "bundle_remove_entry": {
  const a = z.object({ bundle_id: z.string(), entry_id: z.string() }).parse(args);
  if (isLocalBundle(a.bundle_id)) {
    const { localRemoveEntryFromBundle } = await import("@ctx-link/core");
    localRemoveEntryFromBundle(a.bundle_id, a.entry_id);
  } else {
    const { removeEntryFromBundle } = await import("@ctx-link/core");
    await removeEntryFromBundle(a.bundle_id, a.entry_id);
  }
  return ok({ removed: true });
}
```

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck 2>&1`
Expected: passes

- [ ] **Step 7: Commit**

```bash
git add packages/mcp-server/src/index.ts
git commit -m "feat(mcp): add session_push_to_cloud, update context_push for reference model"
```

---

### Task 13: Update CLI Commands

**Files:**
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Add push-to-cloud command**

```typescript
program
  .command("push-to-cloud")
  .description(
    "Push the current session to the cloud under a team.\n" +
    "All session entries are synced. Future entries auto-sync.\n\n" +
    "Example:\n" +
    "  $ ctx-link push-to-cloud"
  )
  .option("--team <team_id>", "team ID (prompted if not given)")
  .action(async (opts) => {
    const sessionId = getActiveSessionId();
    if (!sessionId) {
      console.error("No active session.");
      process.exit(1);
    }

    let teamId = opts.team;
    if (!teamId) {
      const teams = listMyTeams();
      if (teams.length === 0) {
        console.error("No teams found. Create one first with 'ctx-link create-team'.");
        process.exit(1);
      }
      teamId = await select({
        message: "Which team?",
        choices: teams.map(t => ({
          name: t.name,
          value: t.team_id,
          description: t.team_id,
        })),
      });
    }

    const { pushSessionToCloud } = await import("@ctx-link/core");
    const result = await pushSessionToCloud(sessionId, teamId);
    console.log(`Session pushed to cloud.`);
    console.log(`  Cloud ID: ${result.cloud_session_id}`);
    console.log(`  Entries synced: ${result.entries_synced}`);
  });
```

- [ ] **Step 2: Update push command for reference model**

The `push` command currently calls `pushEntry` which copies entries. Update it to use `addEntriesToBundle` for creating refs. The `--consolidate` flag is removed (no more consolidation).

Update the push action to:
1. Get session entry IDs (all or filtered by `--entry-ids`)
2. Sync to cloud if cloud-enabled
3. Call `addEntriesToBundle` for each connected bundle

- [ ] **Step 3: Update pull command**

The `pull` command calls `pullEntries` which now uses the JOIN path. It should work as-is since `pullEntries` was rewritten. Verify the output format matches.

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck 2>&1`
Expected: passes

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): add push-to-cloud command, update push for reference model"
```

---

### Task 14: Update UI Components — Entry Badges and Push Dialog

**Files:**
- Modify: `packages/ui/src/components/EntryCard.tsx`
- Modify: `packages/ui/src/components/EntryPanel.tsx`
- Modify: `packages/ui/src/components/PushSessionToBundleDialog.tsx`
- Modify: `packages/ui/src/stores/uiStore.ts`

- [ ] **Step 1: Add push-to-cloud modal state to store**

In `packages/ui/src/stores/uiStore.ts`, add a new modal type:

Add `"push-to-cloud"` to the `ModalType` union (find the `activeModal` type).

Add state:
```typescript
pushToCloudTarget: string | null; // session_id being pushed to cloud
```

Add action:
```typescript
openPushToCloud(sessionId: string): void;
```

- [ ] **Step 2: Update EntryCard to show bundle ref count**

In `packages/ui/src/components/EntryCard.tsx`, accept an optional `bundleRefCount` prop:

```typescript
interface EntryCardProps {
  entry: EntryRow;
  onDelete?: () => void;
  bundleRefCount?: number; // how many bundles reference this entry
}
```

Show a badge when `bundleRefCount > 0`:
```tsx
{bundleRefCount != null && bundleRefCount > 0 && (
  <span className="text-xs text-mauve bg-surface0 px-1.5 py-0.5 rounded">
    in {bundleRefCount} bundle{bundleRefCount !== 1 ? "s" : ""}
  </span>
)}
```

- [ ] **Step 3: Update PushSessionToBundleDialog for entry selection**

The dialog should:
1. Show all session entries with checkboxes (all selected by default)
2. Gray out entries already pushed to the target bundle
3. Show count: "N new, M already in bundle"
4. Submit only creates refs for selected new entries

This requires fetching which entries already have refs in the target bundle. Add a query or pass this info from the parent.

- [ ] **Step 4: Update EntryPanel for bundle entries**

When showing bundle entries (panel type "bundle"), add a "remove from bundle" action per entry that calls `removeEntryFromBundle` instead of deleting the entry.

- [ ] **Step 5: Run typecheck and test visually**

Run: `bun run typecheck 2>&1`
Start: `bun run dev:ui-api` and `bun run dev:ui`
Test: Open the UI, verify sessions show up, push to cloud works, entries display correctly.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/ packages/ui/src/stores/
git commit -m "feat(ui): add bundle ref badges, push-to-cloud dialog, entry selection"
```

---

### Task 15: Add Push-to-Cloud UI Flow

**Files:**
- Create or modify: `packages/ui/src/components/PushToCloudDialog.tsx`
- Modify: `packages/ui/src/components/nodes/ProjectNode.tsx`

- [ ] **Step 1: Create PushToCloudDialog**

A dialog that:
1. Lists teams the user belongs to
2. User picks a team
3. Calls `POST /api/sessions/:id/push-to-cloud`
4. Shows result (entries synced count)
5. Closes and refreshes graph

- [ ] **Step 2: Add "Push to Cloud" button on session rows**

In `ProjectNode.tsx`, add a cloud upload icon button on session rows where `cloud_session_id` is null. Clicking opens the PushToCloudDialog.

For sessions already in the cloud, show a small cloud icon indicator.

- [ ] **Step 3: Add mutation hook**

Create `packages/ui/src/hooks/usePushToCloud.ts`:

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { pushSessionToCloud } from "../lib/api";
import { toast } from "sonner";

export function usePushToCloud() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, teamId }: { sessionId: string; teamId: string }) =>
      pushSessionToCloud(sessionId, { team_id: teamId }),
    onSuccess: (data) => {
      toast.success(`Session pushed to cloud. ${data.entries_synced} entries synced.`);
      qc.invalidateQueries({ queryKey: ["graph"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
```

- [ ] **Step 4: Test the flow end-to-end**

Start: `bun run dev:ui-api` and `bun run dev:ui`
Test:
1. Open UI
2. See a local session in the graph
3. Click "Push to Cloud" on the session row
4. Pick a team
5. Verify session appears under the team group in the graph
6. Verify entries are visible

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/ packages/ui/src/hooks/
git commit -m "feat(ui): add push-to-cloud dialog and session cloud indicator"
```

---

### Task 16: Update CLAUDE.md and Final Typecheck

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md data model section**

Update the data model to reflect the new architecture:

```
teams → cloud_sessions → cloud_session_entries
                                    ↳ bundle_entry_refs → bundles
                              ↳ rewind_log (audit trail)
```

Update the "Important Patterns" section with:
- Sessions are local-first, promoted to cloud via "Push to Cloud"
- Entries live in sessions, bundles reference them via `bundle_entry_refs`
- Delete entry from session → cascades to all bundle refs
- Remove entry from bundle → only removes the ref

- [ ] **Step 2: Run full typecheck**

Run: `bun run typecheck 2>&1`
Expected: all 5 packages pass with 0 errors

- [ ] **Step 3: Run the UI and verify**

Start: `bun run dev:ui-api` and `bun run dev:ui`
Test the full flow:
1. Session appears locally
2. Push to cloud works
3. Connect session to bundle → entries become refs
4. Push again → only new entries added
5. Delete entry from session → removed from bundle
6. Remove entry from bundle → session entry survives
7. Rewind works on session entries

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for cloud sessions reference model"
```
