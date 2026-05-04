import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { setupTestDir, cleanupTestDir } from "./helpers/mock-fs";
import { localCreateBundle } from "../local-store.js";
import {
  ROLES,
  ROLE_PRIORITY,
  rolePriority,
  getOrCreateNotesSession,
  addBundleNote,
  type Role,
} from "../notes.js";
import { loadActiveSession, deleteActiveSession } from "../config.js";
import { localPullEntries } from "../local-store.js";

describe("Role enum + priority", () => {
  test("ROLES contains the seven defined roles", () => {
    expect(ROLES).toEqual(["ticket", "constraint", "design", "decision", "bug", "qa", "note"]);
  });

  test("ROLE_PRIORITY orders roles ticket < constraint < design < decision < bug < qa < note", () => {
    expect(ROLE_PRIORITY.ticket).toBeLessThan(ROLE_PRIORITY.constraint);
    expect(ROLE_PRIORITY.constraint).toBeLessThan(ROLE_PRIORITY.design);
    expect(ROLE_PRIORITY.design).toBeLessThan(ROLE_PRIORITY.decision);
    expect(ROLE_PRIORITY.decision).toBeLessThan(ROLE_PRIORITY.bug);
    expect(ROLE_PRIORITY.bug).toBeLessThan(ROLE_PRIORITY.qa);
    expect(ROLE_PRIORITY.qa).toBeLessThan(ROLE_PRIORITY.note);
  });

  test("rolePriority defaults missing role to note priority", () => {
    expect(rolePriority(undefined)).toBe(ROLE_PRIORITY.note);
    expect(rolePriority(null)).toBe(ROLE_PRIORITY.note);
    expect(rolePriority("ticket" as Role)).toBe(ROLE_PRIORITY.ticket);
  });
});

describe("getOrCreateNotesSession (local)", () => {
  let testDir: string;
  beforeEach(() => { testDir = setupTestDir(); });
  afterEach(() => { cleanupTestDir(testDir); });

  test("creates a hidden notes session and persists notes_session_id on the bundle", async () => {
    const bundle = localCreateBundle("test-bundle");
    const sessionId = await getOrCreateNotesSession(bundle.bundle_id);

    expect(sessionId).toBeTruthy();
    const session = loadActiveSession(sessionId);
    expect(session?.kind).toBe("notes");
  });

  test("returns the same session id on subsequent calls", async () => {
    const bundle = localCreateBundle("test-bundle");
    const a = await getOrCreateNotesSession(bundle.bundle_id);
    const b = await getOrCreateNotesSession(bundle.bundle_id);
    expect(a).toBe(b);
  });

  test("recreates if the stored notes_session_id no longer exists on disk", async () => {
    const bundle = localCreateBundle("test-bundle");
    const a = await getOrCreateNotesSession(bundle.bundle_id);

    deleteActiveSession(a);

    const b = await getOrCreateNotesSession(bundle.bundle_id);
    expect(b).not.toBe(a);
  });
});

describe("addBundleNote (local)", () => {
  let testDir: string;
  beforeEach(() => { testDir = setupTestDir(); });
  afterEach(() => { cleanupTestDir(testDir); });

  test("creates the entry in the bundle's notes session and refs it", async () => {
    const bundle = localCreateBundle("test-bundle");
    const result = await addBundleNote({
      bundle_id: bundle.bundle_id,
      summary: "the goal: ship the dashboard",
      role: "ticket",
    });

    expect(result.entry_id).toBeTruthy();
    expect(result.role).toBe("ticket");
    expect(result.notes_session_id).toBeTruthy();

    const entries = localPullEntries({ bundle_id: bundle.bundle_id });
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("the goal: ship the dashboard");
    expect(entries[0].role).toBe("ticket");
  });

  test("defaults role to 'note' when omitted", async () => {
    const bundle = localCreateBundle("test-bundle");
    const result = await addBundleNote({
      bundle_id: bundle.bundle_id,
      summary: "general background",
    });
    expect(result.role).toBe("note");
  });

  test("rejects empty summary", async () => {
    const bundle = localCreateBundle("test-bundle");
    await expect(addBundleNote({
      bundle_id: bundle.bundle_id,
      summary: "",
    })).rejects.toThrow(/summary/);
  });

  test("rejects unknown role", async () => {
    const bundle = localCreateBundle("test-bundle");
    await expect(addBundleNote({
      bundle_id: bundle.bundle_id,
      summary: "ok",
      // @ts-expect-error — testing runtime guard
      role: "bogus",
    })).rejects.toThrow(/role/);
  });
});

describe("localPullEntries returns entries sorted by role priority", () => {
  let testDir: string;
  beforeEach(() => { testDir = setupTestDir(); });
  afterEach(() => { cleanupTestDir(testDir); });

  test("ticket comes before note", async () => {
    const bundle = localCreateBundle("b");
    await addBundleNote({ bundle_id: bundle.bundle_id, summary: "general", role: "note" });
    await addBundleNote({ bundle_id: bundle.bundle_id, summary: "scope", role: "ticket" });

    const rows = localPullEntries({ bundle_id: bundle.bundle_id });
    expect(rows[0].role).toBe("ticket");
    expect(rows[1].role).toBe("note");
  });
});

describe("renderEntriesForClaude groups by role", () => {
  test("renders sections in priority order", async () => {
    const { renderEntriesForClaude } = await import("../entries.js");
    const md = renderEntriesForClaude([
      { id: "1", created_at: "2026-04-28T00:00:00Z", updated_at: null, project_name: "p", event_type: "manual",
        trigger_ref: null, title: "general", summary: "general", files_touched: [], decisions: [], role: "note" },
      { id: "2", created_at: "2026-04-28T00:01:00Z", updated_at: null, project_name: "p", event_type: "manual",
        trigger_ref: null, title: "scope anchor", summary: "scope anchor", files_touched: [], decisions: [], role: "ticket" },
    ]);

    expect(md.indexOf("## Ticket")).toBeLessThan(md.indexOf("## Notes"));
    expect(md).toContain("scope anchor");
    expect(md).toContain("general");
  });
});
