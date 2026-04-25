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
  connectSessionToBundle,
  disconnectSessionFromBundle,
  disconnectCloudSessionFromBundle,
} from "./config.js";
import {
  addEntriesToBundle,
  removeEntryFromBundle,
  removeSessionEntriesFromBundle,
} from "./entries.js";
import {
  isLocalBundle,
  localAddEntriesToBundle,
  localRemoveSessionRefsFromBundle,
  localRemoveEntryRefsFromBundleByIds,
} from "./local-store.js";
import {
  copySessionToCloud,
  syncSessionToCloud,
  getCloudSessionEntries,
  deleteCloudSession,
} from "./cloud-sessions.js";
import { createBundle, deleteBundle, bundleStatus, getBundleTeamId } from "./bundles.js";

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
