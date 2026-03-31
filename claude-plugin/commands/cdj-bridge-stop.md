Stop the claude-dj bridge server gracefully.

Use the Bash tool to run:
```bash
curl -s -X POST "http://localhost:${CLAUDE_DJ_PORT:-39200}/api/shutdown" 2>/dev/null && echo "[claude-dj] Bridge shutdown requested" || echo "[claude-dj] No bridge running"
sleep 1
curl -s "http://localhost:${CLAUDE_DJ_PORT:-39200}/api/health" >/dev/null 2>&1 && echo "[claude-dj] Bridge still running" || echo "[claude-dj] Bridge stopped"
```

Report the result to the user.
