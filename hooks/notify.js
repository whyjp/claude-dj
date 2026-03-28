#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const BRIDGE_URL = process.env.CLAUDE_DJ_URL || 'http://localhost:39200';

try {
  const input = readFileSync('/dev/stdin', 'utf8');
  await fetch(`${BRIDGE_URL}/api/hook/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: input,
    signal: AbortSignal.timeout(5000),
  });
} catch (e) {
  // ignore — async hook
}
process.exit(0);
