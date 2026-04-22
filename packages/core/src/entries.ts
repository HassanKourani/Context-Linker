import { getSupabase } from "./supabase.js";
import { assertTokenValid } from "./bundles.js";
import { summarizeContext } from "./summarize.js";
import { loadGlobalConfig } from "./config.js";

export interface PushInput {
  bundle_id: string;
  project_name: string;
  event_type: "commit" | "pr_open" | "manual" | "session_end";
  trigger_ref?: string | null;
  raw_context: string;
  store_raw?: boolean; // default false; raw diffs can be large
  model?: string;
}

export interface PushResult {
  entry_id: string;
  summary: string;
  files_touched: string[];
  decisions: Array<{ decision: string; rationale?: string; affects: string[] }>;
}

export async function pushEntry(input: PushInput): Promise<PushResult> {
  await assertTokenValid(input.bundle_id);
  const cfg = loadGlobalConfig();
  const sb = getSupabase();

  // Summarize locally (always, in MVP).
  const summary = await summarizeContext({
    project_name: input.project_name,
    event_type: input.event_type,
    trigger_ref: input.trigger_ref ?? null,
    raw_context: input.raw_context,
    model: input.model,
  });

  // Find this machine's most recent session for this bundle, or create one.
  let sessionId: string | null = null;
  {
    const { data: s } = await sb
      .from("sessions")
      .select("id")
      .eq("bundle_id", input.bundle_id)
      .eq("machine_id", cfg.machine_id)
      .eq("project_name", input.project_name)
      .order("last_active_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (s) {
      sessionId = s.id;
      await sb
        .from("sessions")
        .update({ last_active_at: new Date().toISOString() })
        .eq("id", s.id);
    } else {
      const { data: inserted, error } = await sb
        .from("sessions")
        .insert({
          bundle_id: input.bundle_id,
          project_name: input.project_name,
          machine_id: cfg.machine_id,
        })
        .select("id")
        .single();
      if (error) throw new Error(`session create failed: ${error.message}`);
      sessionId = inserted.id;
    }
  }

  const { data, error } = await sb
    .from("entries")
    .insert({
      bundle_id: input.bundle_id,
      session_id: sessionId,
      event_type: input.event_type,
      trigger_ref: input.trigger_ref ?? null,
      summary: summary.summary,
      files_touched: summary.files_touched,
      decisions: summary.decisions,
      raw_context: input.store_raw ? input.raw_context : null,
    })
    .select("id")
    .single();

  if (error) throw new Error(`pushEntry failed: ${error.message}`);

  return {
    entry_id: data.id,
    summary: summary.summary,
    files_touched: summary.files_touched,
    decisions: summary.decisions,
  };
}

export interface PullInput {
  bundle_id: string;
  since?: string | null;    // ISO timestamp
  limit?: number;           // default 20
  exclude_project?: string; // useful: "don't show me my own project's entries"
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
}

export async function pullEntries(input: PullInput): Promise<EntryRow[]> {
  await assertTokenValid(input.bundle_id);
  const sb = getSupabase();

  let query = sb
    .from("entries")
    .select(
      "id, created_at, event_type, trigger_ref, summary, files_touched, decisions, sessions(project_name)"
    )
    .eq("bundle_id", input.bundle_id)
    .is("superseded_at", null) // hide rewound entries from all future pulls
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 20);

  if (input.since) {
    query = query.gt("created_at", input.since);
  }

  const { data, error } = await query;
  if (error) throw new Error(`pullEntries failed: ${error.message}`);

  const rows = (data ?? []).map((r: any) => ({
    id: r.id,
    created_at: r.created_at,
    project_name: r.sessions?.project_name ?? "unknown",
    event_type: r.event_type,
    trigger_ref: r.trigger_ref,
    summary: r.summary,
    files_touched: r.files_touched ?? [],
    decisions: r.decisions ?? [],
  })) as EntryRow[];

  if (input.exclude_project) {
    return rows.filter((r) => r.project_name !== input.exclude_project);
  }
  return rows;
}

// Human/LLM-readable rendering of entries for context injection.
export function renderEntriesForClaude(entries: EntryRow[]): string {
  if (entries.length === 0) {
    return "No recent cross-project context.";
  }
  const parts = entries.map((e) => {
    const lines = [
      `[${e.created_at}] ${e.project_name} · ${e.event_type}${
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
          `  - ${d.decision}${d.affects.length ? ` [affects: ${d.affects.join(", ")}]` : ""}`
        );
      }
    }
    return lines.join("\n");
  });
  return parts.join("\n\n---\n\n");
}
