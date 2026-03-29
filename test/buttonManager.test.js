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

  // ── agents array in layoutFor ──

  it('includes empty agents array when session has no agents', () => {
    const layout = ButtonManager.layoutFor({ state: 'IDLE', prompt: null });
    assert.deepEqual(layout.agents, []);
    assert.equal(layout.agentCount, 0);
    assert.equal(layout.agent, null);
  });

  it('includes agents array from session.agents Map', () => {
    const agents = new Map([
      ['a1', { agentId: 'a1', type: 'Explore', state: 'running' }],
      ['a2', { agentId: 'a2', type: 'Plan', state: 'done' }],
    ]);
    const session = { state: 'PROCESSING', prompt: null, agents };
    const layout = ButtonManager.layoutFor(session);
    assert.equal(layout.agents.length, 2);
    assert.deepEqual(layout.agents[0], { agentId: 'a1', type: 'Explore', state: 'running' });
    assert.deepEqual(layout.agents[1], { agentId: 'a2', type: 'Plan', state: 'done' });
  });

  it('includes focused agent when focusAgentId matches', () => {
    const agents = new Map([
      ['a1', { agentId: 'a1', type: 'Explore', state: 'running' }],
    ]);
    const session = { state: 'PROCESSING', prompt: null, agents };
    const layout = ButtonManager.layoutFor(session, 'a1', 1);
    assert.deepEqual(layout.agent, { agentId: 'a1', type: 'Explore', state: 'running' });
    assert.equal(layout.agentCount, 1);
  });

  it('agent is null when focusAgentId does not match', () => {
    const agents = new Map([
      ['a1', { agentId: 'a1', type: 'Explore', state: 'running' }],
    ]);
    const session = { state: 'PROCESSING', prompt: null, agents };
    const layout = ButtonManager.layoutFor(session, 'nonexistent', 1);
    assert.equal(layout.agent, null);
    assert.equal(layout.agentCount, 1);
  });

  it('passes agentCount through to layout', () => {
    const layout = ButtonManager.layoutFor({ state: 'IDLE', prompt: null }, null, 5);
    assert.equal(layout.agentCount, 5);
  });

  it('WAITING_RESPONSE returns awaiting_input layout (display-only)', () => {
    const session = { id: 's1', name: 'test', state: 'WAITING_RESPONSE', prompt: {}, agents: new Map() };
    const layout = ButtonManager.layoutFor(session);
    assert.equal(layout.preset, 'awaiting_input');
  });

  it('WAITING_RESPONSE button press returns null (no interaction)', () => {
    const result = ButtonManager.resolvePress(0, 'WAITING_RESPONSE', {});
    assert.equal(result, null);
  });
});
