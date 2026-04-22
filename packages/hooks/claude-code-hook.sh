#!/usr/bin/env bash
# cxtl: Claude Code PostToolUse hook
#
# Reads the tool-use JSON from stdin, looks for git commit / gh pr create,
# and delegates to the git post-commit path if the action made a new commit.
#
# Configure in ~/.claude/settings.json:
# {
#   "hooks": {
#     "PostToolUse": [
#       {
#         "matcher": "Bash",
#         "hooks": [
#           { "type": "command", "command": "/absolute/path/to/claude-code-hook.sh" }
#         ]
#       }
#     ]
#   }
# }

set -euo pipefail

INPUT=$(cat)

# Pull the command out of the tool input. Claude Code sends something like:
# { "tool_name": "Bash", "tool_input": { "command": "git commit -m '...'", ... } }
CMD=$(echo "$INPUT" | bun -e "
try {
  const j = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  process.stdout.write(j?.tool_input?.command ?? '');
} catch { process.stdout.write(''); }
")

# Match commit-producing commands.
if [[ "$CMD" =~ git[[:space:]]+commit || "$CMD" =~ gh[[:space:]]+pr[[:space:]]+create ]]; then
  # Only run in dirs that have .cxtl.json with mode != "off"
  if [[ -f "$PWD/.cxtl.json" ]]; then
    MODE=$(bun -e "try{process.stdout.write(JSON.parse(require('fs').readFileSync('$PWD/.cxtl.json','utf8')).mode??'off')}catch{process.stdout.write('off')}" 2>/dev/null)
    [[ "$MODE" == "off" ]] && exit 0
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
