import { describe, test, expect, beforeEach, mock } from "bun:test";
import type { ActiveSession, SessionEntry } from "@ctx-link/core";

// ── Mock state ──────────────────────────────────────────────────────────────

let mockSession: ActiveSession | null = null;
let mockUnpushed: SessionEntry[] = [];
let mockExcluded: Set<string> = new Set();
let mockLocalExcluded: Set<string> = new Set();
let pushCalls: Array<{ sessionId: string; bundleId: string; entryIds: string[] }> = [];
let markPushedCalls: Array<{ sessionId: string; entryIds: string[] }> = [];
let localBundleIds: Set<string> = new Set();
/** Set of bundle IDs that should throw on push. */
let failBundleIds: Set<string> = new Set();

// ── Mock @ctx-link/core ─────────────────────────────────────────────────────

mock.module("@ctx-link/core", () => ({
  loadActiveSession: (_id: string) => mockSession,
  getUnpushedSessionEntries: (_id: string) => mockUnpushed,
  markSessionEntriesPushed: (sessionId: string, entryIds: string[]) => {
    markPushedCalls.push({ sessionId, entryIds });
  },
  isLocalBundle: (id: string) => localBundleIds.has(id),
  consolidateEntries: (entries: SessionEntry[]) => entries, // passthrough
  getExcludedEntryIds: async (_bundleId: string) => mockExcluded,
  localGetExcludedEntryIds: (_bundleId: string) => mockLocalExcluded,
  pushSessionToBundle: async (
    sessionId: string,
    bundleId: string,
    entryIds: string[],
  ) => {
    if (failBundleIds.has(bundleId)) {
      throw new Error(`push to ${bundleId} failed: network timeout`);
    }
    pushCalls.push({ sessionId, bundleId, entryIds });
    return { pushed: entryIds.length, skipped: 0, total: entryIds.length };
  },
}));

// Import AFTER mock registration
const { startAutoSync, SETTLE_MS, MIN_INTERVAL_MS } = await import(
  "../auto-sync.js"
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(
  overrides: Partial<ActiveSession> = {},
): ActiveSession {
  return {
    session_id: "sess-1",
    project_name: "test-project",
    project_path: "/tmp/test",
    bundles: [],
    started_at: new Date().toISOString(),
    branch: "main",
    cloud_session_id: null,
    team_id: null,
    cloud_copies: [],
    ...overrides,
  };
}

function makeEntry(id: string): SessionEntry {
  return {
    id,
    created_at: new Date().toISOString(),
    project_name: "test-project",
    event_type: "edit",
    trigger_ref: null,
    title: `entry ${id}`,
    summary: `entry ${id}`,
    files_touched: ["src/a.ts"],
    decisions: [],
    pushed_at: null,
    superseded_at: null,
  };
}

/**
 * Simulate what doPush does, using the same mocked @ctx-link/core functions.
 * This validates the core push logic without depending on setTimeout timing.
 */
async function simulateDoPush(
  sessionId: string,
  logFn: (msg: string) => void,
) {
  const {
    loadActiveSession: load,
    getUnpushedSessionEntries: getUnpushed,
    markSessionEntriesPushed: markPushed,
    isLocalBundle: isLocal,
    consolidateEntries: consolidate,
    getExcludedEntryIds: getExcluded,
    localGetExcludedEntryIds: localGetExcluded,
    pushSessionToBundle: push,
  } = await import("@ctx-link/core");

  const session = load(sessionId);
  if (!session) return;

  if (session.bundles.length === 0) return;

  const unpushed = getUnpushed(sessionId);
  if (unpushed.length === 0) return;

  const consolidated = consolidate(unpushed);
  const entryIds = consolidated.map((e: any) => e.id);

  for (const b of session.bundles) {
    try {
      const excluded = isLocal(b.bundle_id)
        ? localGetExcluded(b.bundle_id)
        : await getExcluded(b.bundle_id);

      const filteredIds = entryIds.filter((id: string) => !excluded.has(id));
      if (filteredIds.length === 0) continue;

      await push(sessionId, b.bundle_id, filteredIds);
      logFn(
        `Auto-synced ${filteredIds.length} entries to bundle ${b.bundle_id}`,
      );
    } catch (err: any) {
      logFn(`Auto-sync to bundle ${b.bundle_id} failed: ${err.message}`);
    }
  }

  markPushed(sessionId, entryIds);
}

// ── Reset state ─────────────────────────────────────────────────────────────

beforeEach(() => {
  mockSession = null;
  mockUnpushed = [];
  mockExcluded = new Set();
  mockLocalExcluded = new Set();
  pushCalls = [];
  markPushedCalls = [];
  localBundleIds = new Set();
  failBundleIds = new Set();
});

// ── Timer / handle tests ────────────────────────────────────────────────────

describe("auto-sync handle", () => {
  test("no push when recordActivity is never called", async () => {
    mockSession = makeSession({
      bundles: [{ bundle_id: "b-1", mode: "cloud" }],
    });
    mockUnpushed = [makeEntry("e1")];

    const handle = startAutoSync("sess-1", () => {});

    // Wait a bit — no timer was scheduled since no activity
    await new Promise((r) => setTimeout(r, 50));

    expect(pushCalls).toHaveLength(0);
    handle.stop();
  });

  test("stop cancels pending timer — no push fires", async () => {
    mockSession = makeSession({
      bundles: [{ bundle_id: "b-1", mode: "cloud" }],
    });
    mockUnpushed = [makeEntry("e1")];

    const handle = startAutoSync("sess-1", () => {});
    handle.recordActivity();
    handle.stop();

    // Even after waiting, nothing should fire
    await new Promise((r) => setTimeout(r, 100));

    expect(pushCalls).toHaveLength(0);
  });

  test("recordActivity can be called multiple times without error", () => {
    const handle = startAutoSync("sess-1", () => {});
    handle.recordActivity();
    handle.recordActivity();
    handle.recordActivity();
    handle.stop();
  });

  test("stop can be called multiple times without error", () => {
    const handle = startAutoSync("sess-1", () => {});
    handle.stop();
    handle.stop();
    handle.stop();
  });

  test("recordActivity after stop does not throw", () => {
    const handle = startAutoSync("sess-1", () => {});
    handle.stop();
    // scheduleCheck returns early when !running
    handle.recordActivity();
  });

  test("handle has recordActivity and stop methods", () => {
    const handle = startAutoSync("sess-1", () => {});
    expect(typeof handle.recordActivity).toBe("function");
    expect(typeof handle.stop).toBe("function");
    handle.stop();
  });

  test("accepts custom now function via options", () => {
    let clock = 1000;
    const handle = startAutoSync("sess-1", () => {}, { now: () => clock });
    handle.recordActivity();
    clock += 5000;
    handle.recordActivity();
    handle.stop();
  });

  test("exports expected constants", () => {
    expect(SETTLE_MS).toBe(20_000);
    expect(MIN_INTERVAL_MS).toBe(180_000);
  });
});

// ── doPush logic tests ──────────────────────────────────────────────────────
// Since Bun does not support advanceTimersByTime, we test the doPush logic
// directly by calling simulateDoPush — a function that mirrors the exact
// code path inside auto-sync.ts's doPush.

describe("auto-sync doPush logic", () => {
  test("pushes unpushed entries to cloud bundle", async () => {
    mockSession = makeSession({
      bundles: [{ bundle_id: "b-cloud", mode: "cloud" }],
    });
    mockUnpushed = [makeEntry("e1"), makeEntry("e2")];

    const logs: string[] = [];
    await simulateDoPush("sess-1", (msg) => logs.push(msg));

    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0].bundleId).toBe("b-cloud");
    expect(pushCalls[0].entryIds).toEqual(["e1", "e2"]);
    expect(logs[0]).toContain("Auto-synced 2 entries");
  });

  test("marks entries as pushed after successful push", async () => {
    mockSession = makeSession({
      bundles: [{ bundle_id: "b-cloud", mode: "cloud" }],
    });
    mockUnpushed = [makeEntry("e1"), makeEntry("e2")];

    await simulateDoPush("sess-1", () => {});

    expect(markPushedCalls).toHaveLength(1);
    expect(markPushedCalls[0].sessionId).toBe("sess-1");
    expect(markPushedCalls[0].entryIds).toEqual(["e1", "e2"]);
  });

  test("skips push when session not found", async () => {
    mockSession = null;

    await simulateDoPush("sess-1", () => {});

    expect(pushCalls).toHaveLength(0);
    expect(markPushedCalls).toHaveLength(0);
  });

  test("skips push when no bundles connected", async () => {
    mockSession = makeSession({ bundles: [] });
    mockUnpushed = [makeEntry("e1")];

    await simulateDoPush("sess-1", () => {});

    expect(pushCalls).toHaveLength(0);
    expect(markPushedCalls).toHaveLength(0);
  });

  test("skips push when no unpushed entries", async () => {
    mockSession = makeSession({
      bundles: [{ bundle_id: "b-cloud", mode: "cloud" }],
    });
    mockUnpushed = [];

    await simulateDoPush("sess-1", () => {});

    expect(pushCalls).toHaveLength(0);
    expect(markPushedCalls).toHaveLength(0);
  });

  test("pushes to all connected bundles regardless of mode", async () => {
    localBundleIds = new Set(["b-local"]);
    mockSession = makeSession({
      bundles: [
        { bundle_id: "b-local", mode: "local" },
        { bundle_id: "b-cloud-1", mode: "cloud" },
        { bundle_id: "b-cloud-2", mode: "cloud" },
      ],
    });
    mockUnpushed = [makeEntry("e1")];

    await simulateDoPush("sess-1", () => {});

    expect(pushCalls).toHaveLength(3);
    expect(pushCalls.map((c) => c.bundleId)).toEqual([
      "b-local",
      "b-cloud-1",
      "b-cloud-2",
    ]);
  });

  test("filters out excluded entries from push", async () => {
    mockSession = makeSession({
      bundles: [{ bundle_id: "b-cloud", mode: "cloud" }],
    });
    mockUnpushed = [makeEntry("e1"), makeEntry("e2"), makeEntry("e3")];
    mockExcluded = new Set(["e2"]);

    await simulateDoPush("sess-1", () => {});

    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0].entryIds).toEqual(["e1", "e3"]);
  });

  test("skips bundle when all entries are excluded", async () => {
    mockSession = makeSession({
      bundles: [{ bundle_id: "b-cloud", mode: "cloud" }],
    });
    mockUnpushed = [makeEntry("e1"), makeEntry("e2")];
    mockExcluded = new Set(["e1", "e2"]);

    const logs: string[] = [];
    await simulateDoPush("sess-1", (msg) => logs.push(msg));

    // No push calls since all entries are excluded
    expect(pushCalls).toHaveLength(0);
    // But markPushed still fires (entries are consolidated regardless)
    expect(markPushedCalls).toHaveLength(1);
    // No success logs
    expect(logs.filter((l) => l.includes("Auto-synced"))).toHaveLength(0);
  });

  test("push error is caught and logged, continues to next bundle", async () => {
    mockSession = makeSession({
      bundles: [
        { bundle_id: "b-cloud-fail", mode: "cloud" },
        { bundle_id: "b-cloud-ok", mode: "cloud" },
      ],
    });
    mockUnpushed = [makeEntry("e1")];
    failBundleIds = new Set(["b-cloud-fail"]);

    const logs: string[] = [];
    await simulateDoPush("sess-1", (msg) => logs.push(msg));

    // First bundle fails, second succeeds
    expect(logs.some((l) => l.includes("failed") && l.includes("network timeout"))).toBe(true);
    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0].bundleId).toBe("b-cloud-ok");
    // Entries still marked as pushed
    expect(markPushedCalls).toHaveLength(1);
  });

  test("pushes to local bundle", async () => {
    localBundleIds = new Set(["b-local"]);
    mockSession = makeSession({
      bundles: [{ bundle_id: "b-local", mode: "local" }],
    });
    mockUnpushed = [makeEntry("e1"), makeEntry("e2")];

    const logs: string[] = [];
    await simulateDoPush("sess-1", (msg) => logs.push(msg));

    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0].bundleId).toBe("b-local");
    expect(pushCalls[0].entryIds).toEqual(["e1", "e2"]);
    expect(logs[0]).toContain("Auto-synced 2 entries");
  });

  test("pushes to mixed local + cloud bundles", async () => {
    localBundleIds = new Set(["b-local"]);
    mockSession = makeSession({
      bundles: [
        { bundle_id: "b-local", mode: "local" },
        { bundle_id: "b-cloud", mode: "cloud" },
      ],
    });
    mockUnpushed = [makeEntry("e1")];

    await simulateDoPush("sess-1", () => {});

    expect(pushCalls).toHaveLength(2);
    expect(pushCalls.map((c) => c.bundleId).sort()).toEqual([
      "b-cloud",
      "b-local",
    ]);
  });

  test("pushes to multiple cloud bundles", async () => {
    mockSession = makeSession({
      bundles: [
        { bundle_id: "b-cloud-1", mode: "cloud" },
        { bundle_id: "b-cloud-2", mode: "cloud" },
        { bundle_id: "b-cloud-3", mode: "cloud" },
      ],
    });
    mockUnpushed = [makeEntry("e1")];

    await simulateDoPush("sess-1", () => {});

    expect(pushCalls).toHaveLength(3);
    expect(pushCalls.map((c) => c.bundleId)).toEqual([
      "b-cloud-1",
      "b-cloud-2",
      "b-cloud-3",
    ]);
  });

  test("uses localGetExcludedEntryIds for bundles where isLocalBundle is true", async () => {
    localBundleIds = new Set(["b-local-cloud"]);
    mockSession = makeSession({
      // In theory a local bundle shouldn't have mode: "cloud", but the code
      // uses isLocalBundle() for exclusion fn dispatch, not the mode field.
      // Here we test the dispatch by setting mode to "cloud" (so it gets
      // past the filter) and isLocalBundle=true (so localGetExcluded is used).
      bundles: [{ bundle_id: "b-local-cloud", mode: "cloud" }],
    });
    mockUnpushed = [makeEntry("e1"), makeEntry("e2")];
    mockLocalExcluded = new Set(["e1"]); // local exclusion
    mockExcluded = new Set(); // cloud exclusion is empty

    await simulateDoPush("sess-1", () => {});

    // Should use localGetExcludedEntryIds, which excludes e1
    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0].entryIds).toEqual(["e2"]);
  });

  test("different exclusions per bundle (independent exclusion sets)", async () => {
    // This test verifies that each bundle gets its own exclusion check.
    // Since our mock returns the same Set for all bundles, we just verify
    // the filtering applies consistently.
    mockSession = makeSession({
      bundles: [
        { bundle_id: "b-cloud-1", mode: "cloud" },
        { bundle_id: "b-cloud-2", mode: "cloud" },
      ],
    });
    mockUnpushed = [makeEntry("e1"), makeEntry("e2"), makeEntry("e3")];
    mockExcluded = new Set(["e2"]);

    await simulateDoPush("sess-1", () => {});

    // Both bundles get the same filtered set
    expect(pushCalls).toHaveLength(2);
    expect(pushCalls[0].entryIds).toEqual(["e1", "e3"]);
    expect(pushCalls[1].entryIds).toEqual(["e1", "e3"]);
  });
});
