# Manual QA — headers-first pull, entry edits, per-session sync

How to verify the changes from `feat/headers-first-pull-edits-sync` work end-to-end. Run these from the `ctx-link` repo root after applying migration 0012.

## Setup

```bash
# 1. Apply the migration to your Supabase project (or local supabase)
#    (your usual deploy path — supabase db push, or copy 0012 to your migration runner)

# 2. Build / install
bun install
bun run typecheck    # all four packages should exit 0
bun test             # 216 pass, 9 skip (RLS-dependent)
```

Open two Claude Code windows pointed at different repos that share a bundle (call them **A** and **B**), so you can verify cross-session behavior. If you only have one machine, two repos sharing a local bundle works — same code path.

---

## QA matrix

### 1. Title is required on `session_log`

In **A**:

```
session_log({ summary: "no title here" })   # expected: zod error, "title is required"
session_log({ title: "endpoint added", summary: "POST /api/x — { y }" })   # expected: ok
```

CLI equivalent:

```bash
ctxl session-log --message "no title here"          # expected: exits with "Provide --title"
ctxl session-log --title "x" --message "POST /x"    # expected: ok
```

### 2. `context_pull` returns headers, not bodies

In **A**, after a few `session_log` calls + `context_push`:

```
context_pull({ bundle_id: "<id>" })
```

Expected: `headers` array containing `{ id, title, project_name, event_type, trigger_ref, created_at, updated_at, role }`. **No** `summary`, `files_touched`, or `decisions` fields. The `rendered` block reads `Headers only — call entry_read with the IDs you want to read in full.`

Verify token saving: log ~20 entries with multi-line summaries (~500 tokens each). The full pull response should be under 10% of what a body-included pull would have been (sanity-check by eye — headers are ~30 tokens each).

### 3. `entry_read` fetches bodies for chosen IDs only

After a header pull, pick 2–3 IDs and call:

```
entry_read({ bundle_id: "<id>", entry_ids: ["<id1>", "<id2>"] })
```

Expected: `entries` array with full bodies (summary, files_touched, decisions). `rendered` is the markdown rendering grouped by role.

Negative case — entry not in bundle, or session not connected:

```
entry_read({ bundle_id: "<id>", entry_ids: ["bogus-id"] })   # returns count: 0, no error
```

(Disconnected bundle → fail message "Not connected to bundle … Use session_connect first.")

### 4. Filters compose

```
context_pull({ bundle_id, last_n: 3 })            # 3 newest headers
context_pull({ bundle_id, project: "frontend" })  # only frontend's headers
context_pull({ bundle_id, since: "<iso ts>" })    # only entries newer than ts
```

Verify counts match expectation.

### 5. Edit own entry — same session, success

In **A**:

```
session_log({ title: "v1 title", summary: "v1 body" })   # remember entry_id from response
session_edit_entry({ entry_id: "<id>", title: "v2 title" })
session_entries({ only_unpushed: false })                 # entry should show updated title
```

Expected: `edited: true`, `scope: "local"`, returned entry has new `title`, `created_at` unchanged, `updated_at` set.

CLI equivalent:

```bash
ctxl edit-entry <entry_id> --title "v2 title"
```

### 6. Edit own entry — different session, refused

In **B** (different active session), with an entry that A logged:

```
session_edit_entry({ entry_id: "<A's entry id>" })
```

Expected: failure with message about ownership. The error path: B's local entries don't contain that ID; B's `cloud_copies` (if any) don't own that cloud session — so we hit the "Entry not found in any session you own" branch.

### 7. Edit propagates via header pull

After **A**'s edit (#5), in **B**:

```
context_pull({ bundle_id: "<shared bundle>" })
```

Expected: header for the edited entry shows the new `title` and a non-null `updated_at`. The rendered text shows `(edited <ts>)` next to the line.

### 8. Sync tracker — fresh connect is in_sync

In **A**, fresh session, connect to a bundle, then immediately:

```
session_info()
```

Expected: `bundle_sync_status` for that bundle is `"in_sync"`. The active session's `bundle_sync[bundle_id].last_seen_at` is around "now".

### 9. Sync tracker — new activity flips to out_of_sync

In **B**: log a new entry and push it to the shared bundle.

In **A**:

```
session_info()
```

Expected: that bundle reports `sync: { state: "out_of_sync", new_since_last_seen: 1 }`. Other connected bundles still report `in_sync`.

```
context_pull({ bundle_id })
session_info()
```

Expected: after the pull, sync flips back to `"in_sync"`. The pull auto-advanced `last_seen_at` to the newest header's `created_at`.

### 10. Edit also triggers sync signal

In **B**: edit one of its own entries that's referenced by the shared bundle.

In **A**:

```
session_info()                # bundle reports out_of_sync (1 new — the edit)
context_pull({ bundle_id })   # header shows new title + updated_at
session_info()                # back to in_sync
```

### 11. CLI parity

```bash
# Headers + bodies
ctxl pull <bundle_id>                           # shows headers (id + title)
ctxl read <bundle_id> <entry_id_1> <entry_id_2> # fetches the bodies you picked
ctxl pull <bundle_id> --last-n 5                # five newest headers
ctxl pull <bundle_id> --project backend         # one project only

# Sync display
ctxl info                                       # each connected bundle shows in_sync or out_of_sync (N new)

# Edit
ctxl edit-entry <entry_id> --title "new" --summary "new body"
```

### 12. UI smoke test

```bash
bun run dev:ui-api    # port 5174
bun run dev:ui        # port 5173
```

Open the dashboard. Verify:

- [ ] Bundle nodes still render. Click one — entries panel still shows full content (uses `pullEntriesWithBodies` server-side).
- [ ] Connect/disconnect a session. No regressions.
- [ ] Rewind/restore an entry. No regressions.
- [ ] Hit `GET /api/graph` directly (`curl localhost:5174/api/graph | jq`):
  - Each bundle has a `last_activity_at` field.
  - Each session has a `bundle_sync` array, one entry per connected bundle, with `last_seen_at`, `last_activity_at`, `in_sync`.
- [ ] Hit `PATCH /api/sessions/<id>/entries/<entry_id>` with body `{ "title": "x" }` against an entry the session owns — expect `{ ok: true, scope: "local", entry: ... }`. Against an entry the session doesn't own — expect 404.

### 13. Migration safety on existing data

Spin up against a Supabase project that has pre-0012 entries:

```sql
-- Before 0012
select count(*) from cloud_session_entries where title is null;  -- expect: row count
-- Apply 0012
select count(*) from cloud_session_entries where title is null;  -- expect: 0
select count(*) from bundles where last_activity_at is null;     -- expect: 0
```

Pull from a bundle that has pre-0012 entries — agents should see derived titles (first line of summary, ≤120 chars).

---

## Quick reference: what changed under the hood

| Surface           | Before                              | After                                                |
| ----------------- | ----------------------------------- | ---------------------------------------------------- |
| `session_log`     | `summary` required                  | `title` + `summary` both required                    |
| `context_pull`    | Returns full bodies                 | Returns headers; advances `bundle_sync`              |
| `entry_read`      | (didn't exist)                      | New tool — fetches bodies for picked IDs             |
| `session_edit_entry` | (didn't exist)                   | New tool — edit your own entries                     |
| `session_info`    | Bundles list only                   | + per-bundle `sync` state                            |
| Bundle row        | `last_entry_at` (creation time)     | + `last_activity_at` (any change)                    |
| Entry row         | `summary`, `created_at`             | + `title`, `updated_at`                              |
| UI graph payload  | No activity / sync                  | + `last_activity_at` per bundle, `bundle_sync` per session |
