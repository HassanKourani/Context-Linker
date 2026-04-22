# ctx-link — Full Todo List

## Phase 1: Get it installing

- [ ] Clone the repo and cd into it
- [ ] Run `bun install` at the root
- [ ] If argon2 fails to build: swap dependency to `@node-rs/argon2` in `packages/core/package.json` and update imports in `packages/core/src/bundles.ts` (API is nearly identical)
- [ ] Run `bun run typecheck` across workspaces, fix any TypeScript errors
- [ ] Verify all three `tsconfig.json` files resolve correctly

## Phase 2: Supabase setup

- [ ] Create a Supabase project at supabase.com
- [ ] Copy the project URL
- [ ] Copy the `service_role` key from Settings → API
- [ ] Run `supabase/migrations/0001_init.sql` in the SQL editor, verify no errors
- [ ] Run `supabase/migrations/0002_rewind.sql`, verify no errors
- [ ] In the Table Editor, confirm tables exist: `bundles`, `sessions`, `entries`, `rewind_log`
- [ ] Confirm the partial index `entries_active_idx` exists

## Phase 3: CLI smoke test

- [ ] Run `bun packages/cli/src/index.ts init --supabase-url ... --supabase-key ... --anthropic-key ...`
- [ ] Verify `~/.ctx-link/config.json` was written with mode 600
- [ ] Verify `machine_id` was generated
- [ ] cd into a throwaway repo with a `package.json`, run `ctx-link create test-bundle`
- [ ] Verify a row appeared in the `bundles` table
- [ ] Verify `~/.ctx-link/tokens.json` now has the token
- [ ] Verify `.ctx-link.json` was created in the repo with the bundle ID
- [ ] Run `ctx-link list`, confirm the bundle shows up
- [ ] Run `ctx-link status <bundle_id>`, confirm it returns stats (exercises token verify)
- [ ] Run `ctx-link push --event manual --message "first test push"` and watch for errors
- [ ] Verify a row appeared in `entries` table, with `summary` field populated (exercises Anthropic API)
- [ ] Verify a row appeared in `sessions` table
- [ ] Run `ctx-link pull` and confirm the summary comes back
- [ ] Run `ctx-link pull --include-self` and confirm you see your own entry

## Phase 4: Cross-repo round trip

- [ ] Create a second test repo (or use a real one)
- [ ] Run `ctx-link join <bundle_id> <token>` in the second repo
- [ ] Verify second session row in DB
- [ ] `ctx-link push --event manual --message "from project B"` in the second repo
- [ ] `ctx-link pull` in the first repo, confirm you see project B's entry
- [ ] Confirm `project_name` is correctly labeled on each entry

## Phase 5: Rewind testing

- [ ] In one project, push 5 test entries via `ctx-link push --event manual --message "entry N"`
- [ ] Run `ctx-link rewind --bundle <id> --project <name> --last-n 3` (dry-run by default)
- [ ] Verify the preview shows the correct 3 entries
- [ ] Re-run with `--apply`, confirm `rewind_log` row is created
- [ ] `ctx-link pull` — confirm rewound entries are hidden
- [ ] Run `ctx-link rewind-history <id>`, confirm the log entry
- [ ] Run `ctx-link restore --bundle <id> --project <name> --from-log <log_id>`
- [ ] `ctx-link pull` again, confirm entries are back
- [ ] Test `--after-ref` strategy with a real commit SHA
- [ ] Test the 50-entry safety cap by trying to rewind more than 50 and confirm it refuses without `--force`

## Phase 6: MCP server integration

- [ ] Verify `claude-sonnet-4-5` is a valid model string (search Anthropic docs for current model names)
- [ ] Register the MCP server in `~/.claude.json` with absolute paths
- [ ] Restart Claude Code
- [ ] Run `/mcp` in Claude Code, confirm `ctx-link` shows as connected
- [ ] From inside Claude Code, ask: "list my ctx-link bundles" — confirm tool calls work
- [ ] Ask Claude Code to pull context from a bundle, confirm it gets the formatted summary
- [ ] Ask Claude Code to push a manual entry, confirm it appears in DB
- [ ] Check stderr output of the MCP server for any warnings

## Phase 7: Git hook integration

- [ ] Copy `packages/hooks/post-commit.sh` to `.git/hooks/post-commit` in a test repo
- [ ] `chmod +x .git/hooks/post-commit`
- [ ] Make a test commit, watch for the push
- [ ] Verify new entry appeared in DB with `event_type: "commit"` and correct SHA as `trigger_ref`
- [ ] Make another commit immediately, verify debounce kicks in and skips the push
- [ ] Wait 10+ minutes, commit again, verify it pushes

## Phase 8: Claude Code PostToolUse hook

- [ ] Add the hook config to `~/.claude/settings.json`
- [ ] Verify the hook script path is absolute and executable
- [ ] In a Claude Code session, ask it to run `git commit -m "test"` on a dummy change
- [ ] Confirm a new DB entry appears
- [ ] Test `gh pr create` path (if you have `gh` installed and a real branch ready)
- [ ] If the hook fails silently: add `set -x` temporarily to `claude-code-hook.sh` and check where output goes

## Phase 9: Install globally

- [ ] Add `alias ctx-link="bun /absolute/path/.../packages/cli/src/index.ts"` to shell rc
- [ ] Or create `/usr/local/bin/ctx-link` wrapper script
- [ ] Verify `ctx-link list` works from any directory
- [ ] Verify hooks still work now that CLI is globally accessible

## Phase 10: Real-world dogfood

- [ ] Pick a real cross-repo task (e.g., adding a new API endpoint + consuming it in frontend)
- [ ] Create a bundle, join both repos
- [ ] Work a full session in one repo, commit as normal
- [ ] Start Claude Code in the other repo, ask it to pull bundle context
- [ ] Evaluate summary quality — are decisions captured? Are file paths accurate? Is anything important missing?
- [ ] Iterate on the summarization prompt in `packages/core/src/summarize.ts` based on what you see

## Phase 11: Known gaps to address

- [ ] Write a proper bin entry so `ctx-link` works without `bun ...` prefix (publish to npm or make a shell wrapper)
- [ ] Add a `bun.lockb` commit once install works
- [ ] Add basic unit tests for bundle create/join/verify and rewind scope enforcement
- [ ] Add an integration test that runs against a disposable Supabase (or a pg-mem shim)
- [ ] Improve error messages (especially around "bundle not found or token invalid" which is deliberately vague, but could be clearer for self-ops)
- [ ] Add a `ctx-link delete-bundle <id>` command (currently you'd have to delete via SQL)
- [ ] Tighten Supabase return types with `supabase gen types typescript`
- [ ] Replace `any` casts in `rewind.ts` and `entries.ts` with generated types

## Phase 12: Future features (post-MVP)

- [ ] End-to-end encryption: generate key on bundle_create, embed in token, encrypt summaries client-side with AES-GCM before writing to Supabase
- [ ] Cloud mode: wrap core in an HTTP handler, deploy to Railway/Fly/CF Workers, implement the `mode: "cloud"` config path
- [ ] Web UI: lightweight React/Vite app showing bundle timelines, manual push approval, rewind controls
- [ ] Smarter rollup: batch commits within N minutes into one entry instead of one entry per commit
- [ ] Per-user permissions in team bundles (currently any token holder can rewind anyone's entries)
- [ ] Git notes sync so summaries are mirrored into the repo itself
- [ ] `ctx-link diff <bundle_id>` to show what's changed since last pull
- [ ] Notification/subscription mode: push entries to Slack or a webhook when they're created

## Phase 13: Ship it

- [ ] Publish `@ctx-link/cli` to npm (after tests exist)
- [ ] Write a blog post about the design
- [ ] Add GitHub Actions CI for typecheck + tests
- [ ] Add a `CHANGELOG.md`
- [ ] Tag v0.1.0 release

---

## UI Phases

### Phase U0: Decide scope before starting

- [ ] Pick the variant:
  - **Option A:** Read-only local dashboard (half day). Browse bundles, view timelines, filter by project. No writes.
  - **Option B:** Full interactive dashboard (1-2 days). Adds rewind UI, restore, manual push approval, diff previews.
  - **Option C:** TUI instead of web (half day). Terminal-based using Ink.
- [ ] Decide: standalone deployed tool, or purely local-first (just `bun run dev:ui`)?
- [ ] Decide: read from Supabase directly with anon key + RLS, or go through a thin local API that proxies through core?

### Phase U1: Scaffold the package

- [ ] Create `packages/ui/` directory in the monorepo
- [ ] Run `bun create vite` inside (pick React + TypeScript template)
- [ ] Add `packages/ui/package.json` name as `@ctx-link/ui`, set `type: "module"`, add workspace dep on `@ctx-link/core`
- [ ] Add to root `package.json` scripts: `"dev:ui": "bun run --cwd packages/ui dev"`
- [ ] Install Tailwind + shadcn/ui
- [ ] Set up `tsconfig.json` extending the root
- [ ] Add `.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (not `service_role`, this is client-side)
- [ ] Verify `bun run dev:ui` serves a blank React page at localhost:5173

### Phase U2: Supabase access layer (read-only)

- [ ] Add Supabase anon key to the config schema in `packages/core/src/config.ts` (currently only stores `service_role`)
- [ ] Update `ctx-link init` to optionally accept `--supabase-anon-key` for UI use
- [ ] Add RLS policies to Supabase so the anon key can only read bundles the user has joined:
  - [ ] Create a `bundle_access` view or RPC that joins bundles with a bearer-token header check
  - [ ] Or simpler for local-only UI: use the `service_role` key from a local-only dev env (accept the tradeoff)
- [ ] Create `packages/ui/src/lib/supabase.ts` with the browser Supabase client
- [ ] Test basic query: list bundles for a known `machine_id`

### Phase U3: Data hooks

- [ ] Install TanStack Query (`@tanstack/react-query`) for data fetching
- [ ] Create `packages/ui/src/hooks/useBundles.ts` that lists bundles by reading local `~/.ctx-link/tokens.json` via a tiny local API, or hardcode for MVP
- [ ] Create `packages/ui/src/hooks/useBundleStatus.ts` wrapping `bundle_status` query
- [ ] Create `packages/ui/src/hooks/useEntries.ts` for paginated entries per bundle
- [ ] Create `packages/ui/src/hooks/useSessions.ts` for sessions in a bundle
- [ ] Create `packages/ui/src/hooks/useRewindHistory.ts`

### Phase U4: Core views (read-only MVP)

**Bundle list page (`/`)**
- [ ] Render a sidebar or grid of bundles this machine has joined
- [ ] Show per-bundle: name, entry count, last activity, linked sessions (project names as chips)
- [ ] Empty state: "No bundles yet. Run `ctx-link create <name>` in a repo to start."
- [ ] Click bundle → navigate to detail view

**Bundle detail page (`/bundles/:id`)**
- [ ] Header: bundle name, ID, session chips, "copy join token" button
- [ ] Timeline view of entries (newest first)
- [ ] Each entry card shows:
  - [ ] Project name badge (color-coded per project)
  - [ ] Timestamp (relative + absolute on hover)
  - [ ] Event type icon (commit, PR, manual, session_end)
  - [ ] Trigger ref (commit SHA as monospace)
  - [ ] Summary text
  - [ ] Files touched (expandable list)
  - [ ] Decisions (structured render with `affects` chips)
- [ ] Toggle: show superseded entries (grayed out)
- [ ] Filter controls: by project, by event type, by date range
- [ ] Pagination or infinite scroll

**Session view (subsection of bundle detail)**
- [ ] List all sessions (per-project-per-machine) with last active time
- [ ] Show which machine is you (highlight current `machine_id`)

### Phase U5: Visual polish

- [ ] Color-code projects consistently (hash `project_name` → HSL color)
- [ ] Add a project-lane timeline view: one column per project, entries flow down, so cross-project handoffs are visually obvious
- [ ] Dark mode support (Tailwind + shadcn handles this mostly for free)
- [ ] Empty states for every view
- [ ] Loading skeletons (not spinners)
- [ ] Relative time with `date-fns` or similar, refresh every minute
- [ ] Monospace for IDs, SHAs, tokens
- [ ] Truncate long summaries with "show more" expand

### Phase U6: Interactive features (Option B upgrade)

> These require writing to Supabase from the UI, which means either proxying through a local API or using the `service_role` key in a local-only dev context.

**Rewind UI**
- [ ] "Rewind" button on each entry → opens a modal
- [ ] Modal shows: strategy picker (`since` / `last_n` / `entry_ids` / `after_ref`), reason input, dry-run preview
- [ ] Dry-run preview shows which entries will be affected with visual strikethrough
- [ ] "Apply rewind" button with confirmation
- [ ] Success toast with link to restore

**Restore UI**
- [ ] Rewind history page (`/bundles/:id/rewinds`)
- [ ] List past rewinds with affected entry count, reason, timestamp
- [ ] "Restore" button per rewind log entry
- [ ] "Restore specific entries" multi-select from within a rewind log detail view

**Manual push UI**
- [ ] "Push manual entry" button on bundle detail page
- [ ] Textarea for message, project selector (pulls from config), `event_type` picker
- [ ] Preview the generated summary before committing (calls Anthropic, shows result, "looks good / regenerate / cancel")

**Bundle management**
- [ ] Create new bundle from UI
- [ ] Join existing bundle (paste ID + token)
- [ ] "Copy join token" one-click
- [ ] Delete bundle (with confirmation showing what gets lost)

### Phase U7: Advanced views

- [ ] Cross-bundle activity feed: "everything across all my bundles in the last 24h"
- [ ] Per-project view: "show me everything project X has contributed across all its bundles"
- [ ] Diff viewer: render diffs with syntax highlighting (use `react-diff-viewer` or `shiki`)
- [ ] Search: full-text search across summaries and decisions
- [ ] Export: download a bundle's timeline as markdown
- [ ] Stats: entries per project per week, most-rewound projects, avg summary length

### Phase U8: Local-only deployment

- [ ] Document the dev flow in the README: `bun run dev:ui` → opens localhost:5173
- [ ] Add a production build: `bun run build:ui` → serves from `packages/ui/dist`
- [ ] Optional: add a `ctx-link ui` CLI command that builds then starts a tiny serve instance
- [ ] Optional: bundle the UI into an Electron/Tauri shell for a real desktop app (stretch goal)

### Phase U9: Deploy as a hosted web app (far-future)

> Only relevant if you ever build cloud mode from the main roadmap.

- [ ] Migrate from direct Supabase access to going through the cloud MCP HTTP endpoint
- [ ] Add proper auth (Supabase Auth or Clerk)
- [ ] Multi-user bundle permissions (owner, member, viewer)
- [ ] Billing / quota if this becomes a real product
- [ ] Public marketing site explaining the concept

### Phase U10: Polish and ship

- [ ] Keyboard shortcuts (cmd+k for bundle switcher, `r` to refresh, etc.)
- [ ] Responsive design for tablet
- [ ] Accessibility pass (screen reader, keyboard nav)
- [ ] Analytics if you care (Plausible, PostHog)
- [ ] User onboarding: first-run tutorial overlay
- [ ] Screenshot + demo GIF for the README

---

> **Suggested order for maximum impact per hour (Option A, one-day sprint):**
> 1. U1 — scaffold (1-2h)
> 2. U2 — Supabase read access (1h)
> 3. U3 — data hooks (1h)
> 4. U4 — bundle list + timeline view (3-4h)
> 5. U5 — project-lane visual (2h — this is the "aha" view)
