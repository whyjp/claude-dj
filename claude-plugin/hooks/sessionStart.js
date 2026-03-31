#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.CLAUDE_DJ_PORT || 39200;
const url = `http://localhost:${port}`;

let running = false;
try {
  const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
  running = res.ok;
} catch {}

if (!running) {
  spawn(process.execPath, [path.join(__dirname, 'boot-bridge.js')], {
    detached: true, stdio: 'ignore', windowsHide: true,
  }).unref();
}

console.log(JSON.stringify({
  hookSpecificOutput: running
    ? `[claude-dj] Virtual DJ dashboard: ${url}`
    : `[claude-dj] Bridge starting — dashboard: ${url}`
}));
process.exit(0);
