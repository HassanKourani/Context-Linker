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

# Write JS to a temp file to avoid bash quoting issues
SCRIPT_FILE=$(mktemp /tmp/ctx-link-hook.XXXXXX.js)
cat > "$SCRIPT_FILE" << 'JSEOF'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const input = JSON.parse(fs.readFileSync(0, "utf8"));
const { tool_name, tool_input, tool_output, cwd } = input;
const dir = cwd || process.cwd();

// Read ctx-link session ID from marker file
const marker = path.join(dir, ".ctx-link-active-session");
if (!fs.existsSync(marker)) process.exit(0);
const sessionId = fs.readFileSync(marker, "utf8").trim();
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

switch (tool_name) {
  case "Write": {
    const p = tool_input?.file_path || "";
    const rel = path.relative(dir, p);
    entriesToAdd.push({
      summary: "Created " + rel,
      files: [rel],
      event_type: "auto",
    });
    break;
  }
  case "Edit": {
    const p = tool_input?.file_path || "";
    const rel = path.relative(dir, p);
    const old_str = (tool_input?.old_string || "").slice(0, 100);
    const new_str = (tool_input?.new_string || "").slice(0, 100);
    let summary = "Edited " + rel;
    if (old_str && new_str) {
      summary += ": " + JSON.stringify(old_str) + " -> " + JSON.stringify(new_str);
    }
    entriesToAdd.push({
      summary,
      files: [rel],
      event_type: "auto",
    });
    break;
  }
  case "Bash": {
    const cmd = (tool_input?.command || "").trim();

    // Check for git commit
    if (/git\s+commit/.test(cmd)) {
      let commitSummary = "Git commit";
      let files = [];
      try {
        const msg = execSync("git log -1 --pretty=format:%s", { cwd: dir, encoding: "utf8" }).trim();
        const changed = execSync("git diff HEAD~1 --name-only", { cwd: dir, encoding: "utf8" }).trim();
        files = changed.split("\n").filter(Boolean);
        commitSummary = "Committed: " + msg;
      } catch {}

      entriesToAdd.push({
        summary: commitSummary,
        files,
        event_type: "commit",
        trigger_ref: getHeadSha(dir),
      });
    }

    // Check for PR creation
    if (/gh\s+pr\s+create/.test(cmd)) {
      let prSummary = "Created pull request";
      const output = (tool_output?.stdout || tool_output || "").toString();
      const urlMatch = output.match(/https:\/\/github\.com\/[^\s]+/);
      if (urlMatch) prSummary = "Created PR: " + urlMatch[0];
      const titleMatch = cmd.match(/--title\s+["']([^"']+)["']/);
      if (titleMatch) prSummary += " -- " + titleMatch[1];

      entriesToAdd.push({
        summary: prSummary,
        files: [],
        event_type: "pr_open",
      });
    }

    break;
  }
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
