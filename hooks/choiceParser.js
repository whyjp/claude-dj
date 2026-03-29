const FENCE_OPEN = '<!-- claude-dj-choices -->';
const FENCE_CLOSE = '<!-- /claude-dj-choices -->';
const LINE_RE = /^\s*([A-Za-z0-9]+(?:[a-z])?)[.):\]]\s*(.+)/;

/**
 * Parse choices from the last <!-- claude-dj-choices --> fence block.
 * Returns array of {index, label} or null if no fence found.
 */
export function parseFencedChoices(text) {
  const lastOpen = text.lastIndexOf(FENCE_OPEN);
  if (lastOpen === -1) return null;

  const contentStart = lastOpen + FENCE_OPEN.length;
  const closeIdx = text.indexOf(FENCE_CLOSE, contentStart);
  if (closeIdx === -1) return null;

  const block = text.slice(contentStart, closeIdx).trim();
  if (!block) return null;

  const choices = [];
  for (const line of block.split('\n')) {
    const m = line.match(LINE_RE);
    if (m) {
      choices.push({
        index: m[1],
        label: m[2].trim().slice(0, 30),
      });
    }
    if (choices.length >= 10) break;
  }

  return choices.length > 0 ? choices : null;
}

/**
 * Fallback: regex-based choice detection (original logic).
 * Scans full text for numbered/lettered patterns.
 * Returns array of {index, label} or null.
 */
export function parseRegexChoices(text) {
  const patterns = [
    /^(?:\*\*)?(\d+)[.):\]]\s*\*?\*?\s*(.+)/gm,
    /^\((\d+)\)\s*(.+)/gm,
    /^(?:\*\*)?([A-Za-z])[.):\]]\s*\*?\*?\s*(.+)/gm,
    /^\(([A-Za-z])\)\s*(.+)/gm,
  ];

  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length >= 2) {
      return matches.slice(0, 10).map((m) => ({
        index: m[1],
        label: m[2].trim().slice(0, 30),
      }));
    }
  }

  return null;
}
