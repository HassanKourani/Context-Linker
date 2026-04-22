#!/usr/bin/env bash
# cxtl: Claude Code PostToolUse hook
#
# Reads the tool-use JSON from stdin, looks for git commit / gh pr create,
# and auto-pushes to all bundles connected to the active session.

set -euo pipefail

INPUT=$(cat)

# Extract command and session_id from the tool input JSON
CMD=$(echo "$INPUT" | bun -e "
try {
  const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  process.stdout.write(j?.tool_input?.command ?? '');
} catch { process.stdout.write(''); }
")

# Match commit-producing commands
if [[ "$CMD" =~ git[[:space:]]+commit || "$CMD" =~ gh[[:space:]]+pr[[:space:]]+create ]]; then
  # Only push if there's an active session with bundles
  if [[ -f "$PWD/.cxtl-active-session" ]]; then
    EVENT="commit"
    [[ "$CMD" =~ gh[[:space:]]+pr ]] && EVENT="pr_open"

    # Async push so we don't block Claude Code's next action
    (
      SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
      cxtl push --event "$EVENT" --ref "$SHA" --diff >/dev/null 2>&1 || true
    ) &
  fi
fi

# Hooks must not alter the tool result; just exit 0.
exit 0
