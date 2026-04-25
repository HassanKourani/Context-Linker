/**
 * High-level session actions that orchestrate across config, entries, local-store,
 * and cloud-sessions. Used by CLI, MCP, and UI to avoid duplicating logic.
 */
import {
  listActiveSessions,
  loadActiveSession,
  saveActiveSession,
  getSessionEntries,
  disconnectSessionFromBundle,
  disconnectCloudSessionFromBundle,
} from "./config.js";
import { removeEntryFromBundle, removeSessionEntriesFromBundle } from "./entries.js";
import {
  isLocalBundle,
  localRemoveSessionRefsFromBundle,
  localRemoveEntryRefsFromBundleByIds,
} from "./local-store.js";
import { getCloudSessionEntries } from "./cloud-sessions.js";

/**
 * Unlink a session from a bundle: removes all entry refs from the bundle,
 * then disconnects the session. Works for both local and cloud bundles.
 *
 * sessionId can be either a local active session ID or a cloud session ID.
 * The function resolves both and cleans up all refs.
 *
 * This is the single source of truth for the "unlink/disconnect" action
 * across CLI, MCP, and UI.
 */
export async function unlinkSessionFromBundle(
  sessionId: string,
  bundleId: string
): Promise<void> {
  // Resolve whether sessionId is a local active session or a cloud session
  let localSessionId: string | null = null;
  let cloudSessionId: string | null = null;

  const directSession = loadActiveSession(sessionId);
  if (directSession) {
    localSessionId = sessionId;
    cloudSessionId = directSession.cloud_session_id ?? null;
  } else {
    // sessionId might be a cloud session ID — find its local counterpart
    cloudSessionId = sessionId;
    const match = listActiveSessions().find((s) =>
      s.cloud_session_id === sessionId ||
      (s.cloud_copies ?? []).some((c) => c.cloud_session_id === sessionId)
    );
    if (match) localSessionId = match.session_id;
  }

  const mode = directSession?.bundles.find((b) => b.bundle_id === bundleId)?.mode
    ?? (isLocalBundle(bundleId) ? "local" : "cloud");

  // Remove entry refs from the bundle
  if (mode === "local") {
    if (localSessionId) {
      localRemoveSessionRefsFromBundle(bundleId, localSessionId);
    }
    if (cloudSessionId) {
      localRemoveSessionRefsFromBundle(bundleId, cloudSessionId);
      // Fallback: remove by entry IDs from the cloud session
      // (in case entry_refs.session_id doesn't match either ID)
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
    // Also remove refs for local entries that were synced
    if (localSessionId) {
      const localEntries = getSessionEntries(localSessionId);
      for (const e of localEntries) {
        try { await removeEntryFromBundle(bundleId, e.id); } catch {}
      }
    }
  }

  // Disconnect the session from the bundle (try all known IDs)
  if (localSessionId) disconnectSessionFromBundle(localSessionId, bundleId);
  if (cloudSessionId && cloudSessionId !== localSessionId) {
    disconnectSessionFromBundle(cloudSessionId, bundleId);
  }
  disconnectCloudSessionFromBundle(sessionId, bundleId);
  if (localSessionId && localSessionId !== sessionId) {
    disconnectCloudSessionFromBundle(localSessionId, bundleId);
  }

  // Update the active session's bundles array
  if (directSession) {
    directSession.bundles = directSession.bundles.filter((b) => b.bundle_id !== bundleId);
    saveActiveSession(directSession);
  }
}
