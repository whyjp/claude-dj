#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const BRIDGE_URL = process.env.CLAUDE_DJ_URL || 'http://localhost:39200';
const MAX_RETRIES = 3;

try {
  const input = readFileSync(0, 'utf8');
  const parsed = JSON.parse(input);

  // If stop_hook_active, Claude is still working — fire and forget
  if (parsed.stop_hook_active) {
    await fetch(`${BRIDGE_URL}/api/hook/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: input,
      signal: AbortSignal.timeout(5000),
    });
    process.exit(0);
  }

  // Retry loop: each attempt has a short timeout, retry if no button pressed
  for (let i = 0; i < MAX_RETRIES; i++) {
    const res = await fetch(`${BRIDGE_URL}/api/hook/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: input,
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json();

    if (json.hookSpecificOutput) {
      process.stdout.write(JSON.stringify(json));
      process.exit(0);
    }
    // No response — retry (Bridge will re-enter WAITING_RESPONSE)
  }
} catch (e) {
  // Bridge down or timeout — exit cleanly
}
process.exit(0);
