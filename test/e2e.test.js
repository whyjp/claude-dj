import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
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

  it('late-join: new client receives current LAYOUT on CLIENT_READY', async () => {
    // First, create a waiting session via permission hook
    const ws1 = await connectWs(wsUrl);
    const msgs1 = collectMessages(ws1);
    await new Promise((r) => setTimeout(r, 100));

    const hookPromise = runHook('permission.js', {
      session_id: 'e2e-latejoin-1',
      cwd: '/tmp/latejoin',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'echo hi' },
    });

    // Wait for binary layout
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (msgs1.some((m) => m.type === 'LAYOUT' && m.preset === 'binary')) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    // Now a LATE client joins — should immediately receive the current layout
    const ws2 = await connectWs(wsUrl);
    const msgs2 = collectMessages(ws2);

    // Wait briefly for the sync message
    await new Promise((r) => setTimeout(r, 200));

    const syncMsg = msgs2.find((m) => m.type === 'LAYOUT' && m.preset === 'binary');
    assert.ok(syncMsg, 'Late-join client should receive current binary layout');
    assert.equal(syncMsg.session.id, 'e2e-latejoin-1');

    // Clean up: approve to unblock the hook
    ws1.send(JSON.stringify({ type: 'BUTTON_PRESS', slot: 0, timestamp: Date.now() }));
    await hookPromise;

    ws1.close();
    ws2.close();
  });

  it('cross-session: AskUserQuestion on B survives notify flood from A', async () => {
    const ws = await connectWs(wsUrl);
    const msgs = collectMessages(ws);
    await new Promise((r) => setTimeout(r, 100));

    // Session A: processing
    await runHook('notify.js', {
      session_id: 'e2e-cross-A',
      cwd: '/tmp/projectA',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    });

    // Session B: AskUserQuestion (blocking permission hook)
    const hookPromise = runHook('permission.js', {
      session_id: 'e2e-cross-B',
      cwd: '/tmp/projectB',
      hook_event_name: 'PermissionRequest',
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [{
          question: 'Which approach?',
          options: [
            { label: 'Refactor', description: 'Clean up existing code' },
            { label: 'Rewrite', description: 'Start from scratch' },
          ],
        }],
      },
    });

    // Wait for choice layout from B
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (msgs.some((m) => m.type === 'LAYOUT' && m.preset === 'choice')) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    // Session A fires MORE notify events (should not override B's choice layout)
    await runHook('notify.js', {
      session_id: 'e2e-cross-A',
      cwd: '/tmp/projectA',
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/foo.js' },
    });
    await runHook('postToolUse.js', {
      session_id: 'e2e-cross-A',
      cwd: '/tmp/projectA',
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_result: { output: 'ok', errored: false },
    });

    // Verify no processing layout was broadcast after the choice layout
    const choiceIdx = msgs.findIndex((m) => m.type === 'LAYOUT' && m.preset === 'choice');
    const laterProcessing = msgs.slice(choiceIdx + 1).find(
      (m) => m.type === 'LAYOUT' && m.preset === 'processing' && m.session?.id === 'e2e-cross-A'
    );
    assert.equal(laterProcessing, undefined, 'A\'s processing should NOT override B\'s choice layout');

    // Press choice button (slot 0 = option 1)
    ws.send(JSON.stringify({ type: 'BUTTON_PRESS', slot: 0, timestamp: Date.now() }));

    const result = await hookPromise;
    assert.equal(result.exitCode, 0);

    const response = JSON.parse(result.stdout);
    assert.equal(response.hookSpecificOutput.decision.behavior, 'allow');
    assert.equal(response.hookSpecificOutput.decision.updatedInput.answer, '1');

    ws.close();
  });

  it('cross-session: both A and B waiting — button resolves the focused session', async () => {
    const ws = await connectWs(wsUrl);
    const msgs = collectMessages(ws);
    await new Promise((r) => setTimeout(r, 100));

    // Session A: permission (WAITING_BINARY) — fires first (older waitingSince)
    const hookA = runHook('permission.js', {
      session_id: 'e2e-dual-A',
      cwd: '/tmp/dualA',
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /tmp/old' },
    });

    // Wait for A's binary layout
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (msgs.some((m) => m.type === 'LAYOUT' && m.preset === 'binary')) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    // Session B: AskUserQuestion (WAITING_CHOICE) — fires second, takes focus
    const hookB = runHook('permission.js', {
      session_id: 'e2e-dual-B',
      cwd: '/tmp/dualB',
      hook_event_name: 'PermissionRequest',
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [{
          question: 'Pick one',
          options: [
            { label: 'Alpha', description: 'First' },
            { label: 'Beta', description: 'Second' },
          ],
        }],
      },
    });

    // Wait for B's choice layout (should override A's binary on deck)
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (msgs.some((m) => m.type === 'LAYOUT' && m.preset === 'choice')) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    // Press choice button (slot 1 = option 2) — must resolve B, not A
    ws.send(JSON.stringify({ type: 'BUTTON_PRESS', slot: 1, timestamp: Date.now() }));

    const resultB = await hookB;
    assert.equal(resultB.exitCode, 0);
    const respB = JSON.parse(resultB.stdout);
    assert.equal(respB.hookSpecificOutput.decision.behavior, 'allow');
    assert.equal(respB.hookSpecificOutput.decision.updatedInput.answer, '2');

    // Now A is still waiting — approve it
    ws.send(JSON.stringify({ type: 'BUTTON_PRESS', slot: 0, timestamp: Date.now() }));

    const resultA = await hookA;
    assert.equal(resultA.exitCode, 0);
    const respA = JSON.parse(resultA.stdout);
    assert.equal(respA.hookSpecificOutput.decision.behavior, 'allow');

    ws.close();
  });

  it('stop.js: choices in transcript → deck shows response buttons (display-only)', async () => {
    // Create a fake transcript JSONL with choices
    const tmpDir = path.join(os.tmpdir(), 'claude-dj-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    const entry = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'text',
            text: 'Which approach?\n\n1. Refactor\n2. Rewrite\n3. Patch',
          },
        ],
      },
    };
    fs.writeFileSync(transcriptPath, JSON.stringify(entry) + '\n');

    const wsPromise = waitForWsMessage(wsUrl, 'LAYOUT', 5000);

    const result = await runHook('stop.js', {
      session_id: 'e2e-display-1',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      transcript_path: transcriptPath,
    });

    assert.equal(result.exitCode, 0);

    const msg = await wsPromise;
    assert.equal(msg.preset, 'response');
    assert.ok(msg.choices);
    assert.equal(msg.choices.length, 3);
    assert.equal(msg.choices[0].index, '1');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
