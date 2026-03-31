---
name: bridge-start
description: Start the claude-dj bridge server manually
user_invocable: true
---

Start the claude-dj bridge server. Run this if the bridge didn't auto-start or was stopped.

## Instructions

1. Use the Bash tool to run:
```bash
cd "${CLAUDE_PLUGIN_ROOT}" && node -e "
const { existsSync } = require('fs');
const { execSync } = require('child_process');
const { spawn } = require('child_process');
if (!existsSync('node_modules/express')) {
  console.log('[claude-dj] Installing dependencies...');
  execSync('npm install --omit=dev', { stdio: 'inherit' });
}
const child = spawn(process.execPath, ['bridge/server.js'], { detached: true, stdio: 'ignore' });
child.unref();
console.log('[claude-dj] Bridge starting...');
setTimeout(async () => {
  try {
    const r = await fetch('http://localhost:' + (process.env.CLAUDE_DJ_PORT || 39200) + '/api/health');
    if (r.ok) console.log('[claude-dj] Bridge running — dashboard: http://localhost:' + (process.env.CLAUDE_DJ_PORT || 39200));
    else console.log('[claude-dj] Bridge health check failed');
  } catch { console.log('[claude-dj] Bridge not responding yet — check http://localhost:' + (process.env.CLAUDE_DJ_PORT || 39200)); }
  process.exit(0);
}, 2000);
"
```

2. Report the result to the user.
