#!/usr/bin/env bash
# Stop any running claude-dj bridge server
# Usage: ./scripts/stop-bridge.sh

PORT="${CLAUDE_DJ_PORT:-39200}"

# Try graceful health-check first to confirm it's our bridge
if curl -s "http://localhost:$PORT/api/health" | grep -q '"status":"ok"' 2>/dev/null; then
  echo "[claude-dj] Bridge found on port $PORT"
else
  echo "[claude-dj] No bridge running on port $PORT"
  exit 0
fi

# Find PIDs listening on the port
if command -v lsof &>/dev/null; then
  PIDS=$(lsof -ti "tcp:$PORT" 2>/dev/null)
elif command -v ss &>/dev/null; then
  PIDS=$(ss -tlnp "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K\d+')
elif command -v netstat &>/dev/null; then
  PIDS=$(netstat -tlnp 2>/dev/null | grep ":$PORT " | grep -oP '\d+(?=/)')
fi

if [ -z "$PIDS" ]; then
  echo "[claude-dj] Could not find PID for port $PORT"
  exit 1
fi

for PID in $PIDS; do
  echo "[claude-dj] Killing bridge (PID $PID)"
  kill "$PID" 2>/dev/null || true
done

# Wait briefly and verify
sleep 1
if curl -s --max-time 2 "http://localhost:$PORT/api/health" &>/dev/null; then
  echo "[claude-dj] Bridge still running — force killing"
  for PID in $PIDS; do
    kill -9 "$PID" 2>/dev/null || true
  done
else
  echo "[claude-dj] Bridge stopped"
fi
