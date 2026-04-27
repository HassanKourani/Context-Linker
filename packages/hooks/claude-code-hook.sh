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

# Capture stdin before backgrounding (we need session_id from input regardless
# of whether a marker file exists — CLAUDE_CODE_SSE_PORT is shared across
# Claude Code instances on the machine, so it can't be used to distinguish).
INPUT=$(cat)

# Write JS to a temp file to avoid bash quoting issues
SCRIPT_FILE=$(mktemp /tmp/ctx-link-hook.XXXXXX.js)
cat > "$SCRIPT_FILE" << 'JSEOF'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const input = JSON.parse(fs.readFileSync(0, "utf8"));
const { tool_name, tool_input, tool_output, cwd, session_id: claudeSessionId } = input;
const dir = cwd || process.cwd();

// Resolve session ID: prefer Claude's per-instance session_id (from hook
// input — uniquely identifies the Claude Code window). The SessionStart
// hook keys ctx-link active sessions by exactly this UUID.
// Fall back to the per-cwd marker file only if input.session_id is missing.
let sessionId = null;
if (claudeSessionId) {
  const sessionFile = path.join(process.env.HOME, ".ctx-link", "active-sessions", claudeSessionId + ".json");
  if (fs.existsSync(sessionFile)) sessionId = claudeSessionId;
}
if (!sessionId) {
  const marker = path.join(dir, ".ctx-link-active-session");
  if (fs.existsSync(marker)) sessionId = fs.readFileSync(marker, "utf8").trim();
}
if (!sessionId) process.exit(0);

// Detect project name
let projectName = dir.split("/").pop() || "unknown";
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  if (pkg.name) projectName = pkg.name;
} catch {}

function getHeadSha(d) {
  try { return execSync("git rev-parse HEAD", { cwd: d, encoding: "utf8" }).trim(); } catch { return null; }
}

const entriesToAdd = [];

// Only auto-log natural batch points: git commits and PR creation.
// File edits aren't logged here — Claude calls session_log itself with a
// handoff-quality summary (covering interface details, not the diff).
if (tool_name !== "Bash") process.exit(0);

const cmd = (tool_input?.command || "").trim();

if (/git\s+commit/.test(cmd)) {
  let commitMsg = "";
  let files = [];
  try {
    commitMsg = execSync("git log -1 --pretty=format:%s", { cwd: dir, encoding: "utf8" }).trim();
    const changed = execSync("git diff HEAD~1 --name-only", { cwd: dir, encoding: "utf8" }).trim();
    files = changed.split("\n").filter(Boolean);
  } catch {}

  entriesToAdd.push({
    summary: commitMsg ? "Committed: " + commitMsg + " (pending agent handoff details)" : "Committed (pending agent handoff details)",
    files,
    event_type: "commit",
    trigger_ref: getHeadSha(dir),
    pending_enrichment: true,
  });
}

if (/gh\s+pr\s+create/.test(cmd)) {
  let prSummary = "Created pull request (pending agent handoff details)";
  const output = (tool_output?.stdout || tool_output || "").toString();
  const urlMatch = output.match(/https:\/\/github\.com\/[^\s]+/);
  const titleMatch = cmd.match(/--title\s+["']([^"']+)["']/);
  if (titleMatch) prSummary = "Created PR: " + titleMatch[1] + " (pending agent handoff details)";
  if (urlMatch) prSummary += " — " + urlMatch[0];

  entriesToAdd.push({
    summary: prSummary,
    files: [],
    event_type: "pr_open",
    pending_enrichment: true,
  });
}

if (entriesToAdd.length === 0) process.exit(0);

// Write entries to session entries file
const entriesDir = path.join(process.env.HOME, ".ctx-link", "session-entries");
if (!fs.existsSync(entriesDir)) fs.mkdirSync(entriesDir, { recursive: true });

const fp = path.join(entriesDir, sessionId + ".json");
const entries = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf8")) : [];

for (const e of entriesToAdd) {
  entries.push({
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    project_name: projectName,
    event_type: e.event_type || "auto",
    trigger_ref: e.trigger_ref || null,
    summary: e.summary,
    files_touched: e.files || [],
    decisions: [],
    pushed_at: null,
    superseded_at: null,
    pending_enrichment: e.pending_enrichment || false,
  });
}

fs.writeFileSync(fp, JSON.stringify(entries, null, 2));
JSEOF

# Process in background so Claude Code isn't blocked
(
  echo "$INPUT" | bun "$SCRIPT_FILE" 2>/dev/null
  rm -f "$SCRIPT_FILE"
) &

exit 0
