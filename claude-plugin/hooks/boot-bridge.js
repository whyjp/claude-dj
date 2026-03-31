#!/usr/bin/env node
// Boot script: install deps if needed, then start bridge (detached)
import { existsSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.join(__dirname, '..');

// Minimal environment — only pass what the bridge needs
const bridgeEnv = {
  PATH: process.env.PATH,
  NODE_ENV: process.env.NODE_ENV || 'production',
  CLAUDE_DJ_PORT: process.env.CLAUDE_DJ_PORT,
  CLAUDE_DJ_URL: process.env.CLAUDE_DJ_URL,
  CLAUDE_DJ_DEBUG: process.env.CLAUDE_DJ_DEBUG,
  CLAUDE_DJ_BUTTON_TIMEOUT: process.env.CLAUDE_DJ_BUTTON_TIMEOUT,
  CLAUDE_DJ_IDLE_TIMEOUT: process.env.CLAUDE_DJ_IDLE_TIMEOUT,
  CLAUDE_DJ_SHUTDOWN_TICKS: process.env.CLAUDE_DJ_SHUTDOWN_TICKS,
  APPDATA: process.env.APPDATA,       // needed for npm on Windows
  USERPROFILE: process.env.USERPROFILE,
  HOME: process.env.HOME,
  SYSTEMROOT: process.env.SYSTEMROOT, // needed for Node.js on Windows
};

if (!existsSync(path.join(pluginRoot, 'node_modules', 'express'))) {
  execFileSync(process.execPath, [process.env.npm_execpath || 'npm', 'install', '--omit=dev'], {
    cwd: pluginRoot, stdio: 'ignore', timeout: 60000, env: bridgeEnv,
  });
}

const child = spawn(process.execPath, [path.join(pluginRoot, 'bridge', 'server.js')], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
  env: bridgeEnv,
});
child.unref();
process.exit(0);
