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
 * Extract last assistant text from transcript JSONL (fallback).
 * Note: transcript may be stale when stop hook fires — prefer
 * parsed.last_assistant_message from stdin when available.
 */
function extractTranscriptText(transcriptPath) {
  try {
    const resolved = path.resolve(transcriptPath);
    const allowedPrefixes = [path.join(os.homedir(), '.claude'), os.tmpdir()];
    if (!allowedPrefixes.some(p => resolved.startsWith(p))) return null;
    const content = readFileSync(resolved, 'utf8');
    const lines = content.trim().split('\n');

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type === 'assistant' && entry.message?.content) {
          const textParts = entry.message.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n');
          if (textParts) return textParts;
        }
      } catch (e) { /* skip malformed lines */ }
    }
    return null;
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

    // Parse choices from last_assistant_message (current text block).
    // Fenced choices may be in an earlier text block (before tool calls),
    // so also check transcript as fallback for fenced detection.
    let choices = null;
    const stdinText = parsed.last_assistant_message || null;
    let src = 'none';
    const traceStdin = (d) => hookLog('choiceParser', JSON.stringify({ ...d, source: 'stdin' }));

    if (stdinText) {
      const fenced = parseFencedChoices(stdinText, { trace: traceStdin });
      const regex = parseRegexChoices(stdinText, { trace: traceStdin });
      choices = fenced || regex;
      src = fenced ? 'stdin-fenced' : regex ? 'stdin-regex' : 'none';
    }

    // Fallback: if no fenced choices in stdin, check transcript
    // (fenced tags may be in a previous text block before AskUserQuestion)
    if (!choices && parsed.transcript_path) {
      const transcriptText = extractTranscriptText(parsed.transcript_path);
      if (transcriptText) {
        const fenced = parseFencedChoices(transcriptText, {
          trace: (d) => hookLog('choiceParser', JSON.stringify({ ...d, source: 'transcript' })),
        });
        if (fenced) {
          choices = fenced;
          src = 'transcript-fenced';
        }
      }
    }

    hookLog('stop', `choices=${choices?.length ?? 0} src=${src} tail=${JSON.stringify((stdinText || '').slice(-200))}`);

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
        // block injects selection into Claude's context immediately.
        // Claude Code displays this as "Stop hook error: {reason}" —
        // the "error" label is a fixed Claude Code UI string, not a real error.
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason: result.selectedChoice,
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
