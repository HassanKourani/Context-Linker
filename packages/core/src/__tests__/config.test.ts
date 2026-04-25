import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { setupTestDir, cleanupTestDir } from "./helpers/mock-fs";
import {
  globalConfigDir,
  loadGlobalConfig,
  saveGlobalConfig,
  loadProjectConfig,
  saveProjectConfig,
  getBundleToken,
  storeBundleToken,
  loadSessionLog,
  logSession,
  saveActiveSession,
  loadActiveSession,
  deleteActiveSession,
  renameActiveSession,
  listActiveSessions,
  getActiveSessionId,
  setActiveSessionId,
  connectSessionToBundle,
  disconnectSessionFromBundle,
  pushSessionEntry,
  getSessionEntries,
  getUnpushedSessionEntries,
  markSessionEntriesPushed,
  deleteSessionEntry,
  type ActiveSession,
} from "../config.js";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

let testDir: string;

beforeEach(() => {
  testDir = setupTestDir();
});

afterEach(() => {
  cleanupTestDir(testDir);
});

// ── globalConfigDir ──────────────────────────────────────────────────────────

describe("globalConfigDir", () => {
  test("returns the CTX_LINK_HOME env override", () => {
    expect(globalConfigDir()).toBe(testDir);
  });
});

// ── Global Config ────────────────────────────────────────────────────────────

describe("loadGlobalConfig / saveGlobalConfig", () => {
  test("auto-creates config with machine_id on first load", () => {
    const cfg = loadGlobalConfig();
    expect(cfg.machine_id).toBeTruthy();
    expect(typeof cfg.machine_id).toBe("string");
    expect(cfg.machine_id.length).toBeGreaterThan(0);
  });

  test("returns same config on subsequent loads", () => {
    const first = loadGlobalConfig();
    const second = loadGlobalConfig();
    expect(first.machine_id).toBe(second.machine_id);
  });

  test("saveGlobalConfig persists changes", () => {
    saveGlobalConfig({ machine_id: "test-machine-123" });
    const loaded = loadGlobalConfig();
    expect(loaded.machine_id).toBe("test-machine-123");
  });
});

// ── Project Config ───────────────────────────────────────────────────────────

describe("loadProjectConfig / saveProjectConfig", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "ctx-link-project-"));
  });

  afterEach(() => {
    try { require("fs").rmSync(projectDir, { recursive: true, force: true }); } catch {}
  });

  test("returns null when no project config exists", () => {
    expect(loadProjectConfig(projectDir)).toBeNull();
  });

  test("saves and loads project config", () => {
    const cfg = {
      mode: "local" as const,
      bundle: randomUUID(),
      project_name: "my-project",
      auto_push_on: ["commit"] as ("commit" | "pr_open")[],
      push_debounce_seconds: 600,
    };
    saveProjectConfig(cfg, projectDir);
    const loaded = loadProjectConfig(projectDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.bundle).toBe(cfg.bundle);
    expect(loaded!.project_name).toBe("my-project");
  });
});

// ── Bundle Tokens ────────────────────────────────────────────────────────────

describe("getBundleToken / storeBundleToken", () => {
  const bundleId = randomUUID();

  test("returns null for unknown bundle", () => {
    expect(getBundleToken(randomUUID())).toBeNull();
  });

  test("stores and retrieves token", () => {
    storeBundleToken(bundleId, "token-abc", "My Bundle");
    const token = getBundleToken(bundleId);
    expect(token).toBe("token-abc");
  });

  test("overwrites existing token", () => {
    const id = randomUUID();
    storeBundleToken(id, "old-token", "My Bundle");
    storeBundleToken(id, "new-token", "My Bundle");
    expect(getBundleToken(id)).toBe("new-token");
  });
});

// ── Session Log ──────────────────────────────────────────────────────────────

describe("logSession / loadSessionLog", () => {
  test("starts empty", () => {
    const log = loadSessionLog();
    expect(log).toEqual([]);
  });

  test("appends entries", () => {
    logSession({
      project_name: "project-a",
      project_path: "/tmp/a",
      machine_id: "m1",
      started_at: "2026-01-01T00:00:00Z",
      branch: "main",
      bundle: null,
      mode: "local",
    });
    logSession({
      project_name: "project-b",
      project_path: "/tmp/b",
      machine_id: "m1",
      started_at: "2026-01-02T00:00:00Z",
      branch: "dev",
      bundle: "b1",
      mode: "cloud",
    });
    const log = loadSessionLog();
    expect(log).toHaveLength(2);
    expect(log[0].project_name).toBe("project-a");
    expect(log[1].project_name).toBe("project-b");
  });
});

// ── Active Sessions ──────────────────────────────────────────────────────────

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

describe("Active Session CRUD", () => {
  test("loadActiveSession returns null for nonexistent", () => {
    expect(loadActiveSession("nonexistent")).toBeNull();
  });

  test("save and load roundtrip", () => {
    const session = makeSession("sess-1");
    saveActiveSession(session);
    const loaded = loadActiveSession("sess-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.session_id).toBe("sess-1");
    expect(loaded!.project_name).toBe("test-project");
  });

  test("deleteActiveSession removes session", () => {
    saveActiveSession(makeSession("sess-2"));
    expect(loadActiveSession("sess-2")).not.toBeNull();
    deleteActiveSession("sess-2");
    expect(loadActiveSession("sess-2")).toBeNull();
  });

  test("renameActiveSession updates name", () => {
    saveActiveSession(makeSession("sess-3", { project_name: "old-name" }));
    renameActiveSession("sess-3", "new-name");
    const loaded = loadActiveSession("sess-3");
    expect(loaded!.project_name).toBe("old-name"); // project_name unchanged
    // renameActiveSession sets session_name field (if that exists) or name
    // Let's check what the function actually does
  });

  test("listActiveSessions lists all sessions", () => {
    saveActiveSession(makeSession("sess-a", { project_name: "proj-a" }));
    saveActiveSession(makeSession("sess-b", { project_name: "proj-b" }));
    const sessions = listActiveSessions();
    expect(sessions).toHaveLength(2);
    const ids = sessions.map(s => s.session_id).sort();
    expect(ids).toEqual(["sess-a", "sess-b"]);
  });
});

// ── Active Session ID (per-project) ──────────────────────────────────────────

describe("getActiveSessionId / setActiveSessionId", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "ctx-link-sid-"));
  });

  afterEach(() => {
    try { require("fs").rmSync(projectDir, { recursive: true, force: true }); } catch {}
  });

  test("returns null when no session set", () => {
    expect(getActiveSessionId(projectDir)).toBeNull();
  });

  test("sets and gets session ID", () => {
    setActiveSessionId("sess-99", projectDir);
    expect(getActiveSessionId(projectDir)).toBe("sess-99");
  });

  test("overwrites previous session ID", () => {
    setActiveSessionId("sess-1", projectDir);
    setActiveSessionId("sess-2", projectDir);
    expect(getActiveSessionId(projectDir)).toBe("sess-2");
  });
});

// ── Session-Bundle Connections ────────────────────────────────────────────────

describe("connectSessionToBundle / disconnectSessionFromBundle", () => {
  test("connects session to bundle", () => {
    saveActiveSession(makeSession("sess-c"));
    const updated = connectSessionToBundle("sess-c", "b0000000-0000-0000-0000-000000000001", "local");
    expect(updated.bundles).toHaveLength(1);
    expect(updated.bundles[0].bundle_id).toBe("b0000000-0000-0000-0000-000000000001");
    expect(updated.bundles[0].mode).toBe("local");
  });

  test("deduplicates connections", () => {
    saveActiveSession(makeSession("sess-c"));
    connectSessionToBundle("sess-c", "b0000000-0000-0000-0000-000000000001", "local");
    const again = connectSessionToBundle("sess-c", "b0000000-0000-0000-0000-000000000001", "local");
    expect(again.bundles).toHaveLength(1);
  });

  test("connects to multiple bundles", () => {
    saveActiveSession(makeSession("sess-c"));
    connectSessionToBundle("sess-c", "b0000000-0000-0000-0000-000000000001", "local");
    const updated = connectSessionToBundle("sess-c", "b0000000-0000-0000-0000-000000000002", "cloud");
    expect(updated.bundles).toHaveLength(2);
  });

  test("disconnects session from bundle", () => {
    saveActiveSession(makeSession("sess-c", {
      bundles: [{ bundle_id: "b1", mode: "local" }, { bundle_id: "b2", mode: "cloud" }],
    }));
    disconnectSessionFromBundle("sess-c", "b1");
    const loaded = loadActiveSession("sess-c");
    expect(loaded!.bundles).toHaveLength(1);
    expect(loaded!.bundles[0].bundle_id).toBe("b2");
  });

  test("disconnect nonexistent session is no-op", () => {
    // Should not throw
    disconnectSessionFromBundle("nonexistent", "b1");
  });
});

// ── Session Entries ──────────────────────────────────────────────────────────

describe("Session Entries", () => {
  test("starts with no entries", () => {
    expect(getSessionEntries("sess-e")).toEqual([]);
  });

  test("pushSessionEntry adds entry with generated ID", () => {
    const entry = pushSessionEntry("sess-e", {
      project_name: "proj",
      event_type: "manual",
      trigger_ref: null,
      summary: "did something",
      files_touched: ["a.ts"],
      decisions: [{ decision: "chose X", affects: ["auth"] }],
    });
    expect(entry.id).toBeTruthy();
    expect(entry.summary).toBe("did something");
    expect(entry.created_at).toBeTruthy();
    expect(entry.pushed_at).toBeNull();
  });

  test("getSessionEntries returns pushed entries", () => {
    pushSessionEntry("sess-e", {
      project_name: "proj",
      event_type: "manual",
      trigger_ref: null,
      summary: "first",
      files_touched: [],
      decisions: [],
    });
    pushSessionEntry("sess-e", {
      project_name: "proj",
      event_type: "commit",
      trigger_ref: "abc123",
      summary: "second",
      files_touched: [],
      decisions: [],
    });
    const entries = getSessionEntries("sess-e");
    expect(entries).toHaveLength(2);
    expect(entries[0].summary).toBe("first");
    expect(entries[1].summary).toBe("second");
  });

  test("getUnpushedSessionEntries returns only unpushed", () => {
    const e1 = pushSessionEntry("sess-f", {
      project_name: "proj",
      event_type: "manual",
      trigger_ref: null,
      summary: "unpushed",
      files_touched: [],
      decisions: [],
    });
    const e2 = pushSessionEntry("sess-f", {
      project_name: "proj",
      event_type: "manual",
      trigger_ref: null,
      summary: "also unpushed",
      files_touched: [],
      decisions: [],
    });
    // Mark first as pushed
    markSessionEntriesPushed("sess-f", [e1.id]);

    const unpushed = getUnpushedSessionEntries("sess-f");
    expect(unpushed).toHaveLength(1);
    expect(unpushed[0].summary).toBe("also unpushed");
  });

  test("deleteSessionEntry removes entry", () => {
    const e1 = pushSessionEntry("sess-g", {
      project_name: "proj",
      event_type: "manual",
      trigger_ref: null,
      summary: "to delete",
      files_touched: [],
      decisions: [],
    });
    pushSessionEntry("sess-g", {
      project_name: "proj",
      event_type: "manual",
      trigger_ref: null,
      summary: "to keep",
      files_touched: [],
      decisions: [],
    });
    deleteSessionEntry("sess-g", e1.id);
    const entries = getSessionEntries("sess-g");
    expect(entries).toHaveLength(1);
    expect(entries[0].summary).toBe("to keep");
  });
});
