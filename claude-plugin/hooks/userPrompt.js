#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const BRIDGE_URL = process.env.CLAUDE_DJ_URL || 'http://localhost:39200';

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
    // Inject DJ button selections as context for Claude
    const selections = events.map((e) => e.value).join(', ');
    const output = {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `[Claude DJ] User previously selected via deck buttons: ${selections}`,
      },
    };
    process.stdout.write(JSON.stringify(output));
  }
} catch (e) {
  // Bridge down — no events to inject
}
process.exit(0);
