#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseFencedChoices, parseRegexChoices } from './choiceParser.js';

const BRIDGE_URL = (() => {
  const url = process.env.CLAUDE_DJ_URL || 'http://localhost:39200';
  try { const h = new URL(url).hostname; if (['localhost','127.0.0.1','::1'].includes(h)) return url; } catch {}
  process.stderr.write(`[claude-dj] CLAUDE_DJ_URL must be localhost, got: ${url}\n`);
  process.exit(1);
})();

/**
 * Extract last assistant text from transcript JSONL and parse choices.
 * Used as display-only fallback when Claude doesn't use AskUserQuestion.
 */
function parseChoices(transcriptPath) {
  try {
    // Guard against path traversal — only allow files under ~/.claude/ or system temp
    const resolved = path.resolve(transcriptPath);
    const allowedPrefixes = [path.join(os.homedir(), '.claude'), os.tmpdir()];
    if (!allowedPrefixes.some(p => resolved.startsWith(p))) return null;
    const content = readFileSync(resolved, 'utf8');
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

    // Send stop event to bridge — deck shows "awaiting input" notification
    // No long-poll or button interaction; user responds in terminal
    const payload = { ...parsed, _djChoices: choices };
    await fetch(`${BRIDGE_URL}/api/hook/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    // ignore
  }
}

await main();
