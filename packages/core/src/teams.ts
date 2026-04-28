import { getSupabase } from "./supabase.js";
import { requireSession, NotAuthenticatedError } from "./auth.js";
import { globalConfigDir } from "./config.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ---------- Local team store ----------
//
// A small cache of {team_id → name} for fast sync `listMyTeams()` reads
// without a round-trip. Source of truth is Supabase + RLS; this cache is
// populated on createTeam/joinTeam and refreshable via refreshTeamsCache().

interface LocalTeamEntry {
  team_id: string;
  name: string;
  joined_at: string;
}

function teamStorePath(): string {
  return join(globalConfigDir(), "teams.json");
}

function loadTeamStore(): Record<string, LocalTeamEntry> {
  const p = teamStorePath();
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf8"));
}

function saveTeamStore(store: Record<string, LocalTeamEntry>): void {
  const dir = globalConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(teamStorePath(), JSON.stringify(store, null, 2), { mode: 0o600 });
}

// ---------- Public API ----------

export interface CreateTeamResult {
  team_id: string;
  name: string;
}

/**
 * Create a team. Requires the caller to be signed in via Supabase Auth.
 * The RPC `team_create_v2` runs SECURITY DEFINER, hashes the join code with
 * bcrypt, inserts the team row, and adds the caller as the first member.
 */
export async function createTeam(
  name: string,
  joinCode: string,
): Promise<CreateTeamResult> {
  await requireSession();
  const sb = getSupabase();

  const { data, error } = await sb.rpc("team_create_v2", {
    p_name: name,
    p_join_code: joinCode,
  });

  if (error) {
    if (error.code === "23505") {
      throw new Error(`Team "${name}" already exists.`);
    }
    throw new Error(`createTeam failed: ${error.message}`);
  }

  const result = data as { team_id: string; name: string };
  const store = loadTeamStore();
  store[result.team_id] = {
    team_id: result.team_id,
    name: result.name,
    joined_at: new Date().toISOString(),
  };
  saveTeamStore(store);

  return result;
}

export interface JoinTeamResult {
  team_id: string;
  name: string;
}

/**
 * Join a team by name + join code. Requires the caller to be signed in.
 * The RPC verifies the join code via bcrypt server-side and inserts the
 * caller into team_members under their auth.uid().
 */
export async function joinTeam(
  name: string,
  joinCode: string,
): Promise<JoinTeamResult> {
  await requireSession();
  const sb = getSupabase();

  const { data, error } = await sb.rpc("team_join_with_code", {
    p_name: name,
    p_join_code: joinCode,
  });

  if (error) {
    if (error.code === "P0002") throw new Error(`Team "${name}" not found.`);
    if (error.code === "42501") throw new Error("Invalid join code.");
    throw new Error(`joinTeam failed: ${error.message}`);
  }

  const result = data as { team_id: string; name: string };
  const store = loadTeamStore();
  store[result.team_id] = {
    team_id: result.team_id,
    name: result.name,
    joined_at: new Date().toISOString(),
  };
  saveTeamStore(store);

  return result;
}

/**
 * Friendly pre-check: throws a readable error if the caller isn't a member
 * of the given team. RLS will also block the underlying op, but errors are
 * less informative there.
 */
export async function assertTeamMember(teamId: string): Promise<void> {
  const user = await requireSession();
  const sb = getSupabase();

  const { data, error } = await sb
    .from("team_members")
    .select("id")
    .eq("team_id", teamId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw new Error(`assertTeamMember failed: ${error.message}`);
  if (!data) throw new Error("You are not a member of this team.");
}

export async function assertBundleTeamAccess(bundleId: string): Promise<void> {
  await requireSession();
  const sb = getSupabase();

  const { data: bundle, error } = await sb
    .from("bundles")
    .select("team_id")
    .eq("id", bundleId)
    .maybeSingle();

  // RLS hides bundles outside the user's teams — a missing row means either
  // "doesn't exist" or "not your team," both of which we treat as access denied.
  if (error) throw new Error(`assertBundleTeamAccess failed: ${error.message}`);
  if (!bundle) throw new Error("Bundle not found or not accessible.");
  if (!bundle.team_id) throw new Error("Bundle has no team — cannot verify access.");

  await assertTeamMember(bundle.team_id);
}

export interface TeamInfo {
  team_id: string;
  name: string;
  joined_at: string;
}

/** Local-cache view; for the live source of truth call refreshTeamsCache() first. */
export function listMyTeams(): TeamInfo[] {
  const store = loadTeamStore();
  return Object.values(store);
}

/**
 * Refresh the local teams cache from Supabase. RLS already filters to the
 * caller's teams. Call this on signin or whenever a fresh view is needed.
 */
export async function refreshTeamsCache(): Promise<TeamInfo[]> {
  try {
    await requireSession();
  } catch (e) {
    if (e instanceof NotAuthenticatedError) {
      // Not signed in → no teams visible. Wipe the cache so we don't show stale.
      saveTeamStore({});
      return [];
    }
    throw e;
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from("teams")
    .select("id, name");

  if (error) throw new Error(`refreshTeamsCache failed: ${error.message}`);

  const fresh: Record<string, LocalTeamEntry> = {};
  const existing = loadTeamStore();
  for (const t of data ?? []) {
    fresh[t.id] = {
      team_id: t.id,
      name: t.name,
      // Preserve original joined_at if known; otherwise stamp now.
      joined_at: existing[t.id]?.joined_at ?? new Date().toISOString(),
    };
  }
  saveTeamStore(fresh);

  return Object.values(fresh);
}

export interface TeamBundleInfo {
  bundle_id: string;
  name: string;
  created_at: string;
}

export async function listTeamBundles(teamId: string): Promise<TeamBundleInfo[]> {
  await assertTeamMember(teamId);
  const sb = getSupabase();

  const { data, error } = await sb
    .from("bundles")
    .select("id, name, created_at")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listTeamBundles failed: ${error.message}`);

  return (data ?? []).map((b) => ({
    bundle_id: b.id,
    name: b.name,
    created_at: b.created_at,
  }));
}
