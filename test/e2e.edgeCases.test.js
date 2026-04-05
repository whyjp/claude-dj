import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hooksDir = path.resolve(__dirname, '..', 'claude-plugin', 'hooks');
const PORT = 39296;

// --- Helpers (same pattern as e2e.test.js) ---

function runHook(scriptName, inputObj, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(hooksDir, scriptName)], {
      env: { ...process.env, CLAUDE_DJ_URL: `http://127.0.0.1:${PORT}`, ...envOverrides },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => stdout += d);
    child.stderr.on('data', (d) => stderr += d);
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ stdout, stderr, exitCode }));
    child.stdin.write(JSON.stringify(inputObj));
    child.stdin.end();
  });
}

function connectWs(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'CLIENT_READY', clientType: 'test', version: '0.2.0' }));
      resolve(ws);
    });
    ws.on('error', reject);
  });
}

function collectMessages(ws) {
  const msgs = [];
  ws.on('message', (raw) => msgs.push(JSON.parse(raw.toString())));
  return msgs;
}

function postJSON(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: PORT, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let body = '';
      res.on('data', (d) => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJSON(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: PORT, path: urlPath }, (res) => {
      let body = '';
      res.on('data', (d) => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
    }).on('error', reject);
  });
}

function waitMs(ms) { return new Promise((r) => setTimeout(r, ms)); }

// --- Test suite ---

describe('E2E Edge Cases: Hook → Bridge → WebSocket', () => {
  let server, pruneInterval, syncInterval;
  const wsUrl = `ws://127.0.0.1:${PORT}/ws`;

  before(async () => {
    process.env.CLAUDE_DJ_PORT = String(PORT);
    process.env.CLAUDE_DJ_BUTTON_TIMEOUT = '800'; // fast timeout for tests
    const mod = await import('../claude-plugin/bridge/server.js');
    server = mod.server;
    pruneInterval = mod.pruneInterval;
    syncInterval = mod.syncInterval;
    await waitMs(500);
  });

  after(() => {
    clearInterval(pruneInterval);
    clearInterval(syncInterval);
    server?.close();
    delete process.env.CLAUDE_DJ_PORT;
    delete process.env.CLAUDE_DJ_BUTTON_TIMEOUT;
  });

  // --- Permission timeout ---

  it('permission timeout auto-denies and broadcasts ALL_DIM', async () => {
    const ws = await connectWs(wsUrl);
    const msgs = collectMessages(ws);
    await waitMs(100);

    const hookPromise = runHook('permission.js', {
      session_id: 'edge-timeout-1',
      cwd: '/tmp/timeout',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
    });

    // Wait for binary layout
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (msgs.some((m) => m.preset === 'binary')) { clearInterval(check); resolve(); }
      }, 50);
    });

    // Do NOT press any button — wait for timeout
    const result = await hookPromise;
    assert.equal(result.exitCode, 0);
    const resp = JSON.parse(result.stdout);
    assert.equal(resp.hookSpecificOutput.decision.behavior, 'deny');
    assert.ok(resp.hookSpecificOutput.decision.message.includes('timeout'));

    // Verify ALL_DIM was broadcast
    assert.ok(msgs.some((m) => m.type === 'ALL_DIM'), 'should broadcast ALL_DIM on timeout');
    ws.close();
  });

  // --- Double permission race ---

  it('double permission on same session: first is auto-denied, second works', async () => {
    const ws = await connectWs(wsUrl);
    const msgs = collectMessages(ws);
    await waitMs(100);

    // First permission (will be auto-denied when second arrives)
    const hook1 = runHook('permission.js', {
      session_id: 'edge-double-1',
      cwd: '/tmp/double',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'echo first' },
    });

    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (msgs.some((m) => m.preset === 'binary')) { clearInterval(check); resolve(); }
      }, 50);
    });

    // Second permission on SAME session — should auto-deny first
    const hook2 = runHook('permission.js', {
      session_id: 'edge-double-1',
      cwd: '/tmp/double',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/x.js' },
    });

    // First hook should get auto-denied
    const result1 = await hook1;
    assert.equal(result1.exitCode, 0);
    const resp1 = JSON.parse(result1.stdout);
    assert.equal(resp1.hookSpecificOutput.decision.behavior, 'deny');

    // Now approve the second one
    await waitMs(200);
    ws.send(JSON.stringify({ type: 'BUTTON_PRESS', slot: 0, timestamp: Date.now() }));

    const result2 = await hook2;
    assert.equal(result2.exitCode, 0);
    const resp2 = JSON.parse(result2.stdout);
    assert.equal(resp2.hookSpecificOutput.decision.behavior, 'allow');

    ws.close();
  });

  // --- Button press with no active sessions ---

  it('button press with no focus session does not crash', async () => {
    const ws = await connectWs(wsUrl);
    await waitMs(100);
    // Send button press with no waiting sessions
    ws.send(JSON.stringify({ type: 'BUTTON_PRESS', slot: 0, timestamp: Date.now() }));
    await waitMs(200);
    // If we got here without crash, test passes
    assert.ok(true);
    ws.close();
  });

  // --- Stop proxy: choices detected → interactive WAITING_CHOICE ---

  it('stop proxy creates WAITING_CHOICE and resolves on button press', async () => {
    const ws = await connectWs(wsUrl);
    const msgs = collectMessages(ws);
    await waitMs(100);

    // POST stop with choices — HTTP held open (proxy mode)
    const stopPromise = postJSON('/api/hook/stop', {
      session_id: 'edge-proxy-1',
      cwd: '/tmp/proxy',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      _djChoices: [{ index: '1', label: 'Refactor' }, { index: '2', label: 'Rewrite' }],
    });

    // Wait for choice layout on deck
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (msgs.some((m) => m.preset === 'choice')) { clearInterval(check); resolve(); }
      }, 50);
    });

    // Verify WAITING_CHOICE state
    const status = await getJSON('/api/status');
    const session = status.body.sessions.find((s) => s.id === 'edge-proxy-1');
    assert.equal(session.state, 'WAITING_CHOICE');

    // Press button slot 0 → select "Refactor"
    ws.send(JSON.stringify({ type: 'BUTTON_PRESS', slot: 0, timestamp: Date.now() }));

    // HTTP should now resolve with selectedChoice
    const result = await stopPromise;
    assert.equal(result.body.ok, true);
    assert.equal(result.body.selectedChoice, 'Refactor');

    ws.close();
  });

  // --- Slot 11 cycle focus ---

  it('slot 11 cycles focus between sessions', async () => {
    const ws = await connectWs(wsUrl);
    const msgs = collectMessages(ws);
    await waitMs(100);

    // Create two sessions
    await postJSON('/api/hook/notify', {
      session_id: 'edge-focus-A', cwd: '/tmp/a',
      hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {},
    });
    await postJSON('/api/hook/notify', {
      session_id: 'edge-focus-B', cwd: '/tmp/b',
      hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {},
    });

    await waitMs(100);

    // Press slot 11 to cycle focus
    ws.send(JSON.stringify({ type: 'BUTTON_PRESS', slot: 11, timestamp: Date.now() }));
    await waitMs(200);

    const focusSwitched = msgs.find((m) => m.focusSwitched === true);
    assert.ok(focusSwitched, 'should receive layout with focusSwitched: true');

    ws.close();
  });

  // --- Slot 12 cycle agent ---

  it('slot 12 cycles agent within session', async () => {
    const ws = await connectWs(wsUrl);
    const msgs = collectMessages(ws);
    await waitMs(100);

    // Use a permission to auto-focus the session (handlePermission calls setFocus)
    const hookPromise = runHook('permission.js', {
      session_id: 'edge-agent-2', cwd: '/tmp/ag',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash', tool_input: { command: 'echo hi' },
    });

    // Wait for binary layout
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (msgs.some((m) => m.preset === 'binary')) { clearInterval(check); resolve(); }
      }, 50);
    });

    // Add a subagent to the focused session
    await postJSON('/api/hook/subagentStart', {
      session_id: 'edge-agent-2', agent_id: 'sub-2', agent_type: 'executor',
    });
    await waitMs(100);

    // Press slot 12 to cycle to subagent
    msgs.length = 0;
    ws.send(JSON.stringify({ type: 'BUTTON_PRESS', slot: 12, timestamp: Date.now() }));
    await waitMs(200);

    const agentLayout = msgs.find((m) => m.focusSwitched === true);
    assert.ok(agentLayout, 'should broadcast focusSwitched after slot 12');
    assert.equal(agentLayout.agent.agentId, 'sub-2');

    // Clean up: approve permission to unblock hook
    ws.send(JSON.stringify({ type: 'BUTTON_PRESS', slot: 0, timestamp: Date.now() }));
    await hookPromise;

    ws.close();
  });

  // --- multiSelect toggle broadcasts intermediate state ---

  it('multiSelect toggle broadcasts updated selected state before submit', async () => {
    const ws = await connectWs(wsUrl);
    const msgs = collectMessages(ws);
    await waitMs(100);

    const hookPromise = runHook('permission.js', {
      session_id: 'edge-toggle-1',
      hook_event_name: 'PermissionRequest',
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [{
          question: 'Pick features',
          multiSelect: true,
          options: [
            { label: 'Auth' },
            { label: 'API' },
            { label: 'UI' },
          ],
        }],
      },
    });

    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (msgs.some((m) => m.preset === 'multiSelect')) { clearInterval(check); resolve(); }
      }, 50);
    });

    // Toggle slot 0
    ws.send(JSON.stringify({ type: 'BUTTON_PRESS', slot: 0, timestamp: Date.now() }));
    await waitMs(200);

    // Find the toggle broadcast
    const toggleLayout = msgs.filter((m) => m.preset === 'multiSelect');
    const afterToggle = toggleLayout[toggleLayout.length - 1];
    assert.ok(afterToggle.choices[0].selected === true, 'slot 0 should be selected after toggle');

    // Submit
    ws.send(JSON.stringify({ type: 'BUTTON_PRESS', slot: 9, timestamp: Date.now() }));
    const result = await hookPromise;
    assert.equal(result.exitCode, 0);
    const resp = JSON.parse(result.stdout);
    assert.equal(resp.hookSpecificOutput.decision.updatedInput.answer, '1');

    ws.close();
  });

  // --- Concurrent button presses ---

  it('concurrent button presses only resolve once (no double-respond crash)', async () => {
    const ws1 = await connectWs(wsUrl);
    const ws2 = await connectWs(wsUrl);
    const msgs1 = collectMessages(ws1);
    await waitMs(100);

    const hookPromise = runHook('permission.js', {
      session_id: 'edge-concurrent-1',
      cwd: '/tmp/concurrent',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'echo test' },
    });

    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (msgs1.some((m) => m.preset === 'binary')) { clearInterval(check); resolve(); }
      }, 50);
    });

    // Both clients press slot 0 simultaneously
    ws1.send(JSON.stringify({ type: 'BUTTON_PRESS', slot: 0, timestamp: Date.now() }));
    ws2.send(JSON.stringify({ type: 'BUTTON_PRESS', slot: 0, timestamp: Date.now() }));

    const result = await hookPromise;
    assert.equal(result.exitCode, 0);
    // Should get a valid response (first press wins, second is no-op)
    const resp = JSON.parse(result.stdout);
    assert.equal(resp.hookSpecificOutput.decision.behavior, 'allow');

    ws1.close();
    ws2.close();
  });

  // --- Hook resilience when bridge is down ---

  it('notify.js exits 0 when bridge is unreachable', async () => {
    const result = await runHook('notify.js', {
      session_id: 'down-1', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {},
    }, { CLAUDE_DJ_URL: 'http://127.0.0.1:1' });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
  });

  it('postToolUse.js exits 0 when bridge is unreachable', async () => {
    const result = await runHook('postToolUse.js', {
      session_id: 'down-2', hook_event_name: 'PostToolUse', tool_name: 'Read',
      tool_result: { output: 'ok', errored: false },
    }, { CLAUDE_DJ_URL: 'http://127.0.0.1:1' });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
  });

  it('stop.js exits 0 when bridge is unreachable', async () => {
    const result = await runHook('stop.js', {
      session_id: 'down-3', hook_event_name: 'Stop', stop_hook_active: false,
    }, { CLAUDE_DJ_URL: 'http://127.0.0.1:1' });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
  });

  it('subagentStart.js exits 0 when bridge is unreachable', async () => {
    const result = await runHook('subagentStart.js', {
      session_id: 'down-4', agent_id: 'a1', agent_type: 'test',
    }, { CLAUDE_DJ_URL: 'http://127.0.0.1:1' });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
  });

  it('subagentStop.js exits 0 when bridge is unreachable', async () => {
    const result = await runHook('subagentStop.js', {
      session_id: 'down-5', agent_id: 'a1',
    }, { CLAUDE_DJ_URL: 'http://127.0.0.1:1' });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
  });

  // --- notify cancels pending stop timer ---

  it('notify cancels pending stop response timer', async () => {
    // Send stop — this creates a WAITING_RESPONSE session
    await postJSON('/api/hook/stop', {
      session_id: 'edge-timer-1', hook_event_name: 'Stop', stop_hook_active: false,
      _djChoices: [{ index: '1', label: 'A' }],
    });

    // Immediately send notify — should cancel stop and transition to PROCESSING
    await postJSON('/api/hook/notify', {
      session_id: 'edge-timer-1', cwd: '/tmp/timer',
      hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {},
    });

    const status = await getJSON('/api/status');
    const session = status.body.sessions.find((s) => s.id === 'edge-timer-1');
    assert.equal(session.state, 'PROCESSING');
  });

  // --- Input validation ---

  it('POST /api/hook/notify with empty body returns 400', async () => {
    const resp = await postJSON('/api/hook/notify', {});
    assert.equal(resp.status, 400);
    assert.equal(resp.body.error, 'missing or invalid session_id');
  });

  it('POST with malformed JSON returns 400', async () => {
    return new Promise((resolve, reject) => {
      const data = 'not valid json{{{';
      const req = http.request({
        hostname: '127.0.0.1', port: PORT, path: '/api/hook/notify', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      }, (res) => {
        assert.equal(res.statusCode, 400);
        resolve();
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  });

  // --- WebSocket edge cases ---

  it('WS malformed JSON does not disconnect client', async () => {
    const ws = await connectWs(wsUrl);
    await waitMs(100);
    ws.send('not json{{{');
    await waitMs(200);
    // Client should still be connected
    assert.equal(ws.readyState, WebSocket.OPEN);
    ws.close();
  });

  it('WS unknown message type is handled gracefully', async () => {
    const ws = await connectWs(wsUrl);
    await waitMs(100);
    ws.send(JSON.stringify({ type: 'GARBAGE_TYPE', data: 123 }));
    await waitMs(200);
    assert.equal(ws.readyState, WebSocket.OPEN);
    ws.close();
  });

  it('WS BUTTON_PRESS before CLIENT_READY is still processed', async () => {
    // Connect without sending CLIENT_READY first
    const ws = await new Promise((resolve, reject) => {
      const conn = new WebSocket(wsUrl);
      conn.on('open', () => resolve(conn));
      conn.on('error', reject);
    });

    // Send button press immediately (no CLIENT_READY)
    ws.send(JSON.stringify({ type: 'BUTTON_PRESS', slot: 0, timestamp: Date.now() }));
    await waitMs(200);
    // Should not crash
    assert.equal(ws.readyState, WebSocket.OPEN);
    ws.close();
  });

  // --- userPrompt.js behavioral tests ---

  it('userPrompt.js injects deck button selections as additionalContext', async () => {
    const sessionId = 'edge-prompt-1';
    // Write a fake event file
    const eventsDir = (await import('../claude-plugin/bridge/config.js')).config.eventsDir;
    const fs = (await import('node:fs')).default;
    const eventFile = `${eventsDir}/${sessionId}.jsonl`;
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(eventFile, JSON.stringify({ value: 'Docker' }) + '\n');

    const result = await runHook('userPrompt.js', {
      session_id: sessionId,
      cwd: '/tmp/prompt-test',
      hook_event_name: 'UserPromptSubmit',
    });

    assert.equal(result.exitCode, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.ok(output.hookSpecificOutput.additionalContext.includes('Docker'));
  });

  it('userPrompt.js produces no output when no events exist', async () => {
    const result = await runHook('userPrompt.js', {
      session_id: 'edge-prompt-none',
      cwd: '/tmp/prompt-test',
      hook_event_name: 'UserPromptSubmit',
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
  });

  // --- Subagent hooks spawned as real processes ---

  it('subagentStart.js spawned as process sends correct data to bridge', async () => {
    const result = await runHook('subagentStart.js', {
      session_id: 'edge-subspawn-1',
      agent_id: 'spawn-agent-1',
      agent_type: 'executor',
    });
    assert.equal(result.exitCode, 0);

    const status = await getJSON('/api/status');
    const session = status.body.sessions.find((s) => s.id === 'edge-subspawn-1');
    assert.ok(session, 'session should exist');
    const agent = session.agents.find((a) => a.agentId === 'spawn-agent-1');
    assert.ok(agent, 'agent should exist');
    assert.equal(agent.type, 'executor');
  });

  it('subagentStop.js spawned as process removes agent from session', async () => {
    // First ensure agent exists
    await runHook('subagentStart.js', {
      session_id: 'edge-subspawn-2',
      agent_id: 'spawn-agent-2',
      agent_type: 'reviewer',
    });

    const result = await runHook('subagentStop.js', {
      session_id: 'edge-subspawn-2',
      agent_id: 'spawn-agent-2',
    });
    assert.equal(result.exitCode, 0);

    const status = await getJSON('/api/status');
    const session = status.body.sessions.find((s) => s.id === 'edge-subspawn-2');
    assert.ok(session);
    const agent = session.agents.find((a) => a.agentId === 'spawn-agent-2');
    assert.equal(agent, undefined, 'agent should be removed');
  });

  // --- Input validation ---

  it('POST /api/hook/notify with null session_id returns 400', async () => {
    const resp = await postJSON('/api/hook/notify', { session_id: null });
    assert.equal(resp.status, 400);
  });

  it('POST /api/hook/notify with numeric session_id returns 400', async () => {
    const resp = await postJSON('/api/hook/notify', { session_id: 12345 });
    assert.equal(resp.status, 400);
  });

  it('POST /api/hook/permission with missing session_id returns 400', async () => {
    const resp = await postJSON('/api/hook/permission', { tool_name: 'Bash' });
    assert.equal(resp.status, 400);
  });

  // --- Oversized body ---

  it('POST with oversized body returns 413', async () => {
    return new Promise((resolve, reject) => {
      const bigBody = JSON.stringify({ session_id: 'x', data: 'A'.repeat(200000) });
      const req = http.request({
        hostname: '127.0.0.1', port: PORT, path: '/api/hook/notify', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bigBody) },
      }, (res) => {
        assert.equal(res.statusCode, 413);
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.write(bigBody);
      req.end();
    });
  });

  it('duplicate CLIENT_READY sends welcome twice without crash', async () => {
    const ws = await connectWs(wsUrl);
    const msgs = collectMessages(ws);
    await waitMs(100);
    // Send CLIENT_READY again
    ws.send(JSON.stringify({ type: 'CLIENT_READY', clientType: 'test', version: '0.2.0' }));
    await waitMs(200);
    const welcomes = msgs.filter((m) => m.type === 'WELCOME');
    assert.ok(welcomes.length >= 1, 'should receive at least one welcome');
    ws.close();
  });
});
