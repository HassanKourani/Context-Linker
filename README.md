# ctx-link

**Connect Claude Code sessions across projects via shared context bundles.**

When you're building a feature that spans multiple repos (e.g., backend API + frontend web + mobile client), each Claude Code session only knows about its own project. `ctx-link` lets sessions in different projects share context through named "bundles," so Claude in the frontend repo automatically knows what changed in the backend, and vice versa.

---

## Table of Contents

- [Why this exists](#why-this-exists)
- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Core concepts](#core-concepts)
- [CLI reference](#cli-reference)
- [MCP tool reference](#mcp-tool-reference)
- [Usage scenarios](#usage-scenarios)
- [Security model](#security-model)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)

---

## Why this exists

You're working on a feature that requires changes in two or more repos. You open Claude Code in the backend, make changes, commit. You switch to the frontend, open a new Claude Code session, and now you have to manually explain to Claude what you just did in the backend: the new endpoint shape, why you changed it, what the frontend should now expect.

`ctx-link` automates that handoff. When Claude Code in Project A makes a commit, a hook fires, the diff gets summarized by Claude into a short handoff note, and it's stored in a shared bundle. When you start working in Project B, Claude there can pull the bundle and see exactly what happened upstream.

The tool is designed to be surgical: context is scoped by project, rewindable when you go down a bad path, and stored in a way that keeps other projects' context untouched.

---

## How it works

```
Claude Code (Project A terminal)
    |
    | git commit
    v
Post-commit hook (local)
    |
    | ctx-link push
    v
MCP server (local)
    |
    | 1. Anthropic API: summarize the diff
    | 2. Supabase: store summary in bundle
    v
Supabase (cloud Postgres, shared mailbox)
    ^
    | MCP server on Machine B pulls
    |
Claude Code (Project B terminal) reads summary,
now knows what changed in Project A
```

All the interesting logic (summarization, hooks, MCP tools) runs locally on your machine. Supabase is just the shared mailbox. Your Anthropic API key never leaves your machine.

---

## Architecture

Monorepo with four packages (Bun workspaces):

```
ctx-link/
  packages/
    core/         # Supabase client, summarization, bundle + entry + rewind logic
    mcp-server/   # MCP protocol wrapper (stdio transport) with 9 tools
    cli/          # claude-link CLI for manual ops + hook targets
    hooks/        # Git post-commit + Claude Code PostToolUse hook scripts
  supabase/
    migrations/   # SQL schema (bundles, sessions, entries, rewind_log)
```

### Data model

```
bundles          -- a shared context container
  id              uuid  (unguessable)
  name            text  (human label)
  token_hash      text  (argon2)
  created_at      timestamptz
  created_by      text

sessions         -- one per (project, machine) that joined a bundle
  id              uuid
  bundle_id       uuid -> bundles
  project_name    text
  machine_id      text
  joined_at       timestamptz
  last_active_at  timestamptz

entries          -- the actual context handoffs
  id              uuid
  bundle_id       uuid -> bundles
  session_id      uuid -> sessions
  created_at      timestamptz
  event_type      text  ('commit' | 'pr_open' | 'manual' | 'session_end')
  trigger_ref     text  (commit SHA, PR number)
  summary         text  (AI-generated handoff note)
  files_touched   text[]
  decisions       jsonb
  raw_context     text  (optional: original diff)
  superseded_at   timestamptz  (soft-delete for rewind)
  superseded_reason text

rewind_log       -- audit trail for rewind operations
  id, bundle_id, project_name, strategy_kind, strategy_detail,
  affected_entry_ids, affected_count, reason, performed_by, performed_at
```

---

## Prerequisites

- **Bun** >= 1.0 (or Node 20+ with modifications)
- **Git**
- **Supabase project** (free tier is enough)
- **Anthropic API key** (for summarization)
- **Claude Code** installed and working

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/HassanKourani/Context-Linker.git ctx-link
cd ctx-link
bun install
```

### 2. Create a Supabase project

Go to [supabase.com](https://supabase.com), create a new project. From the project dashboard, grab:

- **Project URL** (e.g., `https://abcdefgh.supabase.co`)
- **service_role key** (Settings -> API -> `service_role` secret)

> The service_role key bypasses row-level security. The current design uses application-level auth (bearer tokens per bundle) because all clients are trusted (your machines). Do NOT expose this key to untrusted clients.

### 3. Run the migrations

In the Supabase SQL editor, run each file in `supabase/migrations/` in order:

1. `0001_init.sql` (creates bundles, sessions, entries)
2. `0002_rewind.sql` (adds soft-delete + rewind_log)

### 4. Initialize the global config

```bash
bun packages/cli/src/index.ts init \
  --supabase-url https://YOUR_PROJECT.supabase.co \
  --supabase-key YOUR_SERVICE_ROLE_KEY \
  --anthropic-key sk-ant-YOUR_KEY
```

This writes `~/.ctx-link/config.json` with mode `600` and generates a random `machine_id`.

### 5. (Optional) Alias the CLI globally

```bash
# In your shell rc (.zshrc, .bashrc):
alias ctx-link="bun /absolute/path/to/ctx-link/packages/cli/src/index.ts"
```

Or publish a wrapper script to `/usr/local/bin/ctx-link`:

```bash
#!/usr/bin/env bash
exec bun /absolute/path/to/ctx-link/packages/cli/src/index.ts "$@"
```

### 6. Register the MCP server with Claude Code

Edit `~/.claude.json` (or your project's `.mcp.json`):

```json
{
  "mcpServers": {
    "ctx-link": {
      "command": "bun",
      "args": ["/absolute/path/to/ctx-link/packages/mcp-server/src/index.ts"]
    }
  }
}
```

Restart Claude Code. Verify with `/mcp` that `ctx-link` shows up.

### 7. (Optional) Wire up auto-push hooks

**Git post-commit hook** (per repo):

```bash
cd /path/to/your/project
cp /path/to/ctx-link/packages/hooks/post-commit.sh .git/hooks/post-commit
chmod +x .git/hooks/post-commit
```

**Claude Code PostToolUse hook** (global, catches `git commit` and `gh pr create` from inside Claude Code):

Edit `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/ctx-link/packages/hooks/claude-code-hook.sh"
          }
        ]
      }
    ]
  }
}
```

---

## Core concepts

### Bundle

A shared context container. Created by one machine, joined by others via a token. All participants can push and pull context.

### Session

One per (project, machine) combination that has joined a bundle. If you work on the same project from your laptop and desktop, those are two sessions but contribute to the same `project_name` in the bundle.

### Entry

A single handoff note. Has a summary, a list of touched files, structured decisions, and a timestamp. Entries are traceable back to the session (and therefore project) that created them.

### Project name

The label that identifies which project an entry came from. Derived from `package.json` name by default, falls back to directory name. Displayed prominently in every pulled entry so Claude always knows the source.

### Soft-delete / rewind

Entries can be marked `superseded_at` to hide them from future pulls without physically deleting them. Scoped per-project so rewinds in one project never affect others. Fully reversible via `restore`.

---

## CLI reference

### `init`
Create the global config.

```bash
ctx-link init --supabase-url <url> --supabase-key <key> --anthropic-key <key>
```

### `create <name>`
Create a new bundle. Prints a `bundle_id` and `join_token`. Share both with collaborators.

```bash
ctx-link create feature-notifications
```

### `join <bundle_id> <token>`
Join an existing bundle from the current repo. Detects project name from `package.json` or directory name.

```bash
ctx-link join 7f3a... ctxl_aH3k...RzY9
```

### `list`
List bundles this machine has joined.

```bash
ctx-link list
```

### `status <bundle_id>`
Show bundle status: linked sessions, entry count, last activity.

```bash
ctx-link status 7f3a...
```

### `push`
Manually push context from the current repo to its bundles.

```bash
# Use the last commit's diff
ctx-link push --event commit --ref $(git rev-parse HEAD) --diff

# Use a custom message
ctx-link push --event manual --message "Renamed /user/settings to /api/preferences; frontend should migrate"
```

### `pull [bundle_id]`
Pull recent entries. If no `bundle_id` is given, pulls from all bundles in `.ctx-link.json`.

```bash
# Pull from all project bundles, excluding your own project
ctx-link pull

# Pull from one specific bundle, include your own project's entries
ctx-link pull 7f3a... --include-self

# Pull only entries since a timestamp
ctx-link pull --since 2026-04-22T12:00:00Z --limit 50
```

### `rewind`
Soft-delete entries from ONE project in a bundle. Other projects are structurally untouchable.

```bash
# Dry-run (default): see what would be rewound
ctx-link rewind --bundle 7f3a... --project colonist-frontend --last-n 3

# Apply it
ctx-link rewind --bundle 7f3a... --project colonist-frontend --last-n 3 --apply --reason "reverted bad abstraction"

# Rewind everything AFTER a specific commit (pivot itself is kept)
ctx-link rewind --bundle 7f3a... --project colonist-frontend --after-ref d8e1234 --apply

# Rewind entries since a timestamp
ctx-link rewind --bundle 7f3a... --project colonist-frontend --since 2026-04-22T14:00:00Z --apply

# Rewind specific entry IDs
ctx-link rewind --bundle 7f3a... --project colonist-frontend --entry-ids abc,def,ghi --apply

# Override the 50-entry safety cap
ctx-link rewind --bundle 7f3a... --project colonist-frontend --last-n 100 --apply --force
```

### `restore`
Undo a rewind.

```bash
# Restore everything currently superseded in this project
ctx-link restore --bundle 7f3a... --project colonist-frontend

# Restore only the entries from a specific rewind operation
ctx-link restore --bundle 7f3a... --project colonist-frontend --from-log <rewind_log_id>

# Restore specific entry IDs
ctx-link restore --bundle 7f3a... --project colonist-frontend --entry-ids abc,def
```

### `rewind-history <bundle_id>`
List past rewinds for a bundle.

```bash
ctx-link rewind-history 7f3a...
ctx-link rewind-history 7f3a... --project colonist-frontend --limit 50
```

---

## MCP tool reference

These are the tools Claude Code sees when `ctx-link` is registered as an MCP server.

| Tool | Purpose |
|---|---|
| `bundle_create` | Create a new bundle, returns id + join token |
| `bundle_join` | Join a bundle using id + token |
| `bundle_list` | List bundles this machine has joined |
| `bundle_status` | Get sessions, entry count, last activity for a bundle |
| `context_push` | Summarize raw context (diff/notes) and store in a bundle |
| `context_pull` | Get recent entries, formatted for injection into Claude's context |
| `context_rewind` | Soft-delete project-scoped entries (with dry_run, max_affected, force) |
| `context_restore` | Undo a rewind |
| `rewind_history` | List past rewinds |

In a Claude Code session, you can just ask: "pull context from bundle X" or "check what the backend has done today" and Claude will call the right tools.

---

## Usage scenarios

### Scenario 1: Starting a new cross-repo feature

You're about to add notifications across backend and frontend.

**In the backend repo:**
```bash
cd ~/work/colonist-api
ctx-link create feature-notifications
# Output:
#   ID:    7f3a1c8e-2b4d-4e1a-9c7f-1234567890ab
#   Name:  feature-notifications
#   Token: ctxl_aH3kPqR7mN2xL8vN4rZ9cT5bY1wF6kJ3

ctx-link push --event manual --message "Starting notifications feature. Plan: add /api/notifications endpoint with SSE."
```

**Share the bundle_id + token** with your frontend machine (or teammate) via Signal / 1Password / secure channel.

**In the frontend repo (possibly on another machine):**
```bash
cd ~/work/colonist-frontend
ctx-link join 7f3a1c8e-2b4d-4e1a-9c7f-1234567890ab ctxl_aH3kPqR7mN2xL8vN4rZ9cT5bY1wF6kJ3
```

Both repos are now linked. Commits from either side get auto-summarized and flow to the other (if you installed the hooks).

### Scenario 2: Claude Code picks up backend context before starting frontend work

Start a Claude Code session in the frontend repo:

> "Before we start, check ctx-link for what the backend has been doing on the notifications feature."

Claude calls `context_pull` with the bundle ID from `.ctx-link.json`, sees something like:

```
[2026-04-22T15:30:12Z] colonist-api . commit (a3f9b21)
Added GET /api/notifications endpoint. Returns SSE stream of
{id, type, payload, created_at}. Replaces the polling-based /notifications/list.
Files: handlers/notifications.go, routes/v2.go
Decisions:
  - Moved from REST polling to SSE [affects: frontend, mobile]
  - Event shape is flat, not nested under {notification: {...}} [affects: frontend]
```

Claude now knows the endpoint exists, its URL, its response shape, and the key decision to flag to you. You don't have to explain it.

### Scenario 3: Backend is solid, frontend went down a bad path

You spent the afternoon on frontend. The last 3 commits turned out to be a bad abstraction. You git-revert in the repo, but the bundle still has the bad handoff notes, which will confuse future Claude Code sessions.

```bash
# Preview
ctx-link rewind --bundle 7f3a... --project colonist-frontend --last-n 3

# Output:
# [DRY RUN] Would rewind 3 entries from colonist-frontend
#   - 4cd01...  [15:05Z]  commit (4cd0191)
#     Hacky fix on top of bad abstraction...
#   - 9b1ab...  [14:50Z]  commit (9b1ab47)
#     Doubled down on wrong abstraction...
#   - f2a3c...  [14:15Z]  commit (f2a3c88)
#     Bad abstraction in SettingsPanel...

# Apply
ctx-link rewind --bundle 7f3a... --project colonist-frontend --last-n 3 --apply \
  --reason "reverted bad settings abstraction, starting over"

# Audit log: abc-def-123
# Undo with: ctx-link restore --bundle 7f3a... --project colonist-frontend --from-log abc-def-123
```

Backend entries are untouched. Next time the backend session or mobile session runs `context_pull`, they see a clean timeline without the noise.

### Scenario 4: "After-ref" rewind (git reset semantics)

You want to keep everything up to and including commit `d8e1234`, but rewind every frontend entry after it:

```bash
ctx-link rewind --bundle 7f3a... --project colonist-frontend --after-ref d8e1234 --apply \
  --reason "reverted to d8e, redoing from there"
```

The pivot entry (`d8e1234`) stays. Everything later in the frontend's timeline is rewound. Backend entries at any timestamp are untouched.

### Scenario 5: Oops, rewound too far

```bash
# See recent rewinds
ctx-link rewind-history 7f3a...

# Output:
# 2026-04-22T16:30:12Z  colonist-frontend  last_n  3 entries
#   reason: reverted bad settings abstraction
#   log_id: abc-def-123

# Restore just that operation
ctx-link restore --bundle 7f3a... --project colonist-frontend --from-log abc-def-123
```

All 3 entries come back. They were never actually deleted.

### Scenario 6: Multiple bundles per repo

A single repo can participate in multiple bundles (e.g., one for a notifications feature, one for an auth refactor). Each bundle is independent.

```bash
cd ~/work/colonist-api
ctx-link create feature-notifications
# ... later
ctx-link create refactor-auth
# .ctx-link.json now has both bundle IDs

# Pull from all bundles this project is in
ctx-link pull

# Pull from just one
ctx-link pull 7f3a...
```

### Scenario 7: Solo cross-repo work on one machine

You don't need multiple machines. Even solo, `ctx-link` is useful when jumping between repos:

- Morning: work in backend, make commits, auto-push summaries
- Afternoon: open Claude Code in frontend, `context_pull` immediately tells Claude what you did this morning without you retyping it

The value isn't really about "multi-machine," it's about preserving context across session boundaries.

### Scenario 8: Team use

Share the bundle token with a teammate over Signal / 1Password. They run `ctx-link join` on their machine and their commits now flow into the same bundle. Claude sessions on either side see the union.

> Only share tokens with people you trust. There's no per-user permission model in the MVP; anyone with the token has full push/pull/rewind access to that bundle.

---

## Security model

- **Tokens are the credential.** Unguessable (32 chars from a 62-char alphabet, ~190 bits of entropy).
- **Stored hashed.** Supabase only has argon2 hashes. Plaintext tokens live locally in `~/.ctx-link/tokens.json` (mode 600).
- **Bundle IDs are UUIDs.** Not guessable; no "list all bundles" endpoint in the server.
- **Every operation verifies the token.** Before any push/pull/rewind, the server verifies the local token against the stored hash for that specific bundle.
- **No public access.** The service_role key should stay on your trusted machines. A public cloud-mode deployment is designed in (config has a `mode` flag) but not yet implemented.

What this MVP does NOT protect against:
- **End-to-end encryption is not implemented.** Summaries are plaintext in Supabase. Anyone with DB access (you, Supabase staff in a breach) could read them. Noted as a future improvement.
- **No per-user permissions.** Token holders can rewind each other's work. Fine for personal use, less fine for untrusted teams.

---

## Troubleshooting

### "ctx-link: global config not found"
Run `ctx-link init` with your Supabase + Anthropic credentials.

### "No local token for bundle <id>"
You haven't joined this bundle on this machine. Run `ctx-link join <bundle_id> <token>`.

### "Bundle not found or token invalid"
Either the bundle_id doesn't exist (typo?) or the token you stored doesn't match the current hash. Re-run `ctx-link join` with the correct token.

### Claude Code doesn't see the `ctx-link` MCP server
- Check `~/.claude.json` has the server registered with an absolute path
- Run `/mcp` in Claude Code to see server status
- Check the stderr output of the spawn (Claude Code shows MCP logs)
- Verify `bun` is in your PATH (try `which bun`)

### Hooks aren't firing
- For git hook: check `.git/hooks/post-commit` exists, is executable (`ls -la .git/hooks/post-commit`), and `.ctx-link.json` exists in the repo root.
- For Claude Code hook: check `~/.claude/settings.json` syntax and absolute paths.

### "push failed" or Anthropic errors
- Check your Anthropic key is set in `~/.ctx-link/config.json`
- Check you have API credit
- Check the model name in `.ctx-link.json` is valid (default `claude-sonnet-4-5`)

### Rewind affected too many entries
The safety cap (default 50) refuses bulk rewinds without `--force`. Either narrow your strategy or pass `--force` if you really mean it.

### I deleted a bundle in Supabase and now things are broken
Cascade deletes will clean up sessions, entries, and rewind_log automatically. Your local `~/.ctx-link/tokens.json` will still have the stale token; remove it manually or just ignore it.

---

## Roadmap

Not in MVP, candidates for future iterations:

- **End-to-end encryption** (client-side AES-GCM before writing to Supabase)
- **Cloud mode** (hosted MCP server with bearer-token auth, so teammates only need the endpoint URL)
- **Web UI** for bundle browsing, timeline view, approving summaries before push
- **Rate-limiting / smarter debounce** (cluster commits within N minutes into one rollup entry)
- **Per-user permissions** in team bundles
- **Summary quality tuning** based on event type (commits vs PRs vs manual notes)
- **Bidirectional sync with git notes** so summaries are also committed to the repo

---

## License

MIT

---

## Contributing

Built by [Hassan Kourani](https://github.com/HassanKourani). Issues and PRs welcome.
# Context-Linker
