#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const command = process.argv[2];
const isGlobal = process.argv.includes('--global') || process.argv.includes('-g');

switch (command) {
  case 'install': {
    const setup = await import('../tools/setup.js');
    await setup.install({ global: !process.argv.includes('--project') });
    break;
  }
  case 'uninstall': {
    const setup = await import('../tools/setup.js');
    await setup.uninstall({ global: !process.argv.includes('--project') });
    break;
  }
  case 'status': {
    const setup = await import('../tools/setup.js');
    await setup.status();
    break;
  }
  case 'stop': {
    const port = process.env.CLAUDE_DJ_PORT || 39200;
    const url = `http://localhost:${port}`;
    try {
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) throw new Error();
    } catch {
      console.log(`[claude-dj] No bridge running on port ${port}`);
      process.exit(0);
    }
    console.log(`[claude-dj] Bridge found on port ${port} — sending shutdown`);
    try {
      await fetch(`${url}/api/shutdown`, { method: 'POST', signal: AbortSignal.timeout(5000) });
    } catch { /* server closed connection — expected */ }
    console.log('[claude-dj] Bridge stopped');
    break;
  }
  case 'setup': {
    // Legacy alias
    const setup = await import('../tools/setup.js');
    await setup.install({ global: isGlobal });
    break;
  }
  default: {
    // Default: start bridge
    const server = path.join(__dirname, '..', 'bridge', 'server.js');
    const child = spawn(process.execPath, [server], { stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code || 0));
  }
}
