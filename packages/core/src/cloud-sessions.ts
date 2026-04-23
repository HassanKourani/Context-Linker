import { getSupabase } from "./supabase.js";
import {
  loadGlobalConfig,
  loadActiveSession,
  saveActiveSession,
  getSessionEntries,
  type ActiveSession,
  type SessionEntry,
} from "./config.js";
import { assertTeamMember } from "./teams.js";

export interface CloudSession {
  id: string;
  team_id: string;
  project_name: string;
  project_path: string | null;
  machine_id: string;
  branch: string | null;
  started_at: string;
  last_active_at: string;
}

export interface CloudSessionEntry {
  id: string;
  session_id: string;
  event_type: string;
  trigger_ref: string | null;
  summary: string;
  files_touched: string[];
  decisions: Array<{ decision: string; rationale?: string; affects: string[] }>;
  created_at: string;
  superseded_at: string | null;
}

/**
 * Promote a local session to cloud. Creates cloud_sessions + cloud_session_entries rows.
 * Updates the local ActiveSession with cloud_session_id and team_id.
 */
export async function pushSessionToCloud(
  sessionId: string,
  teamId: string
): Promise<{ cloud_session_id: string; entries_synced: number }> {
  await assertTeamMember(teamId);
  const cfg = loadGlobalConfig();
  const session = loadActiveSession(sessionId);
  if (!session) throw new Error(`Active session ${sessionId} not found.`);

  if (session.cloud_session_id && session.team_id === teamId) {
    const synced = await syncNewEntries(session);
    return { cloud_session_id: session.cloud_session_id, entries_synced: synced };
  }

  const sb = getSupabase();

  const { data: cloudSession, error: sessionError } = await sb
    .from("cloud_sessions")
    .insert({
      team_id: teamId,
      project_name: session.project_name,
      project_path: session.project_path,
      machine_id: cfg.machine_id,
      branch: session.branch,
      started_at: session.started_at,
    })
    .select("id")
    .single();

  if (sessionError) throw new Error(`Failed to create cloud session: ${sessionError.message}`);

  const localEntries = getSessionEntries(sessionId);
  let entriesSynced = 0;

  if (localEntries.length > 0) {
    const rows = localEntries.map((e) => ({
      id: e.id,
      session_id: cloudSession.id,
      event_type: e.event_type,
      trigger_ref: e.trigger_ref,
      summary: e.summary,
      files_touched: e.files_touched,
      decisions: e.decisions,
      created_at: e.created_at,
    }));

    const { error: entriesError } = await sb
      .from("cloud_session_entries")
      .upsert(rows, { onConflict: "id" });

    if (entriesError) throw new Error(`Failed to sync entries: ${entriesError.message}`);
    entriesSynced = rows.length;
  }

  session.cloud_session_id = cloudSession.id;
  session.team_id = teamId;
  saveActiveSession(session);

  return { cloud_session_id: cloudSession.id, entries_synced: entriesSynced };
}

export async function syncNewEntries(session: ActiveSession): Promise<number> {
  if (!session.cloud_session_id) return 0;

  const sb = getSupabase();
  const localEntries = getSessionEntries(session.session_id);

  const { data: existing } = await sb
    .from("cloud_session_entries")
    .select("id")
    .eq("session_id", session.cloud_session_id);

  const existingIds = new Set((existing ?? []).map((e: any) => e.id));
  const newEntries = localEntries.filter((e) => !existingIds.has(e.id));

  if (newEntries.length === 0) return 0;

  const rows = newEntries.map((e) => ({
    id: e.id,
    session_id: session.cloud_session_id!,
    event_type: e.event_type,
    trigger_ref: e.trigger_ref,
    summary: e.summary,
    files_touched: e.files_touched,
    decisions: e.decisions,
    created_at: e.created_at,
  }));

  const { error } = await sb
    .from("cloud_session_entries")
    .upsert(rows, { onConflict: "id" });

  if (error) throw new Error(`syncNewEntries failed: ${error.message}`);

  await sb
    .from("cloud_sessions")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", session.cloud_session_id);

  return newEntries.length;
}

export async function syncEntryToCloud(
  session: ActiveSession,
  entry: SessionEntry
): Promise<void> {
  if (!session.cloud_session_id) return;

  const sb = getSupabase();
  const { error } = await sb
    .from("cloud_session_entries")
    .upsert(
      {
        id: entry.id,
        session_id: session.cloud_session_id,
        event_type: entry.event_type,
        trigger_ref: entry.trigger_ref,
        summary: entry.summary,
        files_touched: entry.files_touched,
        decisions: entry.decisions,
        created_at: entry.created_at,
      },
      { onConflict: "id" }
    );

  if (error) throw new Error(`syncEntryToCloud failed: ${error.message}`);

  await sb
    .from("cloud_sessions")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", session.cloud_session_id);
}

export async function deleteCloudSessionEntry(entryId: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("cloud_session_entries")
    .delete()
    .eq("id", entryId);
  if (error) throw new Error(`deleteCloudSessionEntry failed: ${error.message}`);
}

export async function deleteCloudSession(cloudSessionId: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("cloud_sessions")
    .delete()
    .eq("id", cloudSessionId);
  if (error) throw new Error(`deleteCloudSession failed: ${error.message}`);
}

export async function listTeamSessions(teamId: string): Promise<CloudSession[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("cloud_sessions")
    .select("*")
    .eq("team_id", teamId)
    .order("last_active_at", { ascending: false });

  if (error) throw new Error(`listTeamSessions failed: ${error.message}`);
  return (data ?? []) as CloudSession[];
}

export async function getCloudSessionEntries(
  cloudSessionId: string,
  includeSuperseded = false
): Promise<CloudSessionEntry[]> {
  const sb = getSupabase();
  let query = sb
    .from("cloud_session_entries")
    .select("*")
    .eq("session_id", cloudSessionId)
    .order("created_at", { ascending: false });

  if (!includeSuperseded) {
    query = query.is("superseded_at", null);
  }

  const { data, error } = await query;
  if (error) throw new Error(`getCloudSessionEntries failed: ${error.message}`);
  return (data ?? []) as CloudSessionEntry[];
}

export async function getEntryBundleRefs(
  entryId: string
): Promise<Array<{ bundle_id: string; added_at: string }>> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("bundle_entry_refs")
    .select("bundle_id, added_at")
    .eq("entry_id", entryId);
  if (error) throw new Error(`getEntryBundleRefs failed: ${error.message}`);
  return (data ?? []) as Array<{ bundle_id: string; added_at: string }>;
}
