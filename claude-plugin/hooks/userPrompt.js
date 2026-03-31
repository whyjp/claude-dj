#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const BRIDGE_URL = process.env.CLAUDE_DJ_URL || 'http://localhost:39200';

try {
  const input = readFileSync(0, 'utf8');
  const parsed = JSON.parse(input);
  const sessionId = parsed.session_id;

  const res = await fetch(`${BRIDGE_URL}/api/events/${sessionId}`, {
    signal: AbortSignal.timeout(3000),
  });
  const { events } = await res.json();

  if (events && events.length > 0) {
    const selections = events.map((e) => e.value).join(', ');
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `[claude-dj] User selected via deck buttons: ${selections}`,
      },
    }));
  }
} catch {
  // Bridge down — no events to inject
}
process.exit(0);
