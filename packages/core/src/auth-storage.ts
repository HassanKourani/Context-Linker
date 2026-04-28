import {
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { globalConfigDir } from "./config.js";

// File-backed Supabase auth storage. Replaces the browser's localStorage
// (which doesn't exist in Node) so the supabase-js client can persist
// access + refresh tokens between processes (CLI, MCP server, UI server).
//
// Layout: ~/.ctx-link/auth.json is a flat object {key: stringValue}. The
// supabase client picks its own keys (e.g. "sb-<projectRef>-auth-token").

function authPath(): string {
  return join(globalConfigDir(), "auth.json");
}

function readAuthBlob(): Record<string, string> {
  const p = authPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function writeAuthBlob(blob: Record<string, string>): void {
  const dir = globalConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (Object.keys(blob).length === 0) {
    if (existsSync(authPath())) rmSync(authPath());
    return;
  }
  writeFileSync(authPath(), JSON.stringify(blob, null, 2), { mode: 0o600 });
}

export const fileAuthStorage = {
  getItem(key: string): string | null {
    return readAuthBlob()[key] ?? null;
  },
  setItem(key: string, value: string): void {
    const blob = readAuthBlob();
    blob[key] = value;
    writeAuthBlob(blob);
  },
  removeItem(key: string): void {
    const blob = readAuthBlob();
    delete blob[key];
    writeAuthBlob(blob);
  },
};

export function clearAuthFile(): void {
  const p = authPath();
  if (existsSync(p)) {
    try {
      rmSync(p);
    } catch {}
  }
}
