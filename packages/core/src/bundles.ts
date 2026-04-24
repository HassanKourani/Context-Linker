import argon2 from "argon2";
import { customAlphabet } from "nanoid";
import { getSupabase } from "./supabase.js";
import {
  loadGlobalConfig,
  loadTokenStore,
  saveTokenStore,
  storeBundleToken,
} from "./config.js";

// Join tokens are 32 chars from a URL-safe alphabet.
// ~190 bits of entropy, unguessable in practice.
const tokenAlphabet =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const generateTokenBody = customAlphabet(tokenAlphabet, 32);

export function generateJoinToken(): string {
  return `ctxl_${generateTokenBody()}`;
}

async function hashToken(token: string): Promise<string> {
  return argon2.hash(token, { type: argon2.argon2id });
}

async function verifyToken(token: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, token);
  } catch {
    return false;
  }
}

// ---------- Operations ----------

export interface CreateBundleResult {
  bundle_id: string;
  name: string;
  join_token: string;
}

export async function createBundle(name: string, mode: "local" | "cloud" = "cloud", teamId?: string): Promise<CreateBundleResult> {
  if (mode === "local") {
    const { localCreateBundle, listAllLocalBundleDetails } = await import("./local-store.js");
    const existing = listAllLocalBundleDetails();
    if (existing.some((b) => b.bundle_name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`A local bundle named "${name}" already exists.`);
    }
    const r = localCreateBundle(name);
    storeBundleToken(r.bundle_id, r.join_token, r.name);
    return r;
  }

  if (!teamId) throw new Error("Cloud bundles require --team. Create or join a team first.");

  // Verify caller is a member of the team
  const { assertTeamMember } = await import("./teams.js");
  await assertTeamMember(teamId);

  const cfg = loadGlobalConfig();
  const sb = getSupabase();

  // Check for duplicate name within the same team
  const { data: dup } = await sb
    .from("bundles")
    .select("id")
    .eq("team_id", teamId)
    .ilike("name", name)
    .limit(1);
  if (dup && dup.length > 0) {
    throw new Error(`A bundle named "${name}" already exists in this team.`);
  }

  const { data, error } = await sb
    .from("bundles")
    .insert({ name, team_id: teamId, created_by: cfg.machine_id })
    .select("id, name")
    .single();

  if (error) throw new Error(`createBundle failed: ${error.message}`);

  storeBundleToken(data.id, `team_${teamId}`, data.name);

  return { bundle_id: data.id, name: data.name, join_token: `team_${teamId}` };
}

export interface JoinBundleResult {
  bundle_id: string;
  name: string;
}

// Token format: ctxl_<32chars> OR <bundle_id>:<token>
// We accept both. The latter is what you'd share; the server must then
// verify against the specific bundle's hash.
export async function joinBundle(
  bundleId: string,
  token: string,
  projectName: string,
  mode: "local" | "cloud" = "cloud"
): Promise<JoinBundleResult> {
  if (mode === "local") {
    const { localJoinBundle } = await import("./local-store.js");
    const r = localJoinBundle(bundleId);
    storeBundleToken(r.bundle_id, `local_${r.bundle_id}`, r.name);
    return r;
  }

  // Cloud mode: verify team membership
  const { assertBundleTeamAccess } = await import("./teams.js");
  await assertBundleTeamAccess(bundleId);

  const sb = getSupabase();

  const { data: bundle, error } = await sb
    .from("bundles")
    .select("id, name, team_id")
    .eq("id", bundleId)
    .single();

  if (error || !bundle) throw new Error("Bundle not found.");

  storeBundleToken(bundle.id, `team_${bundle.team_id}`, bundle.name);

  return { bundle_id: bundle.id, name: bundle.name };
}

/** Get the team_id for a cloud bundle. Returns null for legacy bundles without teams. */
export async function getBundleTeamId(bundleId: string): Promise<string | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("bundles")
    .select("team_id")
    .eq("id", bundleId)
    .single();
  if (error || !data) return null;
  return data.team_id ?? null;
}

export async function assertTokenValid(bundleId: string): Promise<void> {
  // For team-based bundles, check team membership instead of per-bundle token
  const { assertBundleTeamAccess } = await import("./teams.js");
  await assertBundleTeamAccess(bundleId);
}

export interface BundleStatus {
  bundle_id: string;
  name: string;
  session_count: number;
  entry_count: number;
  last_entry_at: string | null;
}

export async function bundleStatus(bundleId: string, mode: "local" | "cloud" = "cloud", skipAuth = false): Promise<BundleStatus> {
  if (mode === "local") {
    const { localBundleStatus } = await import("./local-store.js");
    return localBundleStatus(bundleId);
  }

  if (!skipAuth) await assertTokenValid(bundleId);
  const sb = getSupabase();

  const [{ data: bundle }, { count: eCount }, { data: latestRef }, { data: sessionRefs }] =
    await Promise.all([
      sb.from("bundles").select("id, name").eq("id", bundleId).single(),
      sb
        .from("bundle_entry_refs")
        .select("*", { count: "exact", head: true })
        .eq("bundle_id", bundleId),
      sb
        .from("bundle_entry_refs")
        .select("entry_id, cloud_session_entries(created_at)")
        .eq("bundle_id", bundleId)
        .order("added_at", { ascending: false })
        .limit(1),
      sb
        .from("bundle_entry_refs")
        .select("entry_id, cloud_session_entries(cloud_session_id)")
        .eq("bundle_id", bundleId),
    ]);

  if (!bundle) throw new Error("Bundle not found.");

  const lastEntryAt = latestRef?.[0]
    ? (latestRef[0] as any).cloud_session_entries?.created_at ?? null
    : null;

  // Count distinct sessions that have entries in this bundle
  const sessionIds = new Set(
    (sessionRefs ?? []).map((r: any) => r.cloud_session_entries?.cloud_session_id).filter(Boolean)
  );

  return {
    bundle_id: bundle.id,
    name: bundle.name,
    session_count: sessionIds.size,
    entry_count: eCount ?? 0,
    last_entry_at: lastEntryAt,
  };
}

export async function deleteBundle(bundleId: string, mode: "local" | "cloud" = "cloud"): Promise<void> {
  if (mode === "local") {
    const { localDeleteBundle } = await import("./local-store.js");
    localDeleteBundle(bundleId);
  } else {
    const { assertBundleTeamAccess } = await import("./teams.js");
    await assertBundleTeamAccess(bundleId);
    const sb = getSupabase();
    const { error } = await sb.from("bundles").delete().eq("id", bundleId);
    if (error) throw new Error(`deleteBundle failed: ${error.message}`);
  }

  const store = loadTokenStore();
  delete store[bundleId];
  saveTokenStore(store);
}

export interface LocalBundleInfo {
  bundle_id: string;
  name: string;
  joined_at: string;
}

export function listLocalBundles(): LocalBundleInfo[] {
  const store = loadTokenStore();
  return Object.entries(store).map(([bundle_id, v]) => ({
    bundle_id,
    name: v.name,
    joined_at: v.joined_at,
  }));
}

