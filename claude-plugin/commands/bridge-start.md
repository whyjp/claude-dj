Start the claude-dj bridge server. Run this if the bridge didn't auto-start or was stopped.

Use the Bash tool to run:
```bash
CDJ_DIR="$(node -e "const p=require('path'),os=require('os');const d=p.join(os.homedir(),'.claude','plugins');const i=JSON.parse(require('fs').readFileSync(p.join(d,'installed_plugins.json'),'utf8'));const e=Object.entries(i.plugins).find(([k])=>k.startsWith('claude-dj'));if(e)console.log(e[1][0].installPath);else console.log('NOT_FOUND')")"
test -d "$CDJ_DIR/node_modules/express" || (cd "$CDJ_DIR" && npm install --omit=dev --silent)
node "$CDJ_DIR/bridge/server.js" &
sleep 2
curl -s "http://localhost:${CLAUDE_DJ_PORT:-39200}/api/health" && echo " — Bridge running: http://localhost:${CLAUDE_DJ_PORT:-39200}" || echo "Bridge not responding yet"
```

Report the result to the user.
