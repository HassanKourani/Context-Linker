import argon2 from "argon2";
import { customAlphabet } from "nanoid";
import { getSupabase } from "./supabase.js";
import {
  getBundleToken,
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
    const { localCreateBundle } = await import("./local-store.js");
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

  const cfg = loadGlobalConfig();
  const sb = getSupabase();

  const { data: bundle, error } = await sb
    .from("bundles")
    .select("id, name, team_id")
    .eq("id", bundleId)
    .single();

  if (error || !bundle) throw new Error("Bundle not found.");

  const { error: sErr } = await sb.from("sessions").insert({
    bundle_id: bundle.id,
    project_name: projectName,
    machine_id: cfg.machine_id,
  });
  if (sErr) throw new Error(`joinBundle session insert failed: ${sErr.message}`);

  storeBundleToken(bundle.id, `team_${bundle.team_id}`, bundle.name);

  return { bundle_id: bundle.id, name: bundle.name };
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

  const [{ data: bundle }, { count: sCount }, { data: entries }, { count: eCount }] =
    await Promise.all([
      sb.from("bundles").select("id, name").eq("id", bundleId).single(),
      sb
        .from("sessions")
        .select("*", { count: "exact", head: true })
        .eq("bundle_id", bundleId),
      sb
        .from("entries")
        .select("created_at")
        .eq("bundle_id", bundleId)
        .order("created_at", { ascending: false })
        .limit(1),
      sb
        .from("entries")
        .select("*", { count: "exact", head: true })
        .eq("bundle_id", bundleId),
    ]);

  if (!bundle) throw new Error("Bundle not found.");

  return {
    bundle_id: bundle.id,
    name: bundle.name,
    session_count: sCount ?? 0,
    entry_count: eCount ?? 0,
    last_entry_at: entries?.[0]?.created_at ?? null,
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

export interface SessionInfo {
  session_id: string;
  project_name: string;
  machine_id: string;
  last_active_at: string | null;
}

export async function listBundleSessions(
  bundleId: string,
  skipAuth = false
): Promise<SessionInfo[]> {
  if (!skipAuth) await assertTokenValid(bundleId);
  const sb = getSupabase();

  const { data, error } = await sb
    .from("sessions")
    .select("id, project_name, machine_id, last_active_at")
    .eq("bundle_id", bundleId)
    .order("last_active_at", { ascending: false, nullsFirst: false });

  if (error) throw new Error(`listBundleSessions failed: ${error.message}`);

  return (data ?? []).map((s: any) => ({
    session_id: s.id,
    project_name: s.project_name,
    machine_id: s.machine_id,
    last_active_at: s.last_active_at,
  }));
}

export async function deleteSession(sessionId: string): Promise<void> {
  const sb = getSupabase();

  // Only delete the session row (the connection).
  // Entries are kept — they're historical context, not tied to the link.
  const { error } = await sb
    .from("sessions")
    .delete()
    .eq("id", sessionId);
  if (error) throw new Error(`deleteSession failed: ${error.message}`);
}
