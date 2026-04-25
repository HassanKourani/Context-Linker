import { describe, test, expect, beforeEach, mock } from "bun:test";
import { createMockSupabase } from "./helpers/mock-supabase";

// Create the mock Supabase instance before importing the module under test.
// We use mock.module so all calls to getSupabase() return our client.
const { client: mockClient, setTableData } = createMockSupabase();

mock.module("../supabase.js", () => ({
  getSupabase: () => mockClient,
}));

// Import AFTER the mock is registered so the module picks up our stub.
const { excludeEntryFromBundle, includeEntryInBundle, getExcludedEntryIds } =
  await import("../exclusions.js");

// ── excludeEntryFromBundle ───────────────────────────────────────────────────

describe("excludeEntryFromBundle", () => {
  beforeEach(() => {
    // Reset table state before each test
    setTableData("excluded_entry_refs", null, null);
  });

  test("resolves without error on success", async () => {
    setTableData("excluded_entry_refs", null, null);
    await expect(
      excludeEntryFromBundle("bundle-1", "entry-1"),
    ).resolves.toBeUndefined();
  });

  test("resolves without error when machineId is provided", async () => {
    setTableData("excluded_entry_refs", null, null);
    await expect(
      excludeEntryFromBundle("bundle-1", "entry-1", "machine-abc"),
    ).resolves.toBeUndefined();
  });

  test("throws when Supabase returns an error", async () => {
    setTableData("excluded_entry_refs", null, { message: "upsert conflict" });
    await expect(
      excludeEntryFromBundle("bundle-1", "entry-1"),
    ).rejects.toThrow("excludeEntryFromBundle failed: upsert conflict");
  });

  test("throws with the Supabase error message in the error text", async () => {
    setTableData("excluded_entry_refs", null, { message: "permission denied" });
    await expect(
      excludeEntryFromBundle("bundle-2", "entry-2"),
    ).rejects.toThrow("permission denied");
  });
});

// ── includeEntryInBundle ─────────────────────────────────────────────────────

describe("includeEntryInBundle", () => {
  beforeEach(() => {
    setTableData("excluded_entry_refs", null, null);
  });

  test("resolves without error on success", async () => {
    setTableData("excluded_entry_refs", null, null);
    await expect(
      includeEntryInBundle("bundle-1", "entry-1"),
    ).resolves.toBeUndefined();
  });

  test("throws when Supabase returns an error", async () => {
    setTableData("excluded_entry_refs", null, { message: "row not found" });
    await expect(
      includeEntryInBundle("bundle-1", "entry-1"),
    ).rejects.toThrow("includeEntryInBundle failed: row not found");
  });

  test("throws with the Supabase error message in the error text", async () => {
    setTableData("excluded_entry_refs", null, { message: "network error" });
    await expect(
      includeEntryInBundle("bundle-3", "entry-3"),
    ).rejects.toThrow("network error");
  });
});

// ── getExcludedEntryIds ──────────────────────────────────────────────────────

describe("getExcludedEntryIds", () => {
  test("returns a Set of entry IDs from query results", async () => {
    setTableData("excluded_entry_refs", [
      { entry_id: "e1" },
      { entry_id: "e2" },
      { entry_id: "e3" },
    ], null);

    const result = await getExcludedEntryIds("bundle-1");

    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(3);
    expect(result.has("e1")).toBe(true);
    expect(result.has("e2")).toBe(true);
    expect(result.has("e3")).toBe(true);
  });

  test("returns empty Set when no exclusions exist", async () => {
    setTableData("excluded_entry_refs", [], null);

    const result = await getExcludedEntryIds("bundle-empty");

    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  test("returns empty Set when data is null", async () => {
    setTableData("excluded_entry_refs", null, null);

    const result = await getExcludedEntryIds("bundle-null");

    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  test("throws when Supabase returns an error", async () => {
    setTableData("excluded_entry_refs", null, { message: "query failed" });

    await expect(
      getExcludedEntryIds("bundle-1"),
    ).rejects.toThrow("getExcludedEntryIds failed: query failed");
  });

  test("throws with the Supabase error message in the error text", async () => {
    setTableData("excluded_entry_refs", null, { message: "timeout" });

    await expect(
      getExcludedEntryIds("bundle-2"),
    ).rejects.toThrow("timeout");
  });

  test("returns a Set with a single entry ID", async () => {
    setTableData("excluded_entry_refs", [{ entry_id: "only-one" }], null);

    const result = await getExcludedEntryIds("bundle-single");

    expect(result.size).toBe(1);
    expect(result.has("only-one")).toBe(true);
  });
});
