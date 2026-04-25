import { describe, test, expect, beforeEach, mock } from "bun:test";
import { createMockSupabase } from "./helpers/mock-supabase";

// ── isJoinCode (pure, no Supabase needed) ────────────────────────────────────

// Import isJoinCode directly — it's pure and requires no mocking
const { isJoinCode } = await import("../join-codes.js");

describe("isJoinCode", () => {
  test("returns true for valid ctx- codes", () => {
    expect(isJoinCode("ctx-abc123")).toBe(true);
    expect(isJoinCode("ctx-000000")).toBe(true);
    expect(isJoinCode("ctx-zzzzzz")).toBe(true);
    expect(isJoinCode("CTX-ABC123")).toBe(true); // case-insensitive check via .toLowerCase()
  });

  test("returns false for UUIDs", () => {
    expect(isJoinCode("550e8400-e29b-41d4-a716-446655440000")).toBe(false);
  });

  test("returns false for random strings without prefix", () => {
    expect(isJoinCode("abc123")).toBe(false);
    expect(isJoinCode("bundle-abc123")).toBe(false);
    expect(isJoinCode("")).toBe(false);
  });

  test("returns false for wrong prefix", () => {
    expect(isJoinCode("ctx_abc123")).toBe(false);
    expect(isJoinCode("link-abc123")).toBe(false);
  });

  test("returns false when code length is wrong (too short or too long)", () => {
    expect(isJoinCode("ctx-abc12")).toBe(false);   // only 5 chars after prefix
    expect(isJoinCode("ctx-abc1234")).toBe(false); // 7 chars after prefix
  });
});

// ── Supabase-backed functions ─────────────────────────────────────────────────
// We use mock.module to stub getSupabase() before importing the module under test.

// ── createJoinCode ────────────────────────────────────────────────────────────

describe("createJoinCode", () => {
  test("returns a code starting with 'ctx-'", async () => {
    const { client: mockClient, setTableData } = createMockSupabase();

    mock.module("../supabase.js", () => ({ getSupabase: () => mockClient }));

    const { createJoinCode } = await import("../join-codes.js");

    // Uniqueness check returns empty (no collision), insert succeeds
    setTableData("bundle_join_codes", [], null);

    const code = await createJoinCode("bundle-1", "tok-abc");
    expect(code).toMatch(/^ctx-[a-z0-9]{6}$/);
  });

  test("retries on collision and returns a new code", async () => {
    // Simulate: first uniqueness check returns existing row (collision),
    // second returns empty (no collision). Insert succeeds.
    let selectCallCount = 0;

    const collisionClient = {
      from: (_table: string) => ({
        select: (..._args: any[]) => ({
          eq: (..._args: any[]) => ({
            limit: (..._args: any[]) => {
              const result = selectCallCount === 0
                ? { data: [{ code: "ctx-exists" }], error: null }
                : { data: [], error: null };
              selectCallCount++;
              return Promise.resolve(result);
            },
          }),
        }),
        insert: (..._args: any[]) => Promise.resolve({ error: null }),
        delete: (..._args: any[]) => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    };

    mock.module("../supabase.js", () => ({ getSupabase: () => collisionClient }));

    const { createJoinCode } = await import("../join-codes.js");
    const code = await createJoinCode("bundle-2", "tok-xyz");
    expect(code).toMatch(/^ctx-[a-z0-9]{6}$/);
    expect(selectCallCount).toBe(2); // one collision + one success
  });

  test("throws when insert fails", async () => {
    const { client: mockClient, setTableData } = createMockSupabase();

    mock.module("../supabase.js", () => ({ getSupabase: () => mockClient }));
    const { createJoinCode } = await import("../join-codes.js");

    // Uniqueness check returns empty, insert returns error
    setTableData("bundle_join_codes", [], { message: "insert failed" });

    await expect(createJoinCode("bundle-err", "tok")).rejects.toThrow(
      "createJoinCode failed: insert failed",
    );
  });
});

// ── resolveJoinCode ───────────────────────────────────────────────────────────

describe("resolveJoinCode", () => {
  test("returns bundle_id and token for a valid, non-expired code", async () => {
    const { client: mockClient } = createMockSupabase();

    mock.module("../supabase.js", () => ({ getSupabase: () => mockClient }));
    const { resolveJoinCode } = await import("../join-codes.js");

    const future = new Date(Date.now() + 86400_000).toISOString();
    const resolveClient = {
      from: (_table: string) => ({
        select: (..._args: any[]) => ({
          eq: (..._args: any[]) => ({
            limit: (..._args: any[]) => ({
              single: () =>
                Promise.resolve({
                  data: { bundle_id: "b-1", token: "tok-1", expires_at: future },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    };

    mock.module("../supabase.js", () => ({ getSupabase: () => resolveClient }));
    const { resolveJoinCode: resolve2 } = await import("../join-codes.js");

    const result = await resolve2("ctx-abc123");
    expect(result).toEqual({ bundle_id: "b-1", token: "tok-1" });
  });

  test("returns null for an expired code", async () => {
    const past = new Date(Date.now() - 86400_000).toISOString();
    const expiredClient = {
      from: (_table: string) => ({
        select: (..._args: any[]) => ({
          eq: (..._args: any[]) => ({
            limit: (..._args: any[]) => ({
              single: () =>
                Promise.resolve({
                  data: { bundle_id: "b-2", token: "tok-2", expires_at: past },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    };

    mock.module("../supabase.js", () => ({ getSupabase: () => expiredClient }));
    const { resolveJoinCode } = await import("../join-codes.js");

    const result = await resolveJoinCode("ctx-expired");
    expect(result).toBeNull();
  });

  test("returns null for a non-existent code", async () => {
    const notFoundClient = {
      from: (_table: string) => ({
        select: (..._args: any[]) => ({
          eq: (..._args: any[]) => ({
            limit: (..._args: any[]) => ({
              single: () =>
                Promise.resolve({ data: null, error: { message: "no rows" } }),
            }),
          }),
        }),
      }),
    };

    mock.module("../supabase.js", () => ({ getSupabase: () => notFoundClient }));
    const { resolveJoinCode } = await import("../join-codes.js");

    const result = await resolveJoinCode("ctx-notfnd");
    expect(result).toBeNull();
  });
});

// ── regenerateJoinCode ────────────────────────────────────────────────────────

describe("regenerateJoinCode", () => {
  test("deletes existing codes then creates a new one", async () => {
    let deleteCalled = false;
    let deleteEqArg = "";

    const regenClient = {
      from: (table: string) => ({
        select: (..._args: any[]) => ({
          eq: (..._args: any[]) => ({
            limit: (..._args: any[]) => Promise.resolve({ data: [], error: null }),
          }),
        }),
        insert: (..._args: any[]) => Promise.resolve({ error: null }),
        delete: () => ({
          eq: (_col: string, val: string) => {
            deleteCalled = true;
            deleteEqArg = val;
            return Promise.resolve({ error: null });
          },
        }),
      }),
    };

    mock.module("../supabase.js", () => ({ getSupabase: () => regenClient }));
    const { regenerateJoinCode } = await import("../join-codes.js");

    const code = await regenerateJoinCode("bundle-regen", "tok-regen");

    expect(deleteCalled).toBe(true);
    expect(deleteEqArg).toEqual("bundle-regen");
    expect(code).toMatch(/^ctx-[a-z0-9]{6}$/);
  });
});

// ── getJoinCode ───────────────────────────────────────────────────────────────

describe("getJoinCode", () => {
  test("returns null when no code exists (data is null)", async () => {
    const noCodeClient = {
      from: (_table: string) => ({
        select: (..._args: any[]) => ({
          eq: (..._args: any[]) => ({
            order: (..._args: any[]) => ({
              limit: (..._args: any[]) => ({
                single: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }),
    };

    mock.module("../supabase.js", () => ({ getSupabase: () => noCodeClient }));
    const { getJoinCode } = await import("../join-codes.js");

    const result = await getJoinCode("bundle-none");
    expect(result).toBeNull();
  });

  test("returns null when the only code is expired", async () => {
    const past = new Date(Date.now() - 86400_000).toISOString();
    const expiredCodeClient = {
      from: (_table: string) => ({
        select: (..._args: any[]) => ({
          eq: (..._args: any[]) => ({
            order: (..._args: any[]) => ({
              limit: (..._args: any[]) => ({
                single: () =>
                  Promise.resolve({
                    data: { code: "ctx-oldcod", expires_at: past },
                    error: null,
                  }),
              }),
            }),
          }),
        }),
      }),
    };

    mock.module("../supabase.js", () => ({ getSupabase: () => expiredCodeClient }));
    const { getJoinCode } = await import("../join-codes.js");

    const result = await getJoinCode("bundle-exp");
    expect(result).toBeNull();
  });

  test("returns the code when it exists and is not expired", async () => {
    const future = new Date(Date.now() + 86400_000).toISOString();
    const validCodeClient = {
      from: (_table: string) => ({
        select: (..._args: any[]) => ({
          eq: (..._args: any[]) => ({
            order: (..._args: any[]) => ({
              limit: (..._args: any[]) => ({
                single: () =>
                  Promise.resolve({
                    data: { code: "ctx-validc", expires_at: future },
                    error: null,
                  }),
              }),
            }),
          }),
        }),
      }),
    };

    mock.module("../supabase.js", () => ({ getSupabase: () => validCodeClient }));
    const { getJoinCode } = await import("../join-codes.js");

    const result = await getJoinCode("bundle-valid");
    expect(result).toBe("ctx-validc");
  });
});
