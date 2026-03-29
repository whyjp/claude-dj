#!/usr/bin/env bash
# Remove claude-dj hooks from Claude Code settings
# Usage: ./scripts/uninstall-hooks.sh [--project]
#   Default: global (~/.claude/settings.json)
#   --project: project-local (.claude/settings.json)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

if [ "$1" = "--project" ]; then
  echo "[claude-dj] Removing hooks (project-local)..."
  node -e "import('./tools/setup.js').then(m => m.uninstall({ global: false }))"
else
  echo "[claude-dj] Removing hooks (global)..."
  node -e "import('./tools/setup.js').then(m => m.uninstall({ global: true }))"
fi

echo ""
echo "[claude-dj] Restart Claude Code sessions to apply changes."
