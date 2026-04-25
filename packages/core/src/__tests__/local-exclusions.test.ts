import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { setupTestDir, cleanupTestDir } from "./helpers/mock-fs";
import { randomUUID } from "node:crypto";
import {
  localCreateBundle,
  localExcludeEntryFromBundle,
  localIncludeEntryInBundle,
  localGetExcludedEntryIds,
} from "../local-store.js";

let testDir: string;

beforeEach(() => {
  testDir = setupTestDir();
});

afterEach(() => {
  cleanupTestDir(testDir);
});

// ── localExcludeEntryFromBundle ─────────────────────────────────────────────

describe("localExcludeEntryFromBundle", () => {
  test("creates excluded_refs.json and adds the entry", () => {
    const bundle = localCreateBundle("excl-test");
    const entryId = randomUUID();

    localExcludeEntryFromBundle(bundle.bundle_id, entryId);

    const excluded = localGetExcludedEntryIds(bundle.bundle_id);
    expect(excluded.has(entryId)).toBe(true);
    expect(excluded.size).toBe(1);
  });

  test("is idempotent — same entry added twice yields only one record", () => {
    const bundle = localCreateBundle("idempotent-excl");
    const entryId = randomUUID();

    localExcludeEntryFromBundle(bundle.bundle_id, entryId);
    localExcludeEntryFromBundle(bundle.bundle_id, entryId);

    const excluded = localGetExcludedEntryIds(bundle.bundle_id);
    expect(excluded.size).toBe(1);
  });

  test("can exclude multiple distinct entries", () => {
    const bundle = localCreateBundle("multi-excl");
    const e1 = randomUUID();
    const e2 = randomUUID();
    const e3 = randomUUID();

    localExcludeEntryFromBundle(bundle.bundle_id, e1);
    localExcludeEntryFromBundle(bundle.bundle_id, e2);
    localExcludeEntryFromBundle(bundle.bundle_id, e3);

    const excluded = localGetExcludedEntryIds(bundle.bundle_id);
    expect(excluded.size).toBe(3);
    expect(excluded.has(e1)).toBe(true);
    expect(excluded.has(e2)).toBe(true);
    expect(excluded.has(e3)).toBe(true);
  });
});

// ── localIncludeEntryInBundle ───────────────────────────────────────────────

describe("localIncludeEntryInBundle", () => {
  test("removes a previously excluded entry", () => {
    const bundle = localCreateBundle("include-test");
    const entryId = randomUUID();

    localExcludeEntryFromBundle(bundle.bundle_id, entryId);
    expect(localGetExcludedEntryIds(bundle.bundle_id).has(entryId)).toBe(true);

    localIncludeEntryInBundle(bundle.bundle_id, entryId);
    expect(localGetExcludedEntryIds(bundle.bundle_id).has(entryId)).toBe(false);
  });

  test("is a no-op when the entry was not excluded", () => {
    const bundle = localCreateBundle("include-noop");
    const e1 = randomUUID();
    const e2 = randomUUID();

    localExcludeEntryFromBundle(bundle.bundle_id, e1);
    // e2 was never excluded
    localIncludeEntryInBundle(bundle.bundle_id, e2);

    const excluded = localGetExcludedEntryIds(bundle.bundle_id);
    expect(excluded.size).toBe(1);
    expect(excluded.has(e1)).toBe(true);
  });

  test("leaves other excluded entries intact", () => {
    const bundle = localCreateBundle("include-partial");
    const e1 = randomUUID();
    const e2 = randomUUID();

    localExcludeEntryFromBundle(bundle.bundle_id, e1);
    localExcludeEntryFromBundle(bundle.bundle_id, e2);

    localIncludeEntryInBundle(bundle.bundle_id, e1);

    const excluded = localGetExcludedEntryIds(bundle.bundle_id);
    expect(excluded.size).toBe(1);
    expect(excluded.has(e1)).toBe(false);
    expect(excluded.has(e2)).toBe(true);
  });

  test("results in empty set when all excluded entries are re-included", () => {
    const bundle = localCreateBundle("include-all");
    const e1 = randomUUID();
    const e2 = randomUUID();

    localExcludeEntryFromBundle(bundle.bundle_id, e1);
    localExcludeEntryFromBundle(bundle.bundle_id, e2);

    localIncludeEntryInBundle(bundle.bundle_id, e1);
    localIncludeEntryInBundle(bundle.bundle_id, e2);

    const excluded = localGetExcludedEntryIds(bundle.bundle_id);
    expect(excluded.size).toBe(0);
  });
});

// ── localGetExcludedEntryIds ────────────────────────────────────────────────

describe("localGetExcludedEntryIds", () => {
  test("returns empty Set when no excluded_refs.json file exists", () => {
    const bundle = localCreateBundle("empty-excl");
    const excluded = localGetExcludedEntryIds(bundle.bundle_id);
    expect(excluded).toBeInstanceOf(Set);
    expect(excluded.size).toBe(0);
  });

  test("returns correct Set after excluding entries", () => {
    const bundle = localCreateBundle("correct-set");
    const e1 = randomUUID();
    const e2 = randomUUID();

    localExcludeEntryFromBundle(bundle.bundle_id, e1);
    localExcludeEntryFromBundle(bundle.bundle_id, e2);

    const excluded = localGetExcludedEntryIds(bundle.bundle_id);
    expect(excluded).toBeInstanceOf(Set);
    expect(excluded.size).toBe(2);
    expect(excluded.has(e1)).toBe(true);
    expect(excluded.has(e2)).toBe(true);
  });

  test("returns empty Set after including all previously excluded entries", () => {
    const bundle = localCreateBundle("re-included");
    const entryId = randomUUID();

    localExcludeEntryFromBundle(bundle.bundle_id, entryId);
    localIncludeEntryInBundle(bundle.bundle_id, entryId);

    const excluded = localGetExcludedEntryIds(bundle.bundle_id);
    expect(excluded.size).toBe(0);
  });

  test("does not return entries from a different bundle", () => {
    const bundleA = localCreateBundle("bundle-a");
    const bundleB = localCreateBundle("bundle-b");
    const entryId = randomUUID();

    localExcludeEntryFromBundle(bundleA.bundle_id, entryId);

    const excludedB = localGetExcludedEntryIds(bundleB.bundle_id);
    expect(excludedB.has(entryId)).toBe(false);
    expect(excludedB.size).toBe(0);
  });
});
