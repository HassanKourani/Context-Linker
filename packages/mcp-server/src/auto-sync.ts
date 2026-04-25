import {
  getUnpushedSessionEntries,
  loadActiveSession,
  markSessionEntriesPushed,
  isLocalBundle,
  consolidateEntries,
  getExcludedEntryIds,
  localGetExcludedEntryIds,
  pushSessionToBundle,
} from "@ctx-link/core";

const SETTLE_MS = 20_000; // 20 seconds of no hook activity = settled
const MIN_INTERVAL_MS = 180_000; // 3 minutes minimum between pushes

export { SETTLE_MS, MIN_INTERVAL_MS };

export interface AutoSyncHandle {
  /** Call this every time a hook event fires (file edit, commit, etc.) */
  recordActivity(): void;
  /** Stop the auto-sync loop */
  stop(): void;
}

/**
 * Options for startAutoSync — mainly used for injecting test doubles.
 */
export interface AutoSyncOptions {
  /** Override Date.now() for testing */
  now?: () => number;
}

/**
 * Start the auto-sync loop for a session.
 * Pushes unpushed entries to connected cloud bundles when:
 * 1. No hook activity for SETTLE_MS (generation settled), AND
 * 2. At least MIN_INTERVAL_MS since the last push.
 */
export function startAutoSync(
  sessionId: string,
  log: (msg: string) => void,
  options?: AutoSyncOptions,
): AutoSyncHandle {
  const now = options?.now ?? Date.now;

  let lastActivityAt = 0;
  let lastPushAt = 0;
  let checkTimer: ReturnType<typeof setTimeout> | null = null;
  let running = true;

  function recordActivity() {
    lastActivityAt = now();
    scheduleCheck();
  }

  function scheduleCheck() {
    if (!running) return;
    if (checkTimer) clearTimeout(checkTimer);

    // Check after settle period
    checkTimer = setTimeout(async () => {
      if (!running) return;

      const currentTime = now();
      const timeSinceActivity = currentTime - lastActivityAt;
      const timeSinceLastPush = currentTime - lastPushAt;

      // Not settled yet — activity happened during our wait
      if (timeSinceActivity < SETTLE_MS) {
        scheduleCheck();
        return;
      }

      // Respect minimum interval
      if (lastPushAt > 0 && timeSinceLastPush < MIN_INTERVAL_MS) {
        // Schedule for when the interval allows
        const waitMore = MIN_INTERVAL_MS - timeSinceLastPush;
        checkTimer = setTimeout(() => scheduleCheck(), waitMore);
        return;
      }

      await doPush();
    }, SETTLE_MS);
  }

  async function doPush() {
    if (!running) return;

    try {
      const session = loadActiveSession(sessionId);
      if (!session) return;

      // Only push to cloud bundles
      const cloudBundles = session.bundles.filter((b) => b.mode === "cloud");
      if (cloudBundles.length === 0) return;

      // Get unpushed entries and consolidate
      const unpushed = getUnpushedSessionEntries(sessionId);
      if (unpushed.length === 0) return;

      const consolidated = consolidateEntries(unpushed);
      const entryIds = consolidated.map((e) => e.id);

      for (const b of cloudBundles) {
        try {
          // Get excluded entries for this bundle
          const excluded = isLocalBundle(b.bundle_id)
            ? localGetExcludedEntryIds(b.bundle_id)
            : await getExcludedEntryIds(b.bundle_id);

          const filteredIds = entryIds.filter((id) => !excluded.has(id));
          if (filteredIds.length === 0) continue;

          await pushSessionToBundle(sessionId, b.bundle_id, filteredIds);
          log(
            `Auto-synced ${filteredIds.length} entries to bundle ${b.bundle_id}`,
          );
        } catch (err: any) {
          log(`Auto-sync to bundle ${b.bundle_id} failed: ${err.message}`);
        }
      }

      // Mark all consolidated entries as pushed
      markSessionEntriesPushed(sessionId, entryIds);
      lastPushAt = now();
    } catch (err: any) {
      log(`Auto-sync error: ${err.message}`);
    }
  }

  return {
    recordActivity,
    stop() {
      running = false;
      if (checkTimer) clearTimeout(checkTimer);
    },
  };
}
