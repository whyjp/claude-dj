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

const child = spawn(process.execPath, [path.join(pluginRoot, 'bridge', 'server.js')], {
  detached: true,
  stdio: 'ignore',
  env: { ...process.env },
});
child.unref();
process.exit(0);
