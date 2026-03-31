const FENCE_OPEN = '[claude-dj-choices]';
const FENCE_CLOSE = '[/claude-dj-choices]';
const LINE_RE = /^\s*([A-Za-z0-9]+(?:[a-z])?)[.):\]]\s*(.+)/;

/**
 * Parse choices from the last [claude-dj-choices] fence block.
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
 * Only scans the TAIL of the text (last 800 chars) to avoid matching
 * numbered section headers or task lists buried in longer responses.
 * Returns array of {index, label} or null.
 */
export function parseRegexChoices(text) {
  // Only scan the tail — real choices are always at the end of a message
  const tail = (text.length > 800 ? text.slice(-800) : text).replace(/\r\n/g, '\n');

  const patterns = [
    /^(?:\*\*)?(\d+)[.):\]]\s*\*?\*?\s*(.+)/gm,
    /^\((\d+)\)\s*(.+)/gm,
    /^(?:\*\*)?([A-Za-z])[.):\]]\s*\*?\*?\s*(.+)/gm,
    /^\(([A-Za-z])\)\s*(.+)/gm,
  ];

  for (const pattern of patterns) {
    const matches = [...tail.matchAll(pattern)];
    if (matches.length < 2) continue;

    // Require matches to be on consecutive or near-consecutive lines
    // (real choices are clustered, section headers are spread across paragraphs)
    const lines = tail.split('\n');
    const matchLineNums = matches.map((m) => {
      const pos = m.index;
      let lineNum = 0;
      let charCount = 0;
      for (const line of lines) {
        if (charCount + line.length >= pos) break;
        charCount += line.length + 1; // +1 for \n
        lineNum++;
      }
      return lineNum;
    });

    // Check that all matches are within a 15-line window
    const span = matchLineNums[matchLineNums.length - 1] - matchLineNums[0];
    if (span > 15) continue;

    return matches.slice(0, 10).map((m) => ({
      index: m[1],
      label: m[2].trim().slice(0, 30),
    }));
  }

  return null;
}
