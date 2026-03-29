import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const PORT = 39297;

describe('E2E: Subagent hooks', () => {
  let server;
  let pruneInterval;

  before(async () => {
    process.env.CLAUDE_DJ_PORT = String(PORT);
    const mod = await import('../bridge/server.js');
    server = mod.server;
    pruneInterval = mod.pruneInterval;
    await new Promise((r) => setTimeout(r, 500));
  });

  after(() => {
    clearInterval(pruneInterval);
    server?.close();
    delete process.env.CLAUDE_DJ_PORT;
  });

  it('POST /api/hook/subagentStart adds agent to session', async () => {
    await fetch(`http://localhost:${PORT}/api/hook/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 'sa-test-1', cwd: '/test', tool_name: 'Bash', hook_event_name: 'PreToolUse' }),
    });

    const res = await fetch(`http://localhost:${PORT}/api/hook/subagentStart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 'sa-test-1', agent_id: 'ag-1', agent_type: 'Explore' }),
    });
    const data = await res.json();
    assert.equal(data.ok, true);

    const status = await fetch(`http://localhost:${PORT}/api/status`).then(r => r.json());
    const session = status.sessions.find(s => s.id === 'sa-test-1');
    assert.ok(session);
    assert.equal(session.agents.length, 1);
    assert.equal(session.agents[0].agentId, 'ag-1');
    assert.equal(session.agents[0].type, 'Explore');
  });

  it('POST /api/hook/subagentStop removes agent from session', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/hook/subagentStop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 'sa-test-1', agent_id: 'ag-1', agent_type: 'Explore' }),
    });
    const data = await res.json();
    assert.equal(data.ok, true);

    const status = await fetch(`http://localhost:${PORT}/api/status`).then(r => r.json());
    const session = status.sessions.find(s => s.id === 'sa-test-1');
    assert.equal(session.agents.length, 0);
  });

  it('notify with agent_id updates agent state via status', async () => {
    await fetch(`http://localhost:${PORT}/api/hook/subagentStart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 'sa-test-1', agent_id: 'ag-2', agent_type: 'Plan' }),
    });

    await fetch(`http://localhost:${PORT}/api/hook/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 'sa-test-1', agent_id: 'ag-2', tool_name: 'Read', hook_event_name: 'PreToolUse' }),
    });

    const status = await fetch(`http://localhost:${PORT}/api/status`).then(r => r.json());
    const session = status.sessions.find(s => s.id === 'sa-test-1');
    assert.equal(session.agents[0].state, 'PROCESSING');
  });
});
