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

  it('returns binary layout with options', () => {
    const session = {
      state: 'WAITING_BINARY',
      prompt: { type: 'BINARY', toolName: 'Bash', command: 'rm -rf dist', options: [
        { type: 'allow', label: 'Allow' }, { type: 'deny', label: 'Deny' },
      ] },
    };
    const layout = ButtonManager.layoutFor(session);
    assert.equal(layout.preset, 'binary');
    assert.equal(layout.prompt.options.length, 2);
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

  it('resolves binary slot 0 to allow', () => {
    const prompt = { options: [{ type: 'allow', label: 'Allow' }, { type: 'deny', label: 'Deny' }] };
    const decision = ButtonManager.resolvePress(0, 'WAITING_BINARY', prompt);
    assert.equal(decision.value, 'allow');
    assert.equal(decision.option.type, 'allow');
  });

  it('resolves binary slot 1 to deny (2-button)', () => {
    const prompt = { options: [{ type: 'allow', label: 'Allow' }, { type: 'deny', label: 'Deny' }] };
    const decision = ButtonManager.resolvePress(1, 'WAITING_BINARY', prompt);
    assert.equal(decision.value, 'deny');
  });

  it('resolves binary slot 1 to addRule (3-button)', () => {
    const suggestion = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'localSettings' };
    const prompt = { options: [
      { type: 'allow', label: 'Allow' },
      { type: 'addRule', label: 'AddRule', suggestion, preview: 'npm test' },
      { type: 'deny', label: 'Deny' },
    ] };
    const decision = ButtonManager.resolvePress(1, 'WAITING_BINARY', prompt);
    assert.equal(decision.value, 'allow');
    assert.equal(decision.option.type, 'addRule');
    assert.deepEqual(decision.option.suggestion, suggestion);
  });

  it('resolves binary slot 2 to deny (3-button)', () => {
    const prompt = { options: [
      { type: 'allow', label: 'Allow' },
      { type: 'addRule', label: 'AddRule', suggestion: {}, preview: '' },
      { type: 'deny', label: 'Deny' },
    ] };
    const decision = ButtonManager.resolvePress(2, 'WAITING_BINARY', prompt);
    assert.equal(decision.value, 'deny');
  });

  it('resolves binary out-of-range slot to null', () => {
    const prompt = { options: [{ type: 'allow', label: 'Allow' }, { type: 'deny', label: 'Deny' }] };
    assert.equal(ButtonManager.resolvePress(5, 'WAITING_BINARY', prompt), null);
    assert.equal(ButtonManager.resolvePress(-1, 'WAITING_BINARY', prompt), null);
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
      type: 'BINARY', options: [{ type: 'allow' }, { type: 'deny' }],
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

  it('multiSelect layout shows preset multiSelect with selected state', () => {
    const session = {
      id: 's1', name: 'test', state: 'WAITING_CHOICE', agents: new Map(),
      prompt: {
        type: 'CHOICE', multiSelect: true, selected: new Set([2]),
        choices: [{ index: 1, label: 'A' }, { index: 2, label: 'B' }, { index: 3, label: 'C' }],
      },
    };
    const layout = ButtonManager.layoutFor(session);
    assert.equal(layout.preset, 'multiSelect');
    assert.equal(layout.choices[0].selected, false);
    assert.equal(layout.choices[1].selected, true);
    assert.equal(layout.choices[2].selected, false);
  });

  it('multiSelect toggle adds/removes from selected set', () => {
    const prompt = {
      multiSelect: true, selected: new Set(),
      choices: [{ index: 1, label: 'A' }, { index: 2, label: 'B' }],
    };
    // Toggle on
    let result = ButtonManager.resolvePress(0, 'WAITING_CHOICE', prompt);
    assert.equal(result.type, 'toggle');
    assert.ok(prompt.selected.has(1));
    // Toggle off
    result = ButtonManager.resolvePress(0, 'WAITING_CHOICE', prompt);
    assert.equal(result.type, 'toggle');
    assert.ok(!prompt.selected.has(1));
  });

  it('multiSelect slot 9 submits selected indices', () => {
    const prompt = {
      multiSelect: true, selected: new Set([1, 3]),
      choices: [{ index: 1, label: 'A' }, { index: 2, label: 'B' }, { index: 3, label: 'C' }],
    };
    const result = ButtonManager.resolvePress(9, 'WAITING_CHOICE', prompt);
    assert.equal(result.type, 'choice');
    assert.equal(result.value, '1,3');
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

  // ── Edge cases ──

  it('unknown state defaults to idle preset', () => {
    const layout = ButtonManager.layoutFor({ state: 'UNKNOWN_STATE', prompt: null });
    assert.equal(layout.preset, 'idle');
  });

  it('session without agents property returns empty agents array', () => {
    const layout = ButtonManager.layoutFor({ state: 'IDLE', prompt: null, agents: undefined });
    assert.deepEqual(layout.agents, []);
  });

  it('resolvePress returns null for slot beyond choices', () => {
    const result = ButtonManager.resolvePress(5, 'WAITING_CHOICE', {
      type: 'CHOICE', choices: [{ index: 1, label: 'A' }, { index: 2, label: 'B' }],
    });
    assert.equal(result, null);
  });

  it('resolvePress returns null for unknown state', () => {
    const result = ButtonManager.resolvePress(0, 'SOME_STATE', {});
    assert.equal(result, null);
  });

  it('multiSelect slot beyond choices returns null', () => {
    const prompt = {
      multiSelect: true, selected: new Set(),
      choices: [{ index: 1, label: 'A' }],
    };
    const result = ButtonManager.resolvePress(5, 'WAITING_CHOICE', prompt);
    assert.equal(result, null);
  });

  it('multiSelect submit with empty selection returns "1"', () => {
    const prompt = {
      multiSelect: true, selected: new Set(),
      choices: [{ index: 1, label: 'A' }],
    };
    const result = ButtonManager.resolvePress(9, 'WAITING_CHOICE', prompt);
    assert.equal(result.value, '1');
  });

  it('choice with empty choices array returns null for any slot', () => {
    const result = ButtonManager.resolvePress(0, 'WAITING_CHOICE', { type: 'CHOICE', choices: [] });
    assert.equal(result, null);
  });

  it('buildHookResponse for choice sets behavior to allow with answer', () => {
    const resp = ButtonManager.buildHookResponse({ value: '2' }, true);
    assert.equal(resp.hookSpecificOutput.decision.behavior, 'allow');
    assert.equal(resp.hookSpecificOutput.decision.updatedInput.answer, '2');
  });

  it('buildHookResponse for binary sets behavior to decision value', () => {
    const resp = ButtonManager.buildHookResponse({ value: 'deny' }, false);
    assert.equal(resp.hookSpecificOutput.decision.behavior, 'deny');
  });

  it('buildHookResponse for addRule option returns suggestion as decision', () => {
    const suggestion = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'localSettings' };
    const resp = ButtonManager.buildHookResponse({ value: 'allow', option: { type: 'addRule', suggestion } }, false);
    assert.deepEqual(resp.hookSpecificOutput.decision, suggestion);
  });

  it('buildHookResponse for allow option returns simple allow', () => {
    const resp = ButtonManager.buildHookResponse({ value: 'allow', option: { type: 'allow' } }, false);
    assert.equal(resp.hookSpecificOutput.decision.behavior, 'allow');
  });

  it('buildTimeoutResponse returns deny behavior', () => {
    const resp = ButtonManager.buildTimeoutResponse();
    assert.equal(resp.hookSpecificOutput.decision.behavior, 'deny');
    assert.ok(resp.hookSpecificOutput.decision.message.includes('timeout'));
  });

  it('WAITING_CHOICE layout includes choices and session info', () => {
    const session = {
      id: 's1', name: 'test-proj', state: 'WAITING_CHOICE', agents: new Map(),
      prompt: {
        type: 'CHOICE', multiSelect: false,
        choices: [{ index: 1, label: 'A' }, { index: 2, label: 'B' }],
      },
    };
    const layout = ButtonManager.layoutFor(session);
    assert.equal(layout.preset, 'choice');
    assert.equal(layout.session.id, 's1');
    assert.equal(layout.session.state, 'WAITING_CHOICE');
    assert.equal(layout.choices.length, 2);
  });
});
