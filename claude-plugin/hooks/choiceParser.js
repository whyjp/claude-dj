// claude-plugin/hooks/choiceParser.js
const FENCE_OPEN = '[claude-dj-choices]';
const FENCE_CLOSE = '[/claude-dj-choices]';
const LINE_RE = /^\s*(?:-\s*)?(?:\*\*)?([A-Za-z0-9]+(?:[a-z])?)[.):\]]\s*(?:\*\*)?\s*(.+)/;

const QUESTION_TAIL_RE = /[?？]\s*$/m;
const CHOICE_KEYWORD_RE =
  /(?:선택|골라|어떤|어느|진행할|할까|주세요|원하시|방식으로|어떻게|결정|필요합니다|which|choose|select|pick|prefer|decide|need)/i;
const HEADING_COLON_RE = /[:：]\s*$/;

function stripMarkdown(text) {
  return text.replace(/\*\*/g, '').replace(/\*/g, '').trim();
}

function emit(trace, record) {
  if (typeof trace === 'function') trace(record);
}

// ---------- Stage 1: Fence extraction ----------
/**
 * Stage 1 — parse choices from the last `[claude-dj-choices]...[/claude-dj-choices]`
 * fence block.
 *
 * @param {string} text
 * @param {{ trace?: (record: object) => void }} [options]
 * @returns {{index: string, label: string}[] | null} null when no fence is found
 */
export function parseFencedChoices(text, { trace } = {}) {
  const lastOpen = text.lastIndexOf(FENCE_OPEN);
  if (lastOpen === -1) {
    emit(trace, { phase: '1-fence', accept: false, reason: 'no-open-tag' });
    return null;
  }
  const contentStart = lastOpen + FENCE_OPEN.length;
  const closeIdx = text.indexOf(FENCE_CLOSE, contentStart);
  if (closeIdx === -1) {
    emit(trace, { phase: '1-fence', accept: false, reason: 'no-close-tag' });
    return null;
  }
  const block = text.slice(contentStart, closeIdx).trim();
  if (!block) {
    emit(trace, { phase: '1-fence', accept: false, reason: 'empty-block' });
    return null;
  }

  const choices = [];
  for (const line of block.split('\n')) {
    const m = line.match(LINE_RE);
    if (m) {
      choices.push({ index: m[1], label: stripMarkdown(m[2]).slice(0, 30) });
    }
    if (choices.length >= 10) break;
  }

  emit(trace, { phase: '1-fence', accept: choices.length > 0, count: choices.length });
  return choices.length > 0 ? choices : null;
}

// ---------- Stage 3c: Context filter (was looksLikeChoices) ----------
function contextAccepts(tail, matches, trace) {
  if (matches.length === 0) {
    emit(trace, { phase: '3c-context', accept: false, rule: 'no-matches' });
    return false;
  }

  const firstMatchPos = matches[0].index;
  const lastMatch = matches[matches.length - 1];
  const lastMatchEnd = lastMatch.index + lastMatch[0].length;

  const preamble = tail.slice(0, firstMatchPos).trim();
  const preambleLines = preamble.split('\n').filter((l) => l.trim());
  const lastPreambleLine = preambleLines[preambleLines.length - 1] || '';
  const aftermath = tail.slice(lastMatchEnd).trim();

  if (QUESTION_TAIL_RE.test(lastPreambleLine)) {
    emit(trace, { phase: '3c-context', accept: true, rule: 'question-tail' });
    return true;
  }
  if (CHOICE_KEYWORD_RE.test(preamble)) {
    emit(trace, { phase: '3c-context', accept: true, rule: 'choice-keyword' });
    return true;
  }
  if (HEADING_COLON_RE.test(lastPreambleLine)) {
    emit(trace, { phase: '3c-context', accept: false, rule: 'heading-colon-preamble' });
    return false;
  }
  if (aftermath.length > 50) {
    emit(trace, { phase: '3c-context', accept: false, rule: 'long-aftermath', aftermathLen: aftermath.length });
    return false;
  }
  if (aftermath.length === 0) {
    emit(trace, { phase: '3c-context', accept: true, rule: 'list-at-end' });
    return true;
  }
  emit(trace, { phase: '3c-context', accept: false, rule: 'default-conservative' });
  return false;
}

// ---------- Stages 2 + 3d: Candidate extraction + quality gate ----------
/**
 * Stages 2+3 — regex candidate extraction, context-based gating, and truncation.
 * Only scans the last 800 chars of `text` to avoid matching numbered section
 * headers buried deeper in longer responses.
 *
 * @param {string} text
 * @param {{ trace?: (record: object) => void }} [options]
 * @returns {{index: string, label: string}[] | null} null when no pattern accepts
 */
export function parseRegexChoices(text, { trace } = {}) {
  const tail = (text.length > 800 ? text.slice(-800) : text).replace(/\r\n/g, '\n');

  const patterns = [
    /^\s*(?:-\s*)?(?:\*\*)?(\d+)[.):\]]\s*(?:\*\*)?\s*(.+)/gm,
    /^\s*\((\d+)\)\s*(.+)/gm,
    /^\s*(?:-\s*)?(?:\*\*)?([A-Za-z])[.):\]]\s*(?:\*\*)?\s*(.+)/gm,
    /^\s*\(([A-Za-z])\)\s*(.+)/gm,
  ];

  for (let patternIdx = 0; patternIdx < patterns.length; patternIdx++) {
    const pattern = patterns[patternIdx];
    const matches = [...tail.matchAll(pattern)];
    if (matches.length < 2) {
      emit(trace, { phase: '2-extract', patternIdx, accept: false, reason: 'too-few-matches', count: matches.length });
      continue;
    }

    const lines = tail.split('\n');
    const matchLineNums = matches.map((m) => {
      const pos = m.index;
      let lineNum = 0;
      let charCount = 0;
      for (const line of lines) {
        if (charCount + line.length >= pos) break;
        charCount += line.length + 1;
        lineNum++;
      }
      return lineNum;
    });

    const span = matchLineNums[matchLineNums.length - 1] - matchLineNums[0];
    if (span > 15) {
      emit(trace, { phase: '2-extract', patternIdx, accept: false, reason: 'span-too-wide', span });
      continue;
    }

    if (!contextAccepts(tail, matches, trace)) continue;

    const choices = matches.slice(0, 10).map((m) => ({
      index: m[1],
      label: stripMarkdown(m[2]).slice(0, 30),
    }));
    emit(trace, { phase: '3d-gate', patternIdx, accept: true, count: choices.length });
    return choices;
  }

  emit(trace, { phase: '2-extract', accept: false, reason: 'all-patterns-exhausted' });
  return null;
}
