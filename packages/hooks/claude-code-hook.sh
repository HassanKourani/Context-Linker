#!/usr/bin/env bash
# ctx-link: Claude Code PostToolUse hook
#
# Auto-logs coding activity (file edits, file creations, git commits, PRs)
# to the active ctx-link session. These entries are what other agents see
# when they pull context from the bundle.
#
# Hook matcher should be: Write|Edit|Bash
# Only logs actions that help other agents understand what changed.

set -euo pipefail

# Only proceed if there's an active ctx-link session
[[ -f "$PWD/.ctx-link-active-session" ]] || exit 0

# Capture stdin before backgrounding
INPUT=$(cat)

# Process in background so Claude Code isn't blocked
(
echo "$INPUT" | bun -e '
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const input = JSON.parse(fs.readFileSync(0, "utf8"));
const { tool_name, tool_input, cwd } = input;
const dir = cwd || process.cwd();

// Read ctx-link session ID from marker file
const marker = path.join(dir, ".ctx-link-active-session");
if (!fs.existsSync(marker)) process.exit(0);
const sessionId = fs.readFileSync(marker, "utf8").trim();
if (!sessionId) process.exit(0);

let summary = null;
let files = [];

switch (tool_name) {
  case "Write": {
    const p = tool_input?.file_path || "";
    const rel = path.relative(dir, p);
    summary = "Created " + rel;
    files = [rel];
    break;
  }
  case "Edit": {
    const p = tool_input?.file_path || "";
    const rel = path.relative(dir, p);
    summary = "Edited " + rel;
    files = [rel];
    break;
  }
  case "Bash": {
    const cmd = (tool_input?.command || "").trim();
    if (/^git\s+commit/.test(cmd)) {
      summary = "Git commit";
    } else if (/^gh\s+pr\s+create/.test(cmd)) {
      summary = "Created pull request";
    }
    break;
  }
}

if (!summary) process.exit(0);

// Write entry directly to session entries file
const entriesDir = path.join(process.env.HOME, ".ctx-link", "session-entries");
if (!fs.existsSync(entriesDir)) fs.mkdirSync(entriesDir, { recursive: true });

const fp = path.join(entriesDir, sessionId + ".json");
const entries = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf8")) : [];

// Detect project name
let projectName = dir.split("/").pop() || "unknown";
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  if (pkg.name) projectName = pkg.name;
} catch {}

entries.push({
  id: crypto.randomUUID(),
  created_at: new Date().toISOString(),
  project_name: projectName,
  event_type: "auto",
  trigger_ref: null,
  summary,
  files_touched: files,
  decisions: [],
  pushed_at: null,
  superseded_at: null,
});

fs.writeFileSync(fp, JSON.stringify(entries, null, 2));
' 2>/dev/null
) &

exit 0
