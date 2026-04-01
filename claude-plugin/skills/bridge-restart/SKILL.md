---
name: bridge-restart
description: Restart the claude-dj bridge server (stop then start)
user_invocable: true
---

Restart the claude-dj bridge server — graceful shutdown then fresh start.

## Instructions

1. Use the Bash tool to run:
```bash
curl -s -X POST "http://localhost:${CLAUDE_DJ_PORT:-39200}/api/shutdown" 2>/dev/null && echo "[claude-dj] Bridge shutdown requested" || echo "[claude-dj] No bridge running (starting fresh)"
sleep 2
curl -s "http://localhost:${CLAUDE_DJ_PORT:-39200}/api/health" >/dev/null 2>&1 && echo "[claude-dj] Bridge still running — skipping start" && exit 0
cd "${CLAUDE_PLUGIN_ROOT}" && node --input-type=module -e "
import { existsSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
if (!existsSync('node_modules/express')) {
  console.log('[claude-dj] Installing dependencies...');
  execFileSync(process.execPath, [process.env.npm_execpath || 'npm', 'install', '--omit=dev'], { stdio: 'inherit' });
}
const child = spawn(process.execPath, ['bridge/server.js'], { detached: true, stdio: 'ignore' });
child.unref();
console.log('[claude-dj] Bridge starting...');
setTimeout(async () => {
  try {
    const r = await fetch('http://localhost:' + (process.env.CLAUDE_DJ_PORT || 39200) + '/api/health');
    if (r.ok) console.log('[claude-dj] Bridge restarted — dashboard: http://localhost:' + (process.env.CLAUDE_DJ_PORT || 39200));
    else console.log('[claude-dj] Bridge health check failed');
  } catch { console.log('[claude-dj] Bridge not responding yet — check http://localhost:' + (process.env.CLAUDE_DJ_PORT || 39200)); }
  process.exit(0);
}, 2000);
"
```

2. Report the result to the user.
