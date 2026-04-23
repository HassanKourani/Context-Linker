import { getSupabase } from "./supabase.js";
import {
  loadGlobalConfig,
  loadActiveSession,
  getSessionEntries,
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
 * Copy a local session to the cloud as an independent snapshot.
 * Creates a new cloud_sessions row + new cloud_session_entries with fresh UUIDs.
 * The local session is NOT modified — no link between local and cloud after copy.
 * Returns the cloud session ID and the new cloud entry IDs (for adding to bundles).
 */
export async function copySessionToCloud(
  sessionId: string,
  teamId: string
): Promise<{ cloud_session_id: string; cloud_entry_ids: string[]; entries_copied: number }> {
  await assertTeamMember(teamId);
  const cfg = loadGlobalConfig();
  const session = loadActiveSession(sessionId);
  if (!session) throw new Error(`Active session ${sessionId} not found.`);

  const sb = getSupabase();

  // Create cloud session
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

  // Copy all local entries with NEW UUIDs (independent copies)
  const localEntries = getSessionEntries(sessionId);
  const cloudEntryIds: string[] = [];

  if (localEntries.length > 0) {
    const rows = localEntries.map((e) => {
      const newId = crypto.randomUUID();
      cloudEntryIds.push(newId);
      return {
        id: newId,
        session_id: cloudSession.id,
        event_type: e.event_type,
        trigger_ref: e.trigger_ref,
        summary: e.summary,
        files_touched: e.files_touched,
        decisions: e.decisions,
        created_at: e.created_at,
      };
    });

    const { error: entriesError } = await sb
      .from("cloud_session_entries")
      .insert(rows);

    if (entriesError) throw new Error(`Failed to copy entries: ${entriesError.message}`);
  }

  // Local session is NOT modified — no cloud_session_id, no team_id.
  // The two are completely independent from this point.

  return {
    cloud_session_id: cloudSession.id,
    cloud_entry_ids: cloudEntryIds,
    entries_copied: localEntries.length,
  };
}

/**
 * Delete a cloud session entry. Cascades removal from all bundle_entry_refs.
 */
export async function deleteCloudSessionEntry(entryId: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("cloud_session_entries")
    .delete()
    .eq("id", entryId);
  if (error) throw new Error(`deleteCloudSessionEntry failed: ${error.message}`);
}

/**
 * Delete a cloud session and all its entries (cascades via FK).
 */
export async function deleteCloudSession(cloudSessionId: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("cloud_sessions")
    .delete()
    .eq("id", cloudSessionId);
  if (error) throw new Error(`deleteCloudSession failed: ${error.message}`);
}

/**
 * List all cloud sessions for a team.
 */
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

/**
 * Get cloud session entries.
 */
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

/**
 * Get which bundles reference a given entry.
 */
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
