import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { setupTestDir, cleanupTestDir } from "./helpers/mock-fs";
import { randomUUID } from "node:crypto";
import { pushSessionEntry } from "../config.js";
import {
  isLocalBundle,
  localCreateBundle,
  localJoinBundle,
  localDeleteBundle,
  localBundleStatus,
  localAddEntriesToBundle,
  localPullEntries,
  localRemoveEntryFromBundle,
  localRemoveSessionRefsFromBundle,
  localRemoveEntryRefsFromBundleByIds,
  getLocalBundleIdsForSession,
  listAllLocalBundleDetails,
} from "../local-store.js";

let testDir: string;

beforeEach(() => {
  testDir = setupTestDir();
});

afterEach(() => {
  cleanupTestDir(testDir);
});

// ── Helper ──────────────────────────────────────────────────────────────────

/** Push a session entry and return its generated ID */
function createSessionEntry(
  sessionId: string,
  overrides: {
    project_name?: string;
    event_type?: string;
    trigger_ref?: string | null;
    summary?: string;
    files_touched?: string[];
    decisions?: any[];
  } = {}
) {
  return pushSessionEntry(sessionId, {
    project_name: overrides.project_name ?? "test-project",
    event_type: overrides.event_type ?? "manual",
    trigger_ref: overrides.trigger_ref ?? null,
    summary: overrides.summary ?? "test entry",
    files_touched: overrides.files_touched ?? [],
    decisions: overrides.decisions ?? [],
  });
}

// ── isLocalBundle ───────────────────────────────────────────────────────────

describe("isLocalBundle", () => {
  test("returns false for nonexistent bundle", () => {
    expect(isLocalBundle(randomUUID())).toBe(false);
  });

  test("returns true after creating a local bundle", () => {
    const result = localCreateBundle("my-bundle");
    expect(isLocalBundle(result.bundle_id)).toBe(true);
  });

  test("returns false after deleting a bundle", () => {
    const result = localCreateBundle("ephemeral");
    localDeleteBundle(result.bundle_id);
    expect(isLocalBundle(result.bundle_id)).toBe(false);
  });
});

// ── localCreateBundle ───────────────────────────────────────────────────────

describe("localCreateBundle", () => {
  test("returns bundle_id, name, and join_token", () => {
    const result = localCreateBundle("test-bundle");
    expect(result.bundle_id).toBeTruthy();
    expect(result.name).toBe("test-bundle");
    expect(result.join_token).toBe(`local_${result.bundle_id}`);
  });

  test("creates a valid UUID bundle_id", () => {
    const result = localCreateBundle("uuid-check");
    // UUID v4 format
    expect(result.bundle_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  test("each call creates a unique bundle", () => {
    const a = localCreateBundle("bundle-a");
    const b = localCreateBundle("bundle-b");
    expect(a.bundle_id).not.toBe(b.bundle_id);
  });

  test("bundle is queryable immediately after creation", () => {
    const result = localCreateBundle("immediate");
    const status = localBundleStatus(result.bundle_id);
    expect(status.name).toBe("immediate");
    expect(status.entry_count).toBe(0);
  });
});

// ── localJoinBundle ─────────────────────────────────────────────────────────

describe("localJoinBundle", () => {
  test("returns bundle_id and name for existing bundle", () => {
    const created = localCreateBundle("joinable");
    const joined = localJoinBundle(created.bundle_id);
    expect(joined.bundle_id).toBe(created.bundle_id);
    expect(joined.name).toBe("joinable");
  });

  test("throws for nonexistent bundle", () => {
    expect(() => localJoinBundle(randomUUID())).toThrow("not found");
  });
});

// ── localDeleteBundle ───────────────────────────────────────────────────────

describe("localDeleteBundle", () => {
  test("removes the bundle directory", () => {
    const created = localCreateBundle("to-delete");
    localDeleteBundle(created.bundle_id);
    expect(isLocalBundle(created.bundle_id)).toBe(false);
  });

  test("no-op for nonexistent bundle (does not throw)", () => {
    expect(() => localDeleteBundle(randomUUID())).not.toThrow();
  });

  test("deleted bundle cannot be joined", () => {
    const created = localCreateBundle("gone");
    localDeleteBundle(created.bundle_id);
    expect(() => localJoinBundle(created.bundle_id)).toThrow("not found");
  });
});

// ── localBundleStatus ───────────────────────────────────────────────────────

describe("localBundleStatus", () => {
  test("returns correct status for empty bundle", () => {
    const created = localCreateBundle("empty-status");
    const status = localBundleStatus(created.bundle_id);
    expect(status.bundle_id).toBe(created.bundle_id);
    expect(status.name).toBe("empty-status");
    expect(status.session_count).toBe(0);
    expect(status.entry_count).toBe(0);
    expect(status.last_entry_at).toBeNull();
  });

  test("reflects entry count after adding entries", () => {
    const bundle = localCreateBundle("with-entries");
    const sessionId = randomUUID();
    const e1 = createSessionEntry(sessionId, { summary: "first" });
    const e2 = createSessionEntry(sessionId, { summary: "second" });

    localAddEntriesToBundle(bundle.bundle_id, [e1.id, e2.id], sessionId);

    const status = localBundleStatus(bundle.bundle_id);
    expect(status.entry_count).toBe(2);
    expect(status.session_count).toBe(1);
    expect(status.last_entry_at).toBeTruthy();
  });

  test("counts distinct sessions", () => {
    const bundle = localCreateBundle("multi-session");
    const sessionA = randomUUID();
    const sessionB = randomUUID();
    const eA = createSessionEntry(sessionA, { summary: "from A" });
    const eB = createSessionEntry(sessionB, { summary: "from B" });

    localAddEntriesToBundle(bundle.bundle_id, [eA.id], sessionA);
    localAddEntriesToBundle(bundle.bundle_id, [eB.id], sessionB);

    const status = localBundleStatus(bundle.bundle_id);
    expect(status.session_count).toBe(2);
    expect(status.entry_count).toBe(2);
  });

  test("throws for nonexistent bundle", () => {
    expect(() => localBundleStatus(randomUUID())).toThrow("not found");
  });
});

// ── localAddEntriesToBundle ─────────────────────────────────────────────────

describe("localAddEntriesToBundle", () => {
  test("adds entries and returns counts", () => {
    const bundle = localCreateBundle("add-test");
    const sessionId = randomUUID();
    const e1 = createSessionEntry(sessionId);
    const e2 = createSessionEntry(sessionId);

    const result = localAddEntriesToBundle(
      bundle.bundle_id,
      [e1.id, e2.id],
      sessionId
    );
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(0);
  });

  test("skips duplicate entries", () => {
    const bundle = localCreateBundle("dedup-test");
    const sessionId = randomUUID();
    const e1 = createSessionEntry(sessionId);

    localAddEntriesToBundle(bundle.bundle_id, [e1.id], sessionId);
    const result = localAddEntriesToBundle(
      bundle.bundle_id,
      [e1.id],
      sessionId
    );
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
  });

  test("handles mixed new and duplicate entries", () => {
    const bundle = localCreateBundle("mixed-test");
    const sessionId = randomUUID();
    const e1 = createSessionEntry(sessionId);
    const e2 = createSessionEntry(sessionId);

    localAddEntriesToBundle(bundle.bundle_id, [e1.id], sessionId);
    const result = localAddEntriesToBundle(
      bundle.bundle_id,
      [e1.id, e2.id],
      sessionId
    );
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
  });

  test("returns zero counts for empty input", () => {
    const bundle = localCreateBundle("empty-add");
    const result = localAddEntriesToBundle(bundle.bundle_id, [], randomUUID());
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(0);
  });

  test("throws for nonexistent bundle", () => {
    expect(() =>
      localAddEntriesToBundle(randomUUID(), [randomUUID()], randomUUID())
    ).toThrow("not found");
  });
});

// ── localPullEntries ────────────────────────────────────────────────────────

describe("localPullEntries", () => {
  test("returns entries resolved from session-entries", () => {
    const bundle = localCreateBundle("pull-test");
    const sessionId = randomUUID();
    const e1 = createSessionEntry(sessionId, {
      summary: "pull me",
      project_name: "proj-a",
    });
    localAddEntriesToBundle(bundle.bundle_id, [e1.id], sessionId);

    const entries = localPullEntries({ bundle_id: bundle.bundle_id });
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(e1.id);
    expect(entries[0].summary).toBe("pull me");
    expect(entries[0].project_name).toBe("proj-a");
  });

  test("returns entries from multiple sessions", () => {
    const bundle = localCreateBundle("multi-pull");
    const s1 = randomUUID();
    const s2 = randomUUID();
    const e1 = createSessionEntry(s1, { summary: "from s1" });
    const e2 = createSessionEntry(s2, { summary: "from s2" });

    localAddEntriesToBundle(bundle.bundle_id, [e1.id], s1);
    localAddEntriesToBundle(bundle.bundle_id, [e2.id], s2);

    const entries = localPullEntries({ bundle_id: bundle.bundle_id });
    expect(entries).toHaveLength(2);
    const summaries = entries.map((e) => e.summary).sort();
    expect(summaries).toEqual(["from s1", "from s2"]);
  });

  test("respects exclude_project filter", () => {
    const bundle = localCreateBundle("exclude-proj");
    const sessionId = randomUUID();
    const e1 = createSessionEntry(sessionId, {
      project_name: "frontend",
      summary: "fe change",
    });
    const e2 = createSessionEntry(sessionId, {
      project_name: "backend",
      summary: "be change",
    });

    localAddEntriesToBundle(bundle.bundle_id, [e1.id, e2.id], sessionId);

    const entries = localPullEntries({
      bundle_id: bundle.bundle_id,
      exclude_project: "frontend",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].project_name).toBe("backend");
  });

  test("respects since filter", () => {
    const bundle = localCreateBundle("since-filter");
    const sessionId = randomUUID();

    // Create entries with controlled timestamps via the normal API
    const e1 = createSessionEntry(sessionId, { summary: "old entry" });
    const e2 = createSessionEntry(sessionId, { summary: "new entry" });

    localAddEntriesToBundle(bundle.bundle_id, [e1.id, e2.id], sessionId);

    // Use the timestamp of e1 as the "since" cutoff - should exclude e1 since
    // the filter is strictly greater than
    const entries = localPullEntries({
      bundle_id: bundle.bundle_id,
      since: e1.created_at,
    });
    // e2's timestamp is >= e1's timestamp, but "since" is strictly >, so
    // depending on timing e2 may or may not be included. At minimum, e1 is excluded.
    for (const entry of entries) {
      expect(entry.created_at > e1.created_at).toBe(true);
    }
  });

  test("respects limit", () => {
    const bundle = localCreateBundle("limit-test");
    const sessionId = randomUUID();
    const entryIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const e = createSessionEntry(sessionId, { summary: `entry ${i}` });
      entryIds.push(e.id);
    }
    localAddEntriesToBundle(bundle.bundle_id, entryIds, sessionId);

    const entries = localPullEntries({
      bundle_id: bundle.bundle_id,
      limit: 3,
    });
    expect(entries).toHaveLength(3);
  });

  test("default limit is 20", () => {
    const bundle = localCreateBundle("default-limit");
    const sessionId = randomUUID();
    const entryIds: string[] = [];
    for (let i = 0; i < 25; i++) {
      const e = createSessionEntry(sessionId, { summary: `entry ${i}` });
      entryIds.push(e.id);
    }
    localAddEntriesToBundle(bundle.bundle_id, entryIds, sessionId);

    const entries = localPullEntries({ bundle_id: bundle.bundle_id });
    expect(entries).toHaveLength(20);
  });

  test("returns empty array for bundle with no entries", () => {
    const bundle = localCreateBundle("empty-pull");
    const entries = localPullEntries({ bundle_id: bundle.bundle_id });
    expect(entries).toEqual([]);
  });

  test("throws for nonexistent bundle", () => {
    expect(() =>
      localPullEntries({ bundle_id: randomUUID() })
    ).toThrow("not found");
  });

  test("entries are sorted by created_at descending", () => {
    const bundle = localCreateBundle("sort-test");
    const sessionId = randomUUID();
    const entryIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const e = createSessionEntry(sessionId, { summary: `entry ${i}` });
      entryIds.push(e.id);
    }
    localAddEntriesToBundle(bundle.bundle_id, entryIds, sessionId);

    const entries = localPullEntries({ bundle_id: bundle.bundle_id });
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1].created_at >= entries[i].created_at).toBe(true);
    }
  });
});

// ── localRemoveEntryFromBundle ──────────────────────────────────────────────

describe("localRemoveEntryFromBundle", () => {
  test("removes a single entry ref", () => {
    const bundle = localCreateBundle("remove-one");
    const sessionId = randomUUID();
    const e1 = createSessionEntry(sessionId, { summary: "keep" });
    const e2 = createSessionEntry(sessionId, { summary: "remove" });

    localAddEntriesToBundle(bundle.bundle_id, [e1.id, e2.id], sessionId);
    localRemoveEntryFromBundle(bundle.bundle_id, e2.id);

    const entries = localPullEntries({ bundle_id: bundle.bundle_id });
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(e1.id);
  });

  test("no-op when entry is not in the bundle", () => {
    const bundle = localCreateBundle("remove-missing");
    const sessionId = randomUUID();
    const e1 = createSessionEntry(sessionId);
    localAddEntriesToBundle(bundle.bundle_id, [e1.id], sessionId);

    // Remove a random entry that was never added
    localRemoveEntryFromBundle(bundle.bundle_id, randomUUID());

    const entries = localPullEntries({ bundle_id: bundle.bundle_id });
    expect(entries).toHaveLength(1);
  });

  test("removing all entries results in empty bundle", () => {
    const bundle = localCreateBundle("remove-all");
    const sessionId = randomUUID();
    const e1 = createSessionEntry(sessionId);

    localAddEntriesToBundle(bundle.bundle_id, [e1.id], sessionId);
    localRemoveEntryFromBundle(bundle.bundle_id, e1.id);

    const status = localBundleStatus(bundle.bundle_id);
    expect(status.entry_count).toBe(0);
  });
});

// ── localRemoveSessionRefsFromBundle ────────────────────────────────────────

describe("localRemoveSessionRefsFromBundle", () => {
  test("removes all refs for a given session", () => {
    const bundle = localCreateBundle("remove-session-refs");
    const sessionA = randomUUID();
    const sessionB = randomUUID();
    const eA1 = createSessionEntry(sessionA, { summary: "A1" });
    const eA2 = createSessionEntry(sessionA, { summary: "A2" });
    const eB1 = createSessionEntry(sessionB, { summary: "B1" });

    localAddEntriesToBundle(bundle.bundle_id, [eA1.id, eA2.id], sessionA);
    localAddEntriesToBundle(bundle.bundle_id, [eB1.id], sessionB);

    localRemoveSessionRefsFromBundle(bundle.bundle_id, sessionA);

    const entries = localPullEntries({ bundle_id: bundle.bundle_id });
    expect(entries).toHaveLength(1);
    expect(entries[0].summary).toBe("B1");
  });

  test("no-op when session has no refs in bundle", () => {
    const bundle = localCreateBundle("no-session-refs");
    const sessionId = randomUUID();
    const e1 = createSessionEntry(sessionId);
    localAddEntriesToBundle(bundle.bundle_id, [e1.id], sessionId);

    localRemoveSessionRefsFromBundle(bundle.bundle_id, randomUUID());

    const entries = localPullEntries({ bundle_id: bundle.bundle_id });
    expect(entries).toHaveLength(1);
  });
});

// ── localRemoveEntryRefsFromBundleByIds ─────────────────────────────────────

describe("localRemoveEntryRefsFromBundleByIds", () => {
  test("removes multiple refs by entry IDs", () => {
    const bundle = localCreateBundle("remove-by-ids");
    const sessionId = randomUUID();
    const e1 = createSessionEntry(sessionId, { summary: "remove me" });
    const e2 = createSessionEntry(sessionId, { summary: "remove me too" });
    const e3 = createSessionEntry(sessionId, { summary: "keep me" });

    localAddEntriesToBundle(
      bundle.bundle_id,
      [e1.id, e2.id, e3.id],
      sessionId
    );
    localRemoveEntryRefsFromBundleByIds(bundle.bundle_id, [e1.id, e2.id]);

    const entries = localPullEntries({ bundle_id: bundle.bundle_id });
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(e3.id);
  });

  test("handles empty entryIds array", () => {
    const bundle = localCreateBundle("remove-empty-ids");
    const sessionId = randomUUID();
    const e1 = createSessionEntry(sessionId);
    localAddEntriesToBundle(bundle.bundle_id, [e1.id], sessionId);

    localRemoveEntryRefsFromBundleByIds(bundle.bundle_id, []);

    const entries = localPullEntries({ bundle_id: bundle.bundle_id });
    expect(entries).toHaveLength(1);
  });

  test("ignores IDs that are not in the bundle", () => {
    const bundle = localCreateBundle("remove-nonexistent-ids");
    const sessionId = randomUUID();
    const e1 = createSessionEntry(sessionId);
    localAddEntriesToBundle(bundle.bundle_id, [e1.id], sessionId);

    localRemoveEntryRefsFromBundleByIds(bundle.bundle_id, [randomUUID()]);

    const entries = localPullEntries({ bundle_id: bundle.bundle_id });
    expect(entries).toHaveLength(1);
  });
});

// ── getLocalBundleIdsForSession ─────────────────────────────────────────────

describe("getLocalBundleIdsForSession", () => {
  test("returns empty array when no bundles exist", () => {
    expect(getLocalBundleIdsForSession(randomUUID())).toEqual([]);
  });

  test("returns bundle IDs that reference the session", () => {
    const bundle1 = localCreateBundle("b1");
    const bundle2 = localCreateBundle("b2");
    const bundle3 = localCreateBundle("b3");
    const sessionId = randomUUID();
    const e1 = createSessionEntry(sessionId);
    const e2 = createSessionEntry(sessionId);

    localAddEntriesToBundle(bundle1.bundle_id, [e1.id], sessionId);
    localAddEntriesToBundle(bundle2.bundle_id, [e2.id], sessionId);
    // bundle3 has no refs for this session

    const bundleIds = getLocalBundleIdsForSession(sessionId).sort();
    expect(bundleIds).toHaveLength(2);
    expect(bundleIds).toContain(bundle1.bundle_id);
    expect(bundleIds).toContain(bundle2.bundle_id);
    expect(bundleIds).not.toContain(bundle3.bundle_id);
  });

  test("does not return bundles for a different session", () => {
    const bundle = localCreateBundle("other-session");
    const sessionA = randomUUID();
    const sessionB = randomUUID();
    const eA = createSessionEntry(sessionA);

    localAddEntriesToBundle(bundle.bundle_id, [eA.id], sessionA);

    const bundleIds = getLocalBundleIdsForSession(sessionB);
    expect(bundleIds).toEqual([]);
  });

  test("returns empty after all refs for session are removed", () => {
    const bundle = localCreateBundle("cleanup");
    const sessionId = randomUUID();
    const e1 = createSessionEntry(sessionId);

    localAddEntriesToBundle(bundle.bundle_id, [e1.id], sessionId);
    localRemoveSessionRefsFromBundle(bundle.bundle_id, sessionId);

    const bundleIds = getLocalBundleIdsForSession(sessionId);
    expect(bundleIds).toEqual([]);
  });
});

// ── listAllLocalBundleDetails ───────────────────────────────────────────────

describe("listAllLocalBundleDetails", () => {
  test("returns empty array when no bundles exist", () => {
    expect(listAllLocalBundleDetails()).toEqual([]);
  });

  test("lists all local bundles with details", () => {
    localCreateBundle("alpha");
    localCreateBundle("beta");

    const details = listAllLocalBundleDetails();
    expect(details).toHaveLength(2);
    const names = details.map((d) => d.bundle_name).sort();
    expect(names).toEqual(["alpha", "beta"]);
  });

  test("includes entry count and last_entry_at", () => {
    const bundle = localCreateBundle("detail-test");
    const sessionId = randomUUID();
    const e1 = createSessionEntry(sessionId, {
      project_name: "proj-x",
      summary: "entry 1",
    });
    const e2 = createSessionEntry(sessionId, {
      project_name: "proj-x",
      summary: "entry 2",
    });
    localAddEntriesToBundle(bundle.bundle_id, [e1.id, e2.id], sessionId);

    const details = listAllLocalBundleDetails();
    const detail = details.find((d) => d.bundle_id === bundle.bundle_id)!;
    expect(detail.entry_count).toBe(2);
    expect(detail.last_entry_at).toBeTruthy();
  });

  test("aggregates projects from entries", () => {
    const bundle = localCreateBundle("multi-project");
    const sessionId = randomUUID();
    const e1 = createSessionEntry(sessionId, { project_name: "frontend" });
    const e2 = createSessionEntry(sessionId, { project_name: "backend" });
    const e3 = createSessionEntry(sessionId, { project_name: "frontend" });

    localAddEntriesToBundle(
      bundle.bundle_id,
      [e1.id, e2.id, e3.id],
      sessionId
    );

    const details = listAllLocalBundleDetails();
    const detail = details.find((d) => d.bundle_id === bundle.bundle_id)!;
    expect(detail.projects).toHaveLength(2);
    const projectNames = detail.projects.map((p) => p.project_name).sort();
    expect(projectNames).toEqual(["backend", "frontend"]);
  });

  test("empty bundle has zero entries and null last_entry_at", () => {
    const bundle = localCreateBundle("empty-detail");
    const details = listAllLocalBundleDetails();
    const detail = details.find((d) => d.bundle_id === bundle.bundle_id)!;
    expect(detail.entry_count).toBe(0);
    expect(detail.last_entry_at).toBeNull();
    expect(detail.projects).toEqual([]);
  });
});
