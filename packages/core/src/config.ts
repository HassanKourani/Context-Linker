import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { z } from "zod";

// ---------- Schemas ----------

export const GlobalConfigSchema = z.object({
  // Each machine gets a stable random ID for informational purposes
  // (who joined which bundle). Not used for auth.
  machine_id: z.string().min(1),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

export const ProjectConfigSchema = z.object({
  // "off" = no linking (default), "local" = local file store, "cloud" = Supabase
  mode: z.enum(["off", "local", "cloud"]).default("off"),
  // One bundle per project. Switch by creating/joining a different one.
  bundle: z.string().uuid().nullable().default(null),
  project_name: z.string().min(1),
  auto_push_on: z.array(z.enum(["commit", "pr_open"])).default(["commit"]),
  // Debounce pushes from the same event source in seconds.
  push_debounce_seconds: z.number().int().nonnegative().default(600),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// Token store: maps bundle_id -> join_token (plaintext, local only).
// Needed because the server only stores hashed tokens.
export const BundleTokenStoreSchema = z.record(
  z.string().uuid(),
  z.object({
    token: z.string(),
    name: z.string(),
    joined_at: z.string(),
  })
);

export type BundleTokenStore = z.infer<typeof BundleTokenStoreSchema>;

// ---------- Paths ----------

export function globalConfigDir(): string {
  return join(homedir(), ".ctx-link");
}

export function globalConfigPath(): string {
  return join(globalConfigDir(), "config.json");
}

export function tokenStorePath(): string {
  return join(globalConfigDir(), "tokens.json");
}

export function projectConfigPath(cwd: string = process.cwd()): string {
  return join(cwd, ".ctx-link.json");
}

// ---------- Loaders ----------

export function loadGlobalConfig(): GlobalConfig {
  const path = globalConfigPath();
  if (!existsSync(path)) {
    // Auto-create on first use — no init command needed.
    const { customAlphabet } = require("nanoid");
    const generate = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 12);
    const cfg: GlobalConfig = { machine_id: generate() };
    saveGlobalConfig(cfg);
    return cfg;
  }
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return GlobalConfigSchema.parse(raw);
}

export function saveGlobalConfig(cfg: GlobalConfig): void {
  const dir = globalConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(globalConfigPath(), JSON.stringify(cfg, null, 2), {
    mode: 0o600,
  });
}

export function loadProjectConfig(
  cwd: string = process.cwd()
): ProjectConfig | null {
  const path = projectConfigPath(cwd);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return ProjectConfigSchema.parse(raw);
}

export function saveProjectConfig(
  cfg: ProjectConfig,
  cwd: string = process.cwd()
): void {
  writeFileSync(projectConfigPath(cwd), JSON.stringify(cfg, null, 2));
}

export function loadTokenStore(): BundleTokenStore {
  const path = tokenStorePath();
  if (!existsSync(path)) return {};
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return BundleTokenStoreSchema.parse(raw);
}

export function saveTokenStore(store: BundleTokenStore): void {
  const dir = globalConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(tokenStorePath(), JSON.stringify(store, null, 2), {
    mode: 0o600,
  });
}

export function getBundleToken(bundleId: string): string | null {
  const store = loadTokenStore();
  return store[bundleId]?.token ?? null;
}

// ---------- Session Log ----------

export interface SessionLogEntry {
  project_name: string;
  project_path: string;
  machine_id: string;
  started_at: string;
  branch: string | null;
  bundle: string | null;
  mode: string;
}

function sessionLogPath(): string {
  return join(globalConfigDir(), "sessions.json");
}

export function logSession(entry: SessionLogEntry): void {
  const dir = globalConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = sessionLogPath();
  const existing: SessionLogEntry[] = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : [];
  existing.push(entry);
  // Keep last 200 sessions
  const trimmed = existing.slice(-200);
  writeFileSync(path, JSON.stringify(trimmed, null, 2));
}

export function loadSessionLog(): SessionLogEntry[] {
  const path = sessionLogPath();
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8"));
}

// ---------- Active Sessions ----------

export interface ActiveSession {
  session_id: string;
  project_name: string;
  project_path: string;
  bundles: Array<{ bundle_id: string; mode: "local" | "cloud" }>;
  started_at: string;
  branch: string | null;
}

function activeSessionsDir(): string {
  return join(globalConfigDir(), "active-sessions");
}

function activeSessionPath(sessionId: string): string {
  return join(activeSessionsDir(), `${sessionId}.json`);
}

export function saveActiveSession(session: ActiveSession): void {
  const dir = activeSessionsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(activeSessionPath(session.session_id), JSON.stringify(session, null, 2));
}

export function loadActiveSession(sessionId: string): ActiveSession | null {
  const path = activeSessionPath(sessionId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Read the active session_id from .cxtl-active-session marker file in CWD */
export function getActiveSessionId(cwd: string = process.cwd()): string | null {
  const marker = join(cwd, ".cxtl-active-session");
  if (!existsSync(marker)) return null;
  return readFileSync(marker, "utf8").trim();
}

/** Write the active session_id marker file in the project directory */
export function setActiveSessionId(sessionId: string, cwd: string = process.cwd()): void {
  writeFileSync(join(cwd, ".cxtl-active-session"), sessionId);
}

/** List all active sessions across all projects */
export function listActiveSessions(): ActiveSession[] {
  const dir = activeSessionsDir();
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

export function storeBundleToken(
  bundleId: string,
  token: string,
  name: string
): void {
  const store = loadTokenStore();
  store[bundleId] = {
    token,
    name,
    joined_at: new Date().toISOString(),
  };
  saveTokenStore(store);
}
