#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const BRIDGE_URL = (() => {
  const url = process.env.CLAUDE_DJ_URL || 'http://localhost:39200';
  try { const h = new URL(url).hostname; if (['localhost','127.0.0.1','::1'].includes(h)) return url; } catch {}
  process.stderr.write(`[claude-dj] CLAUDE_DJ_URL must be localhost, got: ${url}\n`);
  process.exit(1);
})();

try {
  const input = readFileSync(0, 'utf8');
  await fetch(`${BRIDGE_URL}/api/hook/stopFailure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: input,
    signal: AbortSignal.timeout(5000),
  });
} catch {
  // ignore — async hook
}
process.exit(0);
