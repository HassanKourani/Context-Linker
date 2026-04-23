#!/usr/bin/env bun
import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { select, input, password, confirm } from "@inquirer/prompts";

import {
  loadProjectConfig,
  loadGlobalConfig,
  saveProjectConfig,
  createBundle,
  joinBundle,
  deleteBundle,
  listLocalBundles,
  bundleStatus,
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
  pushSessionEntry,
  getSessionEntries,
  getUnpushedSessionEntries,
  addEntriesToBundle,
  localAddEntriesToBundle,
  pushSessionToCloud,
  syncNewEntries,
  isLocalBundle,
  type RewindStrategy,
} from "@ctx-link/core";

const program = new Command();
program
  .name("ctx-link")
  .description(
    "Connect Claude Code sessions across projects via shared context bundles.\n\n" +
    "Modes:\n" +
    "  off   — default, no linking, hooks do nothing\n" +
    "  local — entries stored in ~/.ctx-link/local/, same machine only\n" +
    "  cloud — entries stored in Supabase, requires team membership\n\n" +
    "Typical flow:\n" +
    "  1. ctx-link create-team          (cloud only, once)\n" +
    "  2. ctx-link create <name>        (prompts for mode + team)\n" +
    "  3. In other project: ctx-link join <bundle_id>\n" +
    "  4. ctx-link push --message '...' (or auto on git commit)\n" +
    "  5. ctx-link pull                 (from the other project)"
  )
  .version("0.1.0");

// ==================== TEAMS (cloud mode only) ====================

program
  .command("create-team")
  .description(
    "Create a new team for cloud mode. Prompts for name and password.\n" +
    "You are auto-joined as a member. Share the name + password with teammates.\n\n" +
    "Example:\n" +
    "  $ ctx-link create-team\n" +
    "  Team name: my-team\n" +
    "  Password: ****"
  )
  .action(async () => {
    const name = await input({ message: "Team name:" });
    if (!name) { console.error("Team name is required."); process.exit(1); }
    const pw = await password({ message: "Password:" });
    if (!pw) { console.error("Password is required."); process.exit(1); }
    const r = await createTeam(name, pw);
    console.log(`\nTeam created.`);
    console.log(`  Name: ${r.name}`);
    console.log(`  ID:   ${r.team_id}`);
    console.log("");
    console.log("Others can join with:");
    console.log(`  ctx-link join-team`);
  });

program
  .command("join-team")
  .description(
    "Join an existing team. Prompts for the team name and password.\n" +
    "Once joined, you can access all cloud bundles in that team.\n\n" +
    "Example:\n" +
    "  $ ctx-link join-team\n" +
    "  Team name: my-team\n" +
    "  Password: ****"
  )
  .action(async () => {
    const name = await input({ message: "Team name:" });
    if (!name) { console.error("Team name is required."); process.exit(1); }
    const pw = await password({ message: "Password:" });
    if (!pw) { console.error("Password is required."); process.exit(1); }
    const r = await joinTeam(name, pw);
    console.log(`\nJoined team ${r.name} (${r.team_id}).`);
  });

program
  .command("my-teams")
  .description(
    "List all teams you belong to. Shows team ID, name, and join date.\n" +
    "Use the team ID with 'ctx-link create --team <id>' or 'ctx-link team-bundles <id>'."
  )
  .action(() => {
    const teams = listMyTeams();
    if (teams.length === 0) {
      console.log("Not a member of any teams. Run 'ctx-link create-team' or 'ctx-link join-team'.");
      return;
    }
    for (const t of teams) {
      console.log(`${t.team_id}  ${t.name}  (joined ${t.joined_at})`);
    }
  });

program
  .command("team-bundles")
  .description(
    "List all bundles in a team. If no team ID given, prompts you to pick one.\n\n" +
    "Examples:\n" +
    "  $ ctx-link team-bundles\n" +
    "  $ ctx-link team-bundles 260c55e9-..."
  )
  .argument("[team_id]", "team ID (prompted if not given)")
  .action(async (teamIdArg?: string) => {
    let teamId = teamIdArg;
    if (!teamId) {
      const teams = listMyTeams();
      if (teams.length === 0) {
        console.error("Not a member of any teams. Run 'ctx-link create-team' or 'ctx-link join-team'.");
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
    const bundles = await listTeamBundles(teamId);
    if (bundles.length === 0) {
      console.log("No bundles in this team. Create one with 'ctx-link create <name>'.");
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
    "Show this project's ctx-link config. Reads .ctx-link.json in the current directory.\n" +
    "Shows: project name, mode, active bundle ID, auto-push settings."
  )
  .action(() => {
    const sessionId = getActiveSessionId();
    const session = sessionId ? loadActiveSession(sessionId) : null;

    console.log(`Project:  ${session?.project_name ?? detectProjectName()}`);
    console.log(`Session:  ${sessionId ?? "(none — not in a Claude Code session)"}`);
    console.log(`Branch:   ${session?.branch ?? "unknown"}`);
    console.log(`Bundles:  ${!session || session.bundles.length === 0 ? "(none — run 'ctx-link connect <bundle_id>')" : ""}`);
    if (session) {
      for (const b of session.bundles) {
        console.log(`  - ${b.bundle_id} [${b.mode}]`);
      }
    }
  });

// ==================== SESSION TRACKING ====================

program
  .command("session-start")
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

    if (!opts.sessionId) {
      console.error("--session-id is required.");
      process.exit(1);
    }
    const sessionId = opts.sessionId;

    // Check if this session already exists (e.g. /resume)
    const existing = loadActiveSession(sessionId);
    if (existing) {
      // Session exists — just update the marker file and branch
      existing.branch = branch;
      saveActiveSession(existing);
      setActiveSessionId(sessionId);
      return;
    }

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

    // Create new active session record
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

    // Write marker file so MCP server and hooks can find the session
    setActiveSessionId(sessionId);
  });

program
  .command("sessions")
  .description(
    "List recent Claude Code sessions across all projects.\n" +
    "Shows project name, branch, mode, bundle, and when the session started.\n\n" +
    "Example:\n" +
    "  $ ctx-link sessions\n" +
    "  $ ctx-link sessions --limit 10"
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

// ==================== SESSION ENTRIES ====================

program
  .command("session-log")
  .description(
    "Log a context entry to the current session (local only, NOT pushed to bundles).\n" +
    "Entries accumulate until you run 'ctx-link push --consolidate'.\n\n" +
    "Examples:\n" +
    "  $ ctx-link session-log --message 'Added GET /api/users endpoint'\n" +
    "  $ ctx-link session-log --event commit --ref $(git rev-parse HEAD) --diff"
  )
  .option("--event <type>", "event type", "manual")
  .option("--ref <ref>", "commit SHA, PR number, or reference")
  .option("--diff", "use git diff HEAD~1 as raw context for summary", false)
  .option("--message <text>", "summary text")
  .option("--summary <text>", "explicit summary (use with --diff)")
  .action(async (opts) => {
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

    let summary: string;
    if (opts.diff) {
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
        console.error("Provide --message <text> or use --diff.");
        process.exit(1);
      }
      summary = opts.message;
    }

    const entry = pushSessionEntry(sessionId, {
      project_name: session.project_name,
      event_type: opts.event,
      trigger_ref: opts.ref ?? null,
      summary,
      files_touched: [],
      decisions: [],
    });

    console.log(`Logged entry ${entry.id} to session ${sessionId.slice(0, 8)}...`);
    console.log(`  ${summary}`);
  });

program
  .command("session-entries")
  .description(
    "List accumulated session entries (un-pushed by default).\n\n" +
    "Example:\n" +
    "  $ ctx-link session-entries\n" +
    "  $ ctx-link session-entries --all"
  )
  .option("--all", "show all entries (including already pushed)", false)
  .action((opts) => {
    const sessionId = getActiveSessionId();
    if (!sessionId) {
      console.error("No active session.");
      process.exit(1);
    }
    const entries = opts.all
      ? getSessionEntries(sessionId)
      : getUnpushedSessionEntries(sessionId);

    if (entries.length === 0) {
      console.log("No pending session entries.");
      return;
    }
    for (const e of entries) {
      const status = e.pushed_at ? `[pushed ${e.pushed_at}]` : "[pending]";
      console.log(`${e.id}  ${e.created_at}  ${status}`);
      console.log(`  ${e.summary}`);
    }
  });

// ==================== PUSH TO CLOUD ====================

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
        choices: teams.map(t => ({ name: t.name, value: t.team_id, description: t.team_id })),
      });
    }
    const result = await pushSessionToCloud(sessionId, teamId);
    console.log(`Session pushed to cloud.`);
    console.log(`  Cloud ID: ${result.cloud_session_id}`);
    console.log(`  Entries synced: ${result.entries_synced}`);
  });

// ==================== CONNECT / DISCONNECT ====================

program
  .command("connect <bundle_id>")
  .description(
    "Connect the current Claude Code session to a bundle.\n" +
    "A session can be connected to multiple bundles. Push/pull operates on all of them.\n" +
    "Mode is auto-detected (local if bundle dir exists, else cloud).\n\n" +
    "Examples:\n" +
    "  $ ctx-link connect abc-123\n" +
    "  $ ctx-link connect abc-123 --mode cloud"
  )
  .option("--mode <mode>", "local | cloud (auto-detected if not set)")
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
    const mode = opts.mode ?? (isLocalBundle(bundleId) ? "local" : "cloud");

    // Don't add duplicates
    if (session.bundles.some((b) => b.bundle_id === bundleId)) {
      console.log(`Already connected to bundle ${bundleId}.`);
      return;
    }

    session.bundles.push({ bundle_id: bundleId, mode });
    saveActiveSession(session);

    // Add all session entries as refs to the new bundle
    const entries = getSessionEntries(session.session_id);
    if (entries.length > 0) {
      try {
        const entryIds = entries.map(e => e.id);
        if (isLocalBundle(bundleId)) {
          localAddEntriesToBundle(bundleId, entryIds, session.session_id);
        } else {
          if (session.cloud_session_id) {
            await syncNewEntries(session);
          }
          await addEntriesToBundle(bundleId, entryIds);
        }
        console.log(`Pushed ${entries.length} session entries to bundle.`);
      } catch {
        // Non-fatal
      }
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
    "Prompts for mode and team if not provided via flags.\n\n" +
    "Interactive:\n" +
    "  $ ctx-link create my-feature\n\n" +
    "With flags (for scripting):\n" +
    "  $ ctx-link create my-feature --mode local\n" +
    "  $ ctx-link create my-feature --mode cloud --team <team_id>"
  )
  .option("--mode <mode>", "'local' or 'cloud'")
  .option("--team <team_id>", "team ID (required for cloud, prompted if not given)")
  .action(async (name: string, opts) => {
    let mode: "local" | "cloud" = opts.mode;

    // Prompt for mode if not provided
    if (!mode) {
      mode = await select({
        message: "Storage mode:",
        choices: [
          { name: "Local  — same machine, no network", value: "local" as const },
          { name: "Cloud  — cross-machine, Supabase", value: "cloud" as const },
        ],
      });
    }
    if (mode !== "local" && mode !== "cloud") {
      console.error("--mode must be 'local' or 'cloud'.");
      process.exit(1);
    }

    // Prompt for team if cloud and not provided
    let teamId: string | undefined = opts.team;
    if (mode === "cloud" && !teamId) {
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

    const r = await createBundle(name, mode, teamId);
    const cfg = loadProjectConfig() ?? {
      mode: "off" as const,
      bundle: null,
      project_name: detectProjectName(),
      auto_push_on: ["commit"],
      push_debounce_seconds: 600,
    };
    cfg.mode = mode;
    cfg.bundle = r.bundle_id;
    saveProjectConfig(cfg);

    console.log(`\nBundle created (mode: ${mode}).`);
    console.log(`  ID:    ${r.bundle_id}`);
    console.log(`  Name:  ${r.name}`);
    console.log("");
    console.log("In another project, join with:");
    console.log(`  ctx-link join ${r.bundle_id}`);
  });

program
  .command("join <bundle_id> [token]")
  .description(
    "Join an existing bundle from the current project.\n" +
    "Mode is auto-detected (local if bundle dir exists, else cloud).\n" +
    "Cloud mode: no token needed (team membership is the auth).\n" +
    "Local mode: pass the token from 'ctx-link create' output.\n\n" +
    "Examples:\n" +
    "  $ ctx-link join abc-123\n" +
    "  $ ctx-link join abc-123 local_abc-123 --mode local"
  )
  .option("--mode <mode>", "'local' or 'cloud' (auto-detected if not set)")
  .action(async (bundleId: string, token: string | undefined, opts) => {
    let mode: "local" | "cloud" = opts.mode;
    if (!mode) {
      mode = isLocalBundle(bundleId) ? "local" : "cloud";
    }
    if (mode !== "local" && mode !== "cloud") {
      console.error("--mode must be 'local' or 'cloud'.");
      process.exit(1);
    }
    const projectName = detectProjectName();
    const r = await joinBundle(bundleId, token ?? "", projectName, mode);
    const cfg = loadProjectConfig() ?? {
      mode: "off" as const,
      bundle: null,
      project_name: projectName,
      auto_push_on: ["commit"],
      push_debounce_seconds: 600,
    };
    cfg.mode = mode;
    cfg.bundle = r.bundle_id;
    saveProjectConfig(cfg);
    console.log(`Joined bundle ${r.name} (${r.bundle_id}) as project '${projectName}' (mode: ${mode}).`);
  });

program
  .command("my-bundles")
  .description(
    "List all bundles this machine has ever joined (across all projects).\n" +
    "To see the bundle for the CURRENT project only, use 'ctx-link info'."
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
    "  $ ctx-link status abc-123"
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
    "Push session entries to connected bundles as references.\n\n" +
    "Usage:\n" +
    "  ctx-link push                      Push all session entries to all connected bundles\n" +
    "  ctx-link push --message <text>      Log a new entry, then push all to bundles\n\n" +
    "Examples:\n" +
    "  $ ctx-link push\n" +
    "  $ ctx-link push --message 'Added /api/auth endpoint with JWT'"
  )
  .option("--message <text>", "log a new entry before pushing")
  .action(async (opts) => {
    const sessionId = getActiveSessionId();
    const session = sessionId ? loadActiveSession(sessionId) : null;

    if (!session || session.bundles.length === 0) {
      console.error("No bundles connected to this session. Run 'ctx-link connect <bundle_id>' first.");
      process.exit(1);
    }

    // Optionally log a new entry first
    if (opts.message) {
      pushSessionEntry(session.session_id, {
        project_name: session.project_name,
        event_type: "manual",
        trigger_ref: null,
        summary: opts.message,
        files_touched: [],
        decisions: [],
      });
    }

    const entries = getSessionEntries(session.session_id);
    const entryIds = entries.map(e => e.id);

    if (entryIds.length === 0) {
      console.log("No session entries to push.");
      return;
    }

    // Sync to cloud if cloud-enabled
    if (session.cloud_session_id) {
      await syncNewEntries(session);
    }

    for (const b of session.bundles) {
      if (isLocalBundle(b.bundle_id)) {
        const r = localAddEntriesToBundle(b.bundle_id, entryIds, session.session_id);
        console.log(`[${b.bundle_id}] added ${r.added}, skipped ${r.skipped} (already in bundle)`);
      } else {
        const r = await addEntriesToBundle(b.bundle_id, entryIds);
        console.log(`[${b.bundle_id}] added ${r.added}, skipped ${r.skipped} (already in bundle)`);
      }
    }
  });

program
  .command("pull [bundle_id]")
  .description(
    "Pull recent entries from a bundle. Reads bundle from .ctx-link.json if no ID given.\n" +
    "By default, filters out your own project's entries (shows only cross-project context).\n\n" +
    "Examples:\n" +
    "  $ ctx-link pull                         Pull from current project's bundle\n" +
    "  $ ctx-link pull --include-self           Include your own entries\n" +
    "  $ ctx-link pull abc-123                  Pull from a specific bundle\n" +
    "  $ ctx-link pull --since 2026-04-22T12:00:00Z --limit 50"
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
      console.error("No bundles connected to this session. Run 'ctx-link connect <bundle_id>' first.");
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
    "Prompts for bundle, project, and strategy if not given via flags.\n" +
    "Dry-run by default — add --apply to execute. Reversible via 'ctx-link restore'.\n\n" +
    "Interactive:\n" +
    "  $ ctx-link rewind\n\n" +
    "With flags:\n" +
    "  $ ctx-link rewind --bundle abc --project my-api --last-n 3\n" +
    "  $ ctx-link rewind --bundle abc --project my-api --last-n 3 --apply --reason 'bad abstraction'"
  )
  .option("--bundle <id>", "bundle ID (prompted if not given)")
  .option("--project <name>", "project name (prompted if not given)")
  .option("--since <iso>", "rewind entries at or after this timestamp")
  .option("--last-n <n>", "rewind the last N entries from this project")
  .option("--entry-ids <ids>", "comma-separated entry IDs to rewind")
  .option("--after-ref <ref>", "rewind everything after this trigger_ref (pivot kept)")
  .option("--reason <msg>", "why you're rewinding (stored in audit log)")
  .option("--apply", "actually perform the rewind (default is dry-run)", false)
  .option("--force", "override the 50-entry safety cap", false)
  .option("--max <n>", "max affected entries without --force", "50")
  .action(async (opts) => {
    // Resolve bundle
    let bundleId: string = opts.bundle;
    if (!bundleId) {
      bundleId = await promptForBundle("Which bundle to rewind from?");
    }

    // Resolve project
    let projectName: string = opts.project;
    if (!projectName) {
      const sessionId = getActiveSessionId();
      const session = sessionId ? loadActiveSession(sessionId) : null;
      const defaultProject = session?.project_name;
      projectName = await input({
        message: "Project name to rewind:",
        default: defaultProject,
      });
    }

    // Resolve strategy
    const provided = [opts.since, opts.lastN, opts.entryIds, opts.afterRef].filter(Boolean);
    let strategy: RewindStrategy;

    if (provided.length === 0) {
      // Interactive strategy selection
      const strategyKind = await select({
        message: "Rewind strategy:",
        choices: [
          { name: "Last N entries", value: "last_n" },
          { name: "Since a timestamp", value: "since" },
          { name: "Specific entry IDs", value: "entry_ids" },
          { name: "After a trigger ref (SHA)", value: "after_ref" },
        ],
      });
      switch (strategyKind) {
        case "last_n": {
          const count = await input({ message: "How many entries?", default: "3" });
          strategy = { kind: "last_n", count: Number(count) };
          break;
        }
        case "since": {
          const since = await input({ message: "Since (ISO timestamp):" });
          strategy = { kind: "since", since };
          break;
        }
        case "entry_ids": {
          const ids = await input({ message: "Entry IDs (comma-separated):" });
          strategy = { kind: "entry_ids", ids: ids.split(",").map(s => s.trim()) };
          break;
        }
        case "after_ref": {
          const ref = await input({ message: "Trigger ref (commit SHA):" });
          strategy = { kind: "after_ref", trigger_ref: ref };
          break;
        }
        default:
          process.exit(1);
      }
    } else if (provided.length !== 1) {
      console.error("Specify exactly one of: --since, --last-n, --entry-ids, --after-ref");
      process.exit(1);
    } else {
      if (opts.since) strategy = { kind: "since", since: opts.since };
      else if (opts.lastN) strategy = { kind: "last_n", count: Number(opts.lastN) };
      else if (opts.entryIds)
        strategy = { kind: "entry_ids", ids: opts.entryIds.split(",").map((s: string) => s.trim()) };
      else strategy = { kind: "after_ref", trigger_ref: opts.afterRef };
    }

    // Prompt for reason if not given
    let reason = opts.reason;
    if (!reason && !opts.apply) {
      reason = await input({ message: "Reason (optional):", default: "" });
      if (!reason) reason = undefined;
    }

    const dryRun = !opts.apply;
    const r = await rewindProject({
      bundle_id: bundleId,
      project_name: projectName,
      strategy,
      reason,
      dry_run: dryRun,
      max_affected: Number(opts.max),
      force: opts.force,
    });

    console.log(
      `\n${dryRun ? "[DRY RUN] Would rewind" : "Rewound"} ${r.affected_count} entries from ${projectName}`
    );
    if (r.message) console.log(r.message);
    for (const e of r.affected_entries) {
      console.log(
        `  - ${e.id}  [${e.created_at}]  ${e.event_type}${e.trigger_ref ? ` (${e.trigger_ref})` : ""}`
      );
      console.log(`    ${e.summary_preview}`);
    }

    // If dry-run and there are entries, ask to apply
    if (dryRun && r.affected_count > 0) {
      const shouldApply = await confirm({ message: "Apply the rewind?", default: false });
      if (shouldApply) {
        const applied = await rewindProject({
          bundle_id: bundleId,
          project_name: projectName,
          strategy,
          reason,
          dry_run: false,
          max_affected: Number(opts.max),
          force: opts.force,
        });
        console.log(`\nRewound ${applied.affected_count} entries.`);
        if (applied.rewind_log_id) {
          console.log(`Audit log: ${applied.rewind_log_id}`);
          console.log(`Undo with: ctx-link restore --bundle ${bundleId} --project ${projectName} --from-log ${applied.rewind_log_id}`);
        }
      }
    } else if (r.rewind_log_id) {
      console.log(`\nAudit log: ${r.rewind_log_id}`);
      console.log(`Undo with: ctx-link restore --bundle ${bundleId} --project ${projectName} --from-log ${r.rewind_log_id}`);
    }
  });

program
  .command("restore")
  .description(
    "Undo a rewind — bring back soft-deleted entries.\n" +
    "Prompts for bundle, project, and method if not given via flags.\n\n" +
    "Interactive:\n" +
    "  $ ctx-link restore\n\n" +
    "With flags:\n" +
    "  $ ctx-link restore --bundle abc --project my-api --from-log <log_id>\n" +
    "  $ ctx-link restore --bundle abc --project my-api --entry-ids id1,id2"
  )
  .option("--bundle <id>", "bundle ID (prompted if not given)")
  .option("--project <name>", "project name (prompted if not given)")
  .option("--entry-ids <ids>", "comma-separated entry IDs to restore")
  .option("--from-log <id>", "restore all entries from a specific rewind log")
  .action(async (opts) => {
    // Resolve bundle
    let bundleId: string = opts.bundle;
    if (!bundleId) {
      bundleId = await promptForBundle("Which bundle to restore in?");
    }

    // Resolve project
    let projectName: string = opts.project;
    if (!projectName) {
      const sessionId = getActiveSessionId();
      const session = sessionId ? loadActiveSession(sessionId) : null;
      const defaultProject = session?.project_name;
      projectName = await input({
        message: "Project name to restore:",
        default: defaultProject,
      });
    }

    // Resolve method
    let entryIds: string[] | undefined = opts.entryIds
      ? opts.entryIds.split(",").map((s: string) => s.trim())
      : undefined;
    let rewindLogId: string | undefined = opts.fromLog;

    if (!entryIds && !rewindLogId) {
      const method = await select({
        message: "Restore method:",
        choices: [
          { name: "From a rewind log (undo a whole rewind)", value: "from_log" },
          { name: "Specific entry IDs", value: "entry_ids" },
        ],
      });
      if (method === "from_log") {
        // Show recent rewinds for this bundle/project
        const rewinds = await listRewinds(bundleId, projectName, 10);
        if (rewinds.length === 0) {
          console.error("No rewinds found for this bundle/project.");
          process.exit(1);
        }
        rewindLogId = await select({
          message: "Which rewind to undo?",
          choices: rewinds.map(r => ({
            name: `${r.performed_at}  ${r.strategy_kind}  ${r.affected_count} entries${r.reason ? ` — ${r.reason}` : ""}`,
            value: r.id,
          })),
        });
      } else {
        const ids = await input({ message: "Entry IDs (comma-separated):" });
        entryIds = ids.split(",").map(s => s.trim());
      }
    }

    const r = await restoreRewound({
      bundle_id: bundleId,
      project_name: projectName,
      entry_ids: entryIds,
      rewind_log_id: rewindLogId,
    });
    console.log(`Restored ${r.restored_count} entries.`);
    for (const id of r.restored_ids) console.log(`  - ${id}`);
  });

program
  .command("rewind-history")
  .description(
    "List past rewinds for a bundle. Use the log_id to restore.\n" +
    "Prompts for bundle if not given.\n\n" +
    "Examples:\n" +
    "  $ ctx-link rewind-history\n" +
    "  $ ctx-link rewind-history abc-123 --project my-api"
  )
  .argument("[bundle_id]", "bundle ID (prompted if not given)")
  .option("--project <name>", "filter by project name")
  .option("--limit <n>", "max results", "20")
  .action(async (bundleIdArg: string | undefined, opts) => {
    let bundleId = bundleIdArg;
    if (!bundleId) {
      bundleId = await promptForBundle("Which bundle?");
    }
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
    "Sets mode to 'off'. Rejoin anytime with 'ctx-link join'."
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
  .command("delete-bundle")
  .description(
    "Permanently delete a bundle and ALL its entries. Irreversible.\n" +
    "Prompts for bundle selection and confirmation.\n" +
    "Use 'ctx-link leave' if you just want to disconnect without destroying data."
  )
  .argument("[bundle_id]", "bundle ID (prompted if not given)")
  .action(async (bundleIdArg?: string) => {
    let bundleId = bundleIdArg;
    if (!bundleId) {
      bundleId = await promptForBundle("Which bundle to delete?");
    }

    // Get bundle name for confirmation
    const knownBundles = listLocalBundles();
    const bundleName = knownBundles.find(b => b.bundle_id === bundleId)?.name ?? bundleId;

    const ok = await confirm({
      message: `Permanently delete "${bundleName}" (${bundleId}) and ALL its entries?`,
      default: false,
    });
    if (!ok) {
      console.log("Cancelled.");
      return;
    }

    const cfg = loadProjectConfig();
    const mode = isLocalBundle(bundleId) ? "local" : ((cfg?.mode === "local" || cfg?.mode === "cloud") ? cfg.mode : "cloud");
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

/** Prompt user to pick a bundle from their connected session bundles or all known bundles. */
async function promptForBundle(message: string): Promise<string> {
  // First try: connected session bundles
  const sessionId = getActiveSessionId();
  const session = sessionId ? loadActiveSession(sessionId) : null;
  const knownBundles = listLocalBundles();
  const bundleNameMap = new Map(knownBundles.map(b => [b.bundle_id, b.name]));

  if (session && session.bundles.length > 0) {
    const choices = session.bundles.map(b => ({
      name: `${bundleNameMap.get(b.bundle_id) ?? b.bundle_id.slice(0, 12) + "..."}  [${b.mode}]`,
      value: b.bundle_id,
      description: b.bundle_id,
    }));

    // Also offer "other" if there are more known bundles
    const sessionBundleIds = new Set(session.bundles.map(b => b.bundle_id));
    const otherBundles = knownBundles.filter(b => !sessionBundleIds.has(b.bundle_id));
    if (otherBundles.length > 0) {
      choices.push({ name: "── Other bundles ──", value: "__other__", description: "" });
    }

    const picked = await select({ message, choices });

    if (picked === "__other__") {
      return select({
        message,
        choices: otherBundles.map(b => ({
          name: `${b.name}  (${b.bundle_id.slice(0, 12)}...)`,
          value: b.bundle_id,
          description: b.bundle_id,
        })),
      });
    }
    return picked;
  }

  // Fallback: all known bundles
  if (knownBundles.length > 0) {
    return select({
      message,
      choices: knownBundles.map(b => ({
        name: `${b.name}  (${b.bundle_id.slice(0, 12)}...)`,
        value: b.bundle_id,
        description: b.bundle_id,
      })),
    });
  }

  // Nothing to pick from — ask for manual input
  return input({ message: `${message} (enter bundle ID):` });
}

program.parseAsync().catch((err) => {
  console.error(err?.message ?? String(err));
  process.exit(1);
});
