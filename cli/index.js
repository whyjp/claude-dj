#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const command = process.argv[2];

if (command === 'setup') {
  const setup = await import('../tools/setup.js');
  await setup.run();
} else {
  // Default: start bridge
  const server = path.join(__dirname, '..', 'bridge', 'server.js');
  const child = spawn(process.execPath, [server], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code || 0));
}
