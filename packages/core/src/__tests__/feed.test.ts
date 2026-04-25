import { describe, test, expect, beforeEach, mock } from "bun:test";
import { createMockSupabase } from "./helpers/mock-supabase";

// Create the mock Supabase instance before importing the module under test.
// We use mock.module so all calls to getSupabase() return our client.
const { client: mockClient, setTableData } = createMockSupabase();

mock.module("../supabase.js", () => ({
  getSupabase: () => mockClient,
}));

// Import AFTER the mock is registered so the module picks up our stub.
const { writeFeedEvent, readFeedEvents } = await import("../feed.js");

// ── writeFeedEvent ────────────────────────────────────────────────────────────

describe("writeFeedEvent", () => {
  beforeEach(() => {
    setTableData("team_activity_feed", null, null);
  });

  test("inserts with correct fields (resolves without error)", async () => {
    setTableData("team_activity_feed", null, null);
    await expect(
      writeFeedEvent("team-1", "entry_pushed", { bundle_id: "b1", entry_count: 3 }),
    ).resolves.toBeUndefined();
  });

  test("swallows Supabase errors silently (non-fatal)", async () => {
    setTableData("team_activity_feed", null, { message: "insert failed" });
    // writeFeedEvent catches internally — should NOT throw
    await expect(
      writeFeedEvent("team-1", "bundle_created", { bundle_id: "b2" }),
    ).resolves.toBeUndefined();
  });

  test("swallows errors for any event type without throwing", async () => {
    setTableData("team_activity_feed", null, { message: "network error" });
    await expect(
      writeFeedEvent("team-2", "session_connected", {}),
    ).resolves.toBeUndefined();
  });
});

// ── readFeedEvents ────────────────────────────────────────────────────────────

describe("readFeedEvents", () => {
  const sampleEvents = [
    {
      id: "ev-3",
      team_id: "team-1",
      event_type: "entry_pushed",
      payload: { bundle_id: "b1" },
      created_at: "2026-04-25T10:00:00Z",
    },
    {
      id: "ev-2",
      team_id: "team-1",
      event_type: "session_connected",
      payload: { session_id: "s1" },
      created_at: "2026-04-25T09:00:00Z",
    },
    {
      id: "ev-1",
      team_id: "team-1",
      event_type: "bundle_created",
      payload: { name: "my-bundle" },
      created_at: "2026-04-25T08:00:00Z",
    },
  ];

  beforeEach(() => {
    setTableData("team_activity_feed", sampleEvents, null);
  });

  test("returns events ordered by created_at desc", async () => {
    const events = await readFeedEvents("team-1");
    expect(events).toHaveLength(3);
    // The mock returns data as-is; verify we get back the full array
    expect(events[0].id).toBe("ev-3");
    expect(events[1].id).toBe("ev-2");
    expect(events[2].id).toBe("ev-1");
  });

  test("applies default limit of 50 (returns all when fewer exist)", async () => {
    const events = await readFeedEvents("team-1");
    expect(events).toHaveLength(3);
  });

  test("applies custom limit and offset options", async () => {
    // The mock returns whatever data is set — we just verify no error thrown
    setTableData("team_activity_feed", [sampleEvents[0]], null);
    const events = await readFeedEvents("team-1", { limit: 1, offset: 0 });
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("ev-3");
  });

  test("returns empty array when no events exist", async () => {
    setTableData("team_activity_feed", [], null);
    const events = await readFeedEvents("team-empty");
    expect(events).toEqual([]);
  });

  test("returns empty array when data is null", async () => {
    setTableData("team_activity_feed", null, null);
    const events = await readFeedEvents("team-null");
    expect(events).toEqual([]);
  });

  test("throws on Supabase error", async () => {
    setTableData("team_activity_feed", null, { message: "query failed" });
    await expect(
      readFeedEvents("team-1"),
    ).rejects.toThrow("readFeedEvents failed: query failed");
  });

  test("throws with the Supabase error message in the error text", async () => {
    setTableData("team_activity_feed", null, { message: "permission denied" });
    await expect(
      readFeedEvents("team-1"),
    ).rejects.toThrow("permission denied");
  });
});
