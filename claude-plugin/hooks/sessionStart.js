#!/usr/bin/env node
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_URL = process.env.CLAUDE_DJ_URL || 'http://localhost:39200';

async function isRunning() {
  try {
    const res = await fetch(`${BRIDGE_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch { return false; }
}

function ensureDeps() {
  const pluginRoot = path.join(__dirname, '..');
  if (existsSync(path.join(pluginRoot, 'node_modules', 'express'))) return;
  try {
    execSync('npm install --omit=dev', { cwd: pluginRoot, stdio: 'ignore', timeout: 30000 });
  } catch { /* best effort */ }
}

async function startBridge() {
  ensureDeps();
  const serverPath = path.join(__dirname, '..', 'bridge', 'server.js');
  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();

  // wait for bridge to be ready (up to 5s)
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isRunning()) return true;
  }
  return false;
}

const alreadyRunning = await isRunning();
const url = BRIDGE_URL.replace('http://localhost', 'http://localhost').replace('http://127.0.0.1', 'http://localhost');

if (alreadyRunning) {
  console.log(JSON.stringify({
    hookSpecificOutput: `[claude-dj] Virtual DJ dashboard: ${url}`
  }));
} else {
  const started = await startBridge();
  if (started) {
    console.log(JSON.stringify({
      hookSpecificOutput: `[claude-dj] Bridge started — Virtual DJ dashboard: ${url}`
    }));
  } else {
    console.log(JSON.stringify({
      hookSpecificOutput: `[claude-dj] Failed to start bridge. Run manually: node bridge/server.js`
    }));
  }
}

process.exit(0);
