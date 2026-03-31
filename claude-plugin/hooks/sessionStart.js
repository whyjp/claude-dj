#!/usr/bin/env node
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Close stdin immediately — SessionStart may or may not receive data
process.stdin.resume();
process.stdin.on('data', () => {});
process.stdin.on('end', () => {});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_URL = process.env.CLAUDE_DJ_URL || 'http://localhost:39200';

async function isRunning() {
  try {
    const res = await fetch(`${BRIDGE_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch { return false; }
}

const pluginRoot = path.join(__dirname, '..');
const url = BRIDGE_URL.replace('http://127.0.0.1', 'http://localhost');

if (await isRunning()) {
  console.log(JSON.stringify({
    hookSpecificOutput: `[claude-dj] Virtual DJ dashboard: ${url}`
  }));
  process.exit(0);
}

// Fire-and-forget: install deps + start bridge in background
const bootPath = path.join(__dirname, 'boot-bridge.js');
spawn(process.execPath, [bootPath], {
  detached: true,
  stdio: 'ignore',
}).unref();

console.log(JSON.stringify({
  hookSpecificOutput: `[claude-dj] Bridge starting in background — dashboard: ${url}`
}));
process.exit(0);
