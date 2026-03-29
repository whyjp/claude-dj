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
