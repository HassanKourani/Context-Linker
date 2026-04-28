/**
 * RLS isolation tests.
 *
 * These hit a REAL Supabase project and verify that the policies in
 * `supabase/migrations/0011_auth_rls.sql` actually prevent cross-team
 * access. Skipped unless the following env vars are set:
 *
 *   CTX_LINK_TEST_SUPABASE_URL
 *   CTX_LINK_TEST_ANON_KEY
 *   CTX_LINK_TEST_USER_A_EMAIL
 *   CTX_LINK_TEST_USER_A_PASSWORD
 *   CTX_LINK_TEST_USER_B_EMAIL
 *   CTX_LINK_TEST_USER_B_PASSWORD
 *
 * Setup expectations (one-time, in the test project):
 *   1. Migration 0011 applied.
 *   2. Two user accounts exist with the email/password pairs above.
 *   3. Email confirmation disabled (Supabase Auth → Settings) so
 *      signInWithPassword works on a fresh signup.
 *
 * The tests create a team owned by user A and verify user B cannot
 * read, write, or delete any of A's resources.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.CTX_LINK_TEST_SUPABASE_URL;
const KEY = process.env.CTX_LINK_TEST_ANON_KEY;
const A_EMAIL = process.env.CTX_LINK_TEST_USER_A_EMAIL;
const A_PASS = process.env.CTX_LINK_TEST_USER_A_PASSWORD;
const B_EMAIL = process.env.CTX_LINK_TEST_USER_B_EMAIL;
const B_PASS = process.env.CTX_LINK_TEST_USER_B_PASSWORD;

const HAS_CONFIG = Boolean(URL && KEY && A_EMAIL && A_PASS && B_EMAIL && B_PASS);

const describeIf = HAS_CONFIG ? describe : describe.skip;

describeIf("RLS cross-team isolation", () => {
  let sbA: SupabaseClient;
  let sbB: SupabaseClient;
  let teamAId: string;
  let bundleAId: string;

  // Storage stubs so neither client touches the dev's ~/.ctx-link/auth.json.
  const memStorage = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  };

  beforeAll(async () => {
    sbA = createClient(URL!, KEY!, {
      auth: {
        storage: memStorage(),
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    sbB = createClient(URL!, KEY!, {
      auth: {
        storage: memStorage(),
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const a = await sbA.auth.signInWithPassword({ email: A_EMAIL!, password: A_PASS! });
    expect(a.error).toBeNull();
    expect(a.data.user).toBeTruthy();

    const b = await sbB.auth.signInWithPassword({ email: B_EMAIL!, password: B_PASS! });
    expect(b.error).toBeNull();
    expect(b.data.user).toBeTruthy();

    // User A creates a team and a bundle inside it.
    const teamName = `rls-test-${Date.now()}`;
    const teamRes = await sbA.rpc("team_create_v2", {
      p_name: teamName,
      p_join_code: "test-join-code",
    });
    expect(teamRes.error).toBeNull();
    teamAId = (teamRes.data as { team_id: string }).team_id;

    const bundleRes = await sbA
      .from("bundles")
      .insert({ name: "team-a-bundle", team_id: teamAId })
      .select("id")
      .single();
    expect(bundleRes.error).toBeNull();
    bundleAId = bundleRes.data!.id;
  });

  afterAll(async () => {
    // Best-effort cleanup. RLS lets A delete their own resources.
    if (sbA && teamAId) {
      try {
        await sbA.from("bundles").delete().eq("id", bundleAId);
        await sbA.from("teams").delete().eq("id", teamAId);
      } catch {}
      try { await sbA.auth.signOut(); } catch {}
    }
    if (sbB) {
      try { await sbB.auth.signOut(); } catch {}
    }
  });

  test("B cannot SELECT A's bundle", async () => {
    const { data, error } = await sbB
      .from("bundles")
      .select("id, name")
      .eq("id", bundleAId);
    // RLS hides rows; query succeeds with empty result rather than erroring.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  test("B cannot SELECT A's team", async () => {
    const { data, error } = await sbB
      .from("teams")
      .select("id, name")
      .eq("id", teamAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  test("B cannot SELECT team_members for A's team", async () => {
    const { data, error } = await sbB
      .from("team_members")
      .select("user_id")
      .eq("team_id", teamAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  test("B cannot INSERT a bundle into A's team", async () => {
    const { error } = await sbB
      .from("bundles")
      .insert({ name: "intruder", team_id: teamAId })
      .select("id");
    // RLS WITH CHECK blocks the insert; expect an error.
    expect(error).not.toBeNull();
  });

  test("B cannot UPDATE A's bundle", async () => {
    const { data, error } = await sbB
      .from("bundles")
      .update({ name: "hacked" })
      .eq("id", bundleAId)
      .select("id");
    // Either the update errors OR the row is invisible (no rows affected).
    expect(error === null ? (data ?? []).length : 1).toBe(error === null ? 0 : 1);
  });

  test("B cannot DELETE A's bundle", async () => {
    const { data, error } = await sbB
      .from("bundles")
      .delete()
      .eq("id", bundleAId)
      .select("id");
    // Deletion silently affects 0 rows under RLS.
    expect(error === null ? (data ?? []).length : 1).toBe(error === null ? 0 : 1);

    // Verify A's bundle still exists.
    const check = await sbA
      .from("bundles")
      .select("id")
      .eq("id", bundleAId)
      .single();
    expect(check.error).toBeNull();
    expect(check.data?.id).toBe(bundleAId);
  });

  test("B cannot join A's team without the join code", async () => {
    const { error } = await sbB.rpc("team_join_with_code", {
      p_name: "no-such-team-12345",
      p_join_code: "wrong",
    });
    expect(error).not.toBeNull();
  });

  test("B CAN join A's team if they know the join code", async () => {
    // Have to pull team name from A's view since B can't SELECT teams.
    const teamRow = await sbA.from("teams").select("name").eq("id", teamAId).single();
    expect(teamRow.error).toBeNull();
    const teamName = teamRow.data!.name;

    const { error } = await sbB.rpc("team_join_with_code", {
      p_name: teamName,
      p_join_code: "test-join-code",
    });
    expect(error).toBeNull();

    // Now B should be able to read the bundle.
    const visible = await sbB
      .from("bundles")
      .select("id")
      .eq("id", bundleAId);
    expect(visible.error).toBeNull();
    expect(visible.data?.length).toBe(1);

    // Cleanup: B leaves the team so subsequent cross-team tests still hold.
    const userB = await sbB.auth.getUser();
    if (userB.data.user) {
      await sbB
        .from("team_members")
        .delete()
        .eq("team_id", teamAId)
        .eq("user_id", userB.data.user.id);
    }
  });

  test("anon client (no JWT) sees nothing", async () => {
    const anonOnly = createClient(URL!, KEY!, {
      auth: {
        storage: memStorage(),
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    const { data, error } = await anonOnly.from("bundles").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

if (!HAS_CONFIG) {
  // Surface the skip reason loudly in the test output so it isn't silent.
  // eslint-disable-next-line no-console
  console.warn(
    "[rls.test] skipped — set CTX_LINK_TEST_SUPABASE_URL, CTX_LINK_TEST_ANON_KEY, " +
      "CTX_LINK_TEST_USER_A_{EMAIL,PASSWORD}, and CTX_LINK_TEST_USER_B_{EMAIL,PASSWORD} to run.",
  );
}
