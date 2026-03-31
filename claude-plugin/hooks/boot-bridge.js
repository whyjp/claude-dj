#!/usr/bin/env node
// Boot script: install deps if needed, then start bridge (detached)
import { existsSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.join(__dirname, '..');

if (!existsSync(path.join(pluginRoot, 'node_modules', 'express'))) {
  execSync('npm install --omit=dev', { cwd: pluginRoot, stdio: 'ignore', timeout: 60000 });
}

const port = process.env.CLAUDE_DJ_PORT || 39200;
const child = spawn(process.execPath, [path.join(pluginRoot, 'bridge', 'server.js')], {
  detached: true,
  stdio: 'ignore',
  env: { ...process.env },
});
child.unref();

// Wait for bridge to be ready, then write flag file
const url = `http://localhost:${port}/api/health`;
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 500));
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      // Write ready flag for userPrompt hook to pick up
      const os = await import('node:os');
      const fs = await import('node:fs');
      const flagPath = path.join(os.default.tmpdir(), 'claude-dj-ready.flag');
      fs.default.writeFileSync(flagPath, `http://localhost:${port}`);
      break;
    }
  } catch {}
}
process.exit(0);
