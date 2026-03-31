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

  // 1) Notify bridge of user prompt → transition to PROCESSING immediately
  const notifyPromise = fetch(`${BRIDGE_URL}/api/hook/userPromptSubmit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: input,
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});

  // 2) Poll for pending deck button events (existing behavior)
  const eventsPromise = fetch(`${BRIDGE_URL}/api/events/${sessionId}`, {
    signal: AbortSignal.timeout(3000),
  }).then(r => r.json()).catch(() => ({ events: [] }));

  const [, { events }] = await Promise.all([notifyPromise, eventsPromise]);

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
