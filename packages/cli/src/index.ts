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
  localAddEntriesToBundle,
  copySessionToCloud,
  connectSessionToBundle,
  unlinkSessionFromBundle,
  pushSessionToBundle,
  listAllLocalBundleDetails,
  isLocalBundle,
  askQuestion,
  answerQuestion,
  resolveQuestion,
  listBundleQuestions,
  renameActiveSession,
  renameCloudSession,
  deleteSession,
  deleteSessionEntry,
  deleteCloudSessionEntry,
  removeEntryFromBundle,
  localRemoveEntryFromBundle,
  pushBundleToCloud,
  getBundleTeamId,
  syncSessionToCloud,
  getCloudSessionEntries,
  addEntriesToBundle,
  listTeamSessions,
  getCloudSessionBundleConnections,
  isJoinCode,
  resolveJoinCode,
  regenerateJoinCode,
  getBundleToken,
  type RewindStrategy,
} from "@ctx-link/core";

const HELP_TEXT = `Usage: ctxl [command] [options]

Connect Claude Code sessions across projects via shared context bundles.

Quick start:
  $ ctxl init                      Create a bundle + connect in one step
  $ ctxl join ctx-a3f9k2           Join via short code from a teammate
  $ ctxl push --message '...'      Push context (or auto on git commit)
  $ ctxl pull                      Pull context from the other project

Setup:
  setup                            Add MCP server to Claude Code
  init                             Create bundle, connect session, get join code
  ui                               Start the web dashboard
  info                             Show current project config

Teams:
  create-team                      Create a new team (cloud mode)
  join-team                        Join an existing team
  my-teams                         List your teams
  team-bundles [team_id]           List bundles in a team

Sessions:
  session-start                    Record active session (used by hooks)
  session-resume [id]              Resume a previous session
  sessions                         List all active sessions
  session-log                      Log a context entry to the session
  session-entries                  List session entries
  session-rename [name]            Rename the current session
  session-delete [id]              Delete a session and all cloud copies
  session-delete-entry [id]        Delete a specific entry from session

Session Connectivity:
  connect [bundle_id]              Connect session to a bundle
  disconnect [bundle_id]           Disconnect session from a bundle

Bundles:
  create [name]                    Create a new bundle
  join [bundle_id]                 Join a bundle (accepts short codes: ctx-abc123)
  my-bundles                       List all bundles
  status [bundle_id]               Show bundle details
  delete-bundle [bundle_id]        Permanently delete a bundle
  regenerate-code [bundle_id]      Generate a new short join code
  leave                            Disconnect from bundle (keeps it alive)

Bundle Entries:
  push                             Push session entries to all connected bundles
  push-to-bundle                   Push entries to a specific bundle
  pull [bundle_id]                 Pull entries from a bundle
  bundle-entries [bundle_id]       List all entries in a bundle
  bundle-remove-entry              Remove an entry ref from a bundle
  bundle-pull-from-sessions        Pull from all connected sessions into bundle
  bundle-to-cloud [bundle_id]      Migrate a local bundle to cloud

Options:
  -V, --version                    Output the version number
  -h, --help                       Display help for command

Run 'ctxl <command> --help' for details on any command.
`;

// Detect if running from source (dev) or published (prod)
const isDev = import.meta.path.endsWith(".ts");
const rootPkg = await import("../../../package.json");
const cliVersion = rootPkg.version ?? "0.0.0";
const versionString = isDev ? `${cliVersion} (dev)` : cliVersion;

function updateMcpSettings(settingsPath: string, entry: Record<string, unknown>) {
  const { writeFileSync } = require("node:fs");
  let settings: any = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, "utf8")); } catch {}
  }
  if (!settings.mcpServers) settings.mcpServers = {};
  settings.mcpServers["ctx-link"] = entry;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

// Hidden --env flag: switch CLI + MCP between dev/prod without exposing to users
const envIdx = process.argv.indexOf("--env");
if (envIdx !== -1 && process.argv[envIdx + 1]) {
  const mode = process.argv[envIdx + 1];
  if (mode !== "dev" && mode !== "prod") {
    console.error("Usage: ctxl --env dev|prod");
    process.exit(1);
  }
  const os = await import("node:os");
  const path = await import("node:path");
  const { mkdirSync } = await import("node:fs");
  const bunBin = path.resolve(os.homedir(), ".bun/bin");
  const settingsPath = path.resolve(os.homedir(), ".claude/settings.json");
  const devRepoFile = path.resolve(os.homedir(), ".ctx-link/dev-repo.txt");

  if (mode === "dev") {
    // Find repo root: walk up from import.meta.dir, or from cwd, looking for workspace package.json
    let repoRoot: string | null = null;
    for (const start of [import.meta.dir, process.cwd()]) {
      let dir = path.resolve(start);
      while (dir !== "/") {
        const pkgPath = path.resolve(dir, "package.json");
        if (existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
            if (pkg.name === "ctx-link" && existsSync(path.resolve(dir, "packages/cli/src/index.ts"))) { repoRoot = dir; break; }
          } catch {}
        }
        dir = path.dirname(dir);
      }
      if (repoRoot) break;
    }
    // Fallback: read saved repo path
    if (!repoRoot && existsSync(devRepoFile)) {
      const saved = readFileSync(devRepoFile, "utf8").trim();
      if (existsSync(path.resolve(saved, "packages/cli/src/index.ts"))) repoRoot = saved;
    }
    if (!repoRoot) {
      console.error("Could not find ctx-link repo. Run 'ctxl --env dev' from the repo directory first.");
      process.exit(1);
    }

    // Save repo path for future use from published binary
    const { writeFileSync: wf, mkdirSync: md } = await import("node:fs");
    md(path.dirname(devRepoFile), { recursive: true });
    wf(devRepoFile, repoRoot + "\n");

    // Symlink CLI + MCP to local source
    const { symlinkSync, unlinkSync } = await import("node:fs");
    try { unlinkSync(path.resolve(bunBin, "ctxl")); } catch {}
    try { unlinkSync(path.resolve(bunBin, "ctx-link")); } catch {}
    symlinkSync(path.resolve(repoRoot, "packages/cli/src/index.ts"), path.resolve(bunBin, "ctxl"));
    symlinkSync(path.resolve(repoRoot, "packages/mcp-server/src/index.ts"), path.resolve(bunBin, "ctx-link"));

    // MCP config → local source
    const mpcEntry = { command: "bun", args: [path.resolve(repoRoot, "packages/mcp-server/src/index.ts")] };
    updateMcpSettings(settingsPath, mpcEntry);
  } else {
    execSync("bun install -g ctx-link", { stdio: "ignore" });

    // MCP config → published binary
    updateMcpSettings(settingsPath, { command: path.resolve(bunBin, "ctx-link") });
  }

  console.log(`Switched to ${mode}.`);
  if (mode === "dev") console.log(`  ctxl → local source`);
  console.log("Restart Claude Code for MCP changes.");
  process.exit(0);
}

const program = new Command();
program
  .name("ctxl")
  .description("Connect Claude Code sessions across projects via shared context bundles.")
  .version(versionString)
  .helpCommand(false);

// Replace Commander's default help with our grouped layout (root command only)
program.helpInformation = () => HELP_TEXT;

// ==================== TEAMS (cloud mode only) ====================

program
  .command("create-team")
  .description(
    "Create a new team for cloud mode. Prompts for name and password.\n" +
    "You are auto-joined as a member. Share the name + password with teammates.\n\n" +
    "Example:\n" +
    "  $ ctxl create-team\n" +
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
    console.log(`  ctxl join-team`);
  });

program
  .command("join-team")
  .description(
    "Join an existing team. Prompts for the team name and password.\n" +
    "Once joined, you can access all cloud bundles in that team.\n\n" +
    "Example:\n" +
    "  $ ctxl join-team\n" +
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
    "Use the team ID with 'ctxl create --team <id>' or 'ctxl team-bundles <id>'."
  )
  .action(() => {
    const teams = listMyTeams();
    if (teams.length === 0) {
      console.log("Not a member of any teams. Run 'ctxl create-team' or 'ctxl join-team'.");
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
    "  $ ctxl team-bundles\n" +
    "  $ ctxl team-bundles 260c55e9-..."
  )
  .argument("[team_id]", "team ID (prompted if not given)")
  .action(async (teamIdArg?: string) => {
    let teamId = teamIdArg;
    if (!teamId) {
      const teams = listMyTeams();
      if (teams.length === 0) {
        console.error("Not a member of any teams. Run 'ctxl create-team' or 'ctxl join-team'.");
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
      console.log("No bundles in this team. Create one with 'ctxl create <name>'.");
      return;
    }
    for (const b of bundles) {
      console.log(`${b.bundle_id}  ${b.name}  (created ${b.created_at})`);
    }
  });

// ==================== SETUP ====================

program
  .command("setup")
  .description(
    "Add ctx-link MCP server + hooks to Claude Code settings.\n" +
    "Configures the MCP server, session auto-start hook, and activity logging hook.\n\n" +
    "Examples:\n" +
    "  $ ctxl setup            # add to global (user) settings\n" +
    "  $ ctxl setup --project  # add to current project only\n" +
    "  $ ctxl setup --force    # overwrite existing config"
  )
  .option("--project", "add to .claude/settings.json in the current directory instead of global", false)
  .option("--force", "overwrite existing ctx-link config", false)
  .action(async (opts) => {
    const { resolve, dirname } = await import("node:path");
    const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
    const os = await import("node:os");

    const settingsPath = opts.project
      ? resolve(process.cwd(), ".claude", "settings.json")
      : resolve(os.homedir(), ".claude", "settings.json");

    const scope = opts.project ? "project" : "global";

    // Read existing settings or start fresh
    let settings: any = {};
    if (existsSync(settingsPath)) {
      try {
        settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      } catch {
        console.error(`Failed to parse ${settingsPath}. Fix it manually or delete it.`);
        process.exit(1);
      }
    }

    // Check if already configured
    if (!opts.force && settings.mcpServers?.["ctx-link"]) {
      const hasHooks = JSON.stringify(settings.hooks ?? {}).includes("ctxl");
      if (hasHooks) {
        console.log(`ctx-link is already configured in ${scope} settings.`);
        console.log(`  ${settingsPath}`);
        console.log(`\nRun with --force to overwrite.`);
        return;
      }
    }

    // Find the ctx-link binary path
    let ctxLinkBin: string;
    try {
      ctxLinkBin = execSync("which ctx-link", { encoding: "utf8" }).trim();
    } catch {
      ctxLinkBin = "ctx-link";
    }

    // Find the hook script path (relative to the installed package)
    let hookPath: string;
    try {
      // Resolve from the ctx-link binary to the hooks directory
      const binPath = execSync("which ctx-link", { encoding: "utf8" }).trim();
      const realBin = execSync(`readlink -f "${binPath}" 2>/dev/null || realpath "${binPath}" 2>/dev/null || echo "${binPath}"`, { encoding: "utf8" }).trim();
      const distDir = dirname(realBin);
      const candidate = resolve(distDir, "hooks", "claude-code-hook.sh");
      if (existsSync(candidate)) {
        hookPath = candidate;
      } else {
        // Fallback: try npm global location
        hookPath = resolve(distDir, "..", "dist", "hooks", "claude-code-hook.sh");
      }
    } catch {
      hookPath = "claude-code-hook.sh";
    }

    // Find ctxl binary path
    let ctxlBin: string;
    try {
      ctxlBin = execSync("which ctxl", { encoding: "utf8" }).trim();
    } catch {
      ctxlBin = "ctxl";
    }

    // --- MCP Server ---
    if (!settings.mcpServers) settings.mcpServers = {};
    settings.mcpServers["ctx-link"] = {
      command: ctxLinkBin,
    };

    // --- Hooks ---
    if (!settings.hooks) settings.hooks = {};

    // SessionStart hook: auto-create session with Claude's session ID
    const sessionStartHook = {
      hooks: [
        {
          type: "command",
          command: `SESSION_ID=$(cat | bun -e "try{process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).session_id??'')}catch{process.stdout.write('')}" 2>/dev/null); [ -n "$SESSION_ID" ] && ${ctxlBin} session-start --session-id "$SESSION_ID" || true`,
        },
      ],
    };

    // PostToolUse hook: auto-log edits, commits, PRs
    const postToolUseHook = {
      matcher: "Write|Edit|Bash",
      hooks: [
        {
          type: "command",
          command: hookPath,
        },
      ],
    };

    // Add hooks without removing existing non-ctx-link hooks
    const existingSessionStart: any[] = settings.hooks.SessionStart ?? [];
    const existingPostToolUse: any[] = settings.hooks.PostToolUse ?? [];

    // Remove old ctx-link hooks (to avoid duplicates on --force)
    settings.hooks.SessionStart = existingSessionStart.filter(
      (h: any) => !JSON.stringify(h).includes("ctxl")
    );
    settings.hooks.PostToolUse = existingPostToolUse.filter(
      (h: any) => !JSON.stringify(h).includes("ctx-link") && !JSON.stringify(h).includes("claude-code-hook")
    );

    settings.hooks.SessionStart.push(sessionStartHook);
    settings.hooks.PostToolUse.push(postToolUseHook);

    // Write
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");

    console.log(`ctx-link configured in ${scope} Claude Code settings:`);
    console.log(`  ${settingsPath}\n`);
    console.log(`  ✓ MCP server (ctx-link tools for Claude)`);
    console.log(`  ✓ SessionStart hook (auto-create session)`);
    console.log(`  ✓ PostToolUse hook (auto-log edits, commits, PRs)\n`);
    console.log(`Restart Claude Code to activate. Run /mcp to verify.`);
  });

// ==================== UI DASHBOARD ====================

program
  .command("ui")
  .description(
    "Start the ctx-link web dashboard.\n" +
    "Launches the API + UI server on port 5174 and opens the browser.\n" +
    "Requires 'bun run build:ui' to have been run at least once.\n\n" +
    "Examples:\n" +
    "  $ ctxl ui\n" +
    "  $ ctxl ui --port 3000\n" +
    "  $ ctxl ui --stop"
  )
  .option("--no-open", "don't open the browser automatically")
  .option("--stop", "stop the running UI server")
  .option("--port <port>", "port to run on (default: 5174)", "5174")
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);

    // Handle --stop: find the ctx-link UI server process and kill it
    if (opts.stop) {
      try {
        const pids = execSync("pgrep -f 'ctx-link.*server\\.(ts|js)|server\\.(ts|js).*ctx-link'", { encoding: "utf8" }).trim();
        if (pids) {
          for (const pid of pids.split("\n")) {
            try { process.kill(parseInt(pid), "SIGTERM"); } catch {}
          }
          console.log("ctx-link UI server stopped.");
          return;
        }
      } catch {}

      // Fallback: try the default and custom port
      for (const p of [port, 5174]) {
        try {
          const res = await fetch(`http://127.0.0.1:${p}/api/teams`, { signal: AbortSignal.timeout(1000) });
          if (res.ok) {
            execSync(`lsof -ti:${p} | xargs kill`, { stdio: "ignore" });
            console.log(`ctx-link UI server on port ${p} stopped.`);
            return;
          }
        } catch {}
      }

      console.log("ctx-link UI server is not running.");
      return;
    }
    const { resolve } = await import("node:path");

    // Find server — works in both bundled (dist/) and dev (monorepo) mode
    const serverCandidates = [
      resolve(import.meta.dir, "server.js"),           // bundled: dist/server.js (cli.js is in dist/)
      resolve(import.meta.dir, "../../ui/server.ts"),   // dev: packages/cli/src/ → packages/ui/server.ts
    ];
    const serverPath = serverCandidates.find(existsSync);
    if (!serverPath) {
      console.error("UI server not found. Make sure ctx-link is fully installed.");
      process.exit(1);
    }

    // Find built UI — check both bundled and dev locations
    const distCandidates = [
      resolve(import.meta.dir, "ui/index.html"),        // bundled: dist/ui/index.html
      resolve(import.meta.dir, "../../ui/dist/index.html"), // dev
    ];
    if (!distCandidates.some(existsSync)) {
      console.error("UI not built. Run 'bun run build' first.");
      process.exit(1);
    }

    // Check if already running
    let alreadyRunning = false;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/teams`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) alreadyRunning = true;
    } catch {}

    if (alreadyRunning) {
      console.log(`ctx-link UI already running at http://localhost:${port}`);
    } else {
      console.log("Starting ctx-link UI server...");
      const proc = Bun.spawn(["bun", serverPath], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, CTX_LINK_PORT: String(port) },
      });
      proc.unref();

      // Wait briefly for server to start
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 300));
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/teams`, {
            signal: AbortSignal.timeout(500),
          });
          if (res.ok) break;
        } catch {}
      }
      console.log(`ctx-link UI server running at http://localhost:${port}`);
    }

    if (opts.open !== false) {
      const { platform } = await import("node:os");
      const openCmd = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
      try {
        execSync(`${openCmd} http://localhost:${port}`, { stdio: "ignore" });
      } catch {}
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
    console.log(`Bundles:  ${!session || session.bundles.length === 0 ? "(none — run 'ctxl connect <bundle_id>')" : ""}`);
    if (session) {
      for (const b of session.bundles) {
        console.log(`  - ${b.bundle_id} [${b.mode}]`);
      }
    }
  });

// ==================== INIT WIZARD ====================

program
  .command("init")
  .description(
    "Initialize ctx-link in this project. Creates a bundle, connects your session,\n" +
    "and prints a join code for teammates.\n\n" +
    "Example:\n" +
    "  $ ctxl init\n" +
    "  Bundle name: my-api\n" +
    "  Mode: cloud\n" +
    "  Team: my-team\n" +
    "  ✓ Bundle created\n" +
    "  ✓ Session connected\n" +
    "  Share with teammates: ctxl join ctx-a3f9k2"
  )
  .option("--name <name>", "Bundle name")
  .option("--mode <mode>", "local or cloud")
  .option("--team <team_id>", "Team ID (cloud mode)")
  .action(async (opts) => {
    // Check for existing config
    const existing = loadProjectConfig();
    if (existing?.bundle) {
      const overwrite = await confirm({
        message: `This project is already linked to bundle ${existing.bundle.slice(0, 8)}... Create a new bundle?`,
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
    const mode: "local" | "cloud" = opts.mode ?? await select({
      message: "Mode:",
      choices: [
        { name: "local — same machine only, no network", value: "local" as const },
        { name: "cloud — cross-machine, requires team", value: "cloud" as const },
      ],
    });

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
        const team = await createTeam(teamName, pw);
        teamId = team.team_id;
        console.log(`  Team "${team.name}" created.`);
      } else if (teams.length === 1) {
        teamId = teams[0].team_id;
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
    console.log(`  ✓ Bundle "${result.name}" created`);

    // 5. Connect session
    const sessionId = getActiveSessionId();
    if (sessionId) {
      connectSessionToBundle(sessionId, result.bundle_id, mode);
      console.log(`  ✓ Session connected`);
    } else {
      console.log(`  ⚠ No active session — start Claude Code first`);
    }

    // 6. Detect project name
    const projectName = detectProjectName();

    // 7. Write .ctx-link.json
    saveProjectConfig({
      mode,
      bundle: result.bundle_id,
      project_name: projectName,
      auto_push_on: ["commit"],
      push_debounce_seconds: 600,
      auto_sync: true,
    });
    console.log(`  ✓ .ctx-link.json written`);

    // 8. Print join info
    console.log("");
    if (mode === "cloud" && result.join_code) {
      console.log(`Share with teammates:`);
      console.log(`  ctxl join ${result.join_code}`);
    } else {
      console.log(`Others can join with:`);
      console.log(`  ctxl join ${result.bundle_id}`);
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

    const claudeInstanceId = process.env.CLAUDE_CODE_SSE_PORT ?? null;

    // Check if this session already exists (e.g. /resume)
    const existing = loadActiveSession(sessionId);
    if (existing) {
      // Session exists — refresh branch + bind to this Claude instance so
      // findSessionByInstanceId() can disambiguate when multiple Claude
      // instances share a project directory.
      existing.branch = branch;
      existing.claude_instance_id = claudeInstanceId;
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
      cloud_copies: [],
      claude_instance_id: claudeInstanceId,
    });

    // Write marker file so MCP server and hooks can find the session
    setActiveSessionId(sessionId);
  });

program
  .command("session-resume")
  .description(
    "Resume an existing session. Lists all active sessions and lets you pick one.\n" +
    "Sets the marker file so the MCP server and hooks use that session.\n\n" +
    "Examples:\n" +
    "  $ ctxl session-resume\n" +
    "  $ ctxl session-resume <session_id>"
  )
  .argument("[session_id]", "session ID to resume (prompted if not given)")
  .action(async (sessionIdArg?: string) => {
    let sessionId = sessionIdArg;

    if (!sessionId) {
      const sessions = listActiveSessions();
      if (sessions.length === 0) {
        console.log("No active sessions found.");
        return;
      }

      const currentId = getActiveSessionId();

      sessionId = await select({
        message: "Which session to resume?",
        choices: sessions.map((s) => {
          const entryCount = getSessionEntries(s.session_id).length;
          const bundleCount = s.bundles.length;
          const isCurrent = s.session_id === currentId;
          const label = [
            s.name ?? s.project_name,
            s.branch ? `(${s.branch})` : null,
            `${entryCount} entries`,
            bundleCount > 0 ? `${bundleCount} bundles` : null,
            isCurrent ? "[current]" : null,
          ].filter(Boolean).join("  ");

          return {
            name: label,
            value: s.session_id,
            description: `${s.session_id}  started ${s.started_at}`,
          };
        }),
      });
    }

    const session = loadActiveSession(sessionId);
    if (!session) {
      console.error(`Session ${sessionId} not found.`);
      process.exit(1);
    }

    setActiveSessionId(sessionId);
    console.log(`Resumed session ${sessionId.slice(0, 8)}...`);
    console.log(`  Project: ${session.project_name}`);
    console.log(`  Branch:  ${session.branch ?? "unknown"}`);
    console.log(`  Bundles: ${session.bundles.length}`);
    console.log(`  Entries: ${getSessionEntries(sessionId).length}`);
  });

program
  .command("sessions")
  .description(
    "List recent Claude Code sessions across all projects.\n" +
    "Shows project name, branch, mode, bundle, and when the session started.\n\n" +
    "Example:\n" +
    "  $ ctxl sessions\n" +
    "  $ ctxl sessions --limit 10"
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
    "Entries accumulate until you run 'ctxl push --consolidate'.\n\n" +
    "Examples:\n" +
    "  $ ctxl session-log --message 'Added GET /api/users endpoint'\n" +
    "  $ ctxl session-log --event commit --ref $(git rev-parse HEAD) --diff"
  )
  .option("--event <type>", "event type", "manual")
  .option("--ref <ref>", "commit SHA, PR number, or reference")
  .option("--diff", "use git diff HEAD~1 as raw context for summary", false)
  .option("--message <text>", "summary text")
  .option("--summary <text>", "explicit summary (use with --diff)")
  .option("--session-id <id>", "target session ID (defaults to active session)")
  .action(async (opts) => {
    const sessionId = opts.sessionId ?? getActiveSessionId();
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
    "  $ ctxl session-entries\n" +
    "  $ ctxl session-entries --all"
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
    "  $ ctxl push-to-cloud"
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
        console.error("No teams found. Create one first with 'ctxl create-team'.");
        process.exit(1);
      }
      teamId = await select({
        message: "Which team?",
        choices: teams.map(t => ({ name: t.name, value: t.team_id, description: t.team_id })),
      });
    }
    const session = loadActiveSession(sessionId);
    const copies = session?.cloud_copies ?? [];
    if (copies.some((c) => c.team_id === teamId)) {
      console.error("This session has already been copied to this team.");
      process.exit(1);
    }
    const result = await copySessionToCloud(sessionId, teamId);
    if (session) {
      if (!session.cloud_copies) session.cloud_copies = [];
      session.cloud_copies.push({ cloud_session_id: result.cloud_session_id, team_id: teamId });
      // Keep legacy fields pointing to first copy
      if (!session.cloud_session_id) {
        session.cloud_session_id = result.cloud_session_id;
        session.team_id = teamId;
      }
      saveActiveSession(session);
    }
    console.log(`Session copied to cloud.`);
    console.log(`  Cloud ID: ${result.cloud_session_id}`);
    console.log(`  Entries copied: ${result.entries_copied}`);
  });

// ==================== CONNECT / DISCONNECT ====================

program
  .command("connect")
  .description(
    "Connect the current Claude Code session to a bundle.\n" +
    "A session can be connected to multiple bundles. Push/pull operates on all of them.\n" +
    "Mode is auto-detected (local if bundle dir exists, else cloud).\n\n" +
    "Examples:\n" +
    "  $ ctxl connect\n" +
    "  $ ctxl connect abc-123"
  )
  .argument("[bundle_id]", "bundle ID (prompted if not given)")
  .option("--mode <mode>", "local | cloud (auto-detected if not set)")
  .action(async (bundleIdArg: string | undefined, opts) => {
    let bundleId = bundleIdArg;
    if (!bundleId) {
      bundleId = await promptForBundle("Which bundle to connect to?");
    }
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

    const updated = connectSessionToBundle(sessionId, bundleId, mode);

    console.log(`Connected session ${sessionId.slice(0, 8)}... to bundle ${bundleId}`);
    console.log(`Session now has ${updated.bundles.length} bundle(s).`);
  });

program
  .command("disconnect")
  .description(
    "Disconnect the current session from a bundle.\n" +
    "The bundle still exists — you just stop pushing/pulling to it.\n" +
    "Prompts you to pick from connected bundles if no ID given."
  )
  .argument("[bundle_id]", "bundle ID (prompted if not given)")
  .action(async (bundleIdArg?: string) => {
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

    let bundleId = bundleIdArg;
    if (!bundleId) {
      if (session.bundles.length === 0) {
        console.log("No bundles connected to this session.");
        return;
      }
      const knownBundles = listLocalBundles();
      const bundleNameMap = new Map(knownBundles.map(b => [b.bundle_id, b.name]));
      bundleId = await select({
        message: "Which bundle to disconnect from?",
        choices: session.bundles.map(b => ({
          name: `${bundleNameMap.get(b.bundle_id) ?? b.bundle_id.slice(0, 12) + "..."}  [${b.mode}]`,
          value: b.bundle_id,
          description: b.bundle_id,
        })),
      });
    }

    await unlinkSessionFromBundle(sessionId, bundleId!);
    console.log(`Disconnected from bundle ${bundleId} and removed entry refs.`);
  });

// ==================== BUNDLES ====================

program
  .command("create")
  .description(
    "Create a new bundle and link it to the current project.\n" +
    "Prompts for name, mode, and team interactively.\n\n" +
    "Interactive:\n" +
    "  $ ctxl create\n\n" +
    "With flags (for scripting):\n" +
    "  $ ctxl create --name my-feature --mode local\n" +
    "  $ ctxl create --name my-feature --mode cloud --team <team_id>"
  )
  .argument("[name]", "bundle name (prompted if not given)")
  .option("--mode <mode>", "'local' or 'cloud'")
  .option("--team <team_id>", "team ID (required for cloud, prompted if not given)")
  .action(async (nameArg: string | undefined, opts) => {
    let name = nameArg;
    if (!name) {
      name = await input({ message: "Bundle name:" });
      if (!name) { console.error("Bundle name is required."); process.exit(1); }
    }
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
        console.error("No teams found. Create one first with 'ctxl create-team'.");
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
      mode: mode,
      bundle: null,
      project_name: detectProjectName(),
      auto_push_on: ["commit"],
      push_debounce_seconds: 600,
      auto_sync: true,
    };
    cfg.mode = mode;
    cfg.bundle = r.bundle_id;
    saveProjectConfig(cfg);

    // Auto-connect active session to the new bundle
    const sessionId = getActiveSessionId();
    if (sessionId) {
      const session = loadActiveSession(sessionId);
      if (session && !session.bundles.some((b) => b.bundle_id === r.bundle_id)) {
        session.bundles.push({ bundle_id: r.bundle_id, mode });
        saveActiveSession(session);
        console.log(`\nBundle created and session connected (mode: ${mode}).`);
      } else {
        console.log(`\nBundle created (mode: ${mode}).`);
      }
    } else {
      console.log(`\nBundle created (mode: ${mode}).`);
    }
    console.log(`  ID:    ${r.bundle_id}`);
    console.log(`  Name:  ${r.name}`);
    console.log("");
    console.log("In another project, join with:");
    console.log(`  ctxl join ${r.bundle_id}`);
  });

program
  .command("join")
  .description(
    "Join an existing bundle from the current project.\n" +
    "Accepts a bundle ID, or a short join code (e.g., ctx-abc123).\n" +
    "Mode is auto-detected (local if bundle dir exists, else cloud).\n" +
    "Cloud mode: lists your team bundles to pick from.\n" +
    "Local mode: pass the token from 'ctxl create' output.\n\n" +
    "Interactive:\n" +
    "  $ ctxl join\n\n" +
    "With flags (for scripting):\n" +
    "  $ ctxl join abc-123\n" +
    "  $ ctxl join ctx-a3f9k2"
  )
  .argument("[bundle_id]", "bundle ID (prompted if not given)")
  .argument("[token]", "join token (local mode only)")
  .option("--mode <mode>", "'local' or 'cloud' (auto-detected if not set)")
  .action(async (bundleIdArg: string | undefined, token: string | undefined, opts) => {
    // Resolve short join code if provided
    if (bundleIdArg && isJoinCode(bundleIdArg)) {
      const resolved = await resolveJoinCode(bundleIdArg);
      if (!resolved) {
        console.error("Join code not found or expired. Ask the bundle owner for a new code.");
        process.exit(1);
      }
      bundleIdArg = resolved.bundle_id;
      token = resolved.token;
      console.log(`Resolved join code → bundle ${resolved.bundle_id.slice(0, 8)}...`);
    }

    let bundleId = bundleIdArg;
    let mode: "local" | "cloud" = opts.mode;

    if (!bundleId) {
      // Prompt: pick mode first, then list available bundles
      if (!mode) {
        mode = await select({
          message: "Bundle type:",
          choices: [
            { name: "Cloud  — pick from your team bundles", value: "cloud" as const },
            { name: "Local  — enter a bundle ID manually", value: "local" as const },
          ],
        });
      }

      if (mode === "cloud") {
        // List teams, pick one, then list its bundles
        const teams = listMyTeams();
        if (teams.length === 0) {
          console.error("No teams found. Join one first with 'ctxl join-team'.");
          process.exit(1);
        }
        let teamId: string;
        if (teams.length === 1) {
          teamId = teams[0].team_id;
        } else {
          teamId = await select({
            message: "Which team?",
            choices: teams.map(t => ({ name: t.name, value: t.team_id, description: t.team_id })),
          });
        }
        const bundles = await listTeamBundles(teamId);
        if (bundles.length === 0) {
          console.error("No bundles in this team. Create one with 'ctxl create'.");
          process.exit(1);
        }
        bundleId = await select({
          message: "Which bundle to join?",
          choices: bundles.map(b => ({
            name: b.name,
            value: b.bundle_id,
            description: b.bundle_id,
          })),
        });
      } else {
        bundleId = await input({ message: "Bundle ID:" });
        if (!bundleId) { console.error("Bundle ID is required."); process.exit(1); }
      }
    }

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
      mode: mode,
      bundle: null,
      project_name: projectName,
      auto_push_on: ["commit"],
      push_debounce_seconds: 600,
      auto_sync: true,
    };
    cfg.mode = mode;
    cfg.bundle = r.bundle_id;
    saveProjectConfig(cfg);

    // Auto-connect active session to the bundle
    const sessionId = getActiveSessionId();
    if (sessionId) {
      const session = loadActiveSession(sessionId);
      if (session && !session.bundles.some((b) => b.bundle_id === r.bundle_id)) {
        session.bundles.push({ bundle_id: r.bundle_id, mode });
        saveActiveSession(session);

        // For local bundles, add session entries as refs
        if (isLocalBundle(r.bundle_id)) {
          const entries = getSessionEntries(session.session_id);
          if (entries.length > 0) {
            try {
              const entryIds = entries.map(e => e.id);
              localAddEntriesToBundle(r.bundle_id, entryIds, session.session_id);
            } catch {}
          }
        }

        console.log(`Joined bundle ${r.name} (${r.bundle_id}) as project '${projectName}' (mode: ${mode}). Session connected.`);
      } else {
        console.log(`Joined bundle ${r.name} (${r.bundle_id}) as project '${projectName}' (mode: ${mode}).`);
      }
    } else {
      console.log(`Joined bundle ${r.name} (${r.bundle_id}) as project '${projectName}' (mode: ${mode}).`);
    }
  });

program
  .command("my-bundles")
  .description(
    "List all bundles this machine has ever joined (across all projects).\n" +
    "To see the bundle for the CURRENT project only, use 'ctxl info'."
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
  .command("status")
  .description(
    "Show bundle details: session count, entry count, last activity.\n" +
    "Prompts you to pick a bundle if no ID given.\n\n" +
    "Examples:\n" +
    "  $ ctxl status\n" +
    "  $ ctxl status abc-123"
  )
  .argument("[bundle_id]", "bundle ID (prompted if not given)")
  .action(async (bundleIdArg?: string) => {
    let bundleId = bundleIdArg;
    if (!bundleId) {
      bundleId = await promptForBundle("Which bundle?");
    }
    const mode = isLocalBundle(bundleId) ? "local" : "cloud";
    const s = await bundleStatus(bundleId, mode);
    console.log(JSON.stringify(s, null, 2));
  });

// ==================== PUSH / PULL ====================

program
  .command("push")
  .description(
    "Push session entries to connected bundles as references.\n\n" +
    "Usage:\n" +
    "  ctxl push                      Push all session entries to all connected bundles\n" +
    "  ctxl push --message <text>      Log a new entry, then push all to bundles\n\n" +
    "Examples:\n" +
    "  $ ctxl push\n" +
    "  $ ctxl push --message 'Added /api/auth endpoint with JWT'"
  )
  .option("--message <text>", "log a new entry before pushing")
  .action(async (opts) => {
    const sessionId = getActiveSessionId();
    const session = sessionId ? loadActiveSession(sessionId) : null;

    if (!session || session.bundles.length === 0) {
      console.error("No bundles connected to this session. Run 'ctxl connect <bundle_id>' first.");
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

    for (const b of session.bundles) {
      try {
        const r = await pushSessionToBundle(session.session_id, b.bundle_id, entryIds);
        console.log(`[${b.bundle_id}] added ${r.pushed}, skipped ${r.skipped} (already in bundle)`);
      } catch (err: any) {
        console.error(`[${b.bundle_id}] error: ${err.message}`);
      }
    }
  });

program
  .command("push-to-bundle")
  .description(
    "Push all session entries to a bundle. Interactively pick from local or team bundles.\n\n" +
    "Interactive:\n" +
    "  $ ctxl push-to-bundle\n\n" +
    "With flags (for scripting):\n" +
    "  $ ctxl push-to-bundle --bundle <id>"
  )
  .option("--bundle <id>", "bundle ID (skip interactive selection)")
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

    const entries = getSessionEntries(session.session_id);
    const entryIds = entries.map(e => e.id);
    if (entryIds.length === 0) {
      console.log("No session entries to push.");
      return;
    }

    let bundleId: string = opts.bundle;

    if (!bundleId) {
      // Build choices: Local + each cloud team
      const teams = listMyTeams();
      const localBundles = listAllLocalBundleDetails();

      const teamChoices: Array<{ name: string; value: string }> = [];
      if (localBundles.length > 0) {
        teamChoices.push({ name: `Local  (${localBundles.length} bundle${localBundles.length === 1 ? "" : "s"})`, value: "__local__" });
      }
      for (const t of teams) {
        teamChoices.push({ name: t.name, value: t.team_id });
      }

      if (teamChoices.length === 0) {
        console.error("No local bundles or teams found. Create a bundle first with 'ctxl create'.");
        process.exit(1);
      }

      const teamChoice = await select({ message: "Which team?", choices: teamChoices });

      if (teamChoice === "__local__") {
        bundleId = await select({
          message: "Which bundle?",
          choices: localBundles.map(b => ({
            name: b.bundle_name,
            value: b.bundle_id,
            description: b.bundle_id,
          })),
        });
      } else {
        const bundles = await listTeamBundles(teamChoice);
        if (bundles.length === 0) {
          console.error("No bundles in this team. Create one with 'ctxl create'.");
          process.exit(1);
        }
        bundleId = await select({
          message: "Which bundle?",
          choices: bundles.map(b => ({
            name: b.name,
            value: b.bundle_id,
            description: b.bundle_id,
          })),
        });
      }
    }

    const r = await pushSessionToBundle(session.session_id, bundleId);
    console.log(`Pushed to ${bundleId}: added ${r.pushed}, skipped ${r.skipped} (already in bundle)`);
    console.log(`Total entries: ${r.total}`);
  });

program
  .command("pull [bundle_id]")
  .description(
    "Pull recent entries from a bundle. Reads bundle from .ctx-link.json if no ID given.\n" +
    "By default, filters out your own project's entries (shows only cross-project context).\n\n" +
    "Examples:\n" +
    "  $ ctxl pull                         Pull from current project's bundle\n" +
    "  $ ctxl pull --include-self           Include your own entries\n" +
    "  $ ctxl pull abc-123                  Pull from a specific bundle\n" +
    "  $ ctxl pull --since 2026-04-22T12:00:00Z --limit 50"
  )
  .option("--since <iso>", "only entries newer than this ISO timestamp")
  .option("--limit <n>", "max entries to return", "20")
  .option("--include-self", "include your own project's entries", false)
  .action(async (bundleId: string | undefined, opts) => {
    const sessionId = getActiveSessionId();
    const session = sessionId ? loadActiveSession(sessionId) : null;

    // If a specific bundle_id is given, pull just from that
    if (bundleId) {
      assertSessionConnectedTo(bundleId);
      const mode = isLocalBundle(bundleId) ? "local" : "cloud";
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
      console.error("No bundles connected to this session. Run 'ctxl connect <bundle_id>' first.");
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
    "Dry-run by default — add --apply to execute. Reversible via 'ctxl restore'.\n\n" +
    "Interactive:\n" +
    "  $ ctxl rewind\n\n" +
    "With flags:\n" +
    "  $ ctxl rewind --bundle abc --project my-api --last-n 3\n" +
    "  $ ctxl rewind --bundle abc --project my-api --last-n 3 --apply --reason 'bad abstraction'"
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
          console.log(`Undo with: ctxl restore --bundle ${bundleId} --project ${projectName} --from-log ${applied.rewind_log_id}`);
        }
      }
    } else if (r.rewind_log_id) {
      console.log(`\nAudit log: ${r.rewind_log_id}`);
      console.log(`Undo with: ctxl restore --bundle ${bundleId} --project ${projectName} --from-log ${r.rewind_log_id}`);
    }
  });

program
  .command("restore")
  .description(
    "Undo a rewind — bring back soft-deleted entries.\n" +
    "Prompts for bundle, project, and method if not given via flags.\n\n" +
    "Interactive:\n" +
    "  $ ctxl restore\n\n" +
    "With flags:\n" +
    "  $ ctxl restore --bundle abc --project my-api --from-log <log_id>\n" +
    "  $ ctxl restore --bundle abc --project my-api --entry-ids id1,id2"
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
    "  $ ctxl rewind-history\n" +
    "  $ ctxl rewind-history abc-123 --project my-api"
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
    "Rejoin anytime with 'ctxl join'."
  )
  .action(() => {
    const cfg = loadProjectConfig();
    if (!cfg || !cfg.bundle) {
      console.log("This project is not in any bundle.");
      return;
    }
    const oldBundle = cfg.bundle;
    cfg.bundle = null;
    saveProjectConfig(cfg);
    console.log(`Left bundle ${oldBundle}.`);
  });

program
  .command("delete-bundle")
  .description(
    "Permanently delete a bundle and ALL its entries. Irreversible.\n" +
    "Prompts for bundle selection and confirmation.\n" +
    "Use 'ctxl leave' if you just want to disconnect without destroying data."
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
    const mode = isLocalBundle(bundleId) ? "local" : "cloud";
    await deleteBundle(bundleId, mode);
    if (cfg && cfg.bundle === bundleId) {
      cfg.bundle = null;
      saveProjectConfig(cfg);
    }
    console.log(`Deleted bundle ${bundleId}.`);
  });

// ==================== JOIN CODES ====================

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
    const code = await regenerateJoinCode(bundleId, tokenInfo, expiryDays);
    console.log(`\nNew join code: ${code} (expires in ${expiryDays} days)`);
    console.log(`\nShare with teammates:`);
    console.log(`  ctxl join ${code}`);
  });

// ==================== QUESTIONS ====================

// Helper: broadcast question/answer to active MCP sessions
async function broadcastToChannels(bundleId: string, message: object) {
  const sessions = listActiveSessions();
  const targets = sessions.filter(
    (s) => s.channel_port && s.bundles.some((b) => b.bundle_id === bundleId),
  );
  for (const s of targets) {
    try {
      await fetch(`http://127.0.0.1:${s.channel_port}/channel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(2000),
      });
    } catch {}
  }
}

program
  .command("ask")
  .description(
    "Ask a question on a bundle. Other connected agents will be notified.\n\n" +
    "Examples:\n" +
    "  $ ctxl ask\n" +
    "  $ ctxl ask --bundle <id> --question 'Why did you change X?'\n" +
    "  $ ctxl ask --target backend"
  )
  .option("--bundle <id>", "Bundle ID")
  .option("--question <text>", "The question to ask")
  .option("--target <project>", "Direct the question to a specific project")
  .option("--context <text>", "What prompted this question")
  .action(async (opts) => {
    const sessionId = getActiveSessionId();
    const session = sessionId ? loadActiveSession(sessionId) : null;
    const projectName = session?.project_name ?? detectProjectName();

    let bundleId = opts.bundle;
    if (!bundleId) {
      bundleId = await promptForBundle("Which bundle to ask on?");
    }

    let questionText = opts.question;
    if (!questionText) {
      questionText = await input({ message: "Your question:" });
    }

    const q = askQuestion(bundleId, sessionId ?? "cli", projectName, questionText, {
      targetProject: opts.target,
      context: opts.context,
    });

    // Broadcast to active sessions
    await broadcastToChannels(bundleId, {
      type: "question_asked",
      bundle_id: bundleId,
      question: q,
      from_session_id: sessionId ?? "cli",
      from_project: projectName,
      target_project: opts.target,
    });

    console.log(`Question posted (${q.id}).`);
    if (opts.target) console.log(`Directed to: ${opts.target}`);
  });

program
  .command("answer")
  .description(
    "Answer a question on a bundle.\n\n" +
    "Examples:\n" +
    "  $ ctxl answer\n" +
    "  $ ctxl answer --bundle <id> --question-id <id> --answer 'Because...'"
  )
  .option("--bundle <id>", "Bundle ID")
  .option("--question-id <id>", "Question ID to answer")
  .option("--answer <text>", "Your answer")
  .action(async (opts) => {
    const sessionId = getActiveSessionId();
    const session = sessionId ? loadActiveSession(sessionId) : null;
    const projectName = session?.project_name ?? detectProjectName();

    let bundleId = opts.bundle;
    if (!bundleId) {
      bundleId = await promptForBundle("Which bundle?");
    }

    let questionId = opts.questionId;
    if (!questionId) {
      const open = listBundleQuestions(bundleId, { status: "open" });
      const answered = listBundleQuestions(bundleId, { status: "answered" });
      const candidates = [...open, ...answered];
      if (candidates.length === 0) {
        console.log("No open or answered questions on this bundle.");
        return;
      }
      const choice = await select({
        message: "Which question to answer?",
        choices: candidates.map((q) => ({
          name: `[${q.status}] ${q.question.slice(0, 80)}`,
          value: q.id,
        })),
      });
      questionId = choice;
    }

    let answerText = opts.answer;
    if (!answerText) {
      answerText = await input({ message: "Your answer:" });
    }

    const a = answerQuestion(bundleId, questionId, sessionId ?? "cli", projectName, answerText);

    // Broadcast
    const answeredQ = listBundleQuestions(bundleId).find((q) => q.id === questionId);
    if (answeredQ) {
      await broadcastToChannels(bundleId, {
        type: "question_answered",
        bundle_id: bundleId,
        question: answeredQ,
        from_session_id: sessionId ?? "cli",
        from_project: projectName,
      });
    }

    console.log(`Answer posted (${a.id}).`);
  });

program
  .command("questions")
  .description(
    "List questions on a bundle.\n\n" +
    "Examples:\n" +
    "  $ ctxl questions\n" +
    "  $ ctxl questions --bundle <id> --status open"
  )
  .option("--bundle <id>", "Bundle ID")
  .option("--status <status>", "Filter: open, answered, resolved")
  .option("--target <project>", "Filter by target project")
  .action(async (opts) => {
    let bundleId = opts.bundle;
    if (!bundleId) {
      bundleId = await promptForBundle("Which bundle?");
    }

    const questions = listBundleQuestions(bundleId, {
      status: opts.status,
      targetProject: opts.target,
    });

    if (questions.length === 0) {
      console.log("No questions.");
      return;
    }

    for (const q of questions) {
      console.log(`\n[${q.status.toUpperCase()}] ${q.question}`);
      console.log(`  ID: ${q.id}`);
      console.log(`  From: ${q.asked_by_project}  ${q.target_project ? `→ ${q.target_project}` : ""}`);
      console.log(`  Asked: ${q.created_at}`);
      if (q.answers.length > 0) {
        for (const a of q.answers) {
          console.log(`  └─ [${a.answered_by_project}] ${a.answer}`);
        }
      }
    }
  });

// ==================== SESSION MANAGEMENT ====================

program
  .command("session-rename")
  .description(
    "Rename the current session. Also renames all cloud copies.\n\n" +
    "Examples:\n" +
    "  $ ctxl session-rename\n" +
    "  $ ctxl session-rename 'backend work'"
  )
  .argument("[name]", "new name (prompted if not given)")
  .action(async (nameArg?: string) => {
    const sessionId = getActiveSessionId();
    if (!sessionId) { console.error("No active session."); process.exit(1); }
    const session = loadActiveSession(sessionId);
    if (!session) { console.error(`Session ${sessionId} not found.`); process.exit(1); }

    const name = nameArg ?? await input({ message: "New name (empty to clear):" });
    const trimmed = name.trim() || null;

    renameActiveSession(sessionId, trimmed);
    for (const c of (session.cloud_copies ?? [])) {
      try { await renameCloudSession(c.cloud_session_id, trimmed); } catch {}
    }
    if (session.cloud_session_id) {
      try { await renameCloudSession(session.cloud_session_id, trimmed); } catch {}
    }

    console.log(trimmed ? `Renamed to "${trimmed}".` : "Name cleared.");
  });

program
  .command("session-delete")
  .description(
    "Delete a session and all its cloud copies. Cascades to entries and bundle refs.\n\n" +
    "Examples:\n" +
    "  $ ctxl session-delete\n" +
    "  $ ctxl session-delete <session_id>"
  )
  .argument("[session_id]", "session to delete (prompted if not given)")
  .action(async (sessionIdArg?: string) => {
    let sessionId = sessionIdArg;

    if (!sessionId) {
      const sessions = listActiveSessions();
      if (sessions.length === 0) { console.log("No active sessions."); return; }

      sessionId = await select({
        message: "Which session to delete?",
        choices: sessions.map((s) => ({
          name: `${s.name ?? s.project_name}  ${s.branch ? `(${s.branch})` : ""}  ${getSessionEntries(s.session_id).length} entries`,
          value: s.session_id,
          description: s.session_id,
        })),
      });
    }

    const session = loadActiveSession(sessionId);
    if (!session) { console.error(`Session ${sessionId} not found.`); process.exit(1); }

    const ok = await confirm({ message: `Delete session "${session.name ?? session.project_name}" and all cloud copies?` });
    if (!ok) { console.log("Cancelled."); return; }

    await deleteSession(sessionId);
    console.log(`Deleted session ${sessionId.slice(0, 8)}...`);
  });

program
  .command("session-delete-entry")
  .description(
    "Delete a specific entry from the current session. Cascades to cloud and bundle refs.\n\n" +
    "Examples:\n" +
    "  $ ctxl session-delete-entry\n" +
    "  $ ctxl session-delete-entry <entry_id>"
  )
  .argument("[entry_id]", "entry to delete (prompted if not given)")
  .action(async (entryIdArg?: string) => {
    const sessionId = getActiveSessionId();
    if (!sessionId) { console.error("No active session."); process.exit(1); }
    const session = loadActiveSession(sessionId);
    if (!session) { console.error(`Session ${sessionId} not found.`); process.exit(1); }

    let entryId = entryIdArg;
    if (!entryId) {
      const entries = getSessionEntries(sessionId);
      if (entries.length === 0) { console.log("No entries in this session."); return; }

      entryId = await select({
        message: "Which entry to delete?",
        choices: entries.map((e) => ({
          name: `[${e.event_type}] ${e.summary.slice(0, 80)}`,
          value: e.id,
          description: `${e.id}  ${e.created_at}`,
        })),
      });
    }

    deleteSessionEntry(sessionId, entryId);
    if (session.cloud_copies?.length || session.cloud_session_id) {
      try { await deleteCloudSessionEntry(entryId); } catch {}
    }
    console.log(`Deleted entry ${entryId.slice(0, 8)}...`);
  });

// ==================== BUNDLE MANAGEMENT ====================

program
  .command("bundle-entries")
  .description(
    "List all entries in a bundle (unfiltered).\n\n" +
    "Examples:\n" +
    "  $ ctxl bundle-entries\n" +
    "  $ ctxl bundle-entries <bundle_id>\n" +
    "  $ ctxl bundle-entries --limit 20"
  )
  .argument("[bundle_id]", "bundle ID (prompted if not given)")
  .option("--limit <n>", "max entries to show", "50")
  .action(async (bundleIdArg?: string, opts?: { limit: string }) => {
    const bundleId = bundleIdArg ?? await promptForBundle("Which bundle?");
    assertSessionConnectedTo(bundleId);
    const limit = parseInt(opts?.limit ?? "50", 10);
    const mode = isLocalBundle(bundleId) ? "local" : "cloud";

    const rows = await pullEntries({
      bundle_id: bundleId,
      since: null,
      limit,
      exclude_project: undefined,
      mode,
    });

    if (rows.length === 0) { console.log("No entries."); return; }

    for (const r of rows) {
      console.log(`\n[${r.event_type}] ${r.project_name}  ${r.created_at}`);
      console.log(`  ID: ${r.id}`);
      console.log(`  ${r.summary}`);
    }
    console.log(`\n${rows.length} entries.`);
  });

program
  .command("bundle-remove-entry")
  .description(
    "Remove an entry reference from a bundle. The entry stays in its session.\n\n" +
    "Examples:\n" +
    "  $ ctxl bundle-remove-entry --bundle <id> --entry <id>"
  )
  .option("--bundle <id>", "bundle ID")
  .option("--entry <id>", "entry ID")
  .action(async (opts: { bundle?: string; entry?: string }) => {
    const bundleId = opts.bundle ?? await promptForBundle("Which bundle?");
    assertSessionConnectedTo(bundleId);
    let entryId = opts.entry;

    if (!entryId) {
      const mode = isLocalBundle(bundleId) ? "local" : "cloud";
      const rows = await pullEntries({ bundle_id: bundleId, since: null, limit: 50, exclude_project: undefined, mode });
      if (rows.length === 0) { console.log("No entries in this bundle."); return; }

      entryId = await select({
        message: "Which entry to remove?",
        choices: rows.map((r) => ({
          name: `[${r.event_type}] ${r.project_name}: ${r.summary.slice(0, 60)}`,
          value: r.id,
          description: r.id,
        })),
      });
    }

    if (isLocalBundle(bundleId)) {
      localRemoveEntryFromBundle(bundleId, entryId);
    } else {
      await removeEntryFromBundle(bundleId, entryId);
    }
    console.log(`Removed entry ${entryId.slice(0, 8)}... from bundle.`);
  });

program
  .command("bundle-pull-from-sessions")
  .description(
    "Pull entries from ALL sessions connected to a bundle in one shot.\n\n" +
    "Examples:\n" +
    "  $ ctxl bundle-pull-from-sessions\n" +
    "  $ ctxl bundle-pull-from-sessions <bundle_id>"
  )
  .argument("[bundle_id]", "bundle ID (prompted if not given)")
  .action(async (bundleIdArg?: string) => {
    const bundleId = bundleIdArg ?? await promptForBundle("Which bundle?");
    const mode = isLocalBundle(bundleId) ? "local" : "cloud";
    let totalPushed = 0;
    let totalSkipped = 0;

    const activeSessions = listActiveSessions();
    const connectedActive = activeSessions.filter(
      (s) => s.bundles.some((b) => b.bundle_id === bundleId)
    );

    for (const session of connectedActive) {
      const entries = getSessionEntries(session.session_id);
      if (entries.length === 0) continue;
      const entryIds = entries.map((e) => e.id);

      if (mode === "local") {
        const result = localAddEntriesToBundle(bundleId, entryIds, session.session_id);
        totalPushed += result.added;
        totalSkipped += result.skipped;
      } else {
        const bundleTeamId = await getBundleTeamId(bundleId);
        if (!bundleTeamId) continue;

        const copies = session.cloud_copies ?? [];
        let copy = copies.find((c) => c.team_id === bundleTeamId)
          ?? (session.cloud_session_id && session.team_id === bundleTeamId
            ? { cloud_session_id: session.cloud_session_id, team_id: bundleTeamId }
            : null);

        if (!copy) {
          const result = await copySessionToCloud(session.session_id, bundleTeamId);
          if (!session.cloud_copies) session.cloud_copies = [];
          session.cloud_copies.push({ cloud_session_id: result.cloud_session_id, team_id: bundleTeamId });
          if (!session.cloud_session_id) {
            session.cloud_session_id = result.cloud_session_id;
            session.team_id = bundleTeamId;
          }
          saveActiveSession(session);
          copy = { cloud_session_id: result.cloud_session_id, team_id: bundleTeamId };
        } else {
          await syncSessionToCloud(session.session_id, copy.cloud_session_id);
        }

        const cloudEntries = await getCloudSessionEntries(copy.cloud_session_id);
        const cloudIds = cloudEntries.map((e) => e.id);
        if (cloudIds.length > 0) {
          const result = await addEntriesToBundle(bundleId, cloudIds);
          totalPushed += result.added;
          totalSkipped += result.skipped;
        }
      }
    }

    if (mode === "cloud") {
      const teams = listMyTeams();
      for (const team of teams) {
        const cloudSessions = await listTeamSessions(team.team_id);
        for (const cs of cloudSessions) {
          const bundles = getCloudSessionBundleConnections(cs.id);
          if (!bundles.some((b) => b.bundle_id === bundleId)) continue;
          const cloudEntries = await getCloudSessionEntries(cs.id);
          const cloudIds = cloudEntries.map((e) => e.id);
          if (cloudIds.length > 0) {
            const result = await addEntriesToBundle(bundleId, cloudIds);
            totalPushed += result.added;
            totalSkipped += result.skipped;
          }
        }
      }
    }

    console.log(`Pulled from sessions: ${totalPushed} added, ${totalSkipped} skipped.`);
  });

program
  .command("bundle-to-cloud")
  .description(
    "Migrate a local bundle to cloud under a team.\n" +
    "Creates a cloud bundle, migrates all entry refs, and removes the local bundle.\n\n" +
    "Examples:\n" +
    "  $ ctxl bundle-to-cloud\n" +
    "  $ ctxl bundle-to-cloud <bundle_id>"
  )
  .argument("[bundle_id]", "local bundle ID (prompted if not given)")
  .action(async (bundleIdArg?: string) => {
    const bundleId = bundleIdArg ?? await promptForBundle("Which local bundle?");

    if (!isLocalBundle(bundleId)) {
      console.error("That bundle is already in cloud mode.");
      process.exit(1);
    }

    const teams = listMyTeams();
    if (teams.length === 0) {
      console.error("You need to join a team first. Run 'ctxl create-team' or 'ctxl join-team'.");
      process.exit(1);
    }

    let teamId: string;
    if (teams.length === 1) {
      teamId = teams[0].team_id;
    } else {
      teamId = await select({
        message: "Which team?",
        choices: teams.map((t) => ({
          name: t.name,
          value: t.team_id,
          description: t.team_id,
        })),
      });
    }

    const result = await pushBundleToCloud(bundleId, teamId);
    console.log(`Migrated to cloud.`);
    console.log(`  New bundle ID: ${result.new_bundle_id}`);
    console.log(`  Entries migrated: ${result.entries_migrated}`);
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

function assertSessionConnectedTo(bundleId: string): void {
  const sessionId = getActiveSessionId();
  const session = sessionId ? loadActiveSession(sessionId) : null;
  if (!session) {
    console.error("No active session. Run 'ctxl session-start' first.");
    process.exit(1);
  }
  if (!session.bundles.some((b) => b.bundle_id === bundleId)) {
    console.error(`Session is not connected to bundle ${bundleId}. Run 'ctxl connect ${bundleId}' first.`);
    process.exit(1);
  }
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
