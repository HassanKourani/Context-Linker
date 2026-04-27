#!/usr/bin/env bash
# ctx-link: post-commit hook
# Logs the latest commit to the active session (entries accumulate until push).
#
# Install as a git hook:
#   cp packages/hooks/post-commit.sh .git/hooks/post-commit
#   chmod +x .git/hooks/post-commit
#
# Or wire into Claude Code's PostToolUse hook (see hooks/claude-code-hook.sh).

set -euo pipefail

CONFIG=".ctx-link.json"
if [[ ! -f "$CONFIG" ]]; then
  exit 0  # no ctx-link in this repo, no-op
fi

# Resolve session ID: walk the process tree to the Claude Code parent and
# read its session UUID from ~/.claude/sessions/{pid}.json — that UUID is
# what the SessionStart hook keys the active-session record by, and is the
# only per-instance identifier (CLAUDE_CODE_SSE_PORT is machine-wide).
# Fall back to the per-cwd marker file only if the walk fails (e.g. git
# hook fired outside a Claude Code Bash tool).
SESSION_ID=$(bun -e "
  const fs = require('fs'), path = require('path');
  const { execSync } = require('child_process');
  const sessionsDir = path.join(process.env.HOME, '.claude', 'sessions');
  if (!fs.existsSync(sessionsDir)) process.exit(0);
  let pid = process.ppid;
  for (let i = 0; i < 8 && pid && pid > 1; i++) {
    const f = path.join(sessionsDir, pid + '.json');
    if (fs.existsSync(f)) {
      try {
        const data = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (data.sessionId) { console.log(data.sessionId); process.exit(0); }
      } catch {}
      break;
    }
    try {
      pid = parseInt(execSync('ps -p ' + pid + ' -o ppid=', { encoding: 'utf8' }).trim(), 10);
    } catch { break; }
  }
" 2>/dev/null || true)

if [[ -n "$SESSION_ID" ]]; then
  # Verify the session record actually exists before using it
  if [[ ! -f "$HOME/.ctx-link/active-sessions/$SESSION_ID.json" ]]; then
    SESSION_ID=""
  fi
fi

if [[ -z "$SESSION_ID" ]]; then
  SESSION_FILE=".ctx-link-active-session"
  if [[ ! -f "$SESSION_FILE" ]] || [[ ! -s "$SESSION_FILE" ]]; then
    exit 0
  fi
  SESSION_ID=$(cat "$SESSION_FILE")
fi
if [[ -z "$SESSION_ID" ]]; then
  exit 0
fi

# Debounce: skip if last push was within push_debounce_seconds.
LAST_PUSH_FILE=".git/.ctx-link-last-push"
DEBOUNCE=$(bun -e "console.log(JSON.parse(require('fs').readFileSync('$CONFIG','utf8')).push_debounce_seconds ?? 600)")
NOW=$(date +%s)

if [[ -f "$LAST_PUSH_FILE" ]]; then
  LAST=$(cat "$LAST_PUSH_FILE")
  ELAPSED=$((NOW - LAST))
  if (( ELAPSED < DEBOUNCE )); then
    echo "ctx-link: debounced (${ELAPSED}s < ${DEBOUNCE}s), skipping push"
    exit 0
  fi
fi

SHA=$(git rev-parse HEAD)
SHORT_SHA=$(git rev-parse --short HEAD)

echo "ctx-link: logging commit $SHORT_SHA to session"
ctxl session-log --event commit --ref "$SHA" --diff --session-id "$SESSION_ID" || {
  echo "ctx-link: session-log failed (non-fatal)" >&2
  exit 0
}

echo "$NOW" > "$LAST_PUSH_FILE"
