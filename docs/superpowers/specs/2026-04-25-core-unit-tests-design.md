# Core Unit Tests Design

## Context

ctx-link has zero tests. All core business logic lives in `packages/core/src/` across 8 modules. We just consolidated duplicated orchestration logic into `session-actions.ts`, and need tests to prevent regression. The rewind module is unstable and excluded.

## Scope

Unit tests for 7 core modules + 1 orchestration module using `bun:test`. No Supabase integration tests — all cloud functions are mocked.

## Test Runner

`bun:test` — built into the runtime, zero config, Jest-compatible API (`describe`, `test`, `expect`, `mock`, `beforeEach`, `afterEach`).

Add to `packages/core/package.json`:
```json
"scripts": {
  "test": "bun test",
  "typecheck": "tsc --noEmit"
}
```

Add to root `package.json`:
```json
"test": "bun run --filter '@ctx-link/core' test"
```

## File Structure

```
packages/core/src/__tests__/
  helpers/
    mock-fs.ts          — temp dir setup/teardown, overrides globalConfigDir
    mock-supabase.ts    — chainable Supabase query builder mock
  config.test.ts
  bundles.test.ts
  entries.test.ts
  teams.test.ts
  cloud-sessions.test.ts
  local-store.test.ts
  questions.test.ts
  session-actions.test.ts
```

## Mocking Strategy

### Filesystem (config, local-store, questions)

These modules resolve paths via `globalConfigDir()` which returns `~/.ctx-link`. We use `bun:test`'s `mock.module()` to intercept the config module and redirect all paths to a temp directory per test.

**`helpers/mock-fs.ts`** provides:
- `setupTestDir()` — creates a temp dir under `os.tmpdir()`, returns the path
- `cleanupTestDir(dir)` — removes the temp dir
- Mocks `globalConfigDir()` to return the temp dir
- Mocks `process.cwd()` for `projectConfigPath()` tests

### Supabase (entries, cloud-sessions, bundles, teams)

These modules call `getSupabase()` which returns a `SupabaseClient`. We mock the module to return a fake client with a chainable query builder.

**`helpers/mock-supabase.ts`** provides:
- `createMockSupabase()` — returns a mock client where `sb.from("table")` returns a chainable object with `.select()`, `.insert()`, `.update()`, `.delete()`, `.eq()`, `.in()`, `.is()`, `.order()`, `.single()`, `.maybeSingle()` — all returning `{ data, error }`.
- Test data is configured per test via the mock's return values.

### session-actions.ts (orchestration)

Uses both strategies. Mocks the individual core functions it imports (config, entries, local-store, cloud-sessions, bundles) so we test the orchestration flow without exercising the real implementations.

## Test Coverage Per Module

### config.test.ts
- `loadGlobalConfig()` — auto-creates on first use, returns existing
- `saveGlobalConfig()` / `loadGlobalConfig()` roundtrip
- `loadProjectConfig()` / `saveProjectConfig()` roundtrip
- `getBundleToken()` / `storeBundleToken()` roundtrip
- `loadSessionLog()` / `logSession()` — append + read
- `saveActiveSession()` / `loadActiveSession()` / `deleteActiveSession()` / `renameActiveSession()` — CRUD
- `listActiveSessions()` — lists all session files
- `getActiveSessionId()` / `setActiveSessionId()` — per-project tracking
- `connectSessionToBundle()` — adds bundle, deduplicates
- `disconnectSessionFromBundle()` — removes bundle
- `pushSessionEntry()` / `getSessionEntries()` / `getUnpushedSessionEntries()` — entry tracking
- `markSessionEntriesPushed()` — marks entries as pushed
- `deleteSessionEntry()` — removes entry

### bundles.test.ts (mocked Supabase)
- `createBundle()` — local and cloud modes
- `joinBundle()` — stores token
- `deleteBundle()` — both modes
- `bundleStatus()` — returns counts
- `listLocalBundles()` — reads token store
- `generateJoinToken()` — returns string
- `assertTokenValid()` — throws on invalid
- `getBundleTeamId()` — resolves team

### entries.test.ts (mocked Supabase)
- `pullEntries()` — filters by bundle, excludes rewound
- `addEntriesToBundle()` — creates refs, reports added/skipped
- `removeEntryFromBundle()` — removes single ref
- `removeSessionEntriesFromBundle()` — removes all session refs
- `getUnpushedEntries()` — finds entries not yet in bundle
- `renderEntriesForClaude()` — produces markdown

### teams.test.ts (mocked Supabase)
- `createTeam()` — creates with hashed password
- `joinTeam()` — verifies password
- `listMyTeams()` — reads local teams file
- `listTeamBundles()` — queries Supabase
- `assertTeamMember()` — throws on non-member
- `assertBundleTeamAccess()` — checks team membership for bundle

### cloud-sessions.test.ts (mocked Supabase)
- `copySessionToCloud()` — creates cloud session + copies entries
- `syncSessionToCloud()` — syncs only new entries
- `getCloudSession()` — returns session or null
- `deleteCloudSession()` — cascades
- `deleteCloudSessionEntry()` — cascades refs
- `renameCloudSession()` — updates name
- `listTeamSessions()` — returns team's sessions
- `getCloudSessionEntries()` — filters superseded
- `getEntryBundleRefs()` — returns refs for entry
- `getCloudSessionBundleIds()` — returns bundle IDs

### local-store.test.ts (filesystem)
- `isLocalBundle()` — checks directory existence
- `localCreateBundle()` / `localDeleteBundle()` — CRUD
- `localJoinBundle()` — creates meta
- `localBundleStatus()` — counts from refs
- `localPullEntries()` — resolves refs to entries
- `localAddEntriesToBundle()` — creates refs, deduplicates
- `localRemoveEntryFromBundle()` — removes single ref
- `localRemoveSessionRefsFromBundle()` — removes all session refs
- `localRemoveEntryRefsFromBundleByIds()` — removes by IDs
- `getLocalBundleIdsForSession()` — finds bundles for session
- `listAllLocalBundleDetails()` — aggregates all bundles

### questions.test.ts (filesystem)
- `askQuestion()` / `readQuestions()` roundtrip
- `answerQuestion()` — adds answer to question
- `resolveQuestion()` — sets status
- `listBundleQuestions()` — filters by status/project
- `getQuestion()` — returns single or undefined
- `countOpenQuestions()` — counts open

### session-actions.test.ts (mocked dependencies)
- `ensureCloudCopy()` — creates new copy, syncs existing
- `unlinkSessionFromBundle()` — local mode refs cleanup, cloud mode refs cleanup, both IDs resolved
- `deleteSession()` — local session deletes cloud copies, cloud session updates local session
- `pushSessionToBundle()` — local→local, local→cloud (with ID mapping), cloud→cloud
- `pushBundleToCloud()` — migrates bundle, swaps connections, deletes old

## Verification

```bash
bun run test                    # run from root
bun test                        # run from packages/core/
bun test --watch                # dev mode
bun test src/__tests__/config   # single file
```

All tests pass, typecheck passes, no regressions in existing functionality.
