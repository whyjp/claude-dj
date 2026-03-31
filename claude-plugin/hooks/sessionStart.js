#!/usr/bin/env node
import { readFileSync } from 'node:fs';
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
