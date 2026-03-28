#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const BRIDGE_URL = process.env.CLAUDE_DJ_URL || 'http://localhost:39200';

try {
  const input = readFileSync('/dev/stdin', 'utf8');
  const res = await fetch(`${BRIDGE_URL}/api/hook/permission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: input,
    signal: AbortSignal.timeout(110_000),
  });
  const json = await res.json();
  process.stdout.write(JSON.stringify(json));
} catch (e) {
  // Bridge down — exit 0 with empty response = show original dialog
  process.exit(0);
}
