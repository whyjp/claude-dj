Restart the claude-dj bridge server — graceful shutdown then fresh start.

Use the Bash tool to run:
```bash
curl -s -X POST "http://localhost:${CLAUDE_DJ_PORT:-39200}/api/shutdown" 2>/dev/null && echo "[claude-dj] Bridge shutdown requested" || echo "[claude-dj] No bridge running (starting fresh)"
sleep 2
if curl -s "http://localhost:${CLAUDE_DJ_PORT:-39200}/api/health" >/dev/null 2>&1; then
  echo "[claude-dj] Bridge still running after shutdown — skipping start"
else
  CDJ_DIR="$(node -e "const p=require('path'),os=require('os');const d=p.join(os.homedir(),'.claude','plugins');const i=JSON.parse(require('fs').readFileSync(p.join(d,'installed_plugins.json'),'utf8'));const e=Object.entries(i.plugins).find(([k])=>k.startsWith('claude-dj'));if(e)console.log(e[1][0].installPath);else console.log('NOT_FOUND')")"
  test -d "$CDJ_DIR/node_modules/express" || (cd "$CDJ_DIR" && npm install --omit=dev --silent)
  node "$CDJ_DIR/bridge/server.js" &
  sleep 2
  curl -s "http://localhost:${CLAUDE_DJ_PORT:-39200}/api/health" && echo " — Bridge restarted: http://localhost:${CLAUDE_DJ_PORT:-39200}" || echo "Bridge not responding yet"
fi
```

Report the result to the user.
