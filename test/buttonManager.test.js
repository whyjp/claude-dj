import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ButtonManager } from '../bridge/buttonManager.js';

describe('ButtonManager', () => {
  it('returns idle layout', () => {
    const layout = ButtonManager.layoutFor({ state: 'IDLE', prompt: null });
    assert.equal(layout.preset, 'idle');
  });

  it('returns processing layout', () => {
    const layout = ButtonManager.layoutFor({ state: 'PROCESSING', prompt: null });
    assert.equal(layout.preset, 'processing');
  });

  it('returns binary layout with approve/deny', () => {
    const session = {
      state: 'WAITING_BINARY',
      prompt: { type: 'BINARY', toolName: 'Bash', command: 'rm -rf dist', hasAlwaysAllow: false },
    };
    const layout = ButtonManager.layoutFor(session);
    assert.equal(layout.preset, 'binary');
    assert.deepEqual(layout.prompt, session.prompt);
  });

  it('returns choice layout with choices', () => {
    const session = {
      state: 'WAITING_CHOICE',
      prompt: {
        type: 'CHOICE',
        choices: [
          { index: 1, label: 'Refactor' },
          { index: 2, label: 'Fix tests' },
        ],
      },
    };
    const layout = ButtonManager.layoutFor(session);
    assert.equal(layout.preset, 'choice');
    assert.equal(layout.choices.length, 2);
  });

  it('resolves binary button press slot 0 to approve', () => {
    const decision = ButtonManager.resolvePress(0, 'WAITING_BINARY', {
      type: 'BINARY', hasAlwaysAllow: false,
    });
    assert.equal(decision.value, 'allow');
  });

  it('resolves binary button press slot 1 to deny (no alwaysAllow)', () => {
    const decision = ButtonManager.resolvePress(1, 'WAITING_BINARY', {
      type: 'BINARY', hasAlwaysAllow: false,
    });
    assert.equal(decision.value, 'deny');
  });

  it('resolves binary button press slot 1 to alwaysAllow (with alwaysAllow)', () => {
    const decision = ButtonManager.resolvePress(1, 'WAITING_BINARY', {
      type: 'BINARY', hasAlwaysAllow: true,
    });
    assert.equal(decision.value, 'alwaysAllow');
  });

  it('resolves binary button press slot 2 to deny (with alwaysAllow)', () => {
    const decision = ButtonManager.resolvePress(2, 'WAITING_BINARY', {
      type: 'BINARY', hasAlwaysAllow: true,
    });
    assert.equal(decision.value, 'deny');
  });

  it('resolves choice button press slot 2 to answer "3"', () => {
    const decision = ButtonManager.resolvePress(2, 'WAITING_CHOICE', {
      type: 'CHOICE',
      choices: [
        { index: 1, label: 'A' },
        { index: 2, label: 'B' },
        { index: 3, label: 'C' },
      ],
    });
    assert.equal(decision.value, '3');
    assert.equal(decision.type, 'choice');
  });

  it('returns null for invalid slot press', () => {
    const decision = ButtonManager.resolvePress(7, 'WAITING_BINARY', {
      type: 'BINARY', hasAlwaysAllow: false,
    });
    assert.equal(decision, null);
  });

  it('resolves response button press with natural language value', () => {
    const result = ButtonManager.resolvePress(1, 'WAITING_RESPONSE', {
      choices: [
        { index: '1', label: 'Refactor' },
        { index: '2a', label: 'Rewrite with schema' },
        { index: '2b', label: 'Keep existing schema' },
      ],
    });
    assert.deepEqual(result, { type: 'response', value: 'I choose option 2a: Rewrite with schema' });
  });
});
