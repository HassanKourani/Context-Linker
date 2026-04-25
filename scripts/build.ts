#!/usr/bin/env bun
/**
 * Build script for ctx-link single-package distribution.
 *
 * Produces:
 *   dist/mcp.js      — MCP server (stdio entry point)
 *   dist/cli.js       — CLI tool
 *   dist/server.js    — API + static file server
 *   dist/ui/          — Built Vite frontend
 */

import { execSync } from "node:child_process";
import { rmSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

// Clean
const distDir = resolve(root, "dist");
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true });
}
mkdirSync(distDir, { recursive: true });

console.log("Building ctx-link...\n");

// 1. Bundle server-side entry points
// --packages=external keeps all node_modules as external imports (installed as deps)
// Workspace packages (@ctx-link/core) get inlined automatically
const entries = [
  { input: "packages/mcp-server/src/index.ts", output: "dist/mcp.js", label: "MCP server" },
  { input: "packages/cli/src/index.ts", output: "dist/cli.js", label: "CLI" },
  { input: "packages/ui/server.ts", output: "dist/server.js", label: "UI server" },
];

for (const { input, output, label } of entries) {
  console.log(`  Bundling ${label}...`);
  const result = Bun.spawnSync([
    "bun", "build", input,
    "--target=bun",
    "--packages=external",
    "--outfile", output,
  ], { cwd: root, stderr: "pipe", stdout: "pipe" });

  if (result.exitCode !== 0) {
    console.error(`  Failed to bundle ${label}:`);
    console.error(result.stderr.toString());
    process.exit(1);
  }
}

// Add shebangs to bin entry points
for (const file of ["dist/mcp.js", "dist/cli.js"]) {
  const fullPath = resolve(root, file);
  const content = await Bun.file(fullPath).text();
  if (!content.startsWith("#!")) {
    await Bun.write(fullPath, `#!/usr/bin/env bun\n${content}`);
  }
  // Make executable
  execSync(`chmod +x ${fullPath}`);
}

console.log("  Bundled 3 entry points.\n");

// 2. Build Vite UI
console.log("  Building UI (Vite)...");
execSync("bun run --cwd packages/ui build", { cwd: root, stdio: "inherit" });

// 3. Move Vite output to dist/ui/
const viteOut = resolve(root, "packages/ui/dist");
const uiOut = resolve(root, "dist/ui");
execSync(`mv ${viteOut} ${uiOut}`);

// 4. Copy hook scripts
const hooksOut = resolve(root, "dist/hooks");
mkdirSync(hooksOut, { recursive: true });
for (const hook of ["post-commit.sh", "claude-code-hook.sh"]) {
  const src = resolve(root, "packages/hooks", hook);
  if (existsSync(src)) {
    copyFileSync(src, resolve(hooksOut, hook));
    execSync(`chmod +x ${resolve(hooksOut, hook)}`);
  }
}

console.log("\nBuild complete. Output:");
execSync(`find dist -type f | head -20`, { cwd: root, stdio: "inherit" });
