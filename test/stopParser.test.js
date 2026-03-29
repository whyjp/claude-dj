import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFencedChoices, parseRegexChoices } from '../hooks/choiceParser.js';

describe('parseFencedChoices', () => {
  it('parses numeric choices from fence', () => {
    const text = 'Here are your options:\n\n<!-- claude-dj-choices -->\n1. Refactor\n2. Rewrite\n3. Patch\n<!-- /claude-dj-choices -->';
    const result = parseFencedChoices(text);
    assert.deepEqual(result, [
      { index: '1', label: 'Refactor' },
      { index: '2', label: 'Rewrite' },
      { index: '3', label: 'Patch' },
    ]);
  });

  it('parses letter choices from fence', () => {
    const text = '<!-- claude-dj-choices -->\nA. Fix tests\nB. Skip tests\nC. Delete\n<!-- /claude-dj-choices -->';
    const result = parseFencedChoices(text);
    assert.deepEqual(result, [
      { index: 'A', label: 'Fix tests' },
      { index: 'B', label: 'Skip tests' },
      { index: 'C', label: 'Delete' },
    ]);
  });

  it('parses hierarchical choices (1a, 1b)', () => {
    const text = '<!-- claude-dj-choices -->\n1. Database\n  1a. PostgreSQL\n  1b. SQLite\n2. File-based\n<!-- /claude-dj-choices -->';
    const result = parseFencedChoices(text);
    assert.deepEqual(result, [
      { index: '1', label: 'Database' },
      { index: '1a', label: 'PostgreSQL' },
      { index: '1b', label: 'SQLite' },
      { index: '2', label: 'File-based' },
    ]);
  });

  it('uses last fence when multiple fences exist', () => {
    const text = '<!-- claude-dj-choices -->\n1. Old\n2. Stale\n<!-- /claude-dj-choices -->\n\nActually:\n\n<!-- claude-dj-choices -->\n1. New\n2. Fresh\n<!-- /claude-dj-choices -->';
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
    const text = '<!-- claude-dj-choices -->\n<!-- /claude-dj-choices -->';
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
    const text = '<!-- claude-dj-choices -->\n1. This is a very long label that exceeds thirty characters easily\n<!-- /claude-dj-choices -->';
    const result = parseFencedChoices(text);
    assert.ok(result[0].label.length <= 30);
  });

  it('supports delimiter variants: ) : ]', () => {
    const text = '<!-- claude-dj-choices -->\n1) Parens\n2: Colon\n3] Bracket\n<!-- /claude-dj-choices -->';
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
});
