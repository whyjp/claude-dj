#!/usr/bin/env bash
# Start the claude-dj bridge server
# Usage: ./scripts/start-bridge.sh [--debug] [port]
#   --debug  enables file logging to logs/bridge.log
#   port     defaults to 39200

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parse args
for arg in "$@"; do
  case "$arg" in
    --debug) export CLAUDE_DJ_DEBUG=1 ;;
    *)       export CLAUDE_DJ_PORT="$arg" ;;
  esac
done

PORT="${CLAUDE_DJ_PORT:-39200}"

cd "$PROJECT_DIR"

# Install deps if needed
if [ ! -d node_modules ]; then
  echo "[claude-dj] Installing dependencies..."
  npm install
fi

echo "[claude-dj] Starting bridge server on http://localhost:$PORT"
echo "[claude-dj] Virtual DJ UI: http://localhost:$PORT"
if [ -n "$CLAUDE_DJ_DEBUG" ]; then
  echo "[claude-dj] Debug mode: logging to logs/bridge.log"
fi
echo "[claude-dj] Press Ctrl+C to stop"
echo ""

exec node claude-plugin/bridge/server.js
