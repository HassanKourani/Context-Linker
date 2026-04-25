# Viral Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first 5 minutes magic — one command to set up, one short code to join, and a welcome header on first pull.

**Architecture:** `ctxl init` wizard handles full project setup. Short join codes map to `(bundle_id, token)` in Supabase with 7-day expiry. First-pull welcome adds a header to MCP `context_pull` response on first pull per session.

**Tech Stack:** TypeScript, Bun, Commander.js, @inquirer/prompts, Supabase (Postgres), Zod

**Branch:** `feat/viral-onboarding`

---

### Task 1: Supabase Migration — Join Codes Table

**Files:**
- Create: `supabase/migrations/0009_bundle_join_codes.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Short join codes for easy bundle sharing.
create table if not exists bundle_join_codes (
  code text primary key,
  bundle_id uuid not null references bundles(id) on delete cascade,
  token text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create index idx_bundle_join_codes_bundle on bundle_join_codes(bundle_id);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0009_bundle_join_codes.sql
git commit -m "feat(viral-onboarding): add bundle_join_codes migration"
```

---

### Task 2: Core — Join Code Functions

**Files:**
- Create: `packages/core/src/join-codes.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the join code module**

Create `packages/core/src/join-codes.ts`:

```typescript
import { randomBytes } from "node:crypto";
import { getSupabase } from "./supabase.js";

const CODE_PREFIX = "ctx-";
const CODE_LENGTH = 6;
const CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Generate a short alphanumeric code (e.g., "ctx-a3f9k2").
 */
function generateShortCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CHARSET[bytes[i] % CHARSET.length];
  }
  return `${CODE_PREFIX}${code}`;
}

/**
 * Create a short join code for a cloud bundle.
 * Returns the code string.
 */
export async function createJoinCode(
  bundleId: string,
  token: string,
  expiryDays = 7,
): Promise<string> {
  const sb = getSupabase();

  // Generate a unique code (retry on collision)
  let code: string;
  let attempts = 0;
  while (true) {
    code = generateShortCode();
    const { data: existing } = await sb
      .from("bundle_join_codes")
      .select("code")
      .eq("code", code)
      .limit(1);
    if (!existing || existing.length === 0) break;
    attempts++;
    if (attempts > 10) throw new Error("Failed to generate unique join code.");
  }

  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await sb
    .from("bundle_join_codes")
    .insert({ code, bundle_id: bundleId, token, expires_at: expiresAt });
  if (error) throw new Error(`createJoinCode failed: ${error.message}`);

  return code;
}

/**
 * Resolve a short code to bundle_id + token.
 * Returns null if the code doesn't exist or is expired.
 */
export async function resolveJoinCode(
  code: string,
): Promise<{ bundle_id: string; token: string } | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("bundle_join_codes")
    .select("bundle_id, token, expires_at")
    .eq("code", code.toLowerCase())
    .limit(1)
    .single();

  if (error || !data) return null;

  // Check expiry
  if (new Date(data.expires_at) < new Date()) return null;

  return { bundle_id: data.bundle_id, token: data.token };
}

/**
 * Delete all existing codes for a bundle and create a new one.
 */
export async function regenerateJoinCode(
  bundleId: string,
  token: string,
  expiryDays = 7,
): Promise<string> {
  const sb = getSupabase();
  await sb.from("bundle_join_codes").delete().eq("bundle_id", bundleId);
  return createJoinCode(bundleId, token, expiryDays);
}

/**
 * Get the active join code for a bundle (if any, non-expired).
 */
export async function getJoinCode(bundleId: string): Promise<string | null> {
  const sb = getSupabase();
  const { data } = await sb
    .from("bundle_join_codes")
    .select("code, expires_at")
    .eq("bundle_id", bundleId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data.code;
}

/**
 * Check if a string looks like a short join code.
 */
export function isJoinCode(input: string): boolean {
  return input.toLowerCase().startsWith(CODE_PREFIX) && input.length === CODE_PREFIX.length + CODE_LENGTH;
}
```

- [ ] **Step 2: Export from index.ts**

Add to `packages/core/src/index.ts`:

```typescript
export * from "./join-codes.js";
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/join-codes.ts packages/core/src/index.ts
git commit -m "feat(viral-onboarding): add join code CRUD functions"
```

---

### Task 3: Auto-Generate Join Code on Cloud Bundle Create

**Files:**
- Modify: `packages/core/src/bundles.ts:41-84`

- [ ] **Step 1: Generate join code after cloud bundle creation**

In `packages/core/src/bundles.ts`, in the `createBundle` function, after `storeBundleToken(data.id, ...)` (~line 81) and before the return, add:

```typescript
// Auto-generate a short join code for cloud bundles
try {
  const { createJoinCode } = await import("./join-codes.js");
  const joinCode = await createJoinCode(data.id, `team_${teamId}`);
  return { bundle_id: data.id, name: data.name, join_token: `team_${teamId}`, join_code: joinCode };
} catch {
  // Non-fatal — code generation is optional
  return { bundle_id: data.id, name: data.name, join_token: `team_${teamId}` };
}
```

- [ ] **Step 2: Update the `CreateBundleResult` type**

Update the type (~line 37-39):

```typescript
export interface CreateBundleResult {
  bundle_id: string;
  name: string;
  join_token: string;
  join_code?: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/bundles.ts
git commit -m "feat(viral-onboarding): auto-generate join code on cloud bundle create"
```

---

### Task 4: Update `ctxl join` to Accept Short Codes

**Files:**
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Find the `join` command**

Read `packages/cli/src/index.ts` and find the `join` command definition.

- [ ] **Step 2: Add short code resolution**

At the start of the `join` command's action handler, before attempting to join with UUID + token, add:

```typescript
// Check if input is a short join code
const { isJoinCode, resolveJoinCode } = await import("@ctx-link/core");

let bundleId = opts.bundleId ?? await input({ message: "Bundle ID or join code:" });
let joinToken: string;

if (isJoinCode(bundleId)) {
  const resolved = await resolveJoinCode(bundleId);
  if (!resolved) {
    console.error("Join code not found or expired. Ask the bundle owner for a new code.");
    process.exit(1);
  }
  bundleId = resolved.bundle_id;
  joinToken = resolved.token;
  console.log(`Resolved join code → bundle ${bundleId.slice(0, 8)}...`);
} else {
  joinToken = opts.token ?? await input({ message: "Join token:" });
}
```

Then use `bundleId` and `joinToken` for the rest of the join flow instead of prompting separately.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(viral-onboarding): ctxl join accepts short codes"
```

---

### Task 5: `ctxl init` Wizard Command

**Files:**
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Add the `init` command**

Add near the top of the command definitions in `packages/cli/src/index.ts`:

```typescript
program
  .command("init")
  .description(
    "Initialize ctx-link in this project. Creates a bundle, connects your session,\n" +
    "installs hooks, and prints a join code for teammates.\n\n" +
    "Example:\n" +
    "  $ ctxl init\n" +
    "  Bundle name: my-api\n" +
    "  Mode: cloud\n" +
    "  Team: my-team\n" +
    "  ✓ Bundle created\n" +
    "  ✓ Session connected\n" +
    "  ✓ Hooks installed\n" +
    "  Share with teammates: ctxl join ctx-a3f9k2"
  )
  .option("--name <name>", "Bundle name")
  .option("--mode <mode>", "local or cloud")
  .option("--team <team_id>", "Team ID (cloud mode)")
  .action(async (opts) => {
    const {
      loadProjectConfig,
      saveProjectConfig,
      createBundle,
      getActiveSessionId,
      connectSessionToBundle,
      listMyTeams,
      getJoinCode,
    } = await import("@ctx-link/core");

    // Check for existing config
    const existing = loadProjectConfig();
    if (existing?.bundle) {
      const overwrite = await confirm({
        message: `This project is already linked to bundle ${existing.bundle.slice(0, 8)}. Create a new bundle?`,
        default: false,
      });
      if (!overwrite) {
        console.log("Keeping existing configuration.");
        return;
      }
    }

    // 1. Bundle name
    const name = opts.name ?? await input({ message: "Bundle name:" });
    if (!name) { console.error("Bundle name is required."); process.exit(1); }

    // 2. Mode
    const mode = opts.mode ?? await select({
      message: "Mode:",
      choices: [
        { name: "local — same machine only, no network", value: "local" },
        { name: "cloud — cross-machine, requires team", value: "cloud" },
      ],
    }) as "local" | "cloud";

    // 3. Team (cloud only)
    let teamId = opts.team;
    if (mode === "cloud" && !teamId) {
      const teams = listMyTeams();
      if (teams.length === 0) {
        console.log("\nNo teams found. Create one first:");
        const teamName = await input({ message: "Team name:" });
        if (!teamName) { console.error("Team name is required."); process.exit(1); }
        const pw = await password({ message: "Team password:" });
        if (!pw) { console.error("Password is required."); process.exit(1); }
        const { createTeam } = await import("@ctx-link/core");
        const team = await createTeam(teamName, pw);
        teamId = team.team_id;
        console.log(`  Team "${team.name}" created.`);
      } else {
        teamId = await select({
          message: "Team:",
          choices: teams.map(t => ({ name: t.name, value: t.team_id })),
        });
      }
    }

    // 4. Create bundle
    console.log("");
    const result = await createBundle(name, mode, teamId);
    console.log(`  Bundle "${result.name}" created.`);

    // 5. Connect session
    const sessionId = getActiveSessionId();
    if (sessionId) {
      connectSessionToBundle(sessionId, result.bundle_id, mode);
      console.log(`  Session connected.`);
    } else {
      console.log(`  No active session — run 'ctxl session-start' or start Claude Code first.`);
    }

    // 6. Detect project name
    let projectName = name;
    try {
      const pkgPath = join(process.cwd(), "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        projectName = pkg.name ?? name;
      }
    } catch {}

    // 7. Write .ctx-link.json
    saveProjectConfig({
      mode,
      bundle: result.bundle_id,
      project_name: projectName,
      auto_push_on: ["commit"],
      push_debounce_seconds: 600,
    });
    console.log(`  .ctx-link.json written.`);

    // 8. Install hooks
    try {
      await installHooks();
      console.log(`  Hooks installed.`);
    } catch (err: any) {
      console.log(`  Hook installation skipped: ${err.message}`);
    }

    // 9. Print join info
    console.log("");
    if (mode === "cloud" && result.join_code) {
      console.log(`Share with teammates:`);
      console.log(`  ctxl join ${result.join_code}`);
    } else if (mode === "cloud") {
      const code = await getJoinCode(result.bundle_id);
      if (code) {
        console.log(`Share with teammates:`);
        console.log(`  ctxl join ${code}`);
      } else {
        console.log(`Share with teammates:`);
        console.log(`  ctxl join ${result.bundle_id}`);
        console.log(`  Token: ${result.join_token}`);
      }
    } else {
      console.log(`Local bundle ready. Others on this machine can join with:`);
      console.log(`  ctxl join ${result.bundle_id}`);
    }
  });
```

- [ ] **Step 2: Add the `installHooks` helper function**

Add this helper function before the command definitions:

```typescript
async function installHooks(): Promise<void> {
  const { existsSync, readFileSync, writeFileSync, copyFileSync, chmodSync } = await import("node:fs");
  const { join, resolve } = await import("node:path");

  // Find hook scripts — check bundled dist/ first, then dev monorepo paths
  const candidates = [
    resolve(import.meta.dir, "../hooks"),         // bundled: dist/../hooks/
    resolve(import.meta.dir, "../../hooks/"),      // dev: packages/cli/src/../../hooks/
  ];
  const hooksDir = candidates.find(d => existsSync(join(d, "claude-code-hook.sh")));
  if (!hooksDir) throw new Error("Hook scripts not found.");

  // Install Claude Code PostToolUse hook
  const claudeSettingsDir = join(process.cwd(), ".claude");
  if (!existsSync(claudeSettingsDir)) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(claudeSettingsDir, { recursive: true });
  }

  const settingsPath = join(claudeSettingsDir, "settings.json");
  let settings: any = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, "utf-8")); } catch {}
  }

  // Add hook if not already present
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];

  const hookScript = join(hooksDir, "claude-code-hook.sh");
  const hasHook = settings.hooks.PostToolUse.some(
    (h: any) => h.command?.includes("claude-code-hook")
  );

  if (!hasHook) {
    settings.hooks.PostToolUse.push({
      matcher: "Write|Edit|Bash",
      type: "command",
      command: hookScript,
    });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }
}
```

- [ ] **Step 3: Add necessary imports at the top of the file**

Make sure `existsSync`, `readFileSync`, `join`, `confirm`, `password` are all imported.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(viral-onboarding): add ctxl init wizard command"
```

---

### Task 6: `ctxl regenerate-code` Command

**Files:**
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Add the regenerate-code command**

```typescript
program
  .command("regenerate-code [bundle_id]")
  .description(
    "Generate a new short join code for a cloud bundle.\n" +
    "Invalidates any existing code.\n\n" +
    "Example:\n" +
    "  $ ctxl regenerate-code\n" +
    "  New join code: ctx-x7m2q9 (expires in 7 days)"
  )
  .option("--expiry <days>", "Expiry in days (default: 7)", "7")
  .action(async (bundleIdArg, opts) => {
    const {
      loadProjectConfig,
      getBundleToken,
      regenerateJoinCode,
    } = await import("@ctx-link/core");

    let bundleId = bundleIdArg;
    if (!bundleId) {
      const config = loadProjectConfig();
      if (config?.bundle) {
        bundleId = config.bundle;
      } else {
        bundleId = await input({ message: "Bundle ID:" });
      }
    }
    if (!bundleId) { console.error("Bundle ID is required."); process.exit(1); }

    const tokenInfo = getBundleToken(bundleId);
    if (!tokenInfo) {
      console.error("No token found for this bundle. Are you a member?");
      process.exit(1);
    }

    const expiryDays = parseInt(opts.expiry, 10);
    const code = await regenerateJoinCode(bundleId, tokenInfo.token, expiryDays);
    console.log(`\nNew join code: ${code} (expires in ${expiryDays} days)`);
    console.log(`\nShare with teammates:`);
    console.log(`  ctxl join ${code}`);
  });
```

- [ ] **Step 2: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(viral-onboarding): add ctxl regenerate-code command"
```

---

### Task 7: First-Pull Welcome Header in MCP

**Files:**
- Modify: `packages/mcp-server/src/index.ts:877-932`

- [ ] **Step 1: Track first-pull per session**

Add a module-level `Set` near the top of `packages/mcp-server/src/index.ts` (near the `ownSessionId` variable):

```typescript
let hasShownWelcome = false;
```

- [ ] **Step 2: Add welcome header to context_pull response**

In the `context_pull` case (~line 877-932), after the rendered output is built (both the single-bundle and all-bundles paths), before `return ok(...)`, add:

For the single-bundle path (~line 906-908), change to:

```typescript
let rendered = renderEntriesForClaude(rows);
rendered = appendQuestions(rendered, [a.bundle_id], session?.project_name);

// First-pull welcome
if (!hasShownWelcome && rows.length > 0) {
  hasShownWelcome = true;
  const projects = new Set(rows.map(r => r.project_name));
  const sessionCount = new Set(rows.map(r => r.bundle_refs?.[0] ?? "unknown")).size;
  const header = `--- Context shared via ctx-link — ${rows.length} entries from ${projects.size} project(s) ---\n\n`;
  rendered = header + rendered;
}

return ok({ count: rows.length, rendered, entries: rows });
```

For the all-bundles path (~line 929-931), change to:

```typescript
let rendered = renderEntriesForClaude(limited);
rendered = appendQuestions(rendered, session.bundles.map((b) => b.bundle_id), session.project_name);

// First-pull welcome
if (!hasShownWelcome && limited.length > 0) {
  hasShownWelcome = true;
  const projects = new Set(limited.map(r => r.project_name));
  const header = `--- Context shared via ctx-link — ${limited.length} entries from ${projects.size} project(s) ---\n\n`;
  rendered = header + rendered;
}

return ok({ count: limited.length, rendered, entries: limited });
```

- [ ] **Step 3: Commit**

```bash
git add packages/mcp-server/src/index.ts
git commit -m "feat(viral-onboarding): add first-pull welcome header"
```

---

### Task 8: Update MCP `bundle_create` to Return Join Code

**Files:**
- Modify: `packages/mcp-server/src/index.ts`

- [ ] **Step 1: Update the bundle_create handler**

Find the `bundle_create` case. After the `createBundle` call, include the `join_code` in the response:

```typescript
case "bundle_create": {
  const a = z.object({
    name: z.string(),
    mode: z.enum(["local", "cloud"]).default("local"),
    team_id: z.string().optional(),
  }).parse(args);
  const r = await createBundle(a.name, a.mode, a.team_id);
  // ... existing session connect logic ...
  return ok({
    ...r,
    join_code: r.join_code ?? null,
    message: r.join_code
      ? `Bundle created. Share with teammates: ctxl join ${r.join_code}`
      : `Bundle created.`,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/mcp-server/src/index.ts
git commit -m "feat(viral-onboarding): return join code from bundle_create"
```

---

### Task 9: Update MCP `bundle_join` to Accept Short Codes

**Files:**
- Modify: `packages/mcp-server/src/index.ts`

- [ ] **Step 1: Update the bundle_join handler**

Find the `bundle_join` case. Add short code resolution at the start:

```typescript
case "bundle_join": {
  let a = BundleJoinArgs.parse(args);

  // Resolve short join code if provided
  if (isJoinCode(a.bundle_id)) {
    const resolved = await resolveJoinCode(a.bundle_id);
    if (!resolved) return fail("Join code not found or expired.");
    a = { ...a, bundle_id: resolved.bundle_id, join_token: resolved.token };
  }

  // ... rest of existing join logic ...
}
```

- [ ] **Step 2: Add imports**

Add `isJoinCode` and `resolveJoinCode` to the imports from `@ctx-link/core`.

- [ ] **Step 3: Commit**

```bash
git add packages/mcp-server/src/index.ts
git commit -m "feat(viral-onboarding): bundle_join accepts short codes"
```

---

### Task 10: Typecheck and End-to-End Verification

**Files:** None (verification only)

- [ ] **Step 1: Run typecheck**

Run: `cd /Users/hassan/Desktop/Hassan/Work/ctx-link && bun run typecheck`

Expected: No type errors.

- [ ] **Step 2: Fix any type errors**

Common issues:
- `CreateBundleResult` type changes may need updating in UI types
- Missing imports for `confirm`, `password` in CLI
- `join_code` field not expected by existing callers

- [ ] **Step 3: Manual test — ctxl init**

```bash
cd /tmp && mkdir test-project && cd test-project && git init
bun run --cwd /Users/hassan/Desktop/Hassan/Work/ctx-link cli -- init
```

Verify:
1. Prompts for name, mode, team
2. Creates bundle
3. Writes `.ctx-link.json`
4. Prints join code (for cloud) or bundle ID (for local)

- [ ] **Step 4: Manual test — ctxl join with short code**

```bash
cd /tmp && mkdir test-project-2 && cd test-project-2 && git init
bun run --cwd /Users/hassan/Desktop/Hassan/Work/ctx-link cli -- join <code-from-init>
```

Verify: Resolves the code and joins the bundle.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(viral-onboarding): typecheck and verification fixes"
```
