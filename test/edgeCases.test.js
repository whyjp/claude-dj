import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../claude-plugin/bridge/sessionManager.js';
import { ButtonManager } from '../claude-plugin/bridge/buttonManager.js';
import { parseFencedChoices, parseRegexChoices } from '../claude-plugin/hooks/choiceParser.js';

// ---------------------------------------------------------------------------
// SessionManager edge cases
// ---------------------------------------------------------------------------

describe('SessionManager: edge cases', () => {
  let sm;
  beforeEach(() => { sm = new SessionManager(); });

  it('resolveWaiting on PROCESSING session transitions to PROCESSING (no-op state)', () => {
    sm.getOrCreate({ session_id: 's1', cwd: '/tmp' });
    sm.handleNotify({ session_id: 's1' });
    const result = sm.resolveWaiting('s1', { type: 'binary', value: 'allow' });
    assert.equal(result, true);
    assert.equal(sm.get('s1').state, 'PROCESSING');
  });

  it('resolveWaiting on IDLE session still returns true', () => {
    sm.getOrCreate({ session_id: 's1', cwd: '/tmp' });
    const result = sm.resolveWaiting('s1', { type: 'binary', value: 'allow' });
    assert.equal(result, true);
    assert.equal(sm.get('s1').state, 'PROCESSING');
  });

  it('resolveWaiting on nonexistent session returns false', () => {
    const result = sm.resolveWaiting('ghost', { type: 'binary', value: 'allow' });
    assert.equal(result, false);
  });

  it('resolveWaiting calls respondFn exactly once then nulls it', () => {
    let callCount = 0;
    const session = sm.getOrCreate({ session_id: 's1', cwd: '/tmp' });
    sm.handlePermission({ session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' } });
    session.respondFn = () => { callCount++; };
    sm.resolveWaiting('s1', { type: 'binary', value: 'allow' });
    assert.equal(callCount, 1);
    assert.equal(session.respondFn, null);
  });

  it('dismissSession clears respondFn without calling it', () => {
    let called = false;
    const session = sm.getOrCreate({ session_id: 's1', cwd: '/tmp' });
    sm.handlePermission({ session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' } });
    session.respondFn = () => { called = true; };
    sm.dismissSession('s1');
    assert.equal(called, false);
    assert.equal(session.respondFn, null);
    assert.equal(session.state, 'IDLE');
  });

  it('cycleFocus when focusSessionId points to deleted session starts from index 0', () => {
    sm.getOrCreate({ session_id: 'a', cwd: '/tmp' });
    sm.getOrCreate({ session_id: 'b', cwd: '/tmp' });
    sm.focusSessionId = 'deleted-id';
    const next = sm.cycleFocus();
    // (-1 + 1) % 2 = 0, so picks first session
    assert.equal(next.id, 'a');
  });

  it('cycleFocus with single session always returns that session', () => {
    sm.getOrCreate({ session_id: 'only', cwd: '/tmp' });
    const next = sm.cycleFocus();
    assert.equal(next.id, 'only');
    assert.equal(sm.focusAgentId, null);
  });

  it('cycleFocus with zero sessions returns null', () => {
    assert.equal(sm.cycleFocus(), null);
  });

  it('handlePermission after handleStop overrides WAITING_RESPONSE to WAITING_BINARY', () => {
    sm.handleStop({ session_id: 's1', stop_hook_active: false });
    assert.equal(sm.get('s1').state, 'WAITING_RESPONSE');
    sm.handlePermission({ session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' } });
    assert.equal(sm.get('s1').state, 'WAITING_BINARY');
  });

  it('handleNotify on WAITING_BINARY session overrides state to PROCESSING', () => {
    sm.handlePermission({ session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' } });
    assert.equal(sm.get('s1').state, 'WAITING_BINARY');
    sm.handleNotify({ session_id: 's1' });
    assert.equal(sm.get('s1').state, 'PROCESSING');
    assert.equal(sm.get('s1').prompt, null);
  });

  it('toJSON serializes multiSelect selected Set as array', () => {
    sm.handlePermission({
      session_id: 's1',
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [{ question: 'Q', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] }] },
    });
    const session = sm.get('s1');
    session.prompt.selected.add(1);
    session.prompt.selected.add(3);
    const json = sm.toJSON();
    assert.ok(Array.isArray(json[0].prompt.selected), 'selected should be array');
    assert.deepEqual(json[0].prompt.selected, [1, 3]);
  });

  it('toJSON with null prompt does not throw', () => {
    sm.getOrCreate({ session_id: 's1', cwd: '/tmp' });
    const json = sm.toJSON();
    assert.equal(json[0].prompt, null);
  });

  it('toJSON with non-multiSelect prompt passes through unchanged', () => {
    sm.handlePermission({ session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' } });
    const json = sm.toJSON();
    assert.equal(json[0].prompt.type, 'BINARY');
  });

  it('getOrCreate with undefined session_id creates session with undefined id', () => {
    const session = sm.getOrCreate({ cwd: '/tmp' });
    assert.equal(session.id, undefined);
    assert.equal(sm.sessions.has(undefined), true);
  });

  it('handleSubagentStop resets focusAgentId if it matches stopped agent', () => {
    sm.handleSubagentStart({ session_id: 's1', agent_id: 'a1', agent_type: 'test' });
    sm.focusAgentId = 'a1';
    sm.handleSubagentStop({ session_id: 's1', agent_id: 'a1' });
    assert.equal(sm.focusAgentId, null);
  });

  it('cycleAgent returns null when session has no agents', () => {
    sm.getOrCreate({ session_id: 's1', cwd: '/tmp' });
    sm.focusSessionId = 's1';
    assert.equal(sm.cycleAgent(), null);
  });

  it('cycleAgent cycles through agents then back to null (root)', () => {
    sm.handleSubagentStart({ session_id: 's1', agent_id: 'a1', agent_type: 'exec' });
    sm.handleSubagentStart({ session_id: 's1', agent_id: 'a2', agent_type: 'review' });
    sm.focusSessionId = 's1';

    const first = sm.cycleAgent();
    assert.equal(first.agentId, 'a1');

    const second = sm.cycleAgent();
    assert.equal(second.agentId, 'a2');

    const back = sm.cycleAgent();
    assert.equal(back, null); // back to root
    assert.equal(sm.focusAgentId, null);
  });

  it('getAgentCount returns 0 for nonexistent session', () => {
    assert.equal(sm.getAgentCount('ghost'), 0);
  });

  it('pruneIdle only removes sessions past TTL', () => {
    const s1 = sm.getOrCreate({ session_id: 's1', cwd: '/tmp' });
    s1.state = 'IDLE';
    s1.idleSince = Date.now() - 10000;
    const s2 = sm.getOrCreate({ session_id: 's2', cwd: '/tmp' });
    s2.state = 'IDLE';
    s2.idleSince = Date.now();

    const pruned = sm.pruneIdle(5000);
    assert.deepEqual(pruned, ['s1']);
    assert.equal(sm.sessions.has('s2'), true);
  });
});

// ---------------------------------------------------------------------------
// ButtonManager edge cases
// ---------------------------------------------------------------------------

describe('ButtonManager: edge cases', () => {
  it('resolvePress with null prompt returns null', () => {
    assert.equal(ButtonManager.resolvePress(0, 'WAITING_BINARY', null), null);
  });

  it('resolvePress with undefined prompt returns null', () => {
    assert.equal(ButtonManager.resolvePress(0, 'WAITING_CHOICE', undefined), null);
  });

  it('resolvePress WAITING_RESPONSE returns null for any slot', () => {
    assert.equal(ButtonManager.resolvePress(0, 'WAITING_RESPONSE', { type: 'RESPONSE' }), null);
    assert.equal(ButtonManager.resolvePress(5, 'WAITING_RESPONSE', { type: 'RESPONSE' }), null);
  });

  it('resolvePress IDLE/PROCESSING returns null', () => {
    assert.equal(ButtonManager.resolvePress(0, 'IDLE', null), null);
    assert.equal(ButtonManager.resolvePress(0, 'PROCESSING', null), null);
  });

  it('resolvePress WAITING_CHOICE with prompt.choices undefined returns null', () => {
    const prompt = { type: 'CHOICE', choices: undefined, multiSelect: false };
    assert.equal(ButtonManager.resolvePress(0, 'WAITING_CHOICE', prompt), null);
  });

  it('resolvePress WAITING_CHOICE with empty choices array returns null', () => {
    const prompt = { type: 'CHOICE', choices: [], multiSelect: false };
    assert.equal(ButtonManager.resolvePress(0, 'WAITING_CHOICE', prompt), null);
  });

  it('resolvePress WAITING_BINARY slot 3+ returns null', () => {
    const prompt = { type: 'BINARY', hasAlwaysAllow: true };
    assert.equal(ButtonManager.resolvePress(3, 'WAITING_BINARY', prompt), null);
    assert.equal(ButtonManager.resolvePress(10, 'WAITING_BINARY', prompt), null);
  });

  it('multiSelect submit with empty selection defaults to "1"', () => {
    const prompt = { type: 'CHOICE', multiSelect: true, selected: new Set(), choices: [{ index: 1, label: 'A' }] };
    const result = ButtonManager.resolvePress(9, 'WAITING_CHOICE', prompt);
    assert.deepEqual(result, { type: 'choice', value: '1' });
  });

  it('multiSelect toggle out-of-range slot returns null', () => {
    const prompt = { type: 'CHOICE', multiSelect: true, selected: new Set(), choices: [{ index: 1, label: 'A' }] };
    assert.equal(ButtonManager.resolvePress(5, 'WAITING_CHOICE', prompt), null);
  });

  it('buildHookResponse for alwaysAllow sets behavior correctly', () => {
    const resp = ButtonManager.buildHookResponse({ type: 'binary', value: 'alwaysAllow' }, false);
    assert.equal(resp.hookSpecificOutput.decision.behavior, 'alwaysAllow');
  });

  it('buildTimeoutResponse returns deny with timeout message', () => {
    const resp = ButtonManager.buildTimeoutResponse();
    assert.equal(resp.hookSpecificOutput.decision.behavior, 'deny');
    assert.ok(resp.hookSpecificOutput.decision.message.includes('timeout'));
  });

  it('layoutFor with unknown state falls back to idle preset', () => {
    const session = { id: 's1', name: 'test', state: 'UNKNOWN_STATE', agents: new Map() };
    const layout = ButtonManager.layoutFor(session);
    assert.equal(layout.preset, 'idle');
  });

  it('layoutFor WAITING_CHOICE with multiSelect includes selected state', () => {
    const session = {
      id: 's1', name: 'test', state: 'WAITING_CHOICE',
      prompt: {
        type: 'CHOICE', multiSelect: true,
        selected: new Set([2]),
        choices: [{ index: 1, label: 'A' }, { index: 2, label: 'B' }],
      },
      agents: new Map(),
    };
    const layout = ButtonManager.layoutFor(session);
    assert.equal(layout.preset, 'multiSelect');
    assert.equal(layout.choices[0].selected, false);
    assert.equal(layout.choices[1].selected, true);
  });
});

// ---------------------------------------------------------------------------
// choiceParser edge cases
// ---------------------------------------------------------------------------

describe('choiceParser: edge cases', () => {
  it('parseRegexChoices handles \\r\\n line endings', () => {
    const text = '1. Refactor code\r\n2. Rewrite module\r\n3. Patch fix\r\n';
    const result = parseRegexChoices(text);
    assert.ok(result, 'should parse choices with \\r\\n');
    assert.equal(result.length, 3);
    assert.equal(result[0].label, 'Refactor code');
  });

  it('parseRegexChoices handles mixed \\r\\n and \\n', () => {
    const text = '1. Option A\r\n2. Option B\n3. Option C\r\n';
    const result = parseRegexChoices(text);
    assert.ok(result);
    assert.equal(result.length, 3);
  });

  it('parseFencedChoices with trailing space on fence tag', () => {
    // Trailing space after fence open — exact match will miss it
    const text = '[claude-dj-choices] \n1. Alpha\n2. Beta\n[/claude-dj-choices]';
    // Current implementation uses lastIndexOf exact match, so trailing space is part of content
    const result = parseFencedChoices(text);
    // The " \n1. Alpha..." starts with space+newline, split('\n') gives [" ", "1. Alpha", "2. Beta"]
    // LINE_RE matches "1. Alpha" and "2. Beta"
    assert.ok(result, 'should still parse choices despite trailing space');
    assert.equal(result.length, 2);
  });

  it('parseFencedChoices with empty content between fences returns null', () => {
    const text = '[claude-dj-choices]\n\n[/claude-dj-choices]';
    assert.equal(parseFencedChoices(text), null);
  });

  it('parseFencedChoices with only whitespace between fences returns null', () => {
    const text = '[claude-dj-choices]\n   \n   \n[/claude-dj-choices]';
    assert.equal(parseFencedChoices(text), null);
  });

  it('parseRegexChoices rejects choices spread across >15 lines', () => {
    const lines = [];
    lines.push('1. First option');
    for (let i = 0; i < 20; i++) lines.push('Some intervening text line');
    lines.push('2. Second option');
    const text = lines.join('\n');
    assert.equal(parseRegexChoices(text), null);
  });

  it('parseRegexChoices with letter-indexed choices', () => {
    const text = 'A) Refactor\nB) Rewrite\nC) Patch';
    const result = parseRegexChoices(text);
    assert.ok(result);
    assert.equal(result[0].index, 'A');
    assert.equal(result.length, 3);
  });

  it('parseFencedChoices returns last fence block when multiple exist', () => {
    const text = '[claude-dj-choices]\n1. Old\n2. Stale\n[/claude-dj-choices]\nSome text\n[claude-dj-choices]\n1. Fresh\n2. New\n[/claude-dj-choices]';
    const result = parseFencedChoices(text);
    assert.ok(result);
    assert.equal(result[0].label, 'Fresh');
    assert.equal(result[1].label, 'New');
  });
});
