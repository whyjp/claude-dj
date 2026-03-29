#!/usr/bin/env bash
# Start the claude-dj bridge server
# Usage: ./scripts/start-bridge.sh [port]
#   port defaults to 39200

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -n "$1" ]; then
  export CLAUDE_DJ_PORT="$1"
fi

PORT="${CLAUDE_DJ_PORT:-39200}"

cd "$PROJECT_DIR"

# Install deps if needed
if [ ! -d node_modules ]; then
  echo "[claude-dj] Installing dependencies..."
  npm install
fi

echo "[claude-dj] Starting bridge server on http://localhost:$PORT"
echo "[claude-dj] Virtual DJ UI: http://localhost:$PORT"
echo "[claude-dj] Press Ctrl+C to stop"
echo ""

exec node bridge/server.js
