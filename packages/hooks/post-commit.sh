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

# Check for active session — skip if none
SESSION_FILE=".ctx-link-active-session"
if [[ ! -f "$SESSION_FILE" ]] || [[ ! -s "$SESSION_FILE" ]]; then
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
ctx-link session-log --event commit --ref "$SHA" --diff || {
  echo "ctx-link: session-log failed (non-fatal)" >&2
  exit 0
}

echo "$NOW" > "$LAST_PUSH_FILE"
