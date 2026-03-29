#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseFencedChoices, parseRegexChoices } from './choiceParser.js';

const BRIDGE_URL = process.env.CLAUDE_DJ_URL || 'http://localhost:39200';

/**
 * Extract last assistant text from transcript JSONL and parse choices.
 * Priority: fenced choices > regex fallback > null.
 */
function parseChoices(transcriptPath) {
  try {
    const content = readFileSync(transcriptPath, 'utf8');
    const lines = content.trim().split('\n');

    let lastAssistant = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type === 'assistant' && entry.message?.content) {
          const textParts = entry.message.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n');
          if (textParts) {
            lastAssistant = textParts;
            break;
          }
        }
      } catch (e) { /* skip malformed lines */ }
    }

    if (!lastAssistant) return null;

    return parseFencedChoices(lastAssistant) || parseRegexChoices(lastAssistant);
  } catch (e) {
    return null;
  }
}

try {
  const input = readFileSync(0, 'utf8');
  const parsed = JSON.parse(input);

  if (parsed.stop_hook_active) {
    await fetch(`${BRIDGE_URL}/api/hook/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: input,
      signal: AbortSignal.timeout(5000),
    });
    process.exit(0);
  }

  // Parse transcript for choices
  let choices = null;
  if (parsed.transcript_path) {
    choices = parseChoices(parsed.transcript_path);
  }

  const payload = { ...parsed, _djChoices: choices };

  if (choices && choices.length > 0) {
    // BLOCKING: wait for user to press a deck button (like permission hook)
    const res = await fetch(`${BRIDGE_URL}/api/hook/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
    const json = await res.json();
    // Output the selection so Claude sees it
    if (json.decision) {
      process.stdout.write(JSON.stringify(json));
    }
  } else {
    // No choices — fire and forget
    await fetch(`${BRIDGE_URL}/api/hook/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  }
} catch (e) {
  // ignore — bridge down or timeout
}
process.exit(0);
