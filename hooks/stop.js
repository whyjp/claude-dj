#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseFencedChoices, parseRegexChoices } from './choiceParser.js';

const BRIDGE_URL = process.env.CLAUDE_DJ_URL || 'http://localhost:39200';

/**
 * Extract last assistant text from transcript JSONL and parse choices.
 * Used as display-only fallback when Claude doesn't use AskUserQuestion.
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

async function main() {
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
      return;
    }

    // Parse transcript for choices (display-only fallback)
    let choices = null;
    if (parsed.transcript_path) {
      choices = parseChoices(parsed.transcript_path);
    }

    // Send stop event to bridge (shows buttons on deck)
    const payload = { ...parsed, _djChoices: choices };
    await fetch(`${BRIDGE_URL}/api/hook/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });

    // If choices detected, wait for deck button press via long-poll
    if (choices && choices.length > 0) {
      try {
        const waitRes = await fetch(
          `${BRIDGE_URL}/api/stop-wait/${parsed.session_id}?timeout=60000`,
          { signal: AbortSignal.timeout(65000) },
        );
        const result = await waitRes.json();
        if (result.selected) {
          // Return selection as stopResponse — Claude receives it as user input
          const output = {
            hookSpecificOutput: {
              hookEventName: 'Stop',
              stopResponse: result.value,
            },
          };
          process.stdout.write(JSON.stringify(output));
        }
      } catch (e) {
        // Timeout or bridge down — fall through, user can type manually
      }
    }
  } catch (e) {
    // ignore
  }
}

await main();
