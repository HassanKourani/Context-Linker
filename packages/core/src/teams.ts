import argon2 from "argon2";
import { getSupabase } from "./supabase.js";
import {
  loadGlobalConfig,
  globalConfigDir,
} from "./config.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ---------- Local team store ----------

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

export async function createTeam(name: string, password: string): Promise<CreateTeamResult> {
  const cfg = loadGlobalConfig();
  const sb = getSupabase();
  const password_hash = await argon2.hash(password, { type: argon2.argon2id });

  const { data, error } = await sb
    .from("teams")
    .insert({ name, password_hash, created_by: cfg.machine_id })
    .select("id, name")
    .single();

  if (error) {
    if (error.code === "23505") throw new Error(`Team "${name}" already exists.`);
    throw new Error(`createTeam failed: ${error.message}`);
  }

  // Creator is automatically a member
  await sb.from("team_members").insert({
    team_id: data.id,
    machine_id: cfg.machine_id,
  });

  // Store locally
  const store = loadTeamStore();
  store[data.id] = { team_id: data.id, name: data.name, joined_at: new Date().toISOString() };
  saveTeamStore(store);

  return { team_id: data.id, name: data.name };
}

export interface JoinTeamResult {
  team_id: string;
  name: string;
}

export async function joinTeam(name: string, password: string): Promise<JoinTeamResult> {
  const cfg = loadGlobalConfig();
  const sb = getSupabase();

  const { data: team, error } = await sb
    .from("teams")
    .select("id, name, password_hash")
    .eq("name", name)
    .single();

  if (error || !team) throw new Error(`Team "${name}" not found.`);

  const ok = await argon2.verify(team.password_hash, password);
  if (!ok) throw new Error("Invalid password.");

  // Add membership (upsert in case already a member)
  const { error: mErr } = await sb.from("team_members").upsert(
    { team_id: team.id, machine_id: cfg.machine_id },
    { onConflict: "team_id,machine_id" }
  );
  if (mErr) throw new Error(`joinTeam failed: ${mErr.message}`);

  const store = loadTeamStore();
  store[team.id] = { team_id: team.id, name: team.name, joined_at: new Date().toISOString() };
  saveTeamStore(store);

  return { team_id: team.id, name: team.name };
}

export async function assertTeamMember(teamId: string): Promise<void> {
  const cfg = loadGlobalConfig();
  const sb = getSupabase();

  const { data, error } = await sb
    .from("team_members")
    .select("id")
    .eq("team_id", teamId)
    .eq("machine_id", cfg.machine_id)
    .maybeSingle();

  if (error || !data) throw new Error("You are not a member of this team.");
}

export async function assertBundleTeamAccess(bundleId: string): Promise<void> {
  const sb = getSupabase();

  const { data: bundle, error } = await sb
    .from("bundles")
    .select("team_id")
    .eq("id", bundleId)
    .single();

  if (error || !bundle) throw new Error("Bundle not found.");

  // Legacy bundles without a team (pre-teams) — fall back to token auth
  if (!bundle.team_id) return;

  await assertTeamMember(bundle.team_id);
}

export interface TeamInfo {
  team_id: string;
  name: string;
  joined_at: string;
}

export function listMyTeams(): TeamInfo[] {
  const store = loadTeamStore();
  return Object.values(store);
}
