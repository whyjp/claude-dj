import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hooksDir = path.resolve(__dirname, '..', 'hooks');
const PORT = 39298;

/**
 * Spawn a hook script with JSON piped to stdin (same as Claude CLI does).
 * Returns { stdout, stderr, exitCode }.
 */
function runHook(scriptName, inputObj) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(hooksDir, scriptName)], {
      env: { ...process.env, CLAUDE_DJ_URL: `http://127.0.0.1:${PORT}` },
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

/** Connect a WebSocket client and wait for a specific message type. */
function waitForWsMessage(wsUrl, type, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Timeout waiting for WS message type="${type}"`));
    }, timeoutMs);

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.close();
        resolve(msg);
      }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/** Connect a WebSocket client that can send button presses. */
function connectWs(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'CLIENT_READY', clientType: 'test', version: '0.1.0' }));
      resolve(ws);
    });
    ws.on('error', reject);
  });
}

/** Collect WS messages into an array until closed. */
function collectMessages(ws) {
  const msgs = [];
  ws.on('message', (raw) => msgs.push(JSON.parse(raw.toString())));
  return msgs;
}

describe('E2E: Hook → Bridge → WebSocket', () => {
  let server;
  const wsUrl = `ws://127.0.0.1:${PORT}/ws`;

  before(async () => {
    process.env.CLAUDE_DJ_PORT = String(PORT);
    const mod = await import('../bridge/server.js');
    server = mod.server;
    await new Promise((r) => setTimeout(r, 500));
  });

  after(() => {
    server?.close();
    delete process.env.CLAUDE_DJ_PORT;
  });

  it('notify.js: spawned with stdin → bridge receives → WS gets LAYOUT(processing)', async () => {
    const wsPromise = waitForWsMessage(wsUrl, 'LAYOUT');

    const result = await runHook('notify.js', {
      session_id: 'e2e-notify-1',
      cwd: '/tmp/my-project',
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/foo.js' },
    });

    assert.equal(result.exitCode, 0);

    const msg = await wsPromise;
    assert.equal(msg.preset, 'processing');
    assert.equal(msg.session.id, 'e2e-notify-1');
    assert.equal(msg.session.state, 'PROCESSING');
  });

  it('stop.js: spawned with stdin → bridge receives → WS gets ALL_DIM', async () => {
    const wsPromise = waitForWsMessage(wsUrl, 'ALL_DIM');

    const result = await runHook('stop.js', {
      session_id: 'e2e-stop-1',
      hook_event_name: 'Stop',
      stop_hook_active: false,
    });

    assert.equal(result.exitCode, 0);
    const msg = await wsPromise;
    assert.equal(msg.type, 'ALL_DIM');
  });

  it('postToolUse.js: spawned with stdin → bridge receives → WS gets LAYOUT(processing)', async () => {
    const wsPromise = waitForWsMessage(wsUrl, 'LAYOUT');

    const result = await runHook('postToolUse.js', {
      session_id: 'e2e-post-1',
      cwd: '/tmp/my-project',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_result: { output: 'hello', errored: false },
    });

    assert.equal(result.exitCode, 0);

    const msg = await wsPromise;
    assert.equal(msg.preset, 'processing');
    assert.equal(msg.session.id, 'e2e-post-1');
  });

  it('postToolUse.js: errored tool also broadcasts processing layout', async () => {
    const wsPromise = waitForWsMessage(wsUrl, 'LAYOUT');

    const result = await runHook('postToolUse.js', {
      session_id: 'e2e-post-2',
      cwd: '/tmp/my-project',
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_result: { output: 'ENOENT', errored: true },
    });

    assert.equal(result.exitCode, 0);

    const msg = await wsPromise;
    assert.equal(msg.preset, 'processing');
  });

  it('permission.js: spawned with stdin → WS gets LAYOUT(binary) → button press → hook returns allow', async () => {
    // Connect a WS client that will press the approve button
    const ws = await connectWs(wsUrl);
    const msgs = collectMessages(ws);

    // Small delay to ensure client is registered
    await new Promise((r) => setTimeout(r, 100));

    // Spawn permission hook (this will block until bridge responds)
    const hookPromise = runHook('permission.js', {
      session_id: 'e2e-perm-1',
      cwd: '/tmp/my-project',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
    });

    // Wait for LAYOUT message with binary preset
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (msgs.some((m) => m.type === 'LAYOUT' && m.preset === 'binary')) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    // Press approve button (slot 0)
    ws.send(JSON.stringify({ type: 'BUTTON_PRESS', slot: 0, timestamp: Date.now() }));

    // Hook should return with allow response
    const result = await hookPromise;
    assert.equal(result.exitCode, 0);

    const response = JSON.parse(result.stdout);
    assert.equal(response.hookSpecificOutput.hookEventName, 'PermissionRequest');
    assert.equal(response.hookSpecificOutput.decision.behavior, 'allow');

    ws.close();
  });

  it('permission.js: deny button (slot 1) returns deny', async () => {
    const ws = await connectWs(wsUrl);
    const msgs = collectMessages(ws);
    await new Promise((r) => setTimeout(r, 100));

    const hookPromise = runHook('permission.js', {
      session_id: 'e2e-perm-2',
      cwd: '/tmp/project2',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/bar.js', content: '...' },
    });

    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (msgs.some((m) => m.type === 'LAYOUT' && m.preset === 'binary')) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    // Press deny button (slot 1)
    ws.send(JSON.stringify({ type: 'BUTTON_PRESS', slot: 1, timestamp: Date.now() }));

    const result = await hookPromise;
    assert.equal(result.exitCode, 0);

    const response = JSON.parse(result.stdout);
    assert.equal(response.hookSpecificOutput.decision.behavior, 'deny');

    ws.close();
  });

  it('permission.js: always-allow button (slot 1 with hasAlwaysAllow) returns alwaysAllow', async () => {
    const ws = await connectWs(wsUrl);
    const msgs = collectMessages(ws);
    await new Promise((r) => setTimeout(r, 100));

    const hookPromise = runHook('permission.js', {
      session_id: 'e2e-perm-3',
      cwd: '/tmp/project3',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      permission_suggestions: [{ tool_name: 'Bash', command: 'npm test' }],
    });

    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (msgs.some((m) => m.type === 'LAYOUT' && m.preset === 'binary')) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    // Slot 1 = Always Allow (when hasAlwaysAllow), matching Claude Code dialog order
    ws.send(JSON.stringify({ type: 'BUTTON_PRESS', slot: 1, timestamp: Date.now() }));

    const result = await hookPromise;
    assert.equal(result.exitCode, 0);

    const response = JSON.parse(result.stdout);
    assert.equal(response.hookSpecificOutput.decision.behavior, 'alwaysAllow');

    ws.close();
  });

  it('permission.js: deny button (slot 2 with hasAlwaysAllow) returns deny', async () => {
    const ws = await connectWs(wsUrl);
    const msgs = collectMessages(ws);
    await new Promise((r) => setTimeout(r, 100));

    const hookPromise = runHook('permission.js', {
      session_id: 'e2e-perm-4',
      cwd: '/tmp/project4',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'npm run build' },
      permission_suggestions: [{ tool_name: 'Bash', command: 'npm run build' }],
    });

    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (msgs.some((m) => m.type === 'LAYOUT' && m.preset === 'binary')) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    // Slot 2 = Deny (when hasAlwaysAllow shifts deny to slot 2)
    ws.send(JSON.stringify({ type: 'BUTTON_PRESS', slot: 2, timestamp: Date.now() }));

    const result = await hookPromise;
    assert.equal(result.exitCode, 0);

    const response = JSON.parse(result.stdout);
    assert.equal(response.hookSpecificOutput.decision.behavior, 'deny');

    ws.close();
  });

  it('full lifecycle: notify → permission(allow) → postToolUse → stop', async () => {
    const ws = await connectWs(wsUrl);
    const msgs = collectMessages(ws);
    await new Promise((r) => setTimeout(r, 100));

    const sid = 'e2e-lifecycle-1';

    // 1. Notify → PROCESSING
    await runHook('notify.js', {
      session_id: sid,
      cwd: '/tmp/lifecycle',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    });

    const processingMsg = msgs.find((m) => m.type === 'LAYOUT' && m.preset === 'processing');
    assert.ok(processingMsg, 'Should receive processing layout');

    // 2. Permission → WAITING_BINARY → approve
    const hookPromise = runHook('permission.js', {
      session_id: sid,
      cwd: '/tmp/lifecycle',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /tmp/old' },
    });

    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (msgs.some((m) => m.type === 'LAYOUT' && m.preset === 'binary')) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    ws.send(JSON.stringify({ type: 'BUTTON_PRESS', slot: 0, timestamp: Date.now() }));
    const permResult = await hookPromise;
    assert.equal(permResult.exitCode, 0);

    const resp = JSON.parse(permResult.stdout);
    assert.equal(resp.hookSpecificOutput.decision.behavior, 'allow');

    // 3. PostToolUse → PROCESSING with result
    await runHook('postToolUse.js', {
      session_id: sid,
      cwd: '/tmp/lifecycle',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_result: { output: 'removed', errored: false },
    });

    // After postToolUse, should get a processing layout for same session
    const postMsgs = msgs.filter((m) => m.type === 'LAYOUT' && m.preset === 'processing');
    assert.ok(postMsgs.length >= 2, 'Should receive processing layout from both notify and postToolUse');

    // 4. Stop → IDLE
    await runHook('stop.js', {
      session_id: sid,
      cwd: '/tmp/lifecycle',
      hook_event_name: 'Stop',
      stop_hook_active: false,
    });

    const dimMsg = msgs.find((m) => m.type === 'ALL_DIM');
    assert.ok(dimMsg, 'Should receive ALL_DIM');

    ws.close();
  });
});
