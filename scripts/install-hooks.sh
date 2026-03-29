#!/usr/bin/env bash
# Install claude-dj hooks into Claude Code global settings
# Usage: ./scripts/install-hooks.sh [--project]
#   Default: global (~/.claude/settings.json)
#   --project: project-local (.claude/settings.json)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

# Install deps if needed
if [ ! -d node_modules ]; then
  echo "[claude-dj] Installing dependencies..."
  npm install
fi

if [ "$1" = "--project" ]; then
  echo "[claude-dj] Installing hooks (project-local)..."
  node -e "import('./tools/setup.js').then(m => m.install({ global: false }))"
else
  echo "[claude-dj] Installing hooks (global)..."
  node -e "import('./tools/setup.js').then(m => m.install({ global: true }))"
fi

echo ""
echo "[claude-dj] Done! Start a new Claude Code session to activate hooks."
echo "[claude-dj] Make sure the bridge is running: ./scripts/start-bridge.sh"
