#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const BRIDGE_URL = process.env.CLAUDE_DJ_URL || 'http://localhost:39200';

/**
 * Parse the last assistant message from transcript for numbered choices.
 * Returns array of {index, label} or null if no choices found.
 */
function parseChoices(transcriptPath) {
  try {
    const content = readFileSync(transcriptPath, 'utf8');
    const lines = content.trim().split('\n');

    // Find last assistant message — walk backwards
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

    // Match numbered choice patterns:
    // "1. text", "1) text", "(1) text", "1: text"
    // Also "A. text", "A) text", "(A) text", "a) text"
    const patterns = [
      /^(?:\*\*)?(\d+)[.):\]]\s*\*?\*?\s*(.+)/gm,           // 1. text, 1) text, 1: text
      /^\((\d+)\)\s*(.+)/gm,                                   // (1) text
      /^(?:\*\*)?([A-Za-z])[.):\]]\s*\*?\*?\s*(.+)/gm,       // A. text, A) text
      /^\(([A-Za-z])\)\s*(.+)/gm,                              // (A) text
    ];

    for (const pattern of patterns) {
      const matches = [...lastAssistant.matchAll(pattern)];
      if (matches.length >= 2) {
        return matches.slice(0, 10).map((m, i) => ({
          index: i + 1,
          label: m[1] + ') ' + m[2].trim().slice(0, 30),
        }));
      }
    }

    return null;
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

  // Send to Bridge with parsed choices (or null)
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
process.exit(0);
