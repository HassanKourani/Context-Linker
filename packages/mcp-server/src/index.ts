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
  pullEntries,
  renderEntriesForClaude,
  rewindProject,
  restoreRewound,
  listRewinds,
  getActiveSessionId,
  loadActiveSession,
  saveActiveSession,
  pushSessionEntry,
  getSessionEntries,
  getUnpushedSessionEntries,
  addEntriesToBundle,
  localAddEntriesToBundle,
  removeEntryFromBundle,
  localRemoveEntryFromBundle,
  copySessionToCloud,
  type ActiveSession,
  type RewindStrategy,
  isLocalBundle,
} from "@ctx-link/core";
import { z } from "zod";

/** Get the active session for the current CWD. Returns null if no session. */
function getSession(): ActiveSession | null {
  const sessionId = getActiveSessionId();
  if (!sessionId) return null;
  return loadActiveSession(sessionId);
}

const server = new Server(
  { name: "ctx-link", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ---------- Tool definitions ----------

const tools = [
  {
    name: "bundle_create",
    description:
      "Create a new shared context bundle. Returns a bundle_id and a join_token. Share the token with another machine/session to link them.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Human-readable label, e.g. 'feature-notifications'",
        },
      },
      required: ["name"],
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
    description: "List bundles this machine has joined.",
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
        bundle_id: { type: "string" },
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
      required: ["bundle_id"],
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
        mode: { type: "string", enum: ["local", "cloud"], description: "Storage mode for this bundle" },
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
      "Log a context entry to the current session (local only, NOT pushed to bundles). " +
      "PROACTIVE USE: You SHOULD call this after every meaningful interaction — code changes, decisions, " +
      "API modifications, architecture choices, file creations, configuration updates. " +
      "Keep summaries state-focused: describe WHAT EXISTS now, not what changed from before. " +
      "These entries accumulate locally and get consolidated when the user triggers context_push.",
    inputSchema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "What happened / what exists now. State-focused, 1-2 sentences.",
        },
        files_touched: {
          type: "array",
          items: { type: "string" },
        },
        decisions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              decision: { type: "string" },
              rationale: { type: "string" },
              affects: { type: "array", items: { type: "string" } },
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
      "List accumulated session entries. Use before context_push to see what needs consolidating.",
    inputSchema: {
      type: "object",
      properties: {
        only_unpushed: {
          type: "boolean",
          description: "If true (default), only show entries not yet pushed to a bundle.",
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
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

// ---------- Tool dispatch ----------

const BundleCreateArgs = z.object({ name: z.string() });
const BundleJoinArgs = z.object({
  bundle_id: z.string(),
  join_token: z.string(),
  project_name: z.string(),
});
const BundleStatusArgs = z.object({ bundle_id: z.string() });
const ContextPushArgs = z.object({
  bundle_id: z.string().optional(),
  summary: z.string().optional(),
  source_entry_ids: z.array(z.string()).optional(),
});
const ContextPullArgs = z.object({
  bundle_id: z.string(),
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

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    switch (name) {
      case "bundle_create": {
        const a = BundleCreateArgs.parse(args);
        const r = await createBundle(a.name, "local");
        return ok(r);
      }

      case "bundle_join": {
        const a = BundleJoinArgs.parse(args);
        const r = await joinBundle(a.bundle_id, a.join_token, a.project_name, "local");
        return ok(r);
      }

      case "bundle_list": {
        return ok(listLocalBundles());
      }

      case "bundle_status": {
        const a = BundleStatusArgs.parse(args);
        const mode = isLocalBundle(a.bundle_id) ? "local" : "cloud";
        return ok(await bundleStatus(a.bundle_id, mode));
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
          if (isLocalBundle(b.bundle_id)) {
            const r = localAddEntriesToBundle(b.bundle_id, entryIds, session.session_id);
            results.push({ bundle_id: b.bundle_id, added: r.added, skipped: r.skipped });
          } else {
            const r = await addEntriesToBundle(b.bundle_id, entryIds);
            results.push({ bundle_id: b.bundle_id, added: r.added, skipped: r.skipped });
          }
        }

        return ok({ pushed: results, total_entries: entryIds.length });
      }

      case "context_pull": {
        const a = ContextPullArgs.parse(args);
        const session = getSession();

        // If bundle_id is provided, pull from that specific bundle
        if (a.bundle_id) {
          const mode = isLocalBundle(a.bundle_id) ? "local" : "cloud";
          const rows = await pullEntries({
            bundle_id: a.bundle_id,
            since: a.since ?? null,
            limit: a.limit,
            exclude_project: a.exclude_project,
            mode,
          });
          const rendered = renderEntriesForClaude(rows);
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
        const rendered = renderEntriesForClaude(limited);
        return ok({ count: limited.length, rendered, entries: limited });
      }

      case "context_rewind": {
        const a = ContextRewindArgs.parse(args);
        const r = await rewindProject({
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
        const r = await restoreRewound({
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
          mode: z.enum(["local", "cloud"]).default("local"),
        }).parse(args);
        const session = getSession();
        if (!session) return fail("No active session. Open Claude Code in a project first.");
        if (session.bundles.some((b) => b.bundle_id === a.bundle_id)) {
          return ok({ already_connected: true, bundle_id: a.bundle_id });
        }
        session.bundles.push({ bundle_id: a.bundle_id, mode: a.mode });
        saveActiveSession(session);

        // Add all session entries as refs to the new bundle
        const entries = getSessionEntries(session.session_id);
        if (entries.length > 0) {
          const entryIds = entries.map(e => e.id);
          try {
            if (isLocalBundle(a.bundle_id)) {
              localAddEntriesToBundle(a.bundle_id, entryIds, session.session_id);
            } else {
              await addEntriesToBundle(a.bundle_id, entryIds);
            }
          } catch { /* non-fatal */ }
        }

        return ok({ connected: true, bundle_id: a.bundle_id, total_bundles: session.bundles.length });
      }

      case "session_disconnect": {
        const a = z.object({ bundle_id: z.string() }).parse(args);
        const session = getSession();
        if (!session) return fail("No active session.");
        session.bundles = session.bundles.filter((b) => b.bundle_id !== a.bundle_id);
        saveActiveSession(session);
        return ok({ disconnected: true, bundle_id: a.bundle_id, total_bundles: session.bundles.length });
      }

      case "session_info": {
        const session = getSession();
        if (!session) return ok({ active: false });
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
        if (isLocalBundle(a.bundle_id)) {
          localRemoveEntryFromBundle(a.bundle_id, a.entry_id);
        } else {
          await removeEntryFromBundle(a.bundle_id, a.entry_id);
        }
        return ok({ removed: true });
      }

      case "session_push_to_cloud": {
        const a = z.object({ team_id: z.string() }).parse(args);
        const session = getSession();
        if (!session) return fail("No active session.");
        if (session.cloud_session_id && session.team_id === a.team_id) {
          return fail("This session has already been copied to this team.");
        }
        const result = await copySessionToCloud(session.session_id, a.team_id);
        if (!session.cloud_session_id) {
          session.cloud_session_id = result.cloud_session_id;
          session.team_id = a.team_id;
          saveActiveSession(session);
        }
        return ok({
          cloud_session_id: result.cloud_session_id,
          entries_copied: result.entries_copied,
          message: `Session copied to cloud. ${result.entries_copied} entries copied.`,
        });
      }

      case "rewind_history": {
        const a = RewindHistoryArgs.parse(args);
        const r = await listRewinds(a.bundle_id, a.project_name, a.limit ?? 20);
        return ok(r);
      }

      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return fail(e);
  }
});

// ---------- Boot ----------

const transport = new StdioServerTransport();
await server.connect(transport);

// Stderr only, stdio is the MCP wire.
process.stderr.write("ctx-link MCP server ready\n");
