# Choice Fencing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a plugin skill that instructs Claude to fence choices in HTML comments, and update the stop hook parser to prioritize fenced choices over regex detection.

**Architecture:** A new `skills/choice-format/SKILL.md` provides always-on instructions for Claude to wrap choices in `<!-- claude-dj-choices -->` fences. The `hooks/stop.js` parser gains a `parseFencedChoices()` function that runs before the existing regex fallback. The `index` field changes from number to string to support `"2a"`, `"A"` style indices.

**Tech Stack:** Node.js (node:test), no new dependencies

---

### Task 1: Create the choice-format skill

**Files:**
- Create: `skills/choice-format/SKILL.md`

- [ ] **Step 1: Create the skill directory and SKILL.md**

```markdown
---
name: choice-format
description: Always active when claude-dj plugin is installed. Instructs Claude to wrap user-facing choices in HTML comment fences for reliable deck button mapping.
---

# Choice Format for Claude DJ

When you present choices or yes/no confirmations to the user, wrap them in a fence block so the Claude DJ deck can display buttons automatically.

## Rules

1. When asking the user to choose between options, wrap the choices in `<!-- claude-dj-choices -->` / `<!-- /claude-dj-choices -->` fences
2. When asking a yes/no confirmation ("Should I proceed?", "Apply this change?"), also use the fence with `1. Yes` / `2. No`
3. Each choice is one line: `index. label` (index can be a number, letter, or combo like `2a`)
4. Do NOT fence numbered lists in code examples, explanations, or non-choice content
5. Write your explanation freely outside the fence — only the choices go inside

## Format

<!-- claude-dj-choices -->
1. First option
2. Second option
3. Third option
<!-- /claude-dj-choices -->

## Hierarchical Choices

<!-- claude-dj-choices -->
1. Database approach
  1a. PostgreSQL
  1b. SQLite
2. File-based approach
<!-- /claude-dj-choices -->

## Yes/No Confirmations

<!-- claude-dj-choices -->
1. Yes
2. No
<!-- /claude-dj-choices -->

## Important

- The fences are HTML comments — they are invisible to the user in rendered markdown
- Always place the fence AFTER your explanation text
- Maximum 10 choices per fence block
- Keep labels concise (under 30 characters)
```

- [ ] **Step 2: Verify the file exists and has correct frontmatter**

Run: `node -e "const fs = require('fs'); const c = fs.readFileSync('skills/choice-format/SKILL.md','utf8'); console.log(c.includes('name: choice-format') && c.includes('claude-dj-choices') ? 'OK' : 'FAIL')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add skills/choice-format/SKILL.md
git commit -m "feat: add choice-format skill for structured choice fencing"
```

---

### Task 2: Add fence parser to stop.js

**Files:**
- Modify: `hooks/stop.js:10-58` (add `parseFencedChoices`, update `parseChoices`)
- Test: `test/stopParser.test.js` (new file — parser unit tests)

- [ ] **Step 1: Write failing tests for the fence parser**

Create `test/stopParser.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFencedChoices, parseRegexChoices } from '../hooks/choiceParser.js';

describe('parseFencedChoices', () => {
  it('parses numeric choices from fence', () => {
    const text = `Here are your options:\n\n<!-- claude-dj-choices -->\n1. Refactor\n2. Rewrite\n3. Patch\n<!-- /claude-dj-choices -->`;
    const result = parseFencedChoices(text);
    assert.deepEqual(result, [
      { index: '1', label: 'Refactor' },
      { index: '2', label: 'Rewrite' },
      { index: '3', label: 'Patch' },
    ]);
  });

  it('parses letter choices from fence', () => {
    const text = `<!-- claude-dj-choices -->\nA. Fix tests\nB. Skip tests\nC. Delete\n<!-- /claude-dj-choices -->`;
    const result = parseFencedChoices(text);
    assert.deepEqual(result, [
      { index: 'A', label: 'Fix tests' },
      { index: 'B', label: 'Skip tests' },
      { index: 'C', label: 'Delete' },
    ]);
  });

  it('parses hierarchical choices (1a, 1b)', () => {
    const text = `<!-- claude-dj-choices -->\n1. Database\n  1a. PostgreSQL\n  1b. SQLite\n2. File-based\n<!-- /claude-dj-choices -->`;
    const result = parseFencedChoices(text);
    assert.deepEqual(result, [
      { index: '1', label: 'Database' },
      { index: '1a', label: 'PostgreSQL' },
      { index: '1b', label: 'SQLite' },
      { index: '2', label: 'File-based' },
    ]);
  });

  it('uses last fence when multiple fences exist', () => {
    const text = `<!-- claude-dj-choices -->\n1. Old\n2. Stale\n<!-- /claude-dj-choices -->\n\nActually:\n\n<!-- claude-dj-choices -->\n1. New\n2. Fresh\n<!-- /claude-dj-choices -->`;
    const result = parseFencedChoices(text);
    assert.deepEqual(result, [
      { index: '1', label: 'New' },
      { index: '2', label: 'Fresh' },
    ]);
  });

  it('returns null when no fence found', () => {
    const text = `Here is some text with 1. numbers and 2. lists but no fence.`;
    assert.equal(parseFencedChoices(text), null);
  });

  it('returns null for empty fence', () => {
    const text = `<!-- claude-dj-choices -->\n<!-- /claude-dj-choices -->`;
    assert.equal(parseFencedChoices(text), null);
  });

  it('caps at 10 choices', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `${i + 1}. Option ${i + 1}`).join('\n');
    const text = `<!-- claude-dj-choices -->\n${lines}\n<!-- /claude-dj-choices -->`;
    const result = parseFencedChoices(text);
    assert.equal(result.length, 10);
    assert.equal(result[9].index, '10');
  });

  it('truncates labels to 30 chars', () => {
    const text = `<!-- claude-dj-choices -->\n1. This is a very long label that exceeds thirty characters easily\n<!-- /claude-dj-choices -->`;
    const result = parseFencedChoices(text);
    assert.ok(result[0].label.length <= 30);
  });

  it('supports delimiter variants: ) : ]', () => {
    const text = `<!-- claude-dj-choices -->\n1) Parens\n2: Colon\n3] Bracket\n<!-- /claude-dj-choices -->`;
    const result = parseFencedChoices(text);
    assert.equal(result.length, 3);
    assert.equal(result[0].label, 'Parens');
    assert.equal(result[1].label, 'Colon');
    assert.equal(result[2].label, 'Bracket');
  });
});

describe('parseRegexChoices (fallback)', () => {
  it('parses numbered list without fence', () => {
    const text = `Choose:\n1. Alpha\n2. Beta\n3. Gamma`;
    const result = parseRegexChoices(text);
    assert.equal(result.length, 3);
    assert.equal(result[0].index, '1');
    assert.equal(result[0].label, 'Alpha');
  });

  it('returns null when fewer than 2 matches', () => {
    const text = `Just a single 1. item here.`;
    assert.equal(parseRegexChoices(text), null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/stopParser.test.js`
Expected: FAIL — module `../hooks/choiceParser.js` does not exist

- [ ] **Step 3: Extract parser into `hooks/choiceParser.js`**

Create `hooks/choiceParser.js`:

```javascript
const FENCE_OPEN = '<!-- claude-dj-choices -->';
const FENCE_CLOSE = '<!-- /claude-dj-choices -->';
const LINE_RE = /^\s*([A-Za-z0-9]+(?:[a-z])?)[.):\]]\s*(.+)/;

/**
 * Parse choices from the last <!-- claude-dj-choices --> fence block.
 * Returns array of {index, label} or null if no fence found.
 */
export function parseFencedChoices(text) {
  // Find the LAST fence block
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/stopParser.test.js`
Expected: All 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add hooks/choiceParser.js test/stopParser.test.js
git commit -m "feat: add fence + regex choice parsers with tests"
```

---

### Task 3: Wire fence parser into stop.js

**Files:**
- Modify: `hooks/stop.js` (replace inline parser with import)

- [ ] **Step 1: Update stop.js to use choiceParser**

Replace the `parseChoices` function and its usage in `hooks/stop.js`. The new version:

```javascript
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

    // Fence first, regex fallback
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

  let choices = null;
  if (parsed.transcript_path) {
    choices = parseChoices(parsed.transcript_path);
  }

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
```

- [ ] **Step 2: Run all tests to verify nothing broke**

Run: `node --test test/*.test.js`
Expected: All 64 tests PASS (53 existing + 11 new parser tests)

- [ ] **Step 3: Commit**

```bash
git add hooks/stop.js
git commit -m "refactor: wire fence parser into stop hook with regex fallback"
```

---

### Task 4: Update index type from number to string

The existing code uses `index: i + 1` (number) in the old regex parser. The new parsers return `index: "1"` (string). The downstream code in `buttonManager.js` and `d200-renderer.js` needs to handle string indices.

**Files:**
- Modify: `bridge/buttonManager.js:45-49`
- Modify: `test/buttonManager.test.js`

- [ ] **Step 1: Write a failing test for string index in response choice**

Add to `test/buttonManager.test.js`:

```javascript
it('resolves response button press with string index label', () => {
  const result = ButtonManager.resolvePress(1, 'WAITING_RESPONSE', {
    choices: [
      { index: '1', label: 'Refactor' },
      { index: '2a', label: 'Rewrite with schema' },
      { index: '2b', label: 'Rewrite keep schema' },
    ],
  });
  assert.deepEqual(result, { type: 'response', value: '2a. Rewrite with schema' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/buttonManager.test.js`
Expected: FAIL — value is `"Rewrite with schema"`, not `"2a. Rewrite with schema"`

- [ ] **Step 3: Update resolvePress to include index in response value**

In `bridge/buttonManager.js`, change the WAITING_RESPONSE block (line 46-48):

```javascript
    if (state === 'WAITING_RESPONSE') {
      const choices = prompt?.choices;
      if (choices && slot >= 0 && slot < choices.length) {
        return { type: 'response', value: `${choices[slot].index}. ${choices[slot].label}` };
      }
      if (!choices && slot >= 0 && slot <= 9) {
        return { type: 'response', value: String(slot + 1) };
      }
      return null;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/buttonManager.test.js`
Expected: All 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add bridge/buttonManager.js test/buttonManager.test.js
git commit -m "feat: include choice index in response value for deck events"
```

---

### Task 5: Update hooks.test.js for new parser module

**Files:**
- Modify: `test/hooks.test.js` (add choiceParser.js existence check)

- [ ] **Step 1: Add test for choiceParser.js**

Add to `test/hooks.test.js` inside the `describe('Hook scripts', ...)` block:

```javascript
  it('choiceParser.js exists and exports parsers', async () => {
    assert.ok(existsSync('hooks/choiceParser.js'));
    const mod = await import('../hooks/choiceParser.js');
    assert.equal(typeof mod.parseFencedChoices, 'function');
    assert.equal(typeof mod.parseRegexChoices, 'function');
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test test/hooks.test.js`
Expected: All 8 tests PASS

- [ ] **Step 3: Add test for skill file existence**

Add to `test/hooks.test.js`:

```javascript
  it('choice-format skill exists with correct frontmatter', () => {
    assert.ok(existsSync('skills/choice-format/SKILL.md'));
    const content = readFileSync('skills/choice-format/SKILL.md', 'utf8');
    assert.ok(content.includes('name: choice-format'));
    assert.ok(content.includes('claude-dj-choices'));
  });
```

- [ ] **Step 4: Run all tests**

Run: `node --test test/*.test.js`
Expected: All 66 tests PASS

- [ ] **Step 5: Commit**

```bash
git add test/hooks.test.js
git commit -m "test: add choiceParser and skill existence checks"
```

---

### Task 6: E2E test with fenced transcript

**Files:**
- Modify: `test/e2e.test.js` (add fenced choice E2E test)

- [ ] **Step 1: Add E2E test for fenced choice detection**

Add inside the `describe('E2E: Hook → Bridge → WebSocket', ...)` block in `test/e2e.test.js`:

```javascript
  it('stop.js: fenced choices in transcript → deck shows correct buttons', async () => {
    // Create a fake transcript JSONL with fenced choices
    const tmpDir = path.join(os.tmpdir(), 'claude-dj-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    const entry = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'text',
            text: 'Which approach?\n\n<!-- claude-dj-choices -->\n1. Refactor\n2. Rewrite\n  2a. New schema\n<!-- /claude-dj-choices -->',
          },
        ],
      },
    };
    fs.writeFileSync(transcriptPath, JSON.stringify(entry) + '\n');

    const wsPromise = waitForWsMessage(wsUrl, 'LAYOUT', 5000);

    const result = await runHook('stop.js', {
      session_id: 'e2e-fence-1',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      transcript_path: transcriptPath,
    });

    assert.equal(result.exitCode, 0);

    const msg = await wsPromise;
    assert.equal(msg.preset, 'response');
    assert.ok(msg.choices);
    assert.equal(msg.choices.length, 3);
    assert.equal(msg.choices[0].index, '1');
    assert.equal(msg.choices[0].label, 'Refactor');
    assert.equal(msg.choices[2].index, '2a');
    assert.equal(msg.choices[2].label, 'New schema');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
```

Add `os` and `fs` imports at the top of `test/e2e.test.js`:

```javascript
import os from 'node:os';
import fs from 'node:fs';
```

- [ ] **Step 2: Run the E2E test**

Run: `node --test test/e2e.test.js`
Expected: All 11 tests PASS (10 existing + 1 new)

- [ ] **Step 3: Commit**

```bash
git add test/e2e.test.js
git commit -m "test: add E2E test for fenced choice detection"
```

---

### Task 7: Final integration test — run all tests

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `node --test test/*.test.js`
Expected: All ~67 tests PASS across 7 suites

- [ ] **Step 2: Verify file structure**

Run: `find skills hooks/choiceParser.js -type f`

Expected:
```
skills/choice-format/SKILL.md
hooks/choiceParser.js
```

- [ ] **Step 3: Final commit with updated docs**

Update `docs/superpowers/plans/2026-03-29-session3-final-status.md` file map to include new files, then:

```bash
git add docs/
git commit -m "docs: update status with choice fencing implementation"
```
