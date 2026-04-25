/**
 * Test helper: redirects all ctx-link filesystem operations to a temp directory.
 *
 * Sets process.env.CTX_LINK_HOME so globalConfigDir() returns the temp dir.
 *
 * Usage in tests:
 *   import { setupTestDir, cleanupTestDir } from "./helpers/mock-fs";
 *   let testDir: string;
 *   beforeEach(() => { testDir = setupTestDir(); });
 *   afterEach(() => { cleanupTestDir(testDir); });
 */
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Creates a temp directory and sets CTX_LINK_HOME to point to it.
 * Also creates the subdirectories that config.ts expects.
 */
export function setupTestDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ctx-link-test-"));

  // Redirect all config.ts filesystem ops to the temp dir
  process.env.CTX_LINK_HOME = dir;

  // Create subdirs that the code expects
  mkdirSync(join(dir, "active-sessions"), { recursive: true });
  mkdirSync(join(dir, "session-entries"), { recursive: true });
  mkdirSync(join(dir, "local"), { recursive: true });

  return dir;
}

/**
 * Removes the temp directory and clears the env override.
 */
export function cleanupTestDir(dir: string): void {
  delete process.env.CTX_LINK_HOME;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}
