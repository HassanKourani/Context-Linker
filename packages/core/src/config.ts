import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { z } from "zod";

// ---------- Schemas ----------

export const GlobalConfigSchema = z.object({
  // Forward-compatible: cloud mode is designed in but not implemented in MVP.
  mode: z.enum(["local", "cloud"]).default("local"),
  cloud_endpoint: z.string().url().nullable().default(null),
  supabase: z
    .object({
      url: z.string().url(),
      // Using service_role for MVP since auth is done in-app via bearer tokens.
      // In cloud mode this would move server-side and clients would only have
      // the bearer token.
      service_role_key: z.string().min(1),
    })
    .nullable(),
  // Each machine gets a stable random ID for informational purposes
  // (who joined which bundle). Not used for auth.
  machine_id: z.string().min(1),
});

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

export const ProjectConfigSchema = z.object({
  bundles: z.array(z.string().uuid()).default([]),
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
    throw new Error(
      `ctx-link: global config not found at ${path}. Run 'ctx-link init' first.`
    );
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
