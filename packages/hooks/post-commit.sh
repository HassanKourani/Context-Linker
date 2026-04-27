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

# Resolve session ID: prefer CLAUDE_CODE_SSE_PORT (multi-terminal safe),
# fall back to marker file
SESSION_ID=""
if [[ -n "${CLAUDE_CODE_SSE_PORT:-}" ]]; then
  SESSIONS_DIR="$HOME/.ctx-link/active-sessions"
  if [[ -d "$SESSIONS_DIR" ]]; then
    SESSION_ID=$(bun -e "
      const fs = require('fs'), path = require('path');
      const dir = '$SESSIONS_DIR', port = '$CLAUDE_CODE_SSE_PORT', proj = '$PWD';
      for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          if (s.claude_instance_id === port && s.project_path === proj) { console.log(s.session_id); break; }
        } catch {}
      }
    " 2>/dev/null || true)
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
