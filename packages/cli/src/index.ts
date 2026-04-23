#!/usr/bin/env bun
import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline";

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
import {
  loadProjectConfig,
  loadGlobalConfig,
  saveProjectConfig,
  createBundle,
  joinBundle,
  deleteBundle,
  listLocalBundles,
  bundleStatus,
  pushEntry,
  pullEntries,
  logSession,
  loadSessionLog,
  saveActiveSession,
  loadActiveSession,
  getActiveSessionId,
  setActiveSessionId,
  listActiveSessions,
  renderEntriesForClaude,
  rewindProject,
  restoreRewound,
  listRewinds,
  createTeam,
  joinTeam,
  listMyTeams,
  listTeamBundles,
  type RewindStrategy,
} from "@ctx-link/core";

const program = new Command();
program
  .name("cxtl")
  .description(
    "Connect Claude Code sessions across projects via shared context bundles.\n\n" +
    "Modes:\n" +
    "  off   — default, no linking, hooks do nothing\n" +
    "  local — entries stored in ~/.cxtl/local/, same machine only\n" +
    "  cloud — entries stored in Supabase, requires team membership\n\n" +
    "Typical flow:\n" +
    "  1. cxtl create-team          (cloud only, once)\n" +
    "  2. cxtl create <name> --mode local|cloud\n" +
    "  3. In other project: cxtl join <bundle_id> --mode local|cloud\n" +
    "  4. cxtl push --message '...' (or auto on git commit)\n" +
    "  5. cxtl pull                 (from the other project)"
  )
  .version("0.1.0");

// ==================== TEAMS (cloud mode only) ====================

program
  .command("create-team")
  .description(
    "Create a new team for cloud mode. Prompts for name and password.\n" +
    "You are auto-joined as a member. Share the name + password with teammates.\n\n" +
    "Example:\n" +
    "  $ cxtl create-team\n" +
    "  Team name: my-team\n" +
    "  Password: ****"
  )
  .action(async () => {
    const name = await prompt("Team name: ");
    if (!name) { console.error("Team name is required."); process.exit(1); }
    const password = await prompt("Password: ");
    if (!password) { console.error("Password is required."); process.exit(1); }
    const r = await createTeam(name, password);
    console.log(`\nTeam created.`);
    console.log(`  Name: ${r.name}`);
    console.log(`  ID:   ${r.team_id}`);
    console.log("");
    console.log("Others can join with:");
    console.log(`  cxtl join-team`);
  });

program
  .command("join-team")
  .description(
    "Join an existing team. Prompts for the team name and password.\n" +
    "Once joined, you can access all cloud bundles in that team.\n\n" +
    "Example:\n" +
    "  $ cxtl join-team\n" +
    "  Team name: my-team\n" +
    "  Password: ****"
  )
  .action(async () => {
    const name = await prompt("Team name: ");
    if (!name) { console.error("Team name is required."); process.exit(1); }
    const password = await prompt("Password: ");
    if (!password) { console.error("Password is required."); process.exit(1); }
    const r = await joinTeam(name, password);
    console.log(`\nJoined team ${r.name} (${r.team_id}).`);
  });

program
  .command("my-teams")
  .description(
    "List all teams you belong to. Shows team ID, name, and join date.\n" +
    "Use the team ID with 'cxtl create --team <id>' or 'cxtl team-bundles <id>'."
  )
  .action(() => {
    const teams = listMyTeams();
    if (teams.length === 0) {
      console.log("Not a member of any teams. Run 'cxtl create-team' or 'cxtl join-team'.");
      return;
    }
    for (const t of teams) {
      console.log(`${t.team_id}  ${t.name}  (joined ${t.joined_at})`);
    }
  });

program
  .command("team-bundles <team_id>")
  .description(
    "List all bundles in a team. Shows bundle ID, name, and creation date.\n" +
    "Use the bundle ID with 'cxtl join <bundle_id> --mode cloud'.\n\n" +
    "Example:\n" +
    "  $ cxtl team-bundles 260c55e9-..."
  )
  .action(async (teamId: string) => {
    const bundles = await listTeamBundles(teamId);
    if (bundles.length === 0) {
      console.log("No bundles in this team. Create one with 'cxtl create <name> --mode cloud --team <id>'.");
      return;
    }
    for (const b of bundles) {
      console.log(`${b.bundle_id}  ${b.name}  (created ${b.created_at})`);
    }
  });

// ==================== PROJECT INFO ====================

program
  .command("info")
  .description(
    "Show this project's cxtl config. Reads .cxtl.json in the current directory.\n" +
    "Shows: project name, mode, active bundle ID, auto-push settings."
  )
  .action(() => {
    const sessionId = getActiveSessionId();
    const session = sessionId ? loadActiveSession(sessionId) : null;

    console.log(`Project:  ${session?.project_name ?? detectProjectName()}`);
    console.log(`Session:  ${sessionId ?? "(none — not in a Claude Code session)"}`);
    console.log(`Branch:   ${session?.branch ?? "unknown"}`);
    console.log(`Bundles:  ${!session || session.bundles.length === 0 ? "(none — run 'cxtl connect <bundle_id>')" : ""}`);
    if (session) {
      for (const b of session.bundles) {
        console.log(`  - ${b.bundle_id} [${b.mode}]`);
      }
    }
  });

// ==================== SESSION TRACKING ====================

program
  .command("session-log")
  .description(
    "Record the current project as an active session. Called by SessionStart hook.\n" +
    "Captures Claude Code's session_id and creates an active session record."
  )
  .option("--session-id <id>", "Claude Code session ID (from hook input)")
  .action(async (opts) => {
    const cfg = loadProjectConfig();
    const globalCfg = loadGlobalConfig();
    const projectName = cfg?.project_name ?? detectProjectName();
    let branch: string | null = null;
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
    } catch {}

    const sessionId = opts.sessionId ?? `local-${Date.now()}`;

    // Log to session history
    logSession({
      project_name: projectName,
      project_path: process.cwd(),
      machine_id: globalCfg.machine_id,
      started_at: new Date().toISOString(),
      branch,
      bundle: null,
      mode: cfg?.mode ?? "local",
    });

    // Create active session record
    saveActiveSession({
      session_id: sessionId,
      project_name: projectName,
      project_path: process.cwd(),
      bundles: [],
      started_at: new Date().toISOString(),
      branch,
    });

    // Write marker file so MCP server and hooks can find the session
    setActiveSessionId(sessionId);
  });

program
  .command("sessions")
  .description(
    "List recent Claude Code sessions across all projects.\n" +
    "Shows project name, branch, mode, bundle, and when the session started.\n\n" +
    "Example:\n" +
    "  $ cxtl sessions\n" +
    "  $ cxtl sessions --limit 10"
  )
  .option("--limit <n>", "max sessions to show", "20")
  .action((opts) => {
    const sessions = loadSessionLog();
    const limited = sessions.slice(-Number(opts.limit)).reverse();
    if (limited.length === 0) {
      console.log("No sessions recorded yet.");
      return;
    }
    for (const s of limited) {
      const bundleInfo = s.bundle ? ` → ${s.bundle.slice(0, 8)}...` : "";
      console.log(`${s.started_at}  ${s.project_name}  [${s.mode}]  ${s.branch ?? "no-branch"}${bundleInfo}`);
      console.log(`  ${s.project_path}`);
    }
  });

// ==================== CONNECT / DISCONNECT ====================

program
  .command("connect <bundle_id>")
  .description(
    "Connect the current Claude Code session to a bundle.\n" +
    "A session can be connected to multiple bundles. Push/pull operates on all of them.\n\n" +
    "Examples:\n" +
    "  $ cxtl connect abc-123\n" +
    "  $ cxtl connect abc-123 --mode cloud"
  )
  .option("--mode <mode>", "local | cloud", "local")
  .action(async (bundleId: string, opts) => {
    const sessionId = getActiveSessionId();
    if (!sessionId) {
      console.error("No active session. This command must be run inside a Claude Code session.");
      process.exit(1);
    }
    const session = loadActiveSession(sessionId);
    if (!session) {
      console.error(`Session ${sessionId} not found.`);
      process.exit(1);
    }
    const mode = (opts.mode === "local" || opts.mode === "cloud") ? opts.mode : "local";

    // Don't add duplicates
    if (session.bundles.some((b) => b.bundle_id === bundleId)) {
      console.log(`Already connected to bundle ${bundleId}.`);
      return;
    }

    session.bundles.push({ bundle_id: bundleId, mode });
    saveActiveSession(session);

    // Auto-push session context to the new bundle
    try {
      let recentWork = "";
      try {
        // Get commits since session started
        const since = session.started_at;
        recentWork = execSync(
          `git log --oneline --since="${since}" 2>/dev/null || echo "(no commits yet)"`,
          { encoding: "utf8" }
        ).trim();
      } catch {
        recentWork = "(could not read git history)";
      }

      await pushEntry({
        bundle_id: bundleId,
        project_name: session.project_name,
        event_type: "manual",
        trigger_ref: session.branch,
        raw_context: `Session connected. Branch: ${session.branch ?? "unknown"}. Recent work:\n${recentWork}`,
        summary: `${session.project_name} joined the bundle (branch: ${session.branch ?? "unknown"}). ${recentWork !== "(no commits yet)" ? `Recent commits:\n${recentWork}` : "No commits yet in this session."}`,
        mode,
      });
      console.log(`Pushed session context to bundle.`);
    } catch {
      // Non-fatal
    }

    console.log(`Connected session ${sessionId.slice(0, 8)}... to bundle ${bundleId}`);
    console.log(`Session now has ${session.bundles.length} bundle(s).`);
  });

program
  .command("disconnect <bundle_id>")
  .description(
    "Disconnect the current session from a bundle.\n" +
    "The bundle still exists — you just stop pushing/pulling to it."
  )
  .action((bundleId: string) => {
    const sessionId = getActiveSessionId();
    if (!sessionId) {
      console.error("No active session.");
      process.exit(1);
    }
    const session = loadActiveSession(sessionId);
    if (!session) {
      console.error(`Session ${sessionId} not found.`);
      process.exit(1);
    }

    session.bundles = session.bundles.filter((b) => b.bundle_id !== bundleId);
    saveActiveSession(session);
    console.log(`Disconnected from bundle ${bundleId}.`);
    console.log(`Session now has ${session.bundles.length} bundle(s).`);
  });

// ==================== BUNDLES ====================

program
  .command("create <name>")
  .description(
    "Create a new bundle and link it to the current project.\n" +
    "Replaces any existing bundle for this project.\n\n" +
    "Local mode (same machine, no network):\n" +
    "  $ cxtl create my-feature --mode local\n\n" +
    "Cloud mode (cross-machine, requires team):\n" +
    "  $ cxtl create my-feature --mode cloud --team <team_id>"
  )
  .requiredOption("--mode <mode>", "'local' (file-based, same machine) or 'cloud' (Supabase, cross-machine)")
  .option("--team <team_id>", "team ID — required for cloud mode. Get it from 'cxtl my-teams'")
  .action(async (name: string, opts) => {
    if (opts.mode !== "local" && opts.mode !== "cloud") {
      console.error("--mode must be 'local' or 'cloud'.");
      process.exit(1);
    }
    if (opts.mode === "cloud" && !opts.team) {
      console.error("Cloud bundles require --team <team_id>. Run 'cxtl my-teams' to see your teams.");
      process.exit(1);
    }
    const r = await createBundle(name, opts.mode, opts.team);
    const cfg = loadProjectConfig() ?? {
      mode: "off" as const,
      bundle: null,
      project_name: detectProjectName(),
      auto_push_on: ["commit"],
      push_debounce_seconds: 600,
    };
    cfg.mode = opts.mode;
    cfg.bundle = r.bundle_id;
    saveProjectConfig(cfg);

    console.log(`Bundle created (mode: ${opts.mode}).`);
    console.log(`  ID:    ${r.bundle_id}`);
    console.log(`  Name:  ${r.name}`);
    console.log("");
    console.log("In another project, join with:");
    console.log(`  cxtl join ${r.bundle_id} --mode ${opts.mode}`);
  });

program
  .command("join <bundle_id> [token]")
  .description(
    "Join an existing bundle from the current project.\n" +
    "Replaces any existing bundle for this project.\n" +
    "Cloud mode: no token needed (team membership is the auth).\n" +
    "Local mode: pass the token from 'cxtl create' output.\n\n" +
    "Examples:\n" +
    "  $ cxtl join abc-123 --mode cloud\n" +
    "  $ cxtl join abc-123 local_abc-123 --mode local"
  )
  .requiredOption("--mode <mode>", "'local' or 'cloud'")
  .action(async (bundleId: string, token: string | undefined, opts) => {
    if (opts.mode !== "local" && opts.mode !== "cloud") {
      console.error("--mode must be 'local' or 'cloud'.");
      process.exit(1);
    }
    const projectName = detectProjectName();
    const r = await joinBundle(bundleId, token ?? "", projectName, opts.mode);
    const cfg = loadProjectConfig() ?? {
      mode: "off" as const,
      bundle: null,
      project_name: projectName,
      auto_push_on: ["commit"],
      push_debounce_seconds: 600,
    };
    cfg.mode = opts.mode;
    cfg.bundle = r.bundle_id;
    saveProjectConfig(cfg);
    console.log(`Joined bundle ${r.name} (${r.bundle_id}) as project '${projectName}' (mode: ${opts.mode}).`);
  });

program
  .command("my-bundles")
  .description(
    "List all bundles this machine has ever joined (across all projects).\n" +
    "To see the bundle for the CURRENT project only, use 'cxtl info'."
  )
  .action(() => {
    const bundles = listLocalBundles();
    if (bundles.length === 0) {
      console.log("No bundles joined on this machine.");
      return;
    }
    for (const b of bundles) {
      console.log(`${b.bundle_id}  ${b.name}  (joined ${b.joined_at})`);
    }
  });

program
  .command("status <bundle_id>")
  .description(
    "Show bundle details: session count, entry count, last activity.\n\n" +
    "Example:\n" +
    "  $ cxtl status abc-123"
  )
  .action(async (bundleId: string) => {
    const cfg = loadProjectConfig();
    const s = await bundleStatus(bundleId, (cfg?.mode === "local" || cfg?.mode === "cloud") ? cfg.mode : "cloud");
    console.log(JSON.stringify(s, null, 2));
  });

// ==================== PUSH / PULL ====================

program
  .command("push")
  .description(
    "Push a context entry to this project's bundle. Reads bundle from .cxtl.json.\n\n" +
    "Usage:\n" +
    "  cxtl push --message <text>      Use your text as summary + raw context\n" +
    "  cxtl push --diff                Use git diff as raw context, commit message as summary\n" +
    "  cxtl push --diff --summary <s>  Use git diff + explicit summary\n\n" +
    "Options:\n" +
    "  --event <type>   commit | pr_open | manual | session_end (default: manual)\n" +
    "  --ref <ref>      commit SHA, PR number, or branch name\n\n" +
    "Examples:\n" +
    "  $ cxtl push --message 'Added /api/auth endpoint with JWT'\n" +
    "  $ cxtl push --event commit --ref $(git rev-parse HEAD) --diff"
  )
  .option("--event <type>", "event type", "manual")
  .option("--ref <ref>", "commit SHA, PR number, or reference")
  .option("--diff", "use git diff HEAD~1 as raw context", false)
  .option("--message <text>", "summary text (also used as raw context when --diff is not set)")
  .option("--summary <text>", "explicit summary (use with --diff)")
  .action(async (opts) => {
    // Get bundles from active session
    const sessionId = getActiveSessionId();
    const session = sessionId ? loadActiveSession(sessionId) : null;

    if (!session || session.bundles.length === 0) {
      console.error("No bundles connected to this session. Run 'cxtl connect <bundle_id>' first.");
      process.exit(1);
    }

    let raw: string;
    let summary: string;

    if (opts.diff) {
      try {
        raw = execSync("git diff HEAD~1", { encoding: "utf8" });
      } catch {
        raw = execSync("git diff --cached", { encoding: "utf8" });
      }
      if (opts.summary) {
        summary = opts.summary;
      } else {
        const ref = opts.ref ?? "HEAD";
        try {
          summary = execSync(`git log -1 --pretty=%B ${ref}`, { encoding: "utf8" }).trim();
        } catch {
          summary = "";
        }
        if (!summary) {
          console.error("--diff requires --summary (could not extract commit message).");
          process.exit(1);
        }
      }
    } else {
      if (!opts.message) {
        console.error("Provide --message <text> or use --diff.\nRun 'cxtl push --help' for examples.");
        process.exit(1);
      }
      raw = opts.message;
      summary = opts.summary ?? opts.message;
    }

    // Push to ALL connected bundles
    for (const b of session.bundles) {
      const r = await pushEntry({
        bundle_id: b.bundle_id,
        project_name: session.project_name,
        event_type: opts.event,
        trigger_ref: opts.ref ?? null,
        raw_context: raw,
        summary,
        mode: b.mode,
      });
      console.log(`[${b.bundle_id}] pushed entry ${r.entry_id}`);
      console.log(`  ${r.summary}`);
    }
  });

program
  .command("pull [bundle_id]")
  .description(
    "Pull recent entries from a bundle. Reads bundle from .cxtl.json if no ID given.\n" +
    "By default, filters out your own project's entries (shows only cross-project context).\n\n" +
    "Examples:\n" +
    "  $ cxtl pull                         Pull from current project's bundle\n" +
    "  $ cxtl pull --include-self           Include your own entries\n" +
    "  $ cxtl pull abc-123                  Pull from a specific bundle\n" +
    "  $ cxtl pull --since 2026-04-22T12:00:00Z --limit 50"
  )
  .option("--since <iso>", "only entries newer than this ISO timestamp")
  .option("--limit <n>", "max entries to return", "20")
  .option("--include-self", "include your own project's entries", false)
  .action(async (bundleId: string | undefined, opts) => {
    const sessionId = getActiveSessionId();
    const session = sessionId ? loadActiveSession(sessionId) : null;

    // If a specific bundle_id is given, pull just from that
    if (bundleId) {
      const mode = session?.bundles.find((b) => b.bundle_id === bundleId)?.mode ?? "local";
      const rows = await pullEntries({
        bundle_id: bundleId,
        since: opts.since,
        limit: Number(opts.limit),
        exclude_project: opts.includeSelf ? undefined : session?.project_name,
        mode,
      });
      console.log(`=== ${bundleId} (${rows.length} entries) ===`);
      console.log(renderEntriesForClaude(rows));
      return;
    }

    // Otherwise pull from all session bundles
    if (!session || session.bundles.length === 0) {
      console.error("No bundles connected to this session. Run 'cxtl connect <bundle_id>' first.");
      process.exit(1);
    }

    for (const b of session.bundles) {
      const rows = await pullEntries({
        bundle_id: b.bundle_id,
        since: opts.since,
        limit: Number(opts.limit),
        exclude_project: opts.includeSelf ? undefined : session.project_name,
        mode: b.mode,
      });
      console.log(`=== ${b.bundle_id} (${rows.length} entries) ===`);
      console.log(renderEntriesForClaude(rows));
      console.log("");
    }
  });

// ==================== REWIND / RESTORE ====================

program
  .command("rewind")
  .description(
    "Soft-delete entries from ONE project in a bundle. Other projects untouched.\n" +
    "Dry-run by default — add --apply to execute. Reversible via 'cxtl restore'.\n\n" +
    "Strategies (pick exactly one):\n" +
    "  --last-n <n>        Rewind the last N entries from this project\n" +
    "  --since <iso>       Rewind entries at or after this timestamp\n" +
    "  --entry-ids <a,b,c> Rewind specific entry IDs\n" +
    "  --after-ref <sha>   Rewind everything after this trigger_ref (pivot kept)\n\n" +
    "Examples:\n" +
    "  $ cxtl rewind --bundle abc --project my-api --last-n 3\n" +
    "  $ cxtl rewind --bundle abc --project my-api --last-n 3 --apply --reason 'bad abstraction'"
  )
  .requiredOption("--bundle <id>", "bundle ID")
  .requiredOption("--project <name>", "project name (only this project's entries are affected)")
  .option("--since <iso>", "rewind entries at or after this timestamp")
  .option("--last-n <n>", "rewind the last N entries from this project")
  .option("--entry-ids <ids>", "comma-separated entry IDs to rewind")
  .option("--after-ref <ref>", "rewind everything after this trigger_ref (pivot kept)")
  .option("--reason <msg>", "why you're rewinding (stored in audit log)")
  .option("--apply", "actually perform the rewind (default is dry-run)", false)
  .option("--force", "override the 50-entry safety cap", false)
  .option("--max <n>", "max affected entries without --force", "50")
  .action(async (opts) => {
    const provided = [opts.since, opts.lastN, opts.entryIds, opts.afterRef].filter(Boolean);
    if (provided.length !== 1) {
      console.error("Specify exactly one of: --since, --last-n, --entry-ids, --after-ref");
      process.exit(1);
    }

    let strategy: RewindStrategy;
    if (opts.since) strategy = { kind: "since", since: opts.since };
    else if (opts.lastN) strategy = { kind: "last_n", count: Number(opts.lastN) };
    else if (opts.entryIds)
      strategy = { kind: "entry_ids", ids: opts.entryIds.split(",").map((s: string) => s.trim()) };
    else strategy = { kind: "after_ref", trigger_ref: opts.afterRef };

    const dryRun = !opts.apply;
    const r = await rewindProject({
      bundle_id: opts.bundle,
      project_name: opts.project,
      strategy,
      reason: opts.reason,
      dry_run: dryRun,
      max_affected: Number(opts.max),
      force: opts.force,
    });

    console.log(
      `${dryRun ? "[DRY RUN] Would rewind" : "Rewound"} ${r.affected_count} entries from ${opts.project}`
    );
    if (r.message) console.log(r.message);
    for (const e of r.affected_entries) {
      console.log(
        `  - ${e.id}  [${e.created_at}]  ${e.event_type}${e.trigger_ref ? ` (${e.trigger_ref})` : ""}`
      );
      console.log(`    ${e.summary_preview}`);
    }
    if (dryRun && r.affected_count > 0) {
      console.log("\nRe-run with --apply to perform the rewind.");
    }
    if (r.rewind_log_id) {
      console.log(`\nAudit log: ${r.rewind_log_id}`);
      console.log(`Undo with: cxtl restore --bundle ${opts.bundle} --project ${opts.project} --from-log ${r.rewind_log_id}`);
    }
  });

program
  .command("restore")
  .description(
    "Undo a rewind — bring back soft-deleted entries.\n\n" +
    "Examples:\n" +
    "  $ cxtl restore --bundle abc --project my-api --from-log <log_id>\n" +
    "  $ cxtl restore --bundle abc --project my-api --entry-ids id1,id2"
  )
  .requiredOption("--bundle <id>", "bundle ID")
  .requiredOption("--project <name>", "project name")
  .option("--entry-ids <ids>", "comma-separated entry IDs to restore")
  .option("--from-log <id>", "restore all entries from a specific rewind log")
  .action(async (opts) => {
    const r = await restoreRewound({
      bundle_id: opts.bundle,
      project_name: opts.project,
      entry_ids: opts.entryIds ? opts.entryIds.split(",").map((s: string) => s.trim()) : undefined,
      rewind_log_id: opts.fromLog,
    });
    console.log(`Restored ${r.restored_count} entries.`);
    for (const id of r.restored_ids) console.log(`  - ${id}`);
  });

program
  .command("rewind-history <bundle_id>")
  .description(
    "List past rewinds for a bundle. Use the log_id to restore.\n\n" +
    "Example:\n" +
    "  $ cxtl rewind-history abc-123 --project my-api"
  )
  .option("--project <name>", "filter by project name")
  .option("--limit <n>", "max results", "20")
  .action(async (bundleId: string, opts) => {
    const rows = await listRewinds(bundleId, opts.project, Number(opts.limit));
    if (rows.length === 0) {
      console.log("No rewinds recorded.");
      return;
    }
    for (const r of rows) {
      console.log(
        `${r.performed_at}  ${r.project_name}  ${r.strategy_kind}  ${r.affected_count} entries`
      );
      if (r.reason) console.log(`  reason: ${r.reason}`);
      console.log(`  log_id: ${r.id}`);
    }
  });

// ==================== LEAVE / DELETE ====================

program
  .command("leave")
  .description(
    "Disconnect this project from its bundle. The bundle still exists for others.\n" +
    "Sets mode to 'off'. Rejoin anytime with 'cxtl join'."
  )
  .action(() => {
    const cfg = loadProjectConfig();
    if (!cfg || !cfg.bundle) {
      console.log("This project is not in any bundle.");
      return;
    }
    const oldBundle = cfg.bundle;
    cfg.bundle = null;
    cfg.mode = "off";
    saveProjectConfig(cfg);
    console.log(`Left bundle ${oldBundle}. Mode set to off.`);
  });

program
  .command("delete-bundle <bundle_id>")
  .description(
    "Permanently delete a bundle and ALL its entries. Irreversible.\n" +
    "Use 'cxtl leave' if you just want to disconnect without destroying data."
  )
  .action(async (bundleId: string) => {
    const cfg = loadProjectConfig();
    const mode = (cfg?.mode === "local" || cfg?.mode === "cloud") ? cfg.mode : "cloud";
    await deleteBundle(bundleId, mode);
    if (cfg && cfg.bundle === bundleId) {
      cfg.bundle = null;
      cfg.mode = "off";
      saveProjectConfig(cfg);
    }
    console.log(`Deleted bundle ${bundleId}.`);
  });

// ==================== HELPERS ====================

function detectProjectName(): string {
  const pkgPath = `${process.cwd()}/package.json`;
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.name) return pkg.name;
    } catch {}
  }
  return process.cwd().split("/").pop() ?? "unknown";
}

program.parseAsync().catch((err) => {
  console.error(err?.message ?? String(err));
  process.exit(1);
});
