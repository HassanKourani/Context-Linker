import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { setupTestDir, cleanupTestDir } from "./helpers/mock-fs";
import { localCreateBundle } from "../local-store.js";
import {
  ROLES,
  ROLE_PRIORITY,
  rolePriority,
  getOrCreateNotesSession,
  type Role,
} from "../notes.js";
import { loadActiveSession, deleteActiveSession } from "../config.js";

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
