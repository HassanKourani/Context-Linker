/**
 * High-level session actions that orchestrate across config, entries, local-store,
 * and cloud-sessions. Used by CLI, MCP, and UI to avoid duplicating logic.
 */
import {
  listActiveSessions,
  loadActiveSession,
  saveActiveSession,
  deleteActiveSession,
  getSessionEntries,
  deleteSessionEntry,
  renameActiveSession,
  connectSessionToBundle,
  disconnectSessionFromBundle,
  disconnectCloudSessionFromBundle,
  getCloudSessionBundleConnections,
  resolveClaudeSessionId,
  getActiveSessionId,
  pushSessionEntry,
} from "./config.js";
import { getSupabase } from "./supabase.js";
import {
  addEntriesToBundle,
  removeEntryFromBundle,
  removeSessionEntriesFromBundle,
} from "./entries.js";
import {
  isLocalBundle,
  localAddEntriesToBundle,
  localRemoveEntryFromBundle,
  localRemoveSessionRefsFromBundle,
  localRemoveEntryRefsFromBundleByIds,
  localRewindProject,
  localRestoreRewound,
  localListRewinds,
} from "./local-store.js";
import {
  copySessionToCloud,
  syncSessionToCloud,
  getCloudSessionEntries,
  deleteCloudSession,
  deleteCloudSessionEntry,
  renameCloudSession,
  listTeamSessions,
} from "./cloud-sessions.js";
import {
  createBundle,
  deleteBundle,
  bundleStatus,
  getBundleTeamId,
} from "./bundles.js";
import {
  rewindProject,
  restoreRewound,
  listRewinds,
  type RewindInput,
  type RestoreInput,
  type RewindResult,
  type RestoreResult,
  type RewindLogRow,
} from "./rewind.js";
import { listMyTeams } from "./teams.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

type CloudCopy = { cloud_session_id: string; team_id: string };

/**
 * Ensure a local session has a cloud copy in the given team.
 * Creates one if it doesn't exist, syncs new entries if it does.
 * Returns the cloud copy info. Mutates and saves the session.
 */
export async function ensureCloudCopy(
  sessionId: string,
  teamId: string
): Promise<CloudCopy> {
  const session = loadActiveSession(sessionId);
  if (!session) throw new Error(`Active session ${sessionId} not found.`);

  const copies = session.cloud_copies ?? [];
  let copy: CloudCopy | null = copies.find((c) => c.team_id === teamId)
    ?? (session.cloud_session_id && session.team_id === teamId
      ? { cloud_session_id: session.cloud_session_id, team_id: teamId }
      : null);

  if (!copy) {
    const result = await copySessionToCloud(sessionId, teamId);
    if (!session.cloud_copies) session.cloud_copies = [];
    session.cloud_copies.push({ cloud_session_id: result.cloud_session_id, team_id: teamId });
    if (!session.cloud_session_id) {
      session.cloud_session_id = result.cloud_session_id;
      session.team_id = teamId;
    }
    saveActiveSession(session);
    copy = { cloud_session_id: result.cloud_session_id, team_id: teamId };
  } else {
    await syncSessionToCloud(sessionId, copy.cloud_session_id);
  }

  return copy;
}

// ─── Unlink ─────────────────────────────────────────────────────────────────

/**
 * Unlink a session from a bundle: removes all entry refs from the bundle,
 * then disconnects the session. Works for both local and cloud bundles.
 *
 * sessionId can be either a local active session ID or a cloud session ID.
 * The function resolves both and cleans up all refs.
 */
export async function unlinkSessionFromBundle(
  sessionId: string,
  bundleId: string
): Promise<void> {
  let localSessionId: string | null = null;
  let cloudSessionId: string | null = null;

  const directSession = loadActiveSession(sessionId);
  if (directSession) {
    localSessionId = sessionId;
    cloudSessionId = directSession.cloud_session_id ?? null;
  } else {
    cloudSessionId = sessionId;
    const match = listActiveSessions().find((s) =>
      s.cloud_session_id === sessionId ||
      (s.cloud_copies ?? []).some((c) => c.cloud_session_id === sessionId)
    );
    if (match) localSessionId = match.session_id;
  }

  const mode = directSession?.bundles.find((b) => b.bundle_id === bundleId)?.mode
    ?? (isLocalBundle(bundleId) ? "local" : "cloud");

  if (mode === "local") {
    if (localSessionId) {
      localRemoveSessionRefsFromBundle(bundleId, localSessionId);
    }
    if (cloudSessionId) {
      localRemoveSessionRefsFromBundle(bundleId, cloudSessionId);
      try {
        const cloudEntries = await getCloudSessionEntries(cloudSessionId);
        if (cloudEntries.length > 0) {
          localRemoveEntryRefsFromBundleByIds(bundleId, cloudEntries.map(e => e.id));
        }
      } catch {}
    }
  } else {
    if (cloudSessionId) {
      await removeSessionEntriesFromBundle(bundleId, cloudSessionId);
    }
    if (localSessionId) {
      const localEntries = getSessionEntries(localSessionId);
      for (const e of localEntries) {
        try { await removeEntryFromBundle(bundleId, e.id); } catch {}
      }
    }
  }

  if (localSessionId) disconnectSessionFromBundle(localSessionId, bundleId);
  if (cloudSessionId && cloudSessionId !== localSessionId) {
    disconnectSessionFromBundle(cloudSessionId, bundleId);
  }
  disconnectCloudSessionFromBundle(sessionId, bundleId);
  if (localSessionId && localSessionId !== sessionId) {
    disconnectCloudSessionFromBundle(localSessionId, bundleId);
  }

  if (directSession) {
    directSession.bundles = directSession.bundles.filter((b) => b.bundle_id !== bundleId);
    saveActiveSession(directSession);
  }
}

// ─── Delete Session ─────────────────────────────────────────────────────────

/**
 * Delete a session and all its cloud copies.
 * sessionId can be a local active session ID or a cloud session ID.
 *
 * - Local session: deletes all cloud copies from Supabase, then the local session.
 * - Cloud session: deletes from Supabase, removes from the linked local session's
 *   cloud_copies array (promotes next copy to legacy field if needed).
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const localSession = loadActiveSession(sessionId);

  if (localSession) {
    // Deleting a local active session — also delete all cloud copies
    for (const c of (localSession.cloud_copies ?? [])) {
      try { await deleteCloudSession(c.cloud_session_id); } catch {}
    }
    if (localSession.cloud_session_id) {
      try { await deleteCloudSession(localSession.cloud_session_id); } catch {}
    }
    deleteActiveSession(sessionId);
  } else {
    // sessionId is a cloud session ID — only delete from Supabase, keep local
    try { await deleteCloudSession(sessionId); } catch {}

    // Remove from cloud_copies on any local session that had this cloud copy
    const allSessions = listActiveSessions();
    const linked = allSessions.find((s) =>
      s.cloud_session_id === sessionId ||
      (s.cloud_copies ?? []).some((c) => c.cloud_session_id === sessionId)
    );
    if (linked) {
      linked.cloud_copies = (linked.cloud_copies ?? []).filter(
        (c) => c.cloud_session_id !== sessionId
      );
      if (linked.cloud_session_id === sessionId) {
        const next = linked.cloud_copies[0] ?? null;
        linked.cloud_session_id = next?.cloud_session_id ?? null;
        linked.team_id = next?.team_id ?? null;
      }
      saveActiveSession(linked);
    }
  }
}

// ─── Push Entries to Bundle ─────────────────────────────────────────────────

export type PushToBundleResult = {
  pushed: number;
  skipped: number;
  total: number;
};

/**
 * Push session entries to a bundle. Handles local and cloud bundles,
 * local and cloud sessions, and the local→cloud ID mapping.
 *
 * - Local session → local bundle: adds refs directly.
 * - Local session → cloud bundle: ensures cloud copy, maps IDs, adds refs.
 * - Cloud session → any bundle: uses cloud entry IDs directly.
 *
 * Also ensures the session is connected to the bundle.
 */
export async function pushSessionToBundle(
  sessionId: string,
  bundleId: string,
  entryIds?: string[],
): Promise<PushToBundleResult> {
  const mode = isLocalBundle(bundleId) ? "local" : "cloud";
  const localSession = loadActiveSession(sessionId);

  if (localSession) {
    // Ensure session is connected to this bundle
    try { connectSessionToBundle(sessionId, bundleId, mode); } catch {}

    const allEntries = getSessionEntries(sessionId);
    const ids = entryIds ?? allEntries.map((e) => e.id);

    if (mode === "local") {
      const result = localAddEntriesToBundle(bundleId, ids, sessionId);
      return { pushed: result.added, skipped: result.skipped, total: ids.length };
    }

    // Cloud bundle — ensure cloud copy, map IDs
    const bundleTeamId = await getBundleTeamId(bundleId);
    if (!bundleTeamId) throw new Error("Could not determine the bundle's team.");

    const copy = await ensureCloudCopy(sessionId, bundleTeamId);

    // Map local entry IDs → cloud entry IDs by created_at + summary
    const cloudEntries = await getCloudSessionEntries(copy.cloud_session_id);
    let cloudIds: string[];
    if (entryIds) {
      const selectedLocal = allEntries.filter((e) => ids.includes(e.id));
      const selectedKeys = new Set(
        selectedLocal.map((e) => `${new Date(e.created_at).getTime()}|${e.summary}`)
      );
      cloudIds = cloudEntries
        .filter((e) => selectedKeys.has(`${new Date(e.created_at).getTime()}|${e.summary}`))
        .map((e) => e.id);
    } else {
      cloudIds = cloudEntries.map((e) => e.id);
    }

    if (cloudIds.length > 0) {
      await addEntriesToBundle(bundleId, cloudIds);
    }
    return { pushed: cloudIds.length, skipped: 0, total: cloudIds.length };
  }

  // Cloud session — use cloud entry IDs directly
  const cloudEntries = await getCloudSessionEntries(sessionId);
  const ids = entryIds ?? cloudEntries.map((e) => e.id);

  if (mode === "local") {
    const result = localAddEntriesToBundle(bundleId, ids, sessionId);
    return { pushed: result.added, skipped: result.skipped, total: ids.length };
  } else {
    if (ids.length > 0) {
      await addEntriesToBundle(bundleId, ids);
    }
    return { pushed: ids.length, skipped: 0, total: ids.length };
  }
}

// ─── Add a manual note to a bundle ──────────────────────────────────────────

export interface AddBundleNoteInput {
  bundle_id: string;
  project_name: string;
  summary: string;
  event_type?: string;
  trigger_ref?: string | null;
  files_touched?: string[];
  decisions?: Array<{ decision: string; rationale?: string; affects: string[] }>;
}

export interface AddBundleNoteResult {
  bundle_id: string;
  session_id: string;
  entry_id: string;
}

/**
 * Add a manual note entry to a bundle from the UI/CLI.
 * Entries live in sessions, so we resolve a session for the given project,
 * create the entry there, and reference it from the bundle.
 *
 * Resolution order for the host session:
 *  1. Active local session for `project_name` already connected to the bundle.
 *  2. Any active local session for `project_name`.
 *  3. (cloud bundle only) A cloud session for `project_name` in the bundle's team.
 */
export async function addBundleNote(
  input: AddBundleNoteInput,
): Promise<AddBundleNoteResult> {
  const projectName = input.project_name?.trim();
  const summary = input.summary?.trim();
  if (!projectName) throw new Error("project_name is required.");
  if (!summary) throw new Error("summary is required.");

  const bundleId = input.bundle_id;
  const mode = isLocalBundle(bundleId) ? "local" : "cloud";
  const eventType = input.event_type ?? "manual";
  const triggerRef = input.trigger_ref ?? null;
  const filesTouched = input.files_touched ?? [];
  const decisions = input.decisions ?? [];

  const activeSessions = listActiveSessions();
  const connected = activeSessions.find(
    (s) =>
      s.project_name === projectName &&
      s.bundles.some((b) => b.bundle_id === bundleId),
  );
  let hostSessionId: string | null = connected?.session_id ?? null;
  let useCloudHost = false;

  if (!hostSessionId) {
    const anyLocal = activeSessions.find((s) => s.project_name === projectName);
    if (anyLocal) hostSessionId = anyLocal.session_id;
  }

  if (!hostSessionId && mode === "cloud") {
    const teamId = await getBundleTeamId(bundleId);
    if (teamId) {
      const cloudSessions = await listTeamSessions(teamId);
      const cs = cloudSessions.find((s) => s.project_name === projectName);
      if (cs) {
        hostSessionId = cs.id;
        useCloudHost = true;
      }
    }
  }

  if (!hostSessionId) {
    throw new Error(
      `No session found for project "${projectName}". Start a session in that project first.`,
    );
  }

  let entryId: string;
  if (useCloudHost) {
    const sb = getSupabase();
    const newId = crypto.randomUUID();
    const { error } = await sb.from("cloud_session_entries").insert({
      id: newId,
      session_id: hostSessionId,
      event_type: eventType,
      trigger_ref: triggerRef,
      summary,
      files_touched: filesTouched,
      decisions,
    });
    if (error) throw new Error(`Failed to create note entry: ${error.message}`);
    entryId = newId;
  } else {
    const entry = pushSessionEntry(hostSessionId, {
      project_name: projectName,
      event_type: eventType,
      trigger_ref: triggerRef,
      summary,
      files_touched: filesTouched,
      decisions,
    });
    entryId = entry.id;
  }

  await pushSessionToBundle(hostSessionId, bundleId, [entryId]);

  return { bundle_id: bundleId, session_id: hostSessionId, entry_id: entryId };
}

// ─── Migrate Local Bundle to Cloud ──────────────────────────────────────────

export type PushBundleToCloudResult = {
  new_bundle_id: string;
  entries_migrated: number;
};

/**
 * Migrate a local bundle to cloud under a team.
 * Creates a new cloud bundle, ensures cloud copies for all connected sessions,
 * migrates entry refs, swaps connections, and deletes the old local bundle.
 */
export async function pushBundleToCloud(
  bundleId: string,
  teamId: string
): Promise<PushBundleToCloudResult> {
  if (!isLocalBundle(bundleId)) throw new Error("Bundle is already in the cloud.");

  const status = await bundleStatus(bundleId, "local", true);
  const newBundle = await createBundle(status.name, "cloud", teamId);
  const newBundleId = newBundle.bundle_id;
  let entriesMigrated = 0;

  // Migrate entries from connected active sessions
  const activeSessions = listActiveSessions();
  const connectedActive = activeSessions.filter(
    (s) => s.bundles.some((b) => b.bundle_id === bundleId)
  );

  for (const session of connectedActive) {
    const entries = getSessionEntries(session.session_id);
    if (entries.length === 0) continue;

    const copy = await ensureCloudCopy(session.session_id, teamId);

    const cloudEntries = await getCloudSessionEntries(copy.cloud_session_id);
    const cloudIds = cloudEntries.map((e) => e.id);
    if (cloudIds.length > 0) {
      const result = await addEntriesToBundle(newBundleId, cloudIds);
      entriesMigrated += result.added;
    }

    // Swap connection: disconnect from old local bundle, connect to new cloud bundle
    disconnectSessionFromBundle(session.session_id, bundleId);
    connectSessionToBundle(session.session_id, newBundleId, "cloud");
  }

  // Delete the old local bundle
  await deleteBundle(bundleId, "local");

  return { new_bundle_id: newBundleId, entries_migrated: entriesMigrated };
}

// ─── Pull entries from all connected sessions into a bundle ─────────────────

export type PullFromSessionsResult = {
  pushed: number;
  skipped: number;
};

/**
 * Pull entries from every session connected to a bundle into that bundle.
 *
 * For each active session connected to the bundle:
 *  - Local bundle  → add session entries as local refs.
 *  - Cloud bundle  → ensure a cloud copy of the session exists in the
 *                    bundle's team, then add the cloud entries as refs.
 *
 * For cloud bundles, also pull entries from any cloud-only sessions
 * (i.e. sessions that exist on Supabase but have no local active record)
 * that are connected to the bundle.
 *
 * Idempotent: re-running adds nothing new, returns 0/0.
 */
export async function pullEntriesFromConnectedSessions(
  bundleId: string,
): Promise<PullFromSessionsResult> {
  const mode = isLocalBundle(bundleId) ? "local" : "cloud";
  let pushed = 0;
  let skipped = 0;

  const connectedActive = listActiveSessions().filter(
    (s) => s.bundles.some((b) => b.bundle_id === bundleId),
  );

  for (const session of connectedActive) {
    const entries = getSessionEntries(session.session_id);
    if (entries.length === 0) continue;
    const entryIds = entries.map((e) => e.id);

    if (mode === "local") {
      const r = localAddEntriesToBundle(bundleId, entryIds, session.session_id);
      pushed += r.added;
      skipped += r.skipped;
      continue;
    }

    const bundleTeamId = await getBundleTeamId(bundleId);
    if (!bundleTeamId) continue;

    const copy = await ensureCloudCopy(session.session_id, bundleTeamId);
    const cloudEntries = await getCloudSessionEntries(copy.cloud_session_id);
    const cloudIds = cloudEntries.map((e) => e.id);
    if (cloudIds.length > 0) {
      const r = await addEntriesToBundle(bundleId, cloudIds);
      pushed += r.added;
      skipped += r.skipped;
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
          const r = await addEntriesToBundle(bundleId, cloudIds);
          pushed += r.added;
          skipped += r.skipped;
        }
      }
    }
  }

  return { pushed, skipped };
}

// ─── Session rename / delete-entry with cloud cascade ───────────────────────

/**
 * Rename a local session and cascade the new name to all of its cloud
 * copies (and the legacy `cloud_session_id` field, if set).
 *
 * Cloud rename failures are swallowed — the local rename is the source
 * of truth and we don't want a transient Supabase error to block it.
 */
export async function renameSessionAndCloudCopies(
  sessionId: string,
  name: string | null,
): Promise<void> {
  const session = loadActiveSession(sessionId);
  if (!session) throw new Error(`Active session ${sessionId} not found.`);

  renameActiveSession(sessionId, name);

  for (const c of (session.cloud_copies ?? [])) {
    try { await renameCloudSession(c.cloud_session_id, name); } catch {}
  }
  if (session.cloud_session_id) {
    try { await renameCloudSession(session.cloud_session_id, name); } catch {}
  }
}

/**
 * Delete a single entry from a local session and cascade the deletion to
 * the matching entry in every cloud copy. Cloud deletion is best-effort.
 */
export async function deleteSessionEntryAndCopies(
  sessionId: string,
  entryId: string,
): Promise<void> {
  const session = loadActiveSession(sessionId);
  if (!session) throw new Error(`Active session ${sessionId} not found.`);

  deleteSessionEntry(sessionId, entryId);

  if ((session.cloud_copies?.length ?? 0) > 0 || session.cloud_session_id) {
    try { await deleteCloudSessionEntry(entryId); } catch {}
  }
}

// ─── Bundle mode-aware wrappers ─────────────────────────────────────────────

/**
 * Remove a single entry-ref from a bundle, dispatching to the local or
 * cloud implementation based on the bundle's storage mode.
 */
export async function bundleRemoveEntryRef(
  bundleId: string,
  entryId: string,
  options?: { exclude?: boolean; machineId?: string },
): Promise<void> {
  if (isLocalBundle(bundleId)) {
    localRemoveEntryFromBundle(bundleId, entryId, { exclude: options?.exclude });
    return;
  }
  await removeEntryFromBundle(bundleId, entryId, {
    exclude: options?.exclude,
    machineId: options?.machineId,
  });
}

/** Rewind entries in a bundle. Dispatches to the local or cloud rewind based on storage mode. */
export async function bundleRewind(input: RewindInput): Promise<RewindResult> {
  return isLocalBundle(input.bundle_id)
    ? localRewindProject(input)
    : await rewindProject(input);
}

/** Restore previously-rewound entries. Dispatches by storage mode. */
export async function bundleRestore(input: RestoreInput): Promise<RestoreResult> {
  return isLocalBundle(input.bundle_id)
    ? localRestoreRewound(input)
    : await restoreRewound(input);
}

/** List rewind history for a bundle. Dispatches by storage mode. */
export async function bundleListRewinds(
  bundleId: string,
  projectName?: string,
  limit?: number,
): Promise<RewindLogRow[]> {
  return isLocalBundle(bundleId)
    ? localListRewinds(bundleId, projectName, limit)
    : await listRewinds(bundleId, projectName, limit);
}

// ─── Caller resolution (CLI / generic) ──────────────────────────────────────

/**
 * Resolve which session a CLI invocation belongs to.
 *
 * Order:
 *  1. Explicit ID (e.g. --session-id flag).
 *  2. Process-tree walk → Claude Code session UUID. When the CLI is run
 *     by Claude Code's Bash tool, the calling Claude window is one or
 *     two levels up. The active-session record is keyed by that UUID.
 *  3. Per-cwd marker file. Used only outside of Claude Code (plain
 *     shell), where there's no upstream window to identify.
 */
export function resolveCallerSessionId(explicitId?: string): string | null {
  if (explicitId) return explicitId;

  const claudeUUID = resolveClaudeSessionId();
  if (claudeUUID) {
    const session = loadActiveSession(claudeUUID);
    if (session) return claudeUUID;
  }

  return getActiveSessionId();
}
