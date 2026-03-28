import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '../bridge/sessionManager.js';

describe('SessionManager', () => {
  let sm;

  beforeEach(() => {
    sm = new SessionManager();
  });

  it('creates a session from hook input', () => {
    const input = {
      session_id: 'abc123',
      cwd: '/projects/api-server',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
    };
    const session = sm.getOrCreate(input);
    assert.equal(session.id, 'abc123');
    assert.equal(session.name, 'api-server (abc123)');
    assert.equal(session.state, 'IDLE');
  });

  it('transitions to PROCESSING on PreToolUse', () => {
    const input = {
      session_id: 'abc123',
      cwd: '/projects/api-server',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
    };
    sm.getOrCreate(input);
    sm.handleNotify(input);
    const session = sm.get('abc123');
    assert.equal(session.state, 'PROCESSING');
  });

  it('transitions to WAITING_BINARY on PermissionRequest for Bash', () => {
    const input = {
      session_id: 'abc123',
      cwd: '/projects/api-server',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf dist' },
    };
    sm.getOrCreate(input);
    sm.handlePermission(input);
    const session = sm.get('abc123');
    assert.equal(session.state, 'WAITING_BINARY');
    assert.equal(session.prompt.type, 'BINARY');
    assert.equal(session.prompt.toolName, 'Bash');
  });

  it('transitions to WAITING_CHOICE on AskUserQuestion', () => {
    const input = {
      session_id: 'abc123',
      cwd: '/projects/api-server',
      hook_event_name: 'PermissionRequest',
      tool_name: 'AskUserQuestion',
      tool_input: {
        question: 'How to proceed?',
        options: [
          { label: '1', description: 'Refactor' },
          { label: '2', description: 'Fix tests' },
        ],
      },
    };
    sm.getOrCreate(input);
    sm.handlePermission(input);
    const session = sm.get('abc123');
    assert.equal(session.state, 'WAITING_CHOICE');
    assert.equal(session.prompt.type, 'CHOICE');
    assert.equal(session.prompt.choices.length, 2);
  });

  it('transitions to IDLE on Stop', () => {
    const input = {
      session_id: 'abc123',
      cwd: '/projects/api-server',
      hook_event_name: 'Stop',
      stop_hook_active: false,
    };
    sm.getOrCreate(input);
    sm.handleStop(input);
    const session = sm.get('abc123');
    assert.equal(session.state, 'IDLE');
  });

  it('transitions to PROCESSING with lastToolResult on PostToolUse', () => {
    const input = {
      session_id: 'abc123',
      cwd: '/projects/api-server',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_result: { output: 'hello world', errored: false },
    };
    sm.getOrCreate(input);
    sm.handlePostToolUse(input);
    const session = sm.get('abc123');
    assert.equal(session.state, 'PROCESSING');
    assert.equal(session.lastToolResult.toolName, 'Bash');
    assert.equal(session.lastToolResult.success, true);
    assert.equal(session.lastToolResult.output, 'hello world');
  });

  it('marks lastToolResult.success=false when tool errored', () => {
    const input = {
      session_id: 'abc123',
      cwd: '/projects/api-server',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_result: { output: 'command not found', errored: true },
    };
    sm.getOrCreate(input);
    sm.handlePostToolUse(input);
    const session = sm.get('abc123');
    assert.equal(session.lastToolResult.success, false);
  });

  it('getFocusSession returns focused waiting session', () => {
    sm.handlePermission({ session_id: 's1', cwd: '/a', tool_name: 'Bash', tool_input: { command: 'ls' } });
    sm.handlePermission({ session_id: 's2', cwd: '/b', tool_name: 'Write', tool_input: { file_path: '/x' } });
    sm.setFocus('s2');
    const focus = sm.getFocusSession();
    assert.equal(focus.id, 's2');
  });

  it('getFocusSession falls back to oldest waiting when focus is not waiting', () => {
    sm.handlePermission({ session_id: 's1', cwd: '/a', tool_name: 'Bash', tool_input: { command: 'ls' } });
    sm.handlePermission({ session_id: 's2', cwd: '/b', tool_name: 'Write', tool_input: { file_path: '/x' } });
    sm.setFocus('s1');
    // Resolve s1 so it's no longer waiting
    sm.get('s1').respondFn = () => {};
    sm.resolveWaiting('s1', { value: 'allow' });
    const focus = sm.getFocusSession();
    assert.equal(focus.id, 's2');
  });

  it('cycleFocus rotates through all sessions', () => {
    sm.handleNotify({ session_id: 's1', cwd: '/a', hook_event_name: 'PreToolUse', tool_name: 'Bash' });
    sm.handleNotify({ session_id: 's2', cwd: '/b', hook_event_name: 'PreToolUse', tool_name: 'Bash' });
    sm.setFocus('s1');
    const next = sm.cycleFocus();
    assert.equal(next.id, 's2');
    const back = sm.cycleFocus();
    assert.equal(back.id, 's1');
  });

  it('cycleFocus returns null when no sessions', () => {
    const result = sm.cycleFocus();
    assert.equal(result, null);
  });

  it('cycleFocus works with mix of IDLE and WAITING sessions', () => {
    sm.handleNotify({ session_id: 's1', cwd: '/a', hook_event_name: 'PreToolUse', tool_name: 'Bash' });
    sm.handlePermission({ session_id: 's2', cwd: '/b', tool_name: 'Bash', tool_input: { command: 'x' } });
    sm.handleStop({ session_id: 's3', cwd: '/c', hook_event_name: 'Stop', stop_hook_active: false });
    sm.setFocus('s1');
    assert.equal(sm.cycleFocus().id, 's2');
    assert.equal(sm.cycleFocus().id, 's3');
    assert.equal(sm.cycleFocus().id, 's1');
  });

  it('getWaitingSessions returns sorted by waitingSince', () => {
    sm.handlePermission({ session_id: 's1', cwd: '/a', tool_name: 'Bash', tool_input: { command: 'a' } });
    // Force s1 to have earlier timestamp
    sm.get('s1').waitingSince = 1000;
    sm.handlePermission({ session_id: 's2', cwd: '/b', tool_name: 'Bash', tool_input: { command: 'b' } });
    sm.get('s2').waitingSince = 2000;
    const waiting = sm.getWaitingSessions();
    assert.equal(waiting.length, 2);
    assert.equal(waiting[0].id, 's1');
    assert.equal(waiting[1].id, 's2');
  });

  it('pruneIdle removes sessions idle longer than ttl', () => {
    sm.handleNotify({ session_id: 's1', cwd: '/a', hook_event_name: 'PreToolUse', tool_name: 'Bash' });
    sm.handleStop({ session_id: 's1', hook_event_name: 'Stop', stop_hook_active: false });
    // Force idleSince to 10 minutes ago
    sm.get('s1').idleSince = Date.now() - 600000;
    const pruned = sm.pruneIdle(300000); // 5 min ttl
    assert.deepEqual(pruned, ['s1']);
    assert.equal(sm.get('s1'), undefined);
  });

  it('pruneIdle keeps sessions idle less than ttl', () => {
    sm.handleNotify({ session_id: 's1', cwd: '/a', hook_event_name: 'PreToolUse', tool_name: 'Bash' });
    sm.handleStop({ session_id: 's1', hook_event_name: 'Stop', stop_hook_active: false });
    // Just went idle
    const pruned = sm.pruneIdle(300000);
    assert.deepEqual(pruned, []);
    assert.ok(sm.get('s1'));
  });

  it('pruneIdle does not remove WAITING sessions', () => {
    sm.handlePermission({ session_id: 's1', cwd: '/a', tool_name: 'Bash', tool_input: { command: 'ls' } });
    sm.get('s1').idleSince = Date.now() - 600000; // even if old
    const pruned = sm.pruneIdle(300000);
    assert.deepEqual(pruned, []);
  });

  it('resolves waiting session on button press', () => {
    const input = {
      session_id: 'abc123',
      cwd: '/projects/api-server',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf dist' },
    };
    sm.getOrCreate(input);
    sm.handlePermission(input);

    let resolved = false;
    sm.get('abc123').respondFn = (decision) => { resolved = true; };
    sm.resolveWaiting('abc123', { value: 'allow' });
    assert.equal(resolved, true);
    assert.equal(sm.get('abc123').state, 'PROCESSING');
  });
});
