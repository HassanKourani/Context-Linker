#!/bin/bash
# Dev helper — switch ctx-link MCP + CLI between local source and published binary.
# Usage: ./scripts/mcp-switch.sh dev | prod

SETTINGS="$HOME/.claude/settings.json"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUN_BIN="$HOME/.bun/bin"

if [ ! -f "$SETTINGS" ]; then
  echo "Error: $SETTINGS not found"
  exit 1
fi

case "$1" in
  dev)
    # MCP: point to local source
    python3 -c "
import json
with open('$SETTINGS') as f: s = json.load(f)
s.setdefault('mcpServers', {})['ctx-link'] = {
  'command': 'bun',
  'args': ['$REPO_ROOT/packages/mcp-server/src/index.ts']
}
with open('$SETTINGS', 'w') as f: json.dump(s, f, indent=2); f.write('\n')
"
    # CLI: symlink to local source
    ln -sf "$REPO_ROOT/packages/cli/src/index.ts" "$BUN_BIN/ctxl"
    ln -sf "$REPO_ROOT/packages/mcp-server/src/index.ts" "$BUN_BIN/ctx-link"
    echo "Switched to dev (local source)."
    echo "  ctxl   → $REPO_ROOT/packages/cli/src/index.ts"
    echo "  MCP    → $REPO_ROOT/packages/mcp-server/src/index.ts"
    echo "Restart Claude Code for MCP changes."
    ;;
  prod)
    # Reinstall published binaries
    bun install -g ctx-link 2>/dev/null
    # MCP: point to published binary
    python3 -c "
import json
with open('$SETTINGS') as f: s = json.load(f)
s.setdefault('mcpServers', {})['ctx-link'] = {
  'command': '$BUN_BIN/ctx-link'
}
with open('$SETTINGS', 'w') as f: json.dump(s, f, indent=2); f.write('\n')
"
    echo "Switched to prod (published binary)."
    echo "Restart Claude Code for MCP changes."
    ;;
  *)
    echo "Usage: $0 dev|prod"
    exit 1
    ;;
esac
