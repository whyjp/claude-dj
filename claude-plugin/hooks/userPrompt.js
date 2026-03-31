#!/usr/bin/env node
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BRIDGE_URL = process.env.CLAUDE_DJ_URL || 'http://localhost:39200';
const parts = [];

// Check bridge-ready flag (one-time notification from boot-bridge.js)
const flagPath = join(tmpdir(), 'claude-dj-ready.flag');
if (existsSync(flagPath)) {
  try {
    const url = readFileSync(flagPath, 'utf8').trim();
    parts.push(`[claude-dj] Bridge connected — Virtual DJ dashboard: ${url}`);
    unlinkSync(flagPath);
  } catch {}
}

try {
  const input = readFileSync(0, 'utf8');
  const parsed = JSON.parse(input);
  const sessionId = parsed.session_id;

  // Check if there are pending DJ events for this session
  const res = await fetch(`${BRIDGE_URL}/api/events/${sessionId}`, {
    signal: AbortSignal.timeout(3000),
  });
  const { events } = await res.json();

  if (events && events.length > 0) {
    const selections = events.map((e) => e.value).join(', ');
    parts.push(`[claude-dj] User selected via deck buttons: ${selections}`);
  }
} catch {
  // Bridge down — no events to inject
}

if (parts.length > 0) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: parts.join('\n'),
    },
  }));
}
process.exit(0);
