#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseFencedChoices, parseRegexChoices } from './choiceParser.js';
import { hookLog } from './hookLogger.js';

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

    const fenced = parseFencedChoices(lastAssistant);
    const regex = parseRegexChoices(lastAssistant);
    const result = fenced || regex;
    hookLog('stop', `choices=${result?.length ?? 0} fenced=${!!fenced} regex=${!!regex} tail=${JSON.stringify(lastAssistant.slice(-200))}`);
    return result;
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

    // Parse transcript for choices
    let choices = null;
    if (parsed.transcript_path) {
      choices = parseChoices(parsed.transcript_path);
    }

    if (choices && choices.length > 0) {
      // Proxy mode: send choices to bridge and hold HTTP open.
      // Bridge creates interactive WAITING_CHOICE on deck; user presses a button.
      // Bridge returns { selectedChoice: "label" } → we block the stop and inject selection.
      const payload = { ...parsed, _djChoices: choices };
      const resp = await fetch(`${BRIDGE_URL}/api/hook/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120000), // 2 min for user interaction
      });
      const result = await resp.json();
      if (result.selectedChoice) {
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason: `User selected: ${result.selectedChoice}`,
        }));
        return;
      }
      // No selection (timeout/dismiss) — fall through to normal stop
      return;
    }

    // No choices — fire-and-forget stop notification
    await fetch(`${BRIDGE_URL}/api/hook/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    // ignore
  }
}

await main();
