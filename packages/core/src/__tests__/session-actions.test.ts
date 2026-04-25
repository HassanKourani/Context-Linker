import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { setupTestDir, cleanupTestDir } from "./helpers/mock-fs";
import { randomUUID } from "node:crypto";
import {
  saveActiveSession,
  loadActiveSession,
  connectSessionToBundle,
  pushSessionEntry,
  getSessionEntries,
  type ActiveSession,
} from "../config.js";
import {
  localCreateBundle,
  localAddEntriesToBundle,
  isLocalBundle,
} from "../local-store.js";
import {
  unlinkSessionFromBundle,
  deleteSession,
  pushSessionToBundle,
} from "../session-actions.js";

let testDir: string;

beforeEach(() => {
  testDir = setupTestDir();
});

afterEach(() => {
  cleanupTestDir(testDir);
});

function makeSession(id: string, overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    session_id: id,
    project_name: "test-project",
    project_path: "/tmp/test",
    bundles: [],
    started_at: "2026-01-01T00:00:00Z",
    branch: "main",
    cloud_session_id: null,
    team_id: null,
    cloud_copies: [],
    ...overrides,
  };
}

// ── unlinkSessionFromBundle (local mode) ─────────────────────────────────────

describe("unlinkSessionFromBundle", () => {
  test("unlinks local session from local bundle and removes entry refs", async () => {
    const sessionId = randomUUID();
    const bundle = localCreateBundle("test-bundle");

    // Create session with entries
    const session = makeSession(sessionId, {
      bundles: [{ bundle_id: bundle.bundle_id, mode: "local" }],
    });
    saveActiveSession(session);

    // Add entries
    const e1 = pushSessionEntry(sessionId, {
      project_name: "proj",
      event_type: "manual",
      trigger_ref: null,
      summary: "entry 1",
      files_touched: [],
      decisions: [],
    });
    localAddEntriesToBundle(bundle.bundle_id, [e1.id], sessionId);

    // Unlink
    await unlinkSessionFromBundle(sessionId, bundle.bundle_id);

    // Session should have no bundles
    const updated = loadActiveSession(sessionId);
    expect(updated!.bundles).toHaveLength(0);
  });

  test("handles nonexistent session gracefully", async () => {
    // Should not throw
    await unlinkSessionFromBundle(randomUUID(), randomUUID());
  });
});

// ── deleteSession (local) ────────────────────────────────────────────────────

describe("deleteSession", () => {
  test("deletes local session", async () => {
    const sessionId = randomUUID();
    saveActiveSession(makeSession(sessionId));
    expect(loadActiveSession(sessionId)).not.toBeNull();

    await deleteSession(sessionId);
    expect(loadActiveSession(sessionId)).toBeNull();
  });

  test("handles nonexistent session gracefully", async () => {
    // Should not throw
    await deleteSession(randomUUID());
  });
});

// ── pushSessionToBundle (local mode) ─────────────────────────────────────────

describe("pushSessionToBundle", () => {
  test("pushes local entries to local bundle", async () => {
    const sessionId = randomUUID();
    const bundle = localCreateBundle("push-test");

    saveActiveSession(makeSession(sessionId));

    // Add some entries to the session
    const e1 = pushSessionEntry(sessionId, {
      project_name: "proj",
      event_type: "manual",
      trigger_ref: null,
      summary: "first entry",
      files_touched: [],
      decisions: [],
    });
    const e2 = pushSessionEntry(sessionId, {
      project_name: "proj",
      event_type: "manual",
      trigger_ref: null,
      summary: "second entry",
      files_touched: [],
      decisions: [],
    });

    const result = await pushSessionToBundle(sessionId, bundle.bundle_id);
    expect(result.pushed).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.total).toBe(2);
  });

  test("skips already-pushed entries (deduplication)", async () => {
    const sessionId = randomUUID();
    const bundle = localCreateBundle("dedup-test");

    saveActiveSession(makeSession(sessionId));

    pushSessionEntry(sessionId, {
      project_name: "proj",
      event_type: "manual",
      trigger_ref: null,
      summary: "entry",
      files_touched: [],
      decisions: [],
    });

    // Push twice
    const first = await pushSessionToBundle(sessionId, bundle.bundle_id);
    expect(first.pushed).toBe(1);

    const second = await pushSessionToBundle(sessionId, bundle.bundle_id);
    expect(second.pushed).toBe(0);
    expect(second.skipped).toBe(1);
  });

  test("pushes specific entry IDs only", async () => {
    const sessionId = randomUUID();
    const bundle = localCreateBundle("selective-test");

    saveActiveSession(makeSession(sessionId));

    const e1 = pushSessionEntry(sessionId, {
      project_name: "proj",
      event_type: "manual",
      trigger_ref: null,
      summary: "first",
      files_touched: [],
      decisions: [],
    });
    pushSessionEntry(sessionId, {
      project_name: "proj",
      event_type: "manual",
      trigger_ref: null,
      summary: "second",
      files_touched: [],
      decisions: [],
    });

    // Only push the first entry
    const result = await pushSessionToBundle(sessionId, bundle.bundle_id, [e1.id]);
    expect(result.pushed).toBe(1);
    expect(result.total).toBe(1);
  });

  test("auto-connects session to bundle", async () => {
    const sessionId = randomUUID();
    const bundle = localCreateBundle("auto-connect-test");

    saveActiveSession(makeSession(sessionId));

    pushSessionEntry(sessionId, {
      project_name: "proj",
      event_type: "manual",
      trigger_ref: null,
      summary: "entry",
      files_touched: [],
      decisions: [],
    });

    await pushSessionToBundle(sessionId, bundle.bundle_id);

    // Session should be connected to the bundle now
    const updated = loadActiveSession(sessionId);
    expect(updated!.bundles.some(b => b.bundle_id === bundle.bundle_id)).toBe(true);
  });

  test("handles session with no entries", async () => {
    const sessionId = randomUUID();
    const bundle = localCreateBundle("empty-test");

    saveActiveSession(makeSession(sessionId));

    const result = await pushSessionToBundle(sessionId, bundle.bundle_id);
    expect(result.pushed).toBe(0);
    expect(result.total).toBe(0);
  });
});
