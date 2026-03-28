#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const BRIDGE_URL = process.env.CLAUDE_DJ_URL || 'http://localhost:39200';

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

  // Blocking: wait for Bridge to return (button press or timeout)
  const res = await fetch(`${BRIDGE_URL}/api/hook/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: input,
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json();

  // If Bridge returned a response with systemMessage, pass it to Claude
  if (json.hookSpecificOutput) {
    process.stdout.write(JSON.stringify(json));
  }
} catch (e) {
  // Bridge down or timeout — exit cleanly
}
process.exit(0);
