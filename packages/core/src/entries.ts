import { getSupabase } from "./supabase.js";
import { assertTokenValid, bumpBundleActivity } from "./bundles.js";
import { ROLES, rolePriority, type Role } from "./notes.js";
import { deriveTitleFromSummary } from "./config.js";

export interface PullInput {
  bundle_id: string;
  since?: string | null;    // ISO timestamp
  limit?: number;           // default 20
  last_n?: number;          // alias for limit when caller wants to be explicit about "n newest"
  exclude_project?: string; // useful: "don't show me my own project's entries"
  project?: string;         // restrict to entries from a single project
  mode?: "local" | "cloud";
  skipAuth?: boolean;       // trusted server-side calls can skip team membership check
}

/** Slim shape returned by pullEntries — no body. Use readEntriesByIds to fetch bodies. */
export interface EntryHeader {
  id: string;
  title: string;
  project_name: string;
  event_type: string;
  trigger_ref: string | null;
  created_at: string;
  updated_at: string | null;
  role?: Role | null;
}

/** Full body shape — used by readEntriesByIds and renderEntriesForClaude. */
export interface EntryRow extends EntryHeader {
  summary: string;
  files_touched: string[];
  decisions: Array<{ decision: string; rationale?: string; affects: string[] }>;
  bundle_refs?: string[];
}

/** Headers-first pull. Returns slim headers — call readEntriesByIds for full bodies. */
export async function pullEntries(input: PullInput): Promise<EntryHeader[]> {
  if (input.mode === "local") {
    const { localPullEntries } = await import("./local-store.js");
    return localPullEntries(input);
  }

  if (!input.skipAuth) await assertTokenValid(input.bundle_id);
  const sb = getSupabase();

  const limit = input.last_n ?? input.limit ?? 20;

  let query = sb
    .from("bundle_entry_refs")
    .select(`
      entry_id,
      cloud_session_entries!inner (
        id, created_at, updated_at, event_type, trigger_ref, title, summary, superseded_at, role,
        cloud_sessions!inner ( project_name )
      )
    `)
    .eq("bundle_id", input.bundle_id)
    .is("cloud_session_entries.superseded_at", null)
    .order("added_at", { ascending: false })
    .limit(limit);

  if (input.since) {
    query = query.gt("cloud_session_entries.created_at", input.since);
  }

  const { data, error } = await query;
  if (error) throw new Error(`pullEntries failed: ${error.message}`);

  const rows = (data ?? []).map((r: any) => {
    const e = r.cloud_session_entries;
    return {
      id: e.id,
      title: e.title ?? deriveTitleFromSummary(e.summary ?? ""),
      created_at: e.created_at,
      updated_at: e.updated_at ?? null,
      project_name: e.cloud_sessions?.project_name ?? "unknown",
      event_type: e.event_type,
      trigger_ref: e.trigger_ref,
      role: e.role ?? null,
    } as EntryHeader;
  });

  let filtered = input.exclude_project
    ? rows.filter((r) => r.project_name !== input.exclude_project)
    : rows;

  if (input.project) {
    filtered = filtered.filter((r) => r.project_name === input.project);
  }

  filtered.sort((a, b) => {
    const dp = rolePriority(a.role) - rolePriority(b.role);
    if (dp !== 0) return dp;
    return b.created_at.localeCompare(a.created_at);
  });
  return filtered;
}

/**
 * Pull entries WITH full bodies. Use only where token cost doesn't matter
 * (UI rendering, scripted reports). Tools facing the agent should use the
 * headers-first `pullEntries` instead.
 */
export async function pullEntriesWithBodies(input: PullInput): Promise<EntryRow[]> {
  if (input.mode === "local") {
    const { localPullEntriesWithBodies } = await import("./local-store.js");
    return localPullEntriesWithBodies(input);
  }

  if (!input.skipAuth) await assertTokenValid(input.bundle_id);
  const sb = getSupabase();

  const limit = input.last_n ?? input.limit ?? 20;

  let query = sb
    .from("bundle_entry_refs")
    .select(`
      entry_id,
      cloud_session_entries!inner (
        id, created_at, updated_at, event_type, trigger_ref,
        title, summary, files_touched, decisions, superseded_at, role,
        cloud_sessions!inner ( project_name )
      )
    `)
    .eq("bundle_id", input.bundle_id)
    .is("cloud_session_entries.superseded_at", null)
    .order("added_at", { ascending: false })
    .limit(limit);

  if (input.since) query = query.gt("cloud_session_entries.created_at", input.since);

  const { data, error } = await query;
  if (error) throw new Error(`pullEntriesWithBodies failed: ${error.message}`);

  const rows = (data ?? []).map((r: any) => {
    const e = r.cloud_session_entries;
    return {
      id: e.id,
      title: e.title ?? deriveTitleFromSummary(e.summary ?? ""),
      created_at: e.created_at,
      updated_at: e.updated_at ?? null,
      project_name: e.cloud_sessions?.project_name ?? "unknown",
      event_type: e.event_type,
      trigger_ref: e.trigger_ref,
      summary: e.summary ?? "",
      files_touched: e.files_touched ?? [],
      decisions: e.decisions ?? [],
      role: e.role ?? null,
    } as EntryRow;
  });

  let filtered = input.exclude_project ? rows.filter((r) => r.project_name !== input.exclude_project) : rows;
  if (input.project) filtered = filtered.filter((r) => r.project_name === input.project);

  filtered.sort((a, b) => {
    const dp = rolePriority(a.role) - rolePriority(b.role);
    if (dp !== 0) return dp;
    return b.created_at.localeCompare(a.created_at);
  });
  return filtered;
}

/**
 * Fetch full bodies for specific entry IDs in a bundle.
 * Caller-side rule: each entry must be referenced by the bundle.
 * Authentication: same `assertTokenValid` check pullEntries uses.
 * Auto-detects local vs cloud bundles.
 */
export async function readEntriesByIds(
  bundleId: string,
  entryIds: string[],
  options?: { mode?: "local" | "cloud"; skipAuth?: boolean }
): Promise<EntryRow[]> {
  if (entryIds.length === 0) return [];

  // Auto-detect local
  const mode = options?.mode;
  if (mode === "local") {
    const { localReadEntriesByIds } = await import("./local-store.js");
    return localReadEntriesByIds(bundleId, entryIds);
  }
  if (!mode) {
    const { isLocalBundle, localReadEntriesByIds } = await import("./local-store.js");
    if (isLocalBundle(bundleId)) return localReadEntriesByIds(bundleId, entryIds);
  }

  if (!options?.skipAuth) await assertTokenValid(bundleId);
  const sb = getSupabase();

  // Restrict to entries actually referenced by this bundle.
  const { data, error } = await sb
    .from("bundle_entry_refs")
    .select(`
      entry_id,
      cloud_session_entries!inner (
        id, created_at, updated_at, event_type, trigger_ref,
        title, summary, files_touched, decisions, superseded_at, role,
        cloud_sessions!inner ( project_name )
      )
    `)
    .eq("bundle_id", bundleId)
    .in("entry_id", entryIds)
    .is("cloud_session_entries.superseded_at", null);

  if (error) throw new Error(`readEntriesByIds failed: ${error.message}`);

  return (data ?? []).map((r: any) => {
    const e = r.cloud_session_entries;
    return {
      id: e.id,
      title: e.title ?? deriveTitleFromSummary(e.summary ?? ""),
      created_at: e.created_at,
      updated_at: e.updated_at ?? null,
      project_name: e.cloud_sessions?.project_name ?? "unknown",
      event_type: e.event_type,
      trigger_ref: e.trigger_ref,
      summary: e.summary ?? "",
      files_touched: e.files_touched ?? [],
      decisions: e.decisions ?? [],
      role: e.role ?? null,
    } as EntryRow;
  });
}

/**
 * Add entries to a bundle by creating bundle_entry_refs rows.
 * Skips entries that are already referenced by this bundle.
 */
export async function addEntriesToBundle(
  bundleId: string,
  entryIds: string[]
): Promise<{ added: number; skipped: number }> {
  if (entryIds.length === 0) return { added: 0, skipped: 0 };

  const sb = getSupabase();

  // Check which refs already exist
  const { data: existing } = await sb
    .from("bundle_entry_refs")
    .select("entry_id")
    .eq("bundle_id", bundleId)
    .in("entry_id", entryIds);

  const existingIds = new Set((existing ?? []).map((r: any) => r.entry_id));
  const newIds = entryIds.filter((id) => !existingIds.has(id));

  if (newIds.length === 0) {
    return { added: 0, skipped: entryIds.length };
  }

  const rows = newIds.map((entryId) => ({
    bundle_id: bundleId,
    entry_id: entryId,
  }));

  const { error } = await sb.from("bundle_entry_refs").insert(rows);
  if (error) throw new Error(`addEntriesToBundle failed: ${error.message}`);

  await bumpBundleActivity(bundleId);

  // Fire feed event (non-blocking)
  if (newIds.length > 0) {
    try {
      const { getBundleTeamId } = await import("./bundles.js");
      const teamId = await getBundleTeamId(bundleId);
      if (teamId) {
        const { writeFeedEvent } = await import("./feed.js");
        writeFeedEvent(teamId, "entry_pushed", {
          bundle_id: bundleId,
          entry_count: newIds.length,
        }).catch(() => {});
      }
    } catch {}
  }

  return { added: newIds.length, skipped: existingIds.size };
}

/**
 * Remove a single entry reference from a bundle.
 */
export async function removeEntryFromBundle(
  bundleId: string,
  entryId: string,
  options?: { exclude?: boolean; machineId?: string },
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("bundle_entry_refs")
    .delete()
    .eq("bundle_id", bundleId)
    .eq("entry_id", entryId);
  if (error) throw new Error(`removeEntryFromBundle failed: ${error.message}`);

  await bumpBundleActivity(bundleId);

  if (options?.exclude) {
    const { excludeEntryFromBundle } = await import("./exclusions.js");
    await excludeEntryFromBundle(bundleId, entryId, options.machineId);
  }
}

/**
 * Remove all bundle_entry_refs for entries belonging to a given cloud session.
 */
export async function removeSessionEntriesFromBundle(
  bundleId: string,
  cloudSessionId: string
): Promise<number> {
  const sb = getSupabase();

  // Get all entry IDs for this cloud session
  const { data: sessionEntries, error: seErr } = await sb
    .from("cloud_session_entries")
    .select("id")
    .eq("session_id", cloudSessionId);

  if (seErr) throw new Error(`removeSessionEntriesFromBundle query failed: ${seErr.message}`);
  if (!sessionEntries || sessionEntries.length === 0) return 0;

  const entryIds = sessionEntries.map((e: any) => e.id);

  const { error, count } = await sb
    .from("bundle_entry_refs")
    .delete({ count: "exact" })
    .eq("bundle_id", bundleId)
    .in("entry_id", entryIds);

  if (error) throw new Error(`removeSessionEntriesFromBundle delete failed: ${error.message}`);

  if ((count ?? 0) > 0) {
    await bumpBundleActivity(bundleId);
  }

  return count ?? 0;
}

/**
 * Get session entries not yet referenced by a specific bundle.
 */
export async function getUnpushedEntries(
  cloudSessionId: string,
  bundleId: string
): Promise<string[]> {
  const sb = getSupabase();

  // Get all entry IDs for this cloud session
  const { data: sessionEntries, error: seErr } = await sb
    .from("cloud_session_entries")
    .select("id")
    .eq("session_id", cloudSessionId)
    .is("superseded_at", null);

  if (seErr) throw new Error(`getUnpushedEntries session query failed: ${seErr.message}`);
  if (!sessionEntries || sessionEntries.length === 0) return [];

  const allIds = sessionEntries.map((e: any) => e.id);

  // Get entry IDs already referenced by this bundle
  const { data: refs, error: refErr } = await sb
    .from("bundle_entry_refs")
    .select("entry_id")
    .eq("bundle_id", bundleId)
    .in("entry_id", allIds);

  if (refErr) throw new Error(`getUnpushedEntries refs query failed: ${refErr.message}`);

  const refIds = new Set((refs ?? []).map((r: any) => r.entry_id));
  return allIds.filter((id: string) => !refIds.has(id));
}

const ROLE_HEADINGS: Record<Role, string> = {
  ticket:     "Ticket",
  constraint: "Constraints",
  design:     "Design spec",
  decision:   "Decisions",
  bug:        "Bugs",
  qa:         "QA",
  note:       "Notes",
};

function renderEntry(e: EntryRow): string {
  const ts = new Date(e.created_at).toISOString();
  const updated = e.updated_at && e.updated_at !== e.created_at
    ? ` · edited ${new Date(e.updated_at).toISOString()}`
    : "";
  const lines = [
    `[${e.id}] ${e.title}`,
    `${ts}${updated} · ${e.project_name || "—"} · ${e.event_type}${
      e.trigger_ref ? ` (${e.trigger_ref})` : ""
    }`,
    e.summary,
  ];
  if (e.files_touched.length > 0) {
    lines.push(`Files: ${e.files_touched.join(", ")}`);
  }
  if (e.decisions.length > 0) {
    lines.push("Decisions:");
    for (const d of e.decisions) {
      lines.push(
        `  - ${d.decision}${d.affects?.length ? ` [affects: ${d.affects.join(", ")}]` : ""}`
      );
    }
  }
  return lines.join("\n");
}

/** Compact text listing of entry headers for context_pull.
 *  One line per header. Lets the agent triage by id+title+project+role
 *  without spending tokens on bodies. */
export function renderHeadersForClaude(headers: EntryHeader[]): string {
  if (headers.length === 0) return "No recent cross-project context.";

  const groups = new Map<Role, EntryHeader[]>();
  for (const h of headers) {
    const r: Role = (h.role ?? "note") as Role;
    const arr = groups.get(r) ?? [];
    arr.push(h);
    groups.set(r, arr);
  }

  const orderedRoles = ROLES.filter((r) => groups.has(r));
  const sections = orderedRoles.map((r) => {
    const items = (groups.get(r) ?? [])
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((h) => {
        const ts = new Date(h.created_at).toISOString();
        const updated = h.updated_at && h.updated_at !== h.created_at
          ? ` (edited ${new Date(h.updated_at).toISOString()})`
          : "";
        const ref = h.trigger_ref ? ` (${h.trigger_ref})` : "";
        return `- [${h.id}] ${h.title} — ${h.project_name} · ${h.event_type}${ref} · ${ts}${updated}`;
      })
      .join("\n");
    return `## ${ROLE_HEADINGS[r]}\n\n${items}`;
  });

  const footer =
    "\n\n_Headers only — call `entry_read` with the IDs you want to read in full._";
  return sections.join("\n\n") + footer;
}

// Human/LLM-readable rendering of entries for context injection,
// grouped by role priority so agents read tickets first, notes last.
export function renderEntriesForClaude(entries: EntryRow[]): string {
  if (entries.length === 0) {
    return "No recent cross-project context.";
  }

  const groups = new Map<Role, EntryRow[]>();
  for (const e of entries) {
    const r: Role = (e.role ?? "note") as Role;
    const arr = groups.get(r) ?? [];
    arr.push(e);
    groups.set(r, arr);
  }

  const orderedRoles = ROLES.filter((r) => groups.has(r));
  const sections = orderedRoles.map((r) => {
    const items = (groups.get(r) ?? [])
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(renderEntry)
      .join("\n\n---\n\n");
    return `## ${ROLE_HEADINGS[r]}\n\n${items}`;
  });

  return sections.join("\n\n");
}
