import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFencedChoices, parseRegexChoices } from '../hooks/choiceParser.js';

describe('parseFencedChoices', () => {
  it('parses numeric choices from fence', () => {
    const text = 'Here are your options:\n\n[claude-dj-choices]\n1. Refactor\n2. Rewrite\n3. Patch\n[/claude-dj-choices]';
    const result = parseFencedChoices(text);
    assert.deepEqual(result, [
      { index: '1', label: 'Refactor' },
      { index: '2', label: 'Rewrite' },
      { index: '3', label: 'Patch' },
    ]);
  });

  it('parses letter choices from fence', () => {
    const text = '[claude-dj-choices]\nA. Fix tests\nB. Skip tests\nC. Delete\n[/claude-dj-choices]';
    const result = parseFencedChoices(text);
    assert.deepEqual(result, [
      { index: 'A', label: 'Fix tests' },
      { index: 'B', label: 'Skip tests' },
      { index: 'C', label: 'Delete' },
    ]);
  });

  it('parses hierarchical choices (1a, 1b)', () => {
    const text = '[claude-dj-choices]\n1. Database\n  1a. PostgreSQL\n  1b. SQLite\n2. File-based\n[/claude-dj-choices]';
    const result = parseFencedChoices(text);
    assert.deepEqual(result, [
      { index: '1', label: 'Database' },
      { index: '1a', label: 'PostgreSQL' },
      { index: '1b', label: 'SQLite' },
      { index: '2', label: 'File-based' },
    ]);
  });

  it('uses last fence when multiple fences exist', () => {
    const text = '[claude-dj-choices]\n1. Old\n2. Stale\n[/claude-dj-choices]\n\nActually:\n\n[claude-dj-choices]\n1. New\n2. Fresh\n[/claude-dj-choices]';
    const result = parseFencedChoices(text);
    assert.deepEqual(result, [
      { index: '1', label: 'New' },
      { index: '2', label: 'Fresh' },
    ]);
  });

  it('returns null when no fence found', () => {
    const text = 'Here is some text with 1. numbers and 2. lists but no fence.';
    assert.equal(parseFencedChoices(text), null);
  });

  it('returns null for empty fence', () => {
    const text = '[claude-dj-choices]\n[/claude-dj-choices]';
    assert.equal(parseFencedChoices(text), null);
  });

  it('caps at 10 choices', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `${i + 1}. Option ${i + 1}`).join('\n');
    const text = `[claude-dj-choices]\n${lines}\n[/claude-dj-choices]`;
    const result = parseFencedChoices(text);
    assert.equal(result.length, 10);
    assert.equal(result[9].index, '10');
  });

  it('truncates labels to 30 chars', () => {
    const text = '[claude-dj-choices]\n1. This is a very long label that exceeds thirty characters easily\n[/claude-dj-choices]';
    const result = parseFencedChoices(text);
    assert.ok(result[0].label.length <= 30);
  });

  it('supports delimiter variants: ) : ]', () => {
    const text = '[claude-dj-choices]\n1) Parens\n2: Colon\n3] Bracket\n[/claude-dj-choices]';
    const result = parseFencedChoices(text);
    assert.equal(result.length, 3);
    assert.equal(result[0].label, 'Parens');
    assert.equal(result[1].label, 'Colon');
    assert.equal(result[2].label, 'Bracket');
  });
});

describe('parseRegexChoices (fallback)', () => {
  it('parses numbered list without fence', () => {
    const text = 'Choose:\n1. Alpha\n2. Beta\n3. Gamma';
    const result = parseRegexChoices(text);
    assert.equal(result.length, 3);
    assert.equal(result[0].index, '1');
    assert.equal(result[0].label, 'Alpha');
  });

  it('returns null when fewer than 2 matches', () => {
    const text = 'Just a single 1. item here.';
    assert.equal(parseRegexChoices(text), null);
  });

  it('returns null for numbered section headers spread across long text', () => {
    // This was a real false-positive: bold numbered headers in a long response
    const longText = `현재 상태를 파악했습니다.

**1. Docs 업데이트 (session4-final-status.md)**
- 테스트 카운트 82→93
- Subagent Tracking 완료
- Stop-Wait Path 추가

${'some filler text about the changes made.\n'.repeat(30)}

**2. README.md 업데이트**
- 테스트 카운트 88→93

${'more filler about README changes.\n'.repeat(20)}

**3. choice-format 스킬 강화 (SKILL.md)**
- Rule 강화
- Self-Check 섹션 추가

커밋하시겠습니까?`;
    assert.equal(parseRegexChoices(longText), null);
  });

  it('still detects choices in the tail of a long message', () => {
    const longText = `${'This is a long explanation.\n'.repeat(50)}
Which approach should we take?
1. Refactor the module
2. Rewrite from scratch
3. Patch and move on`;
    const result = parseRegexChoices(longText);
    assert.notEqual(result, null);
    assert.equal(result.length, 3);
    assert.equal(result[0].label, 'Refactor the module');
  });
});
