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
