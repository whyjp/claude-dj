#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.CLAUDE_DJ_PORT || 39200;
const url = `http://localhost:${port}`;

let running = false;
let stale = false;
try {
  const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
  if (res.ok) {
    const health = await res.json();
    const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    if (health.version === pkg.version) {
      running = true;
    } else {
      stale = true; // Bridge running but version mismatch — restart it
    }
  }
} catch {}

if (!running) {
  if (stale) {
    // Kill stale bridge before starting fresh
    try { await fetch(`${url}/api/shutdown`, { method: 'POST', signal: AbortSignal.timeout(1000) }); } catch {}
    await new Promise(r => setTimeout(r, 800));
  }
  spawn(process.execPath, [path.join(__dirname, 'boot-bridge.js')], {
    detached: true, stdio: 'ignore', windowsHide: true,
  }).unref();
}

// Notify bridge of session start (fire-and-forget)
try {
  const input = readFileSync(0, 'utf8');
  await fetch(`${url}/api/hook/sessionStart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: input,
    signal: AbortSignal.timeout(5000),
  });
} catch {
  // Bridge may still be booting — session will be created on first PreToolUse
}

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: running
      ? `[claude-dj] Virtual DJ dashboard: ${url}`
      : `[claude-dj] Bridge starting — dashboard: ${url}`,
  },
}));
process.exit(0);
