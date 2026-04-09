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
 * Context-based choice detection — analyzes text BEFORE and AFTER the
 * numbered list to determine intent.
 *
 * Choice pattern:  question/prompt → list → end of message
 * Explanation pattern:  statement/heading → list → continuation text
 *
 * Em-dashes in list items are irrelevant — they're just punctuation.
 * What matters is whether the surrounding text asks for a decision.
 */
const QUESTION_TAIL_RE = /[?？]\s*$/m;
const CHOICE_KEYWORD_RE =
  /(?:선택|골라|어떤|어느|진행할|할까|주세요|원하시|방식으로|어떻게|결정|필요합니다|which|choose|select|pick|prefer|decide|need)/i;
const HEADING_COLON_RE = /[:：]\s*$/;

function looksLikeChoices(tail, matches) {
  if (matches.length === 0) return false;

  const firstMatchPos = matches[0].index;
  const lastMatch = matches[matches.length - 1];
  const lastMatchEnd = lastMatch.index + lastMatch[0].length;

  // Text before the first numbered item
  const preamble = tail.slice(0, firstMatchPos).trim();
  const preambleLines = preamble.split('\n').filter((l) => l.trim());
  const lastPreambleLine = preambleLines[preambleLines.length - 1] || '';

  // Text after the last numbered item
  const aftermath = tail.slice(lastMatchEnd).trim();

  // --- Strong choice signals ---
  // Question mark in the line immediately before the list
  if (QUESTION_TAIL_RE.test(lastPreambleLine)) return true;
  // Choice-related keyword anywhere in the preamble
  if (CHOICE_KEYWORD_RE.test(preamble)) return true;

  // --- Strong explanation signals ---
  // Heading-style colon without question/keyword → description, not choices
  // e.g. "확인 사항:", "원인:", "구현 계획:", "변경 이력:"
  if (HEADING_COLON_RE.test(lastPreambleLine)) return false;
  // Substantial text continues after the list (summary, analysis, next steps)
  if (aftermath.length > 50) return false;

  // --- Structural signal ---
  // List ends the message with no/minimal text after → likely choices
  if (aftermath.length === 0) return true;

  // Default: conservative — not choices
  return false;
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

    // Context-based detection: analyze text before/after the list
    if (!looksLikeChoices(tail, matches)) continue;

    return matches.slice(0, 10).map((m) => ({
      index: m[1],
      label: m[2].trim().slice(0, 30),
    }));
  }

  return null;
}
