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
