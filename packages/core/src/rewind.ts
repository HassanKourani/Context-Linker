import { getSupabase } from "./supabase.js";
import { assertTokenValid } from "./bundles.js";
import { loadGlobalConfig } from "./config.js";

// ---------- Types ----------

export type RewindStrategy =
  | { kind: "since"; since: string }
  | { kind: "last_n"; count: number }
  | { kind: "entry_ids"; ids: string[] }
  | { kind: "after_ref"; trigger_ref: string };

export interface RewindInput {
  bundle_id: string;
  project_name?: string;
  strategy: RewindStrategy;
  reason?: string;
  dry_run?: boolean;
  // Safety cap: refuse rewinds larger than this unless force=true.
  max_affected?: number; // default 50
  force?: boolean;
}

export interface RewindCandidate {
  id: string;
  created_at: string;
  event_type: string;
  trigger_ref: string | null;
  summary_preview: string;
}

export interface RewindResult {
  applied: boolean;
  dry_run: boolean;
  affected_count: number;
  affected_entries: RewindCandidate[];
  rewind_log_id?: string;
  message?: string;
}

// ---------- Core ----------

/**
 * Find entries that would be rewound.
 * Queries cloud_session_entries joined with cloud_sessions.
 * If bundle_id is provided, scopes to entries referenced by that bundle via bundle_entry_refs.
 */
async function findCandidates(input: RewindInput): Promise<RewindCandidate[]> {
  const sb = getSupabase();

  // For bundle-scoped rewind, get all entry IDs referenced by this bundle first
  let bundleEntryIds: Set<string> | null = null;
  if (input.bundle_id) {
    const { data: refs, error: refErr } = await sb
      .from("bundle_entry_refs")
      .select("entry_id")
      .eq("bundle_id", input.bundle_id);
    if (refErr) throw new Error(`bundle refs lookup failed: ${refErr.message}`);
    bundleEntryIds = new Set((refs ?? []).map((r: any) => r.entry_id));
    if (bundleEntryIds.size === 0) return [];
  }

  // Pivot lookup for after_ref
  let sinceBound: string | null = null;
  if (input.strategy.kind === "after_ref") {
    if (!input.project_name) {
      throw new Error("after_ref strategy requires project_name.");
    }
    const { data: pivot, error } = await sb
      .from("cloud_session_entries")
      .select("created_at, cloud_sessions!inner(project_name)")
      .eq("trigger_ref", input.strategy.trigger_ref)
      .eq("cloud_sessions.project_name", input.project_name)
      .is("superseded_at", null)
      .maybeSingle();

    if (error) throw new Error(`pivot lookup failed: ${error.message}`);
    if (!pivot) {
      throw new Error(
        `No live entry with trigger_ref='${input.strategy.trigger_ref}' in project '${input.project_name}'.`
      );
    }
    sinceBound = (pivot as any).created_at;
  }

  const needsProjectScope = !!input.project_name;

  let q = sb
    .from("cloud_session_entries")
    .select(
      needsProjectScope
        ? "id, created_at, event_type, trigger_ref, summary, cloud_sessions!inner(project_name)"
        : "id, created_at, event_type, trigger_ref, summary"
    )
    .is("superseded_at", null)
    .order("created_at", { ascending: false });

  if (needsProjectScope) {
    q = q.eq("cloud_sessions.project_name", input.project_name!);
  }

  // If scoped to a bundle, filter to only referenced entries
  if (bundleEntryIds) {
    q = q.in("id", Array.from(bundleEntryIds));
  }

  switch (input.strategy.kind) {
    case "since":
      q = q.gte("created_at", input.strategy.since);
      break;
    case "last_n":
      q = q.limit(input.strategy.count);
      break;
    case "entry_ids":
      if (input.strategy.ids.length === 0) return [];
      q = q.in("id", input.strategy.ids);
      break;
    case "after_ref":
      q = q.gt("created_at", sinceBound!);
      break;
  }

  const { data, error } = await q;
  if (error) throw new Error(`candidate query failed: ${error.message}`);

  return (data ?? []).map((r: any) => ({
    id: r.id,
    created_at: r.created_at,
    event_type: r.event_type,
    trigger_ref: r.trigger_ref,
    summary_preview: (r.summary ?? "").slice(0, 160),
  }));
}

export async function rewindProject(input: RewindInput): Promise<RewindResult> {
  await assertTokenValid(input.bundle_id);
  const cfg = loadGlobalConfig();
  const sb = getSupabase();

  const maxAffected = input.max_affected ?? 50;
  const candidates = await findCandidates(input);

  if (candidates.length === 0) {
    return {
      applied: false,
      dry_run: !!input.dry_run,
      affected_count: 0,
      affected_entries: [],
      message: "No entries matched.",
    };
  }

  if (candidates.length > maxAffected && !input.force) {
    return {
      applied: false,
      dry_run: !!input.dry_run,
      affected_count: candidates.length,
      affected_entries: candidates,
      message: `Refusing to rewind ${candidates.length} entries (max ${maxAffected}). Pass force=true to override.`,
    };
  }

  if (input.dry_run) {
    return {
      applied: false,
      dry_run: true,
      affected_count: candidates.length,
      affected_entries: candidates,
    };
  }

  const ids = candidates.map((c) => c.id);
  const now = new Date().toISOString();

  // Soft-delete on cloud_session_entries.
  const { error: updErr } = await sb
    .from("cloud_session_entries")
    .update({ superseded_at: now })
    .in("id", ids);

  if (updErr) throw new Error(`soft-delete failed: ${updErr.message}`);

  // Audit log.
  const { data: log, error: logErr } = await sb
    .from("rewind_log")
    .insert({
      bundle_id: input.bundle_id,
      project_name: input.project_name ?? "",
      strategy_kind: input.strategy.kind,
      strategy_detail: input.strategy as any,
      affected_entry_ids: ids,
      affected_count: ids.length,
      reason: input.reason ?? null,
      performed_by: cfg.machine_id,
    })
    .select("id")
    .single();

  if (logErr) {
    return {
      applied: true,
      dry_run: false,
      affected_count: ids.length,
      affected_entries: candidates,
      message: `Rewind applied but audit log failed: ${logErr.message}`,
    };
  }

  return {
    applied: true,
    dry_run: false,
    affected_count: ids.length,
    affected_entries: candidates,
    rewind_log_id: log.id,
  };
}

// ---------- Restore ----------

export interface RestoreInput {
  bundle_id: string;
  project_name: string;
  entry_ids?: string[];
  rewind_log_id?: string;
}

export interface RestoreResult {
  restored_count: number;
  restored_ids: string[];
}

export async function restoreRewound(input: RestoreInput): Promise<RestoreResult> {
  await assertTokenValid(input.bundle_id);
  const sb = getSupabase();

  // If they passed a rewind_log_id, resolve that to the specific entry_ids.
  let targetIds: string[] | null = null;
  if (input.rewind_log_id) {
    const { data: log, error } = await sb
      .from("rewind_log")
      .select("affected_entry_ids, bundle_id, project_name")
      .eq("id", input.rewind_log_id)
      .single();
    if (error || !log) throw new Error("rewind_log_id not found.");
    if (log.bundle_id !== input.bundle_id || log.project_name !== input.project_name) {
      throw new Error("rewind_log_id does not match bundle/project scope.");
    }
    targetIds = log.affected_entry_ids ?? [];
  }

  // Pull currently-superseded entries scoped to this project.
  const { data: scoped, error: sErr } = await sb
    .from("cloud_session_entries")
    .select("id, cloud_sessions!inner(project_name)")
    .eq("cloud_sessions.project_name", input.project_name)
    .not("superseded_at", "is", null);

  if (sErr) throw new Error(`restore scope query failed: ${sErr.message}`);

  const eligible = new Set((scoped ?? []).map((r: any) => r.id));

  // If scoped to bundle, intersect with bundle refs
  if (input.bundle_id) {
    const { data: refs } = await sb
      .from("bundle_entry_refs")
      .select("entry_id")
      .eq("bundle_id", input.bundle_id);
    const bundleRefIds = new Set((refs ?? []).map((r: any) => r.entry_id));
    for (const id of eligible) {
      if (!bundleRefIds.has(id)) eligible.delete(id);
    }
  }

  let toRestore: string[];

  if (targetIds) {
    toRestore = targetIds.filter((id) => eligible.has(id));
  } else if (input.entry_ids) {
    toRestore = input.entry_ids.filter((id) => eligible.has(id));
  } else {
    toRestore = Array.from(eligible);
  }

  if (toRestore.length === 0) {
    return { restored_count: 0, restored_ids: [] };
  }

  const { error } = await sb
    .from("cloud_session_entries")
    .update({ superseded_at: null })
    .in("id", toRestore);

  if (error) throw new Error(`restore failed: ${error.message}`);

  return { restored_count: toRestore.length, restored_ids: toRestore };
}

// ---------- Rewind history ----------

export interface RewindLogRow {
  id: string;
  bundle_id: string;
  project_name: string;
  strategy_kind: string;
  strategy_detail: unknown;
  affected_count: number;
  reason: string | null;
  performed_by: string | null;
  performed_at: string;
}

export async function listRewinds(
  bundle_id: string,
  project_name?: string,
  limit = 20
): Promise<RewindLogRow[]> {
  await assertTokenValid(bundle_id);
  const sb = getSupabase();

  let q = sb
    .from("rewind_log")
    .select(
      "id, bundle_id, project_name, strategy_kind, strategy_detail, affected_count, reason, performed_by, performed_at"
    )
    .eq("bundle_id", bundle_id)
    .order("performed_at", { ascending: false })
    .limit(limit);

  if (project_name) q = q.eq("project_name", project_name);

  const { data, error } = await q;
  if (error) throw new Error(`listRewinds failed: ${error.message}`);
  return (data ?? []) as RewindLogRow[];
}
