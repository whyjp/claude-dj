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
    assert.equal(session.name, 'api-server');
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
