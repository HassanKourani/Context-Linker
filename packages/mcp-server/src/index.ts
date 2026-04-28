#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createBundle,
  joinBundle,
  deleteBundle,
  bundleStatus,
  listLocalBundles,
  listAllLocalBundleDetails,
  pullEntries,
  renderEntriesForClaude,
  bundleRewind,
  bundleRestore,
  bundleListRewinds,
  bundleRemoveEntryRef,
  pullEntriesFromConnectedSessions,
  renameSessionAndCloudCopies,
  deleteSessionEntryAndCopies,
  loadActiveSession,
  saveActiveSession,
  resolveClaudeSessionId,
  getClaudeSessionName,
  loadGlobalConfig,
  loadProjectConfig,
  logSession,
  deleteActiveSession,
  pushSessionEntry,
  getSessionEntries,
  getUnpushedSessionEntries,
  getPendingEnrichmentStub,
  enrichSessionEntry,
  includeEntryInBundle,
  localIncludeEntryInBundle,
  localRemoveSessionRefsFromBundle,
  removeSessionEntriesFromBundle,
  getBundleTeamId,
  connectSessionToBundle,
  connectCloudSessionToBundle,
  disconnectSessionFromBundle,
  disconnectCloudSessionFromBundle,
  deleteCloudSession,
  listActiveSessions,
  createTeam,
  joinTeam,
  listMyTeams,
  listTeamBundles,
  type ActiveSession,
  type RewindStrategy,
  isLocalBundle,
  isJoinCode,
  resolveJoinCode,
  askQuestion,
  answerQuestion,
  resolveQuestion,
  listBundleQuestions,
  type Question,
  unlinkSessionFromBundle,
  deleteSession,
  pushSessionToBundle,
  pushBundleToCloud,
  ensureCloudCopy,
  writeFeedEvent,
  addBundleNote,
  getCurrentUser,
  sendEmailOtp,
  verifyEmailOtp,
  signOut,
  refreshTeamsCache,
} from "@ctx-link/core";
import { z } from "zod";
import { startChannelListener, broadcastToBundle, type ChannelMessage } from "./channel.js";
import { startAutoSync, type AutoSyncHandle } from "./auto-sync.js";

/**
 * Each MCP server instance is 1:1 with a Claude Code instance.
 *
 * Session resolution: walk the process tree to the Claude Code parent on
 * EVERY tool call and read its session UUID — that UUID is what the
 * SessionStart hook keys the active-session record by. We never trust a
 * cached ID and never read the per-cwd marker file (it's overwritten when
 * a second Claude Code instance starts in the same project, so it can't
 * disambiguate). CLAUDE_CODE_SSE_PORT is shared machine-wide and is also
 * not usable as an instance identifier.
 */
let autoSyncHandle: AutoSyncHandle | null = null;
let hasShownWelcome = false;
let lastNameSyncAt = 0;

// Staleness tracking — nudge the agent to call session_log when too much
// work has happened without one. Reset whenever session_log fires.
let lastSessionLogAt = Date.now();
let toolCallsSinceLog = 0;
const STALE_LOG_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const STALE_LOG_THRESHOLD_CALLS = 6;            // or 6 MCP calls, whichever first

const debugLog = (msg: string) => {
  if (process.env.CTX_LINK_DEBUG) process.stderr.write(`[ctx-link] ${msg}\n`);
};

/**
 * Resolve THIS MCP server's owning Claude Code session UUID via the process
 * tree. Always called fresh — no caching across tool calls.
 *
 * Returns null if Claude Code can't be located in the process tree (e.g.
 * MCP was launched outside Claude Code, or the parent's session record
 * was never created).
 */
function resolveOwnClaudeSessionId(): string | null {
  const id = resolveClaudeSessionId();
  debugLog(`resolveOwnClaudeSessionId: ppid=${process.ppid} → ${id ?? "<null>"}`);
  return id;
}

/** Get the active session for this MCP server instance. */
function getSession(): ActiveSession | null {
  const claudeSessionId = resolveOwnClaudeSessionId();
  if (!claudeSessionId) return null;
  const session = loadActiveSession(claudeSessionId);
  if (!session) {
    debugLog(`getSession: no active-session record for ${claudeSessionId}`);
    return null;
  }
  syncClaudeSessionName(session);
  return session;
}

/**
 * Sync the ctx-link session name from Claude Code's session name.
 * Only updates if:
 *  - The name was auto-synced (name_auto=true) or never set
 *  - At most once every 10 seconds (avoid hammering the filesystem)
 */
function syncClaudeSessionName(session: ActiveSession): void {
  const now = Date.now();
  if (now - lastNameSyncAt < 10_000) return;
  lastNameSyncAt = now;

  const claudeId = session.claude_session_id ?? resolveClaudeSessionId();
  if (!claudeId) return;
  if (!session.claude_session_id) {
    session.claude_session_id = claudeId;
    saveActiveSession(session);
  }

  // Only auto-sync if name was never set or was auto-synced previously
  if (session.name && !session.name_auto) return;

  const claudeName = getClaudeSessionName(claudeId, session.project_path);
  if (!claudeName) return;
  if (claudeName === session.name) return;

  session.name = claudeName;
  session.name_auto = true;
  saveActiveSession(session);
}

/** Auto-create the active-session record for THIS Claude Code instance on MCP boot. */
async function ensureSession(): Promise<ActiveSession | null> {
  const claudeSessionId = resolveOwnClaudeSessionId();
  if (!claudeSessionId) {
    debugLog("ensureSession: process tree did not reach a Claude Code session — skipping auto-create");
    return null;
  }

  const existing = loadActiveSession(claudeSessionId);
  if (existing) return existing;

  // First boot under this Claude Code instance — create the record. Key it
  // by the Claude UUID so every subsequent tool call (which re-resolves
  // via the process tree) finds it directly.
  try {
    const { existsSync, readFileSync } = await import("node:fs");
    let projectName = process.cwd().split("/").pop() ?? "unknown";
    const pkgPath = `${process.cwd()}/package.json`;
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg.name) projectName = pkg.name;
      } catch {}
    }

    let branch: string | null = null;
    try {
      const { execSync } = await import("node:child_process");
      branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
    } catch {}

    const globalCfg = loadGlobalConfig();
    const projectCfg = loadProjectConfig();

    logSession({
      project_name: projectName,
      project_path: process.cwd(),
      machine_id: globalCfg.machine_id,
      started_at: new Date().toISOString(),
      branch,
      bundle: null,
      mode: projectCfg?.mode ?? "local",
    });

    const sessionName = getClaudeSessionName(claudeSessionId, process.cwd());

    const session: ActiveSession = {
      session_id: claudeSessionId,
      project_name: projectName,
      project_path: process.cwd(),
      bundles: [],
      started_at: new Date().toISOString(),
      branch,
      cloud_session_id: null,
      team_id: null,
      cloud_copies: [],
      claude_instance_id: process.env.CLAUDE_CODE_SSE_PORT ?? null,
      claude_session_id: claudeSessionId,
      ...(sessionName ? { name: sessionName, name_auto: true } : {}),
    };

    saveActiveSession(session);
    return session;
  } catch (err) {
    debugLog(`ensureSession: create failed: ${(err as Error).message}`);
    return null;
  }
}

const pkg = await import("../../../package.json");

const server = new Server(
  { name: "ctx-link", version: pkg.version ?? "0.0.0" },
  {
    capabilities: { tools: {}, logging: {} },
    instructions:
      "You are connected to ctx-link, a context-sharing system for Claude Code sessions. " +
      "The CLI command is `ctxl`. If you need help with available commands, run `ctxl --help`.\n" +
      "A session is auto-created on boot. Key tools:\n" +
      "- session_log: Log a context entry to the current session. Use for any 'log entry' requests.\n" +
      "- session_entries: List accumulated session entries.\n" +
      "- session_info: Show current session details and connected bundles.\n" +
      "- context_push: Push session entries to connected bundles.\n" +
      "- context_pull: Pull entries from bundles (use at session start).\n" +
      "- session_connect: Connect session to a bundle.\n" +
      "- bundle_create: Create a new bundle.\n" +
      "- bundle_list: List all bundles.\n" +
      "Proactive behavior: call context_pull at session start if bundles are connected.\n\n" +
      "**IMPORTANT: Call session_log after every meaningful piece of work.** Entries are read by other Claude sessions — both in OTHER repos and in the SAME repo (different sessions). " +
      "Write entries that give the reader what they need without reading your code.\n\n" +
      "**For cross-repo consumers** (e.g., frontend reading backend entries): what do they need to integrate?\n" +
      "- Endpoints: method, path, request body shape, response shape, status codes\n" +
      "- Schema changes: table/column names, types, constraints, indexes\n" +
      "- Auth changes: what's required, token format, error responses\n" +
      "- Config/env: new env vars, defaults, what needs to be set where\n" +
      "- Breaking changes: what stopped working, what the migration path is\n\n" +
      "**For same-repo sessions** (e.g., next session continuing your work): what do they need to understand?\n" +
      "- Decisions: what you chose, what alternatives you considered, why\n" +
      "- Architecture: how components connect, what depends on what\n" +
      "- Side effects: what else this change touches, what might break\n" +
      "- WIP state: what's done, what's left, known issues\n" +
      "- Bug fixes: what the bug was, root cause, what the fix does, how to verify\n\n" +
      "Examples of GOOD entries:\n" +
      "- 'Added POST /api/users — body: { email: string, name: string, role?: \"admin\" | \"user\" }, returns 201 { id, email, name, role, created_at }. Validates email format, returns 400 { error: \"Email already exists\" } on duplicate.'\n" +
      "- 'Refactored auth to use middleware pattern. All /api/* routes now check Bearer token (JWT with { user_id, role }). Added to: routes/api.ts, middleware/auth.ts. Tests in auth.test.ts. Decision: middleware over per-route checks because 12 routes share the same logic.'\n" +
      "- 'Fixed race condition in session sync — two concurrent pushes could duplicate entries. Root cause: no upsert, just insert. Fix: switched to upsert on (bundle_id, entry_id). Affects: entries.ts:addEntriesToBundle.'\n\n" +
      "Examples of BAD entries (no value):\n" +
      "- 'Edited routes.ts' — what changed?\n" +
      "- 'Fixed a bug' — what bug? what was the root cause?\n" +
      "- 'Created pull request' — what does the PR accomplish?\n\n" +
      "**One entry per logical change.** Ask yourself: if another session reads only this entry, can they understand what happened and act on it?",
  }
);

// ---------- Tool definitions ----------

const tools = [
  {
    name: "bundle_create",
    description:
      "Create a new shared context bundle. Returns a bundle_id and a join_token. " +
      "Use mode='cloud' with a team_id to create a cloud bundle. Default is local.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Human-readable label, e.g. 'feature-notifications'",
        },
        mode: {
          type: "string",
          enum: ["local", "cloud"],
          description: "Storage mode. Default: 'local'. Use 'cloud' with team_id for cross-machine sharing.",
        },
        team_id: {
          type: "string",
          description: "Required when mode='cloud'. The team to create the bundle under.",
        },
      },
      required: ["name"],
    },
  },
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
  {
    name: "bundle_join",
    description:
      "Join an existing bundle using a bundle_id and join_token shared from another machine.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string" },
        join_token: { type: "string" },
        project_name: {
          type: "string",
          description: "Name of the current project/repo joining the bundle.",
        },
      },
      required: ["bundle_id", "join_token", "project_name"],
    },
  },
  {
    name: "bundle_list",
    description: "List all bundles: local bundles on this machine and cloud bundles from joined teams.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "bundle_status",
    description:
      "Get status of a bundle: linked sessions, entry count, last activity.",
    inputSchema: {
      type: "object",
      properties: { bundle_id: { type: "string" } },
      required: ["bundle_id"],
    },
  },
  {
    name: "context_push",
    description:
      "Push session entries to connected bundles as references. " +
      "If summary is provided, a new session entry is created first. " +
      "If source_entry_ids is provided, only those entries are pushed; otherwise all session entries are pushed. " +
      "If bundle_id is omitted, pushes to ALL bundles connected to the current session.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string", description: "Target bundle (omit to push to all connected bundles)" },
        summary: {
          type: "string",
          description: "If provided, logs a new session entry with this summary before pushing.",
        },
        source_entry_ids: {
          type: "array",
          items: { type: "string" },
          description: "Specific session entry IDs to push. If omitted, all unpushed entries are pushed.",
        },
      },
    },
  },
  {
    name: "context_pull",
    description:
      "Pull recent cross-project context from the session's connected bundles. " +
      "PROACTIVE USE: You SHOULD call this at the start of a session if bundles are connected, " +
      "to see what other projects/sessions have done. This gives you cross-project awareness. " +
      "If bundle_id is omitted, pulls from ALL connected bundles (aggregated and sorted by time).",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string", description: "Specific bundle to pull from. Omit to pull from ALL connected bundles." },
        since: {
          type: "string",
          description: "ISO timestamp; only return entries newer than this.",
        },
        limit: { type: "number", description: "Default 20." },
        exclude_project: {
          type: "string",
          description: "Skip entries from this project (usually your own).",
        },
      },
    },
  },
  {
    name: "context_rewind",
    description:
      "Soft-delete entries from ONE project in a bundle, scoped by strategy. Other projects are never touched. Strategies: since (ISO timestamp), last_n (count), entry_ids (explicit list), after_ref (trigger_ref; keeps pivot, removes everything after). Use dry_run=true to preview. Refuses >50 affected unless force=true.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string" },
        project_name: {
          type: "string",
          description: "Only entries from this project are candidates.",
        },
        strategy: {
          type: "object",
          description:
            "One of: {kind:'since', since: ISO}, {kind:'last_n', count: N}, {kind:'entry_ids', ids: [...]}, {kind:'after_ref', trigger_ref: 'sha'}",
        },
        reason: { type: "string" },
        dry_run: { type: "boolean" },
        max_affected: { type: "number", description: "Default 50." },
        force: { type: "boolean" },
      },
      required: ["bundle_id", "project_name", "strategy"],
    },
  },
  {
    name: "context_restore",
    description:
      "Undo a rewind. Restores soft-deleted entries scoped to one project. Optionally filter by entry_ids or rewind_log_id.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string" },
        project_name: { type: "string" },
        entry_ids: { type: "array", items: { type: "string" } },
        rewind_log_id: { type: "string" },
      },
      required: ["bundle_id", "project_name"],
    },
  },
  {
    name: "bundle_delete",
    description:
      "Permanently delete a bundle and all its entries. This is irreversible — cascade-deletes all sessions and entries. Use with caution.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string" },
      },
      required: ["bundle_id"],
    },
  },
  {
    name: "rewind_history",
    description:
      "List past rewinds for a bundle (optionally filtered by project). Useful to find a rewind_log_id to restore from.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string" },
        project_name: { type: "string" },
        limit: { type: "number" },
      },
      required: ["bundle_id"],
    },
  },
  {
    name: "session_connect",
    description:
      "Connect the current Claude Code session to a bundle. A session can connect to multiple bundles. " +
      "Push/pull will then operate on all connected bundles. " +
      "All existing session entries are automatically added to the bundle as references.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string", description: "The bundle to connect to" },
        mode: { type: "string", enum: ["local", "cloud"], description: "Storage mode. Auto-detected from bundle ID if omitted." },
      },
      required: ["bundle_id"],
    },
  },
  {
    name: "session_disconnect",
    description: "Disconnect the current session from a bundle. The bundle still exists.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string" },
      },
      required: ["bundle_id"],
    },
  },
  {
    name: "session_info",
    description:
      "Show the current session: project name, branch, connected bundles, and pending (un-pushed) session entries.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "session_log",
    description:
      "Log a HANDOFF entry to the current session — written for another agent who will integrate against your work without reading the code.\n\n" +
      "WHEN TO CALL: at intent boundaries — after `git commit`, after `gh pr create`, after finishing a logical unit of work. " +
      "ONE entry per logical unit. Consolidate all related edits into a single call. Do NOT log per file edit.\n\n" +
      "WHAT TO INCLUDE (when relevant):\n" +
      "  • Function / endpoint / hook names with signatures (e.g. `getUser(id: string): Promise<User>`)\n" +
      "  • Request and response payload shapes as inline objects (e.g. `{ id: string, status: 'open'|'closed' }`)\n" +
      "  • Error format: status codes, error keys, throw types\n" +
      "  • Where the new code is consumed from / what it depends on\n" +
      "  • Configuration, env vars, feature flags introduced (with default values)\n" +
      "  • Decisions with one-line rationale\n\n" +
      "WHAT TO AVOID: diffs, before/after snippets, prose recaps of WHAT you changed, restated commit messages, code blocks longer than a signature or shape. " +
      "Describe what NOW EXISTS and HOW TO USE IT, not what you did.\n\n" +
      "ACCEPTANCE TEST: could another agent integrate against this entry without reading the code? If no, it's too thin.\n\n" +
      "PENDING STUBS: if a commit/PR happened, a stub entry exists with `pending_enrichment: true`. Calling session_log will MERGE into that stub (one final entry per commit, not two).",
    inputSchema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Handoff details — interface, payload shapes, errors, dependencies. Multi-paragraph is fine when warranted; aim for 'no-questions-asked' completeness without dumping diffs.",
        },
        files_touched: {
          type: "array",
          items: { type: "string" },
        },
        decisions: {
          type: "array",
          description: "Optional. Only 'decision' is required per item; rationale and affects are optional.",
          items: {
            type: "object",
            properties: {
              decision: { type: "string" },
              rationale: { type: "string" },
            },
            required: ["decision"],
          },
        },
        event_type: {
          type: "string",
          enum: ["commit", "pr_open", "manual", "session_end"],
          description: "Default: manual",
        },
        trigger_ref: {
          type: "string",
          description: "Commit SHA, PR number, etc.",
        },
      },
      required: ["summary"],
    },
  },
  {
    name: "session_entries",
    description:
      "List accumulated session entries. " +
      "WARNING: Defaults to only_unpushed=true — set to false to see ALL entries including already-pushed ones.",
    inputSchema: {
      type: "object",
      properties: {
        only_unpushed: {
          type: "boolean",
          description: "Default true — only entries not yet pushed. Set false to see ALL entries.",
        },
      },
    },
  },
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
  },
  {
    name: "bundle_include_entry",
    description: "Re-include a previously excluded entry in a bundle. Removes the entry from the exclusion list so auto-sync can add it again. Use after bundle_remove_entry if you change your mind.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string", description: "Bundle ID" },
        entry_id: { type: "string", description: "Entry ID to re-include" },
      },
      required: ["bundle_id", "entry_id"],
    },
  },
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
  {
    name: "session_push_to_bundle",
    description:
      "Push all session entries to a specific bundle (no need to connect first). " +
      "If bundle_id is omitted, returns available teams and their bundles so you can present the options and let the user pick. " +
      "Call without bundle_id first to discover, then call again with the chosen bundle_id.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: {
          type: "string",
          description: "Target bundle ID. Omit to list available teams and bundles.",
        },
      },
    },
  },
  {
    name: "session_start",
    description:
      "Create or resume a session for the current project. " +
      "NOTE: A session is auto-created when the MCP server starts — you usually do NOT need to call this. " +
      "Use only if you need to bind to a specific session_id.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID. If omitted, generates a random UUID.",
        },
      },
    },
  },
  {
    name: "team_create",
    description:
      "Create a new team. Teams are access-control containers for cloud sessions and bundles. " +
      "Requires the user to be signed in (use auth_status / auth_signin_send_code first if needed). " +
      "Returns team_id and name. Share the team name + join_code with collaborators so they can join.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Team name (unique, used to join)" },
        join_code: { type: "string", description: "Team join code (a shared secret your collaborators will enter to join)" },
      },
      required: ["name", "join_code"],
    },
  },
  {
    name: "team_join",
    description:
      "Join an existing team by name and join_code. Requires the user to be signed in. " +
      "Required before working with cloud bundles or pushing sessions to cloud.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Team name" },
        join_code: { type: "string", description: "Team join code (the shared secret you were given)" },
      },
      required: ["name", "join_code"],
    },
  },
  {
    name: "auth_status",
    description:
      "Show the currently signed-in Supabase user (or 'not signed in'). " +
      "Use this to check whether the user can perform cloud operations before suggesting team / cloud bundle actions.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "auth_send_code",
    description:
      "Send a one-time 6-digit sign-in code to the given email. " +
      "Use this for cloud sign-in when the user doesn't already have a session. " +
      "After they receive the code, call auth_verify_code with the email and the code. " +
      "If the email isn't registered, an account is created automatically.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Email address that will receive the code" },
      },
      required: ["email"],
    },
  },
  {
    name: "auth_verify_code",
    description:
      "Verify the 6-digit code the user received in their email and complete sign-in. " +
      "Run auth_send_code first.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Same email passed to auth_send_code" },
        code: { type: "string", description: "The 6-digit code from the email" },
      },
      required: ["email", "code"],
    },
  },
  {
    name: "auth_signout",
    description:
      "Sign the current user out of Supabase and clear the local session token. " +
      "After this, cloud operations will fail until the user signs in again.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "session_rename",
    description:
      "Rename the current session. Also renames all cloud copies. Pass null or empty string to clear the name.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "New session name (or empty to clear)" },
      },
      required: ["name"],
    },
  },
  {
    name: "session_delete",
    description:
      "Delete a session and all its cloud copies. This is irreversible — cascade-deletes cloud entries and bundle refs. " +
      "If no session_id is provided, deletes the current session.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session ID to delete. Omit to delete the current session." },
      },
    },
  },
  {
    name: "session_delete_entry",
    description:
      "Delete a specific entry from the current session. Also deletes the cloud copy of the entry and cascades to bundle refs.",
    inputSchema: {
      type: "object",
      properties: {
        entry_id: { type: "string", description: "Entry ID to delete" },
      },
      required: ["entry_id"],
    },
  },
  {
    name: "bundle_entries",
    description:
      "List all entries in a bundle — unfiltered, no cross-project exclusion. " +
      "Use this to see the raw contents of a bundle. " +
      "Unlike context_pull, this returns everything without filtering by project.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string" },
        limit: { type: "number", description: "Max entries to return. Default 50." },
      },
      required: ["bundle_id"],
    },
  },
  {
    name: "session_list",
    description:
      "List all active sessions across all projects on this machine. " +
      "Shows session ID, project name, branch, connected bundles, and entry count.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "bundle_pull_from_sessions",
    description:
      "Pull entries from ALL sessions connected to a bundle in one shot. " +
      "For each connected session, adds all its entry refs to the bundle. " +
      "Handles both local and cloud bundles, auto-syncing cloud copies as needed.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string", description: "Bundle to pull entries into" },
      },
      required: ["bundle_id"],
    },
  },
  {
    name: "bundle_push_to_cloud",
    description:
      "Migrate a local bundle to the cloud under a team. " +
      "Creates a new cloud bundle, pushes all connected sessions to cloud, migrates entry refs, " +
      "then deletes the old local bundle. Returns the new cloud bundle_id.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string", description: "Local bundle ID to migrate" },
        team_id: { type: "string", description: "Team to create the cloud bundle under" },
      },
      required: ["bundle_id", "team_id"],
    },
  },
  {
    name: "bundle_ask_question",
    description:
      "LAST RESORT: Ask a question to other sessions connected to a bundle. " +
      "Only use this AFTER you have: (1) read all bundle entries thoroughly, and " +
      "(2) examined the relevant code to try to answer the question yourself. " +
      "Most answers are in the entries or the codebase — only ask for things code can't explain, " +
      "like intent, timeline, or whether something is intentional vs WIP. " +
      "Currently only works for local bundles.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string" },
        question: { type: "string", description: "The question to ask" },
        target_project: { type: "string", description: "Optional: direct the question to a specific project" },
        context: { type: "string", description: "Optional: what context prompted this question" },
      },
      required: ["bundle_id", "question"],
    },
  },
  {
    name: "bundle_answer_question",
    description:
      "Answer a question that was asked in a bundle. " +
      "PROACTIVE USE: When you see an open question targeting your project (via context_pull or bundle_questions), answer it.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string" },
        question_id: { type: "string", description: "The ID of the question being answered" },
        answer: { type: "string", description: "Your answer to the question" },
      },
      required: ["bundle_id", "question_id", "answer"],
    },
  },
  {
    name: "bundle_questions",
    description:
      "List questions in a bundle, optionally filtered by status or target project. " +
      "Returns questions with their answers. " +
      "PROACTIVE USE: Check for open questions when pulling context from a bundle.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string" },
        status: { type: "string", enum: ["open", "answered", "resolved"], description: "Filter by status" },
        target_project: { type: "string", description: "Filter to questions targeting this project" },
      },
      required: ["bundle_id"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

// ---------- Tool dispatch ----------

const BundleCreateArgs = z.object({ name: z.string() });
const BundleJoinArgs = z.object({
  bundle_id: z.string(),
  join_token: z.string().optional(),
  project_name: z.string(),
});
const BundleStatusArgs = z.object({ bundle_id: z.string() });
const ContextPushArgs = z.object({
  bundle_id: z.string().optional(),
  summary: z.string().optional(),
  source_entry_ids: z.array(z.string()).optional(),
});
const ContextPullArgs = z.object({
  bundle_id: z.string().optional(),
  since: z.string().optional(),
  limit: z.number().optional(),
  exclude_project: z.string().optional(),
});

const RewindStrategySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("since"), since: z.string() }),
  z.object({ kind: z.literal("last_n"), count: z.number().int().positive() }),
  z.object({ kind: z.literal("entry_ids"), ids: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal("after_ref"), trigger_ref: z.string() }),
]);

const ContextRewindArgs = z.object({
  bundle_id: z.string(),
  project_name: z.string(),
  strategy: RewindStrategySchema,
  reason: z.string().optional(),
  dry_run: z.boolean().optional(),
  max_affected: z.number().optional(),
  force: z.boolean().optional(),
});

const ContextRestoreArgs = z.object({
  bundle_id: z.string(),
  project_name: z.string(),
  entry_ids: z.array(z.string()).optional(),
  rewind_log_id: z.string().optional(),
});

const RewindHistoryArgs = z.object({
  bundle_id: z.string(),
  project_name: z.string().optional(),
  limit: z.number().optional(),
});

const SessionLogArgs = z.object({
  summary: z.string(),
  files_touched: z.array(z.string()).optional(),
  decisions: z.array(z.object({
    decision: z.string(),
    rationale: z.string().optional(),
    affects: z.array(z.string()).default([]),
  })).optional(),
  event_type: z.enum(["commit", "pr_open", "manual", "session_end"]).default("manual"),
  trigger_ref: z.string().optional(),
});

const SessionEntriesArgs = z.object({
  only_unpushed: z.boolean().default(true),
});

const BundleRemoveEntryArgs = z.object({
  bundle_id: z.string(),
  entry_id: z.string(),
});

const BundleIncludeEntryArgs = z.object({
  bundle_id: z.string(),
  entry_id: z.string(),
});

function ok(result: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(result, null, 2) },
    ],
  };
}

function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${msg}` }],
  };
}

/** Auto-log ctx-link tool calls ONLY when running inside the ctx-link project (for debugging). */
const CTX_LINK_AUTO_LOG: Record<string, (a: Record<string, any>) => string | null> = {
  bundle_create: (a) => `Created ${a.mode ?? "local"} bundle "${a.name}"`,
  bundle_join: (a) => `Joined bundle ${a.bundle_id}`,
  bundle_delete: (a) => `Deleted bundle ${a.bundle_id}`,
  bundle_remove_entry: (a) => `Removed entry ref from bundle ${a.bundle_id}`,
  bundle_add_note: (a) => `Added ${a.role ?? "note"} to bundle ${a.bundle_id}`,
  context_push: (a) => a.summary ? null : `Pushed context to ${a.bundle_id ?? "connected bundles"}`,
  context_pull: (a) => `Pulled context from bundle ${a.bundle_id ?? "connected bundles"}`,
  context_rewind: (a) => `Rewound entries in bundle ${a.bundle_id}`,
  context_restore: (a) => `Restored entries in bundle ${a.bundle_id}`,
  session_connect: (a) => `Connected to bundle ${a.bundle_id}`,
  session_disconnect: (a) => `Disconnected from bundle ${a.bundle_id}`,
  session_push_to_cloud: () => `Session pushed to cloud`,
  session_push_to_bundle: (a) => a.bundle_id ? `Pushed entries to bundle ${a.bundle_id}` : null,
  team_create: (a) => `Created team "${a.name}"`,
  team_join: (a) => `Joined team "${a.name}"`,
  auth_status: () => `Checked auth status`,
  auth_send_code: (a) => `Sent sign-in code to ${a.email}`,
  auth_verify_code: (a) => `Verified sign-in code for ${a.email}`,
  auth_signout: () => `Signed out`,
  bundle_ask_question: (a) => `Asked question: "${(a.question ?? "").slice(0, 100)}"`,
  bundle_answer_question: () => `Answered a bundle question`,
  bundle_push_to_cloud: (a) => `Migrated bundle ${a.bundle_id} to cloud`,
  bundle_pull_from_sessions: (a) => `Pulled entries from sessions into bundle ${a.bundle_id}`,
};

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  // Notify auto-sync of activity on any tool call (Claude is working)
  if (autoSyncHandle) {
    autoSyncHandle.recordActivity();
  }

  const result = await (async () => {
  try {
    switch (name) {
      case "bundle_create": {
        const a = z.object({
          name: z.string(),
          mode: z.enum(["local", "cloud"]).default("local"),
          team_id: z.string().optional(),
        }).parse(args);
        if (a.mode === "cloud" && !a.team_id) return fail("team_id is required when mode is 'cloud'.");
        const r = await createBundle(a.name, a.mode, a.team_id);
        return ok({
          ...r,
          join_code: r.join_code ?? null,
          message: r.join_code
            ? `Bundle created. Share with teammates: ctxl join ${r.join_code}`
            : `Bundle created.`,
        });
      }

      case "bundle_join": {
        const raw = BundleJoinArgs.parse(args);

        // Resolve short join code if provided
        let bundleId = raw.bundle_id;
        let joinToken = raw.join_token;
        if (isJoinCode(bundleId)) {
          const resolved = await resolveJoinCode(bundleId);
          if (!resolved) return fail("Join code not found or expired.");
          bundleId = resolved.bundle_id;
          joinToken = resolved.token;
        }

        if (!joinToken) return fail("join_token is required when bundle_id is a full bundle ID.");
        const r = await joinBundle(bundleId, joinToken, raw.project_name, "local");
        return ok(r);
      }

      case "bundle_list": {
        const local = listAllLocalBundleDetails();
        const teams = listMyTeams();
        const teamBundles = [];
        for (const t of teams) {
          const bundles = await listTeamBundles(t.team_id);
          teamBundles.push({
            team_id: t.team_id,
            team_name: t.name,
            bundles: bundles.map(b => ({ bundle_id: b.bundle_id, name: b.name, mode: "cloud" as const })),
          });
        }
        return ok({
          local_bundles: local.map(b => ({ ...b, mode: "local" as const })),
          team_bundles: teamBundles,
        });
      }

      case "bundle_status": {
        const a = BundleStatusArgs.parse(args);
        const mode = isLocalBundle(a.bundle_id) ? "local" : "cloud";
        return ok(await bundleStatus(a.bundle_id, mode));
      }

      case "bundle_add_note": {
        const a = z.object({
          bundle_id: z.string(),
          summary: z.string(),
          role: z.enum(["ticket","constraint","design","decision","bug","qa","note"]).optional(),
        }).parse(args);
        const result = await addBundleNote({
          bundle_id: a.bundle_id,
          summary: a.summary,
          role: a.role,
        });
        return ok(result);
      }

      case "context_push": {
        const a = ContextPushArgs.parse(args);
        const session = getSession();
        if (!session) return fail("No active session.");

        // If summary is provided, create a new session entry first
        if (a.summary) {
          pushSessionEntry(session.session_id, {
            project_name: session.project_name,
            event_type: "manual",
            trigger_ref: null,
            summary: a.summary,
            files_touched: [],
            decisions: [],
          });
        }

        // Get entry IDs to push
        const entryIds = a.source_entry_ids ?? getUnpushedSessionEntries(session.session_id).map(e => e.id);
        if (entryIds.length === 0) return fail("No entries to push.");

        // Push to specified bundle or all connected bundles
        const targetBundles = a.bundle_id
          ? [{ bundle_id: a.bundle_id, mode: isLocalBundle(a.bundle_id) ? "local" as const : "cloud" as const }]
          : session.bundles;

        if (targetBundles.length === 0) return fail("No bundles connected. Use session_connect first.");

        const results = [];
        for (const b of targetBundles) {
          try {
            const r = await pushSessionToBundle(session.session_id, b.bundle_id, entryIds);
            results.push({ bundle_id: b.bundle_id, added: r.pushed, skipped: r.skipped });
          } catch (err: any) {
            results.push({ bundle_id: b.bundle_id, added: 0, skipped: 0, error: err.message });
          }
        }

        return ok({ pushed: results, total_entries: entryIds.length, skip_reason: "skipped entries were already in the bundle" });
      }

      case "context_pull": {
        const a = ContextPullArgs.parse(args);
        const session = getSession();

        // Helper: append open questions to rendered output
        function appendQuestions(rendered: string, bundleIds: string[], projectName?: string): string {
          const allQuestions: Question[] = [];
          for (const bid of bundleIds) {
            if (!isLocalBundle(bid)) continue;
            const qs = listBundleQuestions(bid, { status: "open", targetProject: projectName });
            allQuestions.push(...qs);
          }
          if (allQuestions.length === 0) return rendered;
          const qLines = allQuestions.map((q) =>
            `[Q from "${q.asked_by_project}"${q.target_project ? ` → "${q.target_project}"` : ""}] ${q.question}\n  ID: ${q.id} | Status: ${q.status} | Use bundle_answer_question to respond.`
          );
          return rendered + "\n\n--- Open Questions ---\n" + qLines.join("\n\n");
        }

        // If bundle_id is provided, pull from that specific bundle
        if (a.bundle_id) {
          const session2 = getSession();
          const isConnected = session2?.bundles.some((b) => b.bundle_id === a.bundle_id);
          if (!isConnected) {
            return fail(`Not connected to bundle ${a.bundle_id}. Use session_connect first.`);
          }
          const mode = isLocalBundle(a.bundle_id) ? "local" : "cloud";
          const rows = await pullEntries({
            bundle_id: a.bundle_id,
            since: a.since ?? null,
            limit: a.limit,
            exclude_project: a.exclude_project,
            mode,
          });
          let rendered = renderEntriesForClaude(rows);
          rendered = appendQuestions(rendered, [a.bundle_id], session?.project_name);
          if (!hasShownWelcome && rows.length > 0) {
            hasShownWelcome = true;
            const projects = new Set(rows.map(r => r.project_name));
            const header = `--- Context shared via ctx-link — ${rows.length} entries from ${projects.size} project(s) ---\n\n`;
            rendered = header + rendered;
          }
          return ok({ count: rows.length, rendered, entries: rows });
        }

        // Otherwise pull from ALL session bundles (aggregated)
        if (!session || session.bundles.length === 0) {
          return fail("No bundles connected to this session. Use session_connect first.");
        }
        const allRows = [];
        for (const b of session.bundles) {
          const rows = await pullEntries({
            bundle_id: b.bundle_id,
            since: a.since ?? null,
            limit: a.limit,
            exclude_project: a.exclude_project,
            mode: b.mode,
          });
          allRows.push(...rows);
        }
        // Sort by created_at descending and limit
        allRows.sort((x, y) => y.created_at.localeCompare(x.created_at));
        const limited = allRows.slice(0, a.limit ?? 20);
        let rendered = renderEntriesForClaude(limited);
        rendered = appendQuestions(rendered, session.bundles.map((b) => b.bundle_id), session.project_name);
        if (!hasShownWelcome && limited.length > 0) {
          hasShownWelcome = true;
          const projects = new Set(limited.map(r => r.project_name));
          const header = `--- Context shared via ctx-link — ${limited.length} entries from ${projects.size} project(s) ---\n\n`;
          rendered = header + rendered;
        }
        return ok({ count: limited.length, rendered, entries: limited });
      }

      case "context_rewind": {
        const a = ContextRewindArgs.parse(args);
        const r = await bundleRewind({
          bundle_id: a.bundle_id,
          project_name: a.project_name,
          strategy: a.strategy as RewindStrategy,
          reason: a.reason,
          dry_run: a.dry_run,
          max_affected: a.max_affected,
          force: a.force,
        });
        return ok(r);
      }

      case "context_restore": {
        const a = ContextRestoreArgs.parse(args);
        const r = await bundleRestore({
          bundle_id: a.bundle_id,
          project_name: a.project_name,
          entry_ids: a.entry_ids,
          rewind_log_id: a.rewind_log_id,
        });
        return ok(r);
      }

      case "bundle_delete": {
        const a = z.object({ bundle_id: z.string() }).parse(args);
        const mode = isLocalBundle(a.bundle_id) ? "local" : "cloud";
        await deleteBundle(a.bundle_id, mode);
        return ok({ deleted: true, bundle_id: a.bundle_id });
      }

      case "session_connect": {
        const a = z.object({
          bundle_id: z.string(),
          mode: z.enum(["local", "cloud"]).optional(),
        }).parse(args);
        const resolvedMode = a.mode ?? (isLocalBundle(a.bundle_id) ? "local" : "cloud");
        const session = getSession();
        if (!session) return fail("No active session. Open Claude Code in a project first.");
        if (session.bundles.some((b) => b.bundle_id === a.bundle_id)) {
          return ok({ already_connected: true, bundle_id: a.bundle_id });
        }
        const updated = connectSessionToBundle(session.session_id, a.bundle_id, resolvedMode);

        // Fire feed event for cloud bundles
        if (!isLocalBundle(a.bundle_id)) {
          const teamId = await getBundleTeamId(a.bundle_id);
          if (teamId) {
            writeFeedEvent(teamId, "session_connected", {
              bundle_id: a.bundle_id,
              project_name: session.project_name,
              machine_id: loadGlobalConfig().machine_id,
            }).catch(() => {});
          }
        }

        return ok({ connected: true, bundle_id: a.bundle_id, total_bundles: updated.bundles.length });
      }

      case "session_disconnect": {
        const a = z.object({ bundle_id: z.string() }).parse(args);
        const session = getSession();
        if (!session) return fail("No active session.");
        await unlinkSessionFromBundle(session.session_id, a.bundle_id);

        // Fire feed event for cloud bundles
        if (!isLocalBundle(a.bundle_id)) {
          const teamId = await getBundleTeamId(a.bundle_id);
          if (teamId) {
            writeFeedEvent(teamId, "session_disconnected", {
              bundle_id: a.bundle_id,
              project_name: session.project_name,
              machine_id: loadGlobalConfig().machine_id,
            }).catch(() => {});
          }
        }

        const updated = loadActiveSession(session.session_id);
        return ok({ disconnected: true, bundle_id: a.bundle_id, total_bundles: updated?.bundles.length ?? 0 });
      }

      case "session_info": {
        const session = getSession();
        if (!session) return ok({ active: false, hint: "Session may still be initializing. The SessionStart hook creates it — try again in a moment, or use session_rename to name it." });
        const pending = getUnpushedSessionEntries(session.session_id);
        return ok({
          active: true,
          ...session,
          pending_entries_count: pending.length,
          pending_entries: pending,
        });
      }

      case "session_log": {
        const a = SessionLogArgs.parse(args);
        const session = getSession();
        if (!session) return fail("No active session. Open Claude Code in a project first.");

        // Reset staleness counters whenever the agent logs.
        lastSessionLogAt = Date.now();
        toolCallsSinceLog = 0;

        // If a commit/PR stub is awaiting enrichment, merge into it instead
        // of creating a second entry — gives one clean record per commit.
        const stub = getPendingEnrichmentStub(session.session_id);
        if (stub) {
          const merged = enrichSessionEntry(session.session_id, stub.id, {
            summary: a.summary,
            files_touched: a.files_touched,
            decisions: a.decisions,
          });
          if (merged) {
            return ok({
              logged: true,
              enriched: true,
              entry_id: merged.id,
              session_id: session.session_id,
              note: `Merged into pending ${stub.event_type} stub.`,
            });
          }
        }

        const entry = pushSessionEntry(session.session_id, {
          project_name: session.project_name,
          event_type: a.event_type,
          trigger_ref: a.trigger_ref ?? null,
          summary: a.summary,
          files_touched: a.files_touched ?? [],
          decisions: a.decisions ?? [],
        });
        return ok({ logged: true, entry_id: entry.id, session_id: session.session_id });
      }

      case "session_entries": {
        const a = SessionEntriesArgs.parse(args);
        const session = getSession();
        if (!session) return fail("No active session.");
        const entries = a.only_unpushed
          ? getUnpushedSessionEntries(session.session_id)
          : getSessionEntries(session.session_id);
        return ok({ count: entries.length, entries });
      }

      case "bundle_remove_entry": {
        const a = BundleRemoveEntryArgs.parse(args);
        const cfg = loadGlobalConfig();
        await bundleRemoveEntryRef(a.bundle_id, a.entry_id, { exclude: true, machineId: cfg.machine_id });
        return ok({ removed: true, excluded: true });
      }

      case "bundle_include_entry": {
        const a = BundleIncludeEntryArgs.parse(args);
        if (isLocalBundle(a.bundle_id)) {
          localIncludeEntryInBundle(a.bundle_id, a.entry_id);
        } else {
          await includeEntryInBundle(a.bundle_id, a.entry_id);
        }
        return ok({ included: true });
      }

      case "session_push_to_cloud": {
        const a = z.object({ team_id: z.string() }).parse(args);
        const session = getSession();
        if (!session) return fail("No active session.");
        const copy = await ensureCloudCopy(session.session_id, a.team_id);
        const updated = loadActiveSession(session.session_id);
        return ok({
          cloud_session_id: copy.cloud_session_id,
          message: `Session synced to cloud.`,
        });
      }

      case "rewind_history": {
        const a = RewindHistoryArgs.parse(args);
        const r = await bundleListRewinds(a.bundle_id, a.project_name, a.limit ?? 20);
        return ok(r);
      }

      case "session_push_to_bundle": {
        const a = z.object({ bundle_id: z.string().optional() }).parse(args);
        const session = getSession();
        if (!session) return fail("No active session.");

        // Discovery mode: return available teams and bundles
        if (!a.bundle_id) {
          const teams = listMyTeams();
          const localBundles = listAllLocalBundleDetails();
          const teamResults = [];
          for (const t of teams) {
            const bundles = await listTeamBundles(t.team_id);
            teamResults.push({
              team_id: t.team_id,
              name: t.name,
              bundles: bundles.map(b => ({ bundle_id: b.bundle_id, name: b.name })),
            });
          }
          return ok({
            local_bundles: localBundles.map(b => ({ bundle_id: b.bundle_id, name: b.bundle_name })),
            teams: teamResults,
          });
        }

        // Push mode: push all session entries to the specified bundle
        const entries = getSessionEntries(session.session_id);
        if (entries.length === 0) return fail("No session entries to push.");

        const r = await pushSessionToBundle(session.session_id, a.bundle_id);
        return ok({ bundle_id: a.bundle_id, added: r.pushed, skipped: r.skipped, total_entries: r.total });
      }

      case "session_start": {
        // The active session is identified by the calling Claude Code
        // window's session UUID, resolved from the process tree on every
        // tool call. session_start is now a no-op for arbitrary IDs — it
        // just refreshes branch/instance metadata for the resolved session
        // (or creates one if the SessionStart hook didn't fire yet).
        z.object({ session_id: z.string().optional() }).parse(args);
        const claudeSessionId = resolveOwnClaudeSessionId();
        if (!claudeSessionId) return fail("Could not identify Claude Code session from the process tree. Ensure ctx-link is launched by Claude Code.");

        const existing = loadActiveSession(claudeSessionId);
        if (existing) {
          try {
            const { execSync } = await import("node:child_process");
            existing.branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
          } catch {}
          existing.claude_instance_id = process.env.CLAUDE_CODE_SSE_PORT ?? null;
          if (!existing.claude_session_id) existing.claude_session_id = claudeSessionId;
          saveActiveSession(existing);
          return ok({ resumed: true, session_id: claudeSessionId, project_name: existing.project_name });
        }

        const created = await ensureSession();
        if (!created) return fail("Failed to create active session record.");
        return ok({ created: true, session_id: created.session_id, project_name: created.project_name, branch: created.branch });
      }

      case "team_create": {
        const a = z.object({ name: z.string(), join_code: z.string() }).parse(args);
        const r = await createTeam(a.name, a.join_code);
        return ok(r);
      }

      case "team_join": {
        const a = z.object({ name: z.string(), join_code: z.string() }).parse(args);
        const r = await joinTeam(a.name, a.join_code);
        return ok(r);
      }

      case "auth_status": {
        const user = await getCurrentUser();
        if (!user) return ok({ signed_in: false });
        return ok({ signed_in: true, user_id: user.id, email: user.email });
      }

      case "auth_send_code": {
        const a = z.object({ email: z.string().email() }).parse(args);
        await sendEmailOtp(a.email);
        return ok({
          sent: true,
          email: a.email,
          next: "Ask the user for the 6-digit code from their email and call auth_verify_code with it.",
        });
      }

      case "auth_verify_code": {
        const a = z.object({ email: z.string().email(), code: z.string() }).parse(args);
        const r = await verifyEmailOtp(a.email, a.code.trim());
        await refreshTeamsCache();
        return ok({ signed_in: true, user_id: r.user.id, email: r.user.email });
      }

      case "auth_signout": {
        await signOut();
        await refreshTeamsCache();
        return ok({ signed_out: true });
      }

      case "session_rename": {
        const a = z.object({ name: z.string() }).parse(args);
        const session = getSession();
        if (!session) return fail("No active session.");
        const trimmed = a.name.trim() || null;
        // Mark as manually renamed so auto-sync doesn't overwrite
        session.name_auto = false;
        saveActiveSession(session);
        await renameSessionAndCloudCopies(session.session_id, trimmed);
        return ok({ renamed: true, name: trimmed });
      }

      case "session_delete": {
        const a = z.object({ session_id: z.string().optional() }).parse(args);
        const sessionId = a.session_id ?? getSession()?.session_id;
        if (!sessionId) return fail("No active session and no session_id provided.");
        await deleteSession(sessionId);
        return ok({ deleted: true, session_id: sessionId });
      }

      case "session_delete_entry": {
        const a = z.object({ entry_id: z.string() }).parse(args);
        const session = getSession();
        if (!session) return fail("No active session.");
        await deleteSessionEntryAndCopies(session.session_id, a.entry_id);
        return ok({ deleted: true, entry_id: a.entry_id });
      }

      case "bundle_entries": {
        const a = z.object({ bundle_id: z.string(), limit: z.number().default(50) }).parse(args);
        const session = getSession();
        const isConnected = session?.bundles.some((b) => b.bundle_id === a.bundle_id);
        if (!isConnected) {
          return fail(`Not connected to bundle ${a.bundle_id}. Use session_connect first.`);
        }
        const mode = isLocalBundle(a.bundle_id) ? "local" : "cloud";
        const rows = await pullEntries({
          bundle_id: a.bundle_id,
          since: null,
          limit: a.limit,
          exclude_project: undefined,
          mode,
        });
        return ok({ count: rows.length, entries: rows });
      }

      case "session_list": {
        const sessions = listActiveSessions();
        return ok({
          count: sessions.length,
          sessions: sessions.map(s => ({
            session_id: s.session_id,
            project_name: s.project_name,
            project_path: s.project_path,
            branch: s.branch,
            name: s.name ?? null,
            started_at: s.started_at,
            bundles: s.bundles,
            entry_count: getSessionEntries(s.session_id).length,
            cloud_session_id: s.cloud_session_id,
          })),
        });
      }

      case "bundle_pull_from_sessions": {
        const a = z.object({ bundle_id: z.string() }).parse(args);
        const r = await pullEntriesFromConnectedSessions(a.bundle_id);
        return ok({ pushed: r.pushed, skipped: r.skipped });
      }

      case "bundle_push_to_cloud": {
        const a = z.object({ bundle_id: z.string(), team_id: z.string() }).parse(args);
        const result = await pushBundleToCloud(a.bundle_id, a.team_id);
        return ok(result);
      }

      case "bundle_ask_question": {
        const a = z.object({
          bundle_id: z.string(),
          question: z.string(),
          target_project: z.string().optional(),
          context: z.string().optional(),
        }).parse(args);
        const session = getSession();
        if (!session) return fail("No active session.");
        const q = askQuestion(a.bundle_id, session.session_id, session.project_name, a.question, {
          targetProject: a.target_project,
          context: a.context,
        });
        // Broadcast to other sessions connected to this bundle
        broadcastToBundle(a.bundle_id, {
          type: "question_asked",
          bundle_id: a.bundle_id,
          question: q,
          from_session_id: session.session_id,
          from_project: session.project_name,
          target_project: a.target_project,
        }, session.session_id).catch(() => {}); // fire and forget
        return ok({
          question_id: q.id,
          status: q.status,
          message: `Question posted to bundle. ${a.target_project ? `Directed to project "${a.target_project}".` : "Open to all projects."}`,
        });
      }

      case "bundle_answer_question": {
        const a = z.object({
          bundle_id: z.string(),
          question_id: z.string(),
          answer: z.string(),
        }).parse(args);
        const session = getSession();
        if (!session) return fail("No active session.");
        const answer = answerQuestion(a.bundle_id, a.question_id, session.session_id, session.project_name, a.answer);
        // Broadcast answer notification
        const answeredQ = listBundleQuestions(a.bundle_id).find((q) => q.id === a.question_id);
        if (answeredQ) {
          broadcastToBundle(a.bundle_id, {
            type: "question_answered",
            bundle_id: a.bundle_id,
            question: answeredQ,
            from_session_id: session.session_id,
            from_project: session.project_name,
          }, session.session_id).catch(() => {});
        }
        return ok({
          answer_id: answer.id,
          question_id: a.question_id,
          message: "Answer posted. The question is now marked as 'answered'.",
        });
      }

      case "bundle_questions": {
        const a = z.object({
          bundle_id: z.string(),
          status: z.enum(["open", "answered", "resolved"]).optional(),
          target_project: z.string().optional(),
        }).parse(args);
        const questions = listBundleQuestions(a.bundle_id, {
          status: a.status,
          targetProject: a.target_project,
        });
        return ok({ count: questions.length, questions });
      }

      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return fail(e);
  }
  })();

  // Auto-log ctx-link tool calls only when running inside the ctx-link project (debugging)
  if (result && !('isError' in result)) {
    const session = getSession();
    if (session?.project_name === "ctx-link") {
      const gen = CTX_LINK_AUTO_LOG[name];
      if (gen) {
        const summary = gen((args ?? {}) as Record<string, any>);
        if (summary) {
          try {
            pushSessionEntry(session.session_id, {
              project_name: session.project_name,
              event_type: "auto",
              trigger_ref: null,
              summary,
              files_touched: [],
              decisions: [],
            });
          } catch {}
        }
      }
    }
  }

  // Tool-call counter for staleness detection. session_log resets it inside
  // its own case; here we just count anything else the agent calls.
  if (name !== "session_log") {
    toolCallsSinceLog += 1;
  }

  // Reminder system: prepend at most ONE [ctx-link] notice per response.
  // Priority order:
  //   1. Pending commit/PR enrichment stub (highest signal — there's a
  //      placeholder in the entry log waiting to be filled in).
  //   2. Staleness — too much time or too many tool calls since last log.
  // The agent sees these as plain-text content blocks; they don't break
  // the underlying tool result.
  try {
    const session = getSession();
    if (session) {
      let reminder: string | null = null;

      const stub = getPendingEnrichmentStub(session.session_id);
      if (stub) {
        const which = stub.event_type === "pr_open" ? "PR" : "commit";
        const ref = stub.trigger_ref ? ` (${stub.trigger_ref.slice(0, 7)})` : "";
        reminder =
          `[ctx-link] Pending handoff: a ${which}${ref} was logged as a stub. ` +
          `Call \`session_log\` now with handoff details — function/endpoint signatures, payload shapes, error format, dependencies. ` +
          `Your call will MERGE into the stub (one clean entry per ${which}). Avoid diffs; describe what now exists and how to use it.`;
      } else if (name !== "session_log") {
        const elapsedMs = Date.now() - lastSessionLogAt;
        const stale =
          elapsedMs >= STALE_LOG_THRESHOLD_MS ||
          toolCallsSinceLog >= STALE_LOG_THRESHOLD_CALLS;
        if (stale) {
          const minutes = Math.round(elapsedMs / 60000);
          reminder =
            `[ctx-link] You haven't called session_log in ${minutes} min / ${toolCallsSinceLog} tool calls. ` +
            `If you've finished a logical unit of work since (a feature, bug fix, refactor, design decision, config change) — log it NOW. ` +
            `Don't wait for a commit; commits create stub entries you can enrich, but mid-flight work disappears unless logged. ` +
            `One handoff entry per logical unit; describe what now exists and how the next agent uses it.`;
          // Re-arm so we don't fire on every single subsequent call. Reset
          // the counter but leave lastSessionLogAt — the agent has been
          // warned; if they ignore us, the time-based threshold will trip
          // again later.
          toolCallsSinceLog = 0;
        }
      }

      if (reminder && Array.isArray(result?.content)) {
        (result.content as any[]).unshift({ type: "text", text: reminder });
      }
    }
  } catch {
    // never let the reminder break the actual response
  }

  return result;
});

// ---------- Auto-start UI server ----------

async function startUiServer() {
  try {
    // Check if already running
    const res = await fetch("http://127.0.0.1:5174/api/teams", {
      signal: AbortSignal.timeout(1000),
    });
    if (res.ok) return; // already running
  } catch {
    // Not running — start it
  }

  try {
    const { resolve } = await import("node:path");
    const { existsSync } = await import("node:fs");

    // Find server.js — works in both bundled (dist/) and dev (monorepo) mode
    const candidates = [
      resolve(import.meta.dir, "server.js"),           // bundled: dist/server.js
      resolve(import.meta.dir, "../../ui/server.ts"),   // dev: packages/mcp-server/src/ → packages/ui/server.ts
    ];
    const serverPath = candidates.find(existsSync);
    if (!serverPath) return; // UI server not available

    const proc = Bun.spawn(["bun", serverPath], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    proc.unref(); // detach so MCP can exit without killing the UI server
  } catch {
    // Non-fatal — UI server is optional
  }
}

// ---------- Boot ----------

const transport = new StdioServerTransport();
await server.connect(transport);

// Auto-start UI server (non-blocking)
startUiServer();

// Boot diagnostics — written to a per-PID log so two MCP servers don't
// stomp each other and the user can verify which Claude Code window each
// MCP is bound to. Reset on each boot.
try {
  const { mkdirSync, appendFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");
  const dir = join(homedir(), ".ctx-link", "mcp-logs");
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, `${process.pid}.log`);
  const claudeId = resolveClaudeSessionId();
  const lines = [
    `--- ctx-link MCP boot ${new Date().toISOString()} ---`,
    `pid=${process.pid} ppid=${process.ppid} cwd=${process.cwd()}`,
    `CLAUDE_CODE_SSE_PORT=${process.env.CLAUDE_CODE_SSE_PORT ?? "<unset>"}`,
    `resolveClaudeSessionId() → ${claudeId ?? "<null>"}`,
    "",
  ].join("\n");
  appendFileSync(logPath, lines);
} catch {}

// Auto-start session — no manual session_start needed
const bootSession = await ensureSession();

// Start auto-sync for cloud bundles
if (bootSession) {
  const projectConfig = loadProjectConfig(bootSession.project_path);
  const autoSyncEnabled = projectConfig?.auto_sync !== false; // default true
  const hasCloudBundles = bootSession.bundles.some(b => b.mode === "cloud");

  if (autoSyncEnabled && hasCloudBundles) {
    autoSyncHandle = startAutoSync(
      bootSession.session_id,
      (msg) => process.stderr.write(`[auto-sync] ${msg}\n`),
    );
  }
}

// Auto-pull from cloud bundles on session start (respects auto_sync config)
if (bootSession) {
  const projectConfig = loadProjectConfig(bootSession.project_path);
  const autoSyncEnabled = projectConfig?.auto_sync !== false;
  if (autoSyncEnabled) {
    const cloudBundles = bootSession.bundles.filter(b => b.mode === "cloud");
    for (const b of cloudBundles) {
      try {
        const rows = await pullEntries({
          bundle_id: b.bundle_id,
          exclude_project: bootSession.project_name,
          mode: "cloud",
          limit: 20,
          skipAuth: true,
        });
        if (rows.length > 0) {
          const rendered = renderEntriesForClaude(rows);
          process.stderr.write(`[auto-sync] Auto-pulled ${rows.length} entries from bundle ${b.bundle_id}\n`);
          try {
            await server.sendLoggingMessage({
              level: "info",
              logger: "ctx-link-auto-pull",
              data: `[AUTO-PULL] ${rows.length} entries from connected bundles:\n\n${rendered}`,
            });
          } catch {}
        }
      } catch (err: any) {
        process.stderr.write(`[auto-sync] Auto-pull from ${b.bundle_id} failed: ${err.message}\n`);
      }
    }
  }
}

// Start Q&A channel listener for cross-session notifications
let channelHandle: { port: number; close: () => void } | null = null;

if (bootSession) {
  channelHandle = startChannelListener(bootSession.session_id, async (msg) => {
    const currentSession = getSession();
    const projectName = currentSession?.project_name;

    // Only process messages relevant to this session's project
    if (msg.target_project && msg.target_project !== projectName) return;

    try {
      if (msg.type === "question_asked") {
        await server.sendLoggingMessage({
          level: "warning",
          logger: "ctx-link-qa",
          data: `[ACTION REQUIRED] Question from "${msg.from_project}" on bundle ${msg.bundle_id}: "${msg.question.question}" — Answer using: bundle_answer_question(bundle_id="${msg.bundle_id}", question_id="${msg.question.id}", answer="<your answer>")`,
        });
      } else if (msg.type === "question_answered") {
        const latestAnswer = msg.question.answers[msg.question.answers.length - 1]?.answer ?? "";
        await server.sendLoggingMessage({
          level: "info",
          logger: "ctx-link-qa",
          data: `[ANSWER RECEIVED] Your question "${msg.question.question}" was answered by "${msg.from_project}": "${latestAnswer}"`,
        });
      }
    } catch {
      // sendLoggingMessage may fail if client disconnects — non-fatal
    }
  });
}

// Clean shutdown
process.on("SIGINT", () => { autoSyncHandle?.stop(); channelHandle?.close(); process.exit(0); });
process.on("SIGTERM", () => { autoSyncHandle?.stop(); channelHandle?.close(); process.exit(0); });

// Stderr only, stdio is the MCP wire.
process.stderr.write("ctx-link MCP server ready\n");
