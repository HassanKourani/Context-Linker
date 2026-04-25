import { getSupabase } from "./supabase.js";
import { assertTokenValid } from "./bundles.js";

export interface PullInput {
  bundle_id: string;
  since?: string | null;    // ISO timestamp
  limit?: number;           // default 20
  exclude_project?: string; // useful: "don't show me my own project's entries"
  mode?: "local" | "cloud";
  skipAuth?: boolean;       // trusted server-side calls can skip team membership check
}

export interface EntryRow {
  id: string;
  created_at: string;
  project_name: string;
  event_type: string;
  trigger_ref: string | null;
  summary: string;
  files_touched: string[];
  decisions: Array<{ decision: string; rationale?: string; affects: string[] }>;
  bundle_refs?: string[];
}

export async function pullEntries(input: PullInput): Promise<EntryRow[]> {
  if (input.mode === "local") {
    const { localPullEntries } = await import("./local-store.js");
    return localPullEntries(input);
  }

  if (!input.skipAuth) await assertTokenValid(input.bundle_id);
  const sb = getSupabase();

  let query = sb
    .from("bundle_entry_refs")
    .select(`
      entry_id,
      cloud_session_entries!inner (
        id, created_at, event_type, trigger_ref, summary, files_touched, decisions, superseded_at,
        cloud_sessions!inner ( project_name )
      )
    `)
    .eq("bundle_id", input.bundle_id)
    .is("cloud_session_entries.superseded_at", null)
    .order("added_at", { ascending: false })
    .limit(input.limit ?? 20);

  if (input.since) {
    query = query.gt("cloud_session_entries.created_at", input.since);
  }

  const { data, error } = await query;
  if (error) throw new Error(`pullEntries failed: ${error.message}`);

  const rows = (data ?? []).map((r: any) => {
    const e = r.cloud_session_entries;
    return {
      id: e.id,
      created_at: e.created_at,
      project_name: e.cloud_sessions?.project_name ?? "unknown",
      event_type: e.event_type,
      trigger_ref: e.trigger_ref,
      summary: e.summary,
      files_touched: e.files_touched ?? [],
      decisions: e.decisions ?? [],
    } as EntryRow;
  });

  if (input.exclude_project) {
    return rows.filter((r) => r.project_name !== input.exclude_project);
  }
  return rows;
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

// Human/LLM-readable rendering of entries for context injection.
export function renderEntriesForClaude(entries: EntryRow[]): string {
  if (entries.length === 0) {
    return "No recent cross-project context.";
  }
  const parts = entries.map((e) => {
    const ts = new Date(e.created_at).toISOString();
    const lines = [
      `[${ts}] ${e.project_name} · ${e.event_type}${
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
  });
  return parts.join("\n\n---\n\n");
}
