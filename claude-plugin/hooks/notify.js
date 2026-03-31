#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_URL = process.env.CLAUDE_DJ_URL || 'http://localhost:39200';

try {
  const input = readFileSync(0, 'utf8');
  await fetch(`${BRIDGE_URL}/api/hook/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: input,
    signal: AbortSignal.timeout(5000),
  });
} catch (e) {
  // Bridge down — try to start it
  if (e?.cause?.code === 'ECONNREFUSED' || e?.name === 'TimeoutError') {
    spawn(process.execPath, [path.join(__dirname, 'boot-bridge.js')], {
      detached: true, stdio: 'ignore', windowsHide: true,
    }).unref();
  }
}
process.exit(0);
