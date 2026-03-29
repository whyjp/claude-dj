# Subagent Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track subagent lifecycle within sessions, display root/child hierarchy in dashboard, assign Slot 11 to root-only cycling and Slot 12 to subagent cycling.

**Architecture:** Extend SessionManager's session object with an `agents` Map keyed by agent_id. Add SubagentStart/SubagentStop hooks. Branch all existing handlers on `input.agent_id` presence. Slot 11 cycles roots (resets focusAgentId), Slot 12 cycles children within current root.

**Tech Stack:** Node.js 20+, Express, WebSocket, vanilla JS frontend

---

### File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `bridge/sessionManager.js` | Add agents Map, focusAgentId, agent_id branching, cycleAgent |
| Modify | `bridge/buttonManager.js` | Slot 12 layout, agentCount in layoutFor |
| Modify | `bridge/server.js` | New endpoints, slot 12 handler, agent info in LAYOUT |
| Create | `hooks/subagentStart.js` | POST to bridge on SubagentStart |
| Create | `hooks/subagentStop.js` | POST to bridge on SubagentStop |
| Modify | `hooks/hooks.json` | Add SubagentStart/SubagentStop entries |
| Modify | `public/js/app.js` | Slot 12 focusSwitched handling |
| Modify | `public/js/dashboard.js` | Tree-view sessions, agent log tabs |
| Modify | `public/js/d200-renderer.js` | Slot 12 agent-switch key |
| Modify | `public/css/style.css` | Child row indent, agent-switch key styles |
| Modify | `public/index.html` | (no changes needed — slot 12 is already in grid) |
| Modify | `test/sessionManager.test.js` | Agent lifecycle + cycleAgent tests |
| Modify | `test/hooks.test.js` | New hook file existence tests |
| Create | `test/e2e.subagent.test.js` | E2E tests for subagent hooks |

---

### Task 1: SessionManager — agents Map & subagent lifecycle

**Files:**
- Modify: `bridge/sessionManager.js`
- Modify: `test/sessionManager.test.js`

- [ ] **Step 1: Write failing tests for subagent lifecycle**

Add to `test/sessionManager.test.js` at the end, inside the describe block:

```js
  it('getOrCreate initializes empty agents Map', () => {
    const session = sm.getOrCreate({ session_id: 's1', cwd: '/a' });
    assert.ok(session.agents instanceof Map);
    assert.equal(session.agents.size, 0);
  });

  it('handleSubagentStart adds agent to session', () => {
    sm.getOrCreate({ session_id: 's1', cwd: '/a' });
    sm.handleSubagentStart({ session_id: 's1', agent_id: 'ag1', agent_type: 'Explore' });
    const session = sm.get('s1');
    assert.equal(session.agents.size, 1);
    const agent = session.agents.get('ag1');
    assert.equal(agent.agentId, 'ag1');
    assert.equal(agent.type, 'Explore');
    assert.equal(agent.state, 'PROCESSING');
  });

  it('handleSubagentStop removes agent from session', () => {
    sm.getOrCreate({ session_id: 's1', cwd: '/a' });
    sm.handleSubagentStart({ session_id: 's1', agent_id: 'ag1', agent_type: 'Explore' });
    sm.handleSubagentStop({ session_id: 's1', agent_id: 'ag1' });
    assert.equal(sm.get('s1').agents.size, 0);
  });

  it('handleNotify with agent_id updates agent state, not root', () => {
    sm.getOrCreate({ session_id: 's1', cwd: '/a' });
    sm.handleSubagentStart({ session_id: 's1', agent_id: 'ag1', agent_type: 'Explore' });
    sm.handleStop({ session_id: 's1', stop_hook_active: false }); // root → WAITING_RESPONSE
    sm.handleNotify({ session_id: 's1', agent_id: 'ag1', tool_name: 'Bash', hook_event_name: 'PreToolUse' });
    assert.equal(sm.get('s1').state, 'WAITING_RESPONSE'); // root unchanged
    assert.equal(sm.get('s1').agents.get('ag1').state, 'PROCESSING');
  });

  it('handlePermission with agent_id updates agent state', () => {
    sm.getOrCreate({ session_id: 's1', cwd: '/a' });
    sm.handleSubagentStart({ session_id: 's1', agent_id: 'ag1', agent_type: 'Explore' });
    sm.handlePermission({ session_id: 's1', agent_id: 'ag1', tool_name: 'Bash', tool_input: { command: 'ls' } });
    assert.equal(sm.get('s1').agents.get('ag1').state, 'WAITING_BINARY');
  });

  it('handlePostToolUse with agent_id updates agent state', () => {
    sm.getOrCreate({ session_id: 's1', cwd: '/a' });
    sm.handleSubagentStart({ session_id: 's1', agent_id: 'ag1', agent_type: 'Explore' });
    sm.handlePostToolUse({ session_id: 's1', agent_id: 'ag1', tool_name: 'Bash', tool_result: { errored: false } });
    assert.equal(sm.get('s1').agents.get('ag1').state, 'PROCESSING');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/sessionManager.test.js`
Expected: 6 new tests FAIL (handleSubagentStart, handleSubagentStop not defined)

- [ ] **Step 3: Implement agents Map in getOrCreate**

In `bridge/sessionManager.js`, modify `getOrCreate` to add `agents: new Map()`:

```js
  getOrCreate(input) {
    const id = input.session_id;
    if (!this.sessions.has(id)) {
      this.sessions.set(id, {
        id,
        name: `${input.cwd ? path.basename(input.cwd) : 'unknown'} (${id})`,
        cwd: input.cwd || '',
        state: 'IDLE',
        waitingSince: null,
        prompt: null,
        respondFn: null,
        lastToolResult: null,
        agents: new Map(),
      });
    }
    return this.sessions.get(id);
  }
```

- [ ] **Step 4: Implement handleSubagentStart and handleSubagentStop**

Add after `handleStopWithChoices` method:

```js
  handleSubagentStart(input) {
    const session = this.getOrCreate(input);
    session.agents.set(input.agent_id, {
      agentId: input.agent_id,
      type: input.agent_type || 'unknown',
      state: 'PROCESSING',
      startedAt: Date.now(),
    });
    return session;
  }

  handleSubagentStop(input) {
    const session = this.getOrCreate(input);
    session.agents.delete(input.agent_id);
    // Reset focusAgentId if the removed agent was focused
    if (this.focusAgentId === input.agent_id) {
      this.focusAgentId = null;
    }
    return session;
  }
```

- [ ] **Step 5: Add agent_id branching to handleNotify**

```js
  handleNotify(input) {
    const session = this.getOrCreate(input);
    if (input.agent_id && session.agents.has(input.agent_id)) {
      session.agents.get(input.agent_id).state = 'PROCESSING';
      return session;
    }
    session.state = 'PROCESSING';
    session.prompt = null;
    return session;
  }
```

- [ ] **Step 6: Add agent_id branching to handlePermission**

Replace the opening of `handlePermission`:

```js
  handlePermission(input) {
    const session = this.getOrCreate(input);
    const isChoice = input.tool_name === 'AskUserQuestion';

    // Subagent permission — update agent state only
    if (input.agent_id && session.agents.has(input.agent_id)) {
      const agent = session.agents.get(input.agent_id);
      agent.state = isChoice ? 'WAITING_CHOICE' : 'WAITING_BINARY';
      // Still set session-level prompt/respondFn for button handling
    }

    if (isChoice) {
```

Wait — this needs more thought. The permission dialog is blocking and uses `session.respondFn`. For subagents, we still need this mechanism. The agent_id branching for permission should update agent state BUT also set session-level prompt/respondFn as before, since the deck button handling uses `session.respondFn`.

Revised approach: handlePermission always sets session-level state + prompt (for deck interaction). Additionally update agent state if agent_id is present.

```js
  handlePermission(input) {
    const session = this.getOrCreate(input);
    const isChoice = input.tool_name === 'AskUserQuestion';

    if (isChoice) {
      const options = input.tool_input?.options || [];
      session.state = 'WAITING_CHOICE';
      session.prompt = {
        type: 'CHOICE',
        question: input.tool_input?.question || '',
        choices: options.map((o) => ({
          index: parseInt(o.label, 10),
          label: o.description || o.label,
        })),
      };
    } else {
      session.state = 'WAITING_BINARY';
      session.prompt = {
        type: 'BINARY',
        toolName: input.tool_name,
        command: input.tool_input?.command || input.tool_input?.file_path || '',
        hasAlwaysAllow: Array.isArray(input.permission_suggestions) && input.permission_suggestions.length > 0,
      };
    }

    session.waitingSince = Date.now();

    // Also track agent state if this is a subagent permission
    if (input.agent_id && session.agents.has(input.agent_id)) {
      session.agents.get(input.agent_id).state = isChoice ? 'WAITING_CHOICE' : 'WAITING_BINARY';
    }

    return session;
  }
```

- [ ] **Step 7: Add agent_id branching to handlePostToolUse**

```js
  handlePostToolUse(input) {
    const session = this.getOrCreate(input);
    if (input.agent_id && session.agents.has(input.agent_id)) {
      session.agents.get(input.agent_id).state = 'PROCESSING';
      return session;
    }
    session.state = 'PROCESSING';
    session.lastToolResult = {
      toolName: input.tool_name,
      success: input.tool_result?.errored !== true,
      output: input.tool_result?.output || '',
      timestamp: Date.now(),
    };
    return session;
  }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --test test/sessionManager.test.js`
Expected: All pass (18 old + 6 new = 24)

- [ ] **Step 9: Commit**

```bash
git add bridge/sessionManager.js test/sessionManager.test.js
git commit -m "feat: SessionManager agent tracking — subagent lifecycle + agent_id branching"
```

---

### Task 2: SessionManager — focusAgentId & cycleAgent

**Files:**
- Modify: `bridge/sessionManager.js`
- Modify: `test/sessionManager.test.js`

- [ ] **Step 1: Write failing tests for cycleAgent and focusAgentId**

Add to `test/sessionManager.test.js`:

```js
  it('cycleAgent rotates through agents and null (root)', () => {
    sm.getOrCreate({ session_id: 's1', cwd: '/a' });
    sm.handleSubagentStart({ session_id: 's1', agent_id: 'ag1', agent_type: 'Explore' });
    sm.handleSubagentStart({ session_id: 's1', agent_id: 'ag2', agent_type: 'Plan' });
    sm.setFocus('s1');
    // Start at null (root)
    assert.equal(sm.focusAgentId, null);
    const a1 = sm.cycleAgent();
    assert.equal(a1.agentId, 'ag1');
    assert.equal(sm.focusAgentId, 'ag1');
    const a2 = sm.cycleAgent();
    assert.equal(a2.agentId, 'ag2');
    const root = sm.cycleAgent();
    assert.equal(root, null); // back to root
    assert.equal(sm.focusAgentId, null);
  });

  it('cycleAgent returns null when no agents', () => {
    sm.getOrCreate({ session_id: 's1', cwd: '/a' });
    sm.setFocus('s1');
    const result = sm.cycleAgent();
    assert.equal(result, null);
  });

  it('cycleAgent returns null when no focus session', () => {
    const result = sm.cycleAgent();
    assert.equal(result, null);
  });

  it('cycleFocus resets focusAgentId to null', () => {
    sm.getOrCreate({ session_id: 's1', cwd: '/a' });
    sm.getOrCreate({ session_id: 's2', cwd: '/b' });
    sm.handleSubagentStart({ session_id: 's1', agent_id: 'ag1', agent_type: 'Explore' });
    sm.setFocus('s1');
    sm.focusAgentId = 'ag1';
    sm.cycleFocus(); // switch to s2
    assert.equal(sm.focusAgentId, null);
  });

  it('getAgentCount returns agents.size', () => {
    sm.getOrCreate({ session_id: 's1', cwd: '/a' });
    assert.equal(sm.getAgentCount('s1'), 0);
    sm.handleSubagentStart({ session_id: 's1', agent_id: 'ag1', agent_type: 'Explore' });
    assert.equal(sm.getAgentCount('s1'), 1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/sessionManager.test.js`
Expected: FAIL — cycleAgent and getAgentCount not defined

- [ ] **Step 3: Add focusAgentId to constructor**

```js
  constructor() {
    this.sessions = new Map();
    this.focusSessionId = null;
    this.focusAgentId = null;
  }
```

- [ ] **Step 4: Implement cycleAgent**

Add after `cycleFocus` method:

```js
  /** Cycle through subagents of the currently focused root session. Returns agent object or null (root). */
  cycleAgent() {
    const session = this.focusSessionId ? this.sessions.get(this.focusSessionId) : null;
    if (!session) return null;
    const agents = [...session.agents.values()];
    if (agents.length === 0) return null;

    if (this.focusAgentId === null) {
      // Currently on root → go to first agent
      this.focusAgentId = agents[0].agentId;
      return agents[0];
    }

    const currentIdx = agents.findIndex((a) => a.agentId === this.focusAgentId);
    const nextIdx = currentIdx + 1;
    if (nextIdx >= agents.length) {
      // Past last agent → back to root
      this.focusAgentId = null;
      return null;
    }
    this.focusAgentId = agents[nextIdx].agentId;
    return agents[nextIdx];
  }

  /** Get agent count for a session */
  getAgentCount(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? session.agents.size : 0;
  }
```

- [ ] **Step 5: Modify cycleFocus to reset focusAgentId**

In `cycleFocus`, add reset at the end before each return:

```js
  cycleFocus() {
    const all = [...this.sessions.values()];
    if (all.length === 0) return null;
    if (all.length === 1) {
      this.focusSessionId = all[0].id;
      this.focusAgentId = null;
      return all[0];
    }
    const currentIdx = all.findIndex((s) => s.id === this.focusSessionId);
    const nextIdx = (currentIdx + 1) % all.length;
    this.focusSessionId = all[nextIdx].id;
    this.focusAgentId = null;
    return all[nextIdx];
  }
```

- [ ] **Step 6: Update toJSON to include agents**

```js
  toJSON() {
    return [...this.sessions.values()].map(({ respondFn, agents, ...rest }) => ({
      ...rest,
      agents: [...agents.values()],
    }));
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test test/sessionManager.test.js`
Expected: All pass (24 + 5 = 29)

- [ ] **Step 8: Commit**

```bash
git add bridge/sessionManager.js test/sessionManager.test.js
git commit -m "feat: SessionManager cycleAgent + focusAgentId + getAgentCount"
```

---

### Task 3: Hook scripts — SubagentStart & SubagentStop

**Files:**
- Create: `hooks/subagentStart.js`
- Create: `hooks/subagentStop.js`
- Modify: `hooks/hooks.json`
- Modify: `test/hooks.test.js`

- [ ] **Step 1: Write failing tests**

Add to `test/hooks.test.js` inside the describe block:

```js
  it('subagentStart.js exists and is valid JS', () => {
    assert.ok(existsSync('hooks/subagentStart.js'));
    const content = readFileSync('hooks/subagentStart.js', 'utf8');
    assert.ok(content.includes('/api/hook/subagentStart'));
  });

  it('subagentStop.js exists and is valid JS', () => {
    assert.ok(existsSync('hooks/subagentStop.js'));
    const content = readFileSync('hooks/subagentStop.js', 'utf8');
    assert.ok(content.includes('/api/hook/subagentStop'));
  });

  it('hooks.json includes SubagentStart and SubagentStop', () => {
    const config = JSON.parse(readFileSync('hooks/hooks.json', 'utf8'));
    assert.ok(config.hooks.SubagentStart, 'should have SubagentStart');
    assert.ok(config.hooks.SubagentStop, 'should have SubagentStop');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/hooks.test.js`
Expected: 3 FAIL

- [ ] **Step 3: Create hooks/subagentStart.js**

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const BRIDGE_URL = process.env.CLAUDE_DJ_URL || 'http://localhost:39200';

try {
  const input = readFileSync(0, 'utf8');
  await fetch(`${BRIDGE_URL}/api/hook/subagentStart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: input,
    signal: AbortSignal.timeout(5000),
  });
} catch (e) {
  // ignore — async hook
}
process.exit(0);
```

- [ ] **Step 4: Create hooks/subagentStop.js**

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const BRIDGE_URL = process.env.CLAUDE_DJ_URL || 'http://localhost:39200';

try {
  const input = readFileSync(0, 'utf8');
  await fetch(`${BRIDGE_URL}/api/hook/subagentStop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: input,
    signal: AbortSignal.timeout(5000),
  });
} catch (e) {
  // ignore — async hook
}
process.exit(0);
```

- [ ] **Step 5: Update hooks/hooks.json**

Add SubagentStart and SubagentStop entries:

```json
{
  "hooks": {
    "UserPromptSubmit": [ ... ],
    "PermissionRequest": [ ... ],
    "PreToolUse": [ ... ],
    "PostToolUse": [ ... ],
    "Stop": [ ... ],
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/subagentStart.js\""
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/subagentStop.js\""
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/hooks.test.js`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add hooks/subagentStart.js hooks/subagentStop.js hooks/hooks.json test/hooks.test.js
git commit -m "feat: SubagentStart/SubagentStop hook scripts + hooks.json registration"
```

---

### Task 4: Server — subagent endpoints & slot 12

**Files:**
- Modify: `bridge/server.js`
- Modify: `bridge/buttonManager.js`
- Create: `test/e2e.subagent.test.js`

- [ ] **Step 1: Write E2E tests for subagent hooks**

Create `test/e2e.subagent.test.js`:

```js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
    // Create session first
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

    // Verify via status endpoint
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

  it('notify with agent_id updates agent state, not root', async () => {
    // Setup: session + subagent
    await fetch(`http://localhost:${PORT}/api/hook/subagentStart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 'sa-test-1', agent_id: 'ag-2', agent_type: 'Plan' }),
    });

    // Root → IDLE via dismiss
    // Notify with agent_id
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
```

- [ ] **Step 2: Add server endpoints for subagentStart/Stop**

In `bridge/server.js`, after the `/api/hook/postToolUse` endpoint:

```js
app.post('/api/hook/subagentStart', (req, res) => {
  const input = req.body;
  console.log(`[hook/subagentStart] session=${input.session_id} agent=${input.agent_id} type=${input.agent_type}`);
  const session = sm.handleSubagentStart(input);
  const layout = ButtonManager.layoutFor(session, sm.focusAgentId, sm.getAgentCount(session.id));
  broadcastLayout(layout);
  res.json({ ok: true });
});

app.post('/api/hook/subagentStop', (req, res) => {
  const input = req.body;
  console.log(`[hook/subagentStop] session=${input.session_id} agent=${input.agent_id}`);
  const session = sm.handleSubagentStop(input);
  const layout = ButtonManager.layoutFor(session, sm.focusAgentId, sm.getAgentCount(session.id));
  broadcastLayout(layout);
  res.json({ ok: true });
});
```

- [ ] **Step 3: Update ButtonManager.layoutFor to accept agent info**

In `bridge/buttonManager.js`, update `layoutFor`:

```js
  static layoutFor(session, focusAgentId = null, agentCount = 0) {
    const focusedAgent = focusAgentId ? session.agents?.get(focusAgentId) : null;
    const base = {
      session: session.id ? {
        id: session.id,
        name: session.name,
        state: session.state,
      } : undefined,
      agent: focusedAgent ? {
        agentId: focusedAgent.agentId,
        type: focusedAgent.type,
        state: focusedAgent.state,
      } : null,
      agentCount,
    };

    switch (session.state) {
      case 'IDLE':
        return { ...base, preset: 'idle' };
      case 'PROCESSING':
        return { ...base, preset: 'processing' };
      case 'WAITING_BINARY':
        return { ...base, preset: 'binary', prompt: session.prompt };
      case 'WAITING_CHOICE':
        return { ...base, preset: 'choice', choices: session.prompt.choices };
      case 'WAITING_RESPONSE':
        return { ...base, preset: 'response', choices: session.prompt.choices || null };
      default:
        return { ...base, preset: 'idle' };
    }
  }
```

- [ ] **Step 4: Update all layoutFor calls in server.js**

Every `ButtonManager.layoutFor(session)` call becomes:

```js
ButtonManager.layoutFor(session, sm.focusAgentId, sm.getAgentCount(session.id))
```

There are approximately 8 call sites in server.js. Update all of them.

- [ ] **Step 5: Add Slot 12 handler in server.js**

In the `ws.onButtonPress` handler, after the slot 11 block:

```js
  // Slot 12: cycle subagents within current root
  if (slot === 12) {
    const agent = sm.cycleAgent();
    const focus = sm.focusSessionId ? sm.get(sm.focusSessionId) : null;
    if (focus) {
      const layout = ButtonManager.layoutFor(focus, sm.focusAgentId, sm.getAgentCount(focus.id));
      broadcastLayout({ ...layout, focusSwitched: true });
    }
    return;
  }
```

- [ ] **Step 6: Run tests**

Run: `node --test test/e2e.subagent.test.js test/sessionManager.test.js test/buttonManager.test.js`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add bridge/server.js bridge/buttonManager.js test/e2e.subagent.test.js
git commit -m "feat: subagent endpoints, slot 12 handler, agent info in LAYOUT"
```

---

### Task 5: Frontend — Slot 12 key & tree-view sessions

**Files:**
- Modify: `public/js/d200-renderer.js`
- Modify: `public/js/dashboard.js`
- Modify: `public/js/app.js`
- Modify: `public/css/style.css`

- [ ] **Step 1: Update d200-renderer.js — replace reserved key with agent-switch**

Replace `_makeReservedKey` function:

```js
function _makeAgentKey() {
  const k = document.createElement('div');
  k.className = 'k agent-switch';
  k.dataset.slot = '12';
  k.innerHTML = `<span class="agent-ico">◈</span><span class="agent-n" id="agentN">ROOT</span>`;
  k.addEventListener('click', () => {
    _firePress(12, k);
  });
  return k;
}
```

In `initGrid`, replace `r2.appendChild(_makeReservedKey())` with `r2.appendChild(_makeAgentKey())`.

Add new function to update agent key display:

```js
/** Update the agent switch key (slot 12) */
function _updateAgentKey(agent, agentCount) {
  const nameEl = document.getElementById('agentN');
  if (nameEl) nameEl.textContent = agent ? agent.type : 'ROOT';
  const k = _getK(12);
  if (!k) return;
  // Update badge
  k.querySelector('.agent-badge')?.remove();
  if (agentCount > 0) {
    const b = document.createElement('div');
    b.className = 'agent-badge';
    b.textContent = agentCount;
    k.appendChild(b);
  }
}
```

Export `_updateAgentKey` as `updateAgentKey`.

- [ ] **Step 2: Update renderLayout to pass agent info to agent key**

In `renderLayout`, after the session count/name update block:

```js
  // Update agent switch key (slot 12)
  if (msg.agent !== undefined) {
    _updateAgentKey(msg.agent, msg.agentCount || 0);
  }
```

- [ ] **Step 3: Update dashboard.js — tree-view session rendering**

Modify `updateSession` to accept and store agent info:

```js
export function updateSession(msg) {
  const s = msg.session;
  if (!s || !s.id) return;

  const existing = _sessions.get(s.id);
  const isWaiting = s.state === 'WAITING_BINARY' || s.state === 'WAITING_CHOICE';
  const wasWaiting = existing && (existing.state === 'WAITING_BINARY' || existing.state === 'WAITING_CHOICE');

  _sessions.set(s.id, {
    id: s.id,
    name: s.name || s.id.slice(0, 8),
    state: s.state,
    waitingSince: isWaiting ? (wasWaiting ? existing.waitingSince : Date.now()) : null,
    agents: existing?.agents || [],
  });

  // Update agent list if provided
  if (msg.agent !== undefined || msg.agentCount !== undefined) {
    const sess = _sessions.get(s.id);
    // Agent info comes one at a time via LAYOUT; track by agentId
    if (msg.agent) {
      const existing = sess.agents.find(a => a.agentId === msg.agent.agentId);
      if (existing) {
        existing.state = msg.agent.state;
        existing.type = msg.agent.type;
      } else {
        sess.agents.push({ ...msg.agent });
      }
    }
  }

  _renderSessions();
  _ensureDurTimer();
}
```

Modify `_renderSessions` to render tree:

```js
function _renderSessions() {
  const list = document.getElementById('sessList');
  const empty = document.getElementById('sessEmpty');
  if (!list) return;

  list.innerHTML = '';
  const entries = Array.from(_sessions.values());

  if (empty) empty.classList.toggle('hide', entries.length > 0);
  _syncLogTabLabels();

  for (const s of entries) {
    // Root row
    const row = document.createElement('div');
    row.className = 'sess-row';
    row.dataset.sid = s.id;

    const dur = s.waitingSince ? _fmtDur(Date.now() - s.waitingSince) : '';

    row.innerHTML =
      `<span class="sess-dot ${esc(s.state)}"></span>` +
      `<span class="sess-name">${esc(s.name)}</span>` +
      `<span class="sess-state">${STATE_LABELS[s.state] || s.state}</span>` +
      `<span class="sess-dur">${dur}</span>`;

    list.appendChild(row);

    // Child agent rows
    if (s.agents && s.agents.length > 0) {
      for (const a of s.agents) {
        const child = document.createElement('div');
        child.className = 'sess-row sess-child';
        child.dataset.sid = s.id;
        child.dataset.aid = a.agentId;

        child.innerHTML =
          `<span class="sess-dot ${esc(a.state || 'PROCESSING')}"></span>` +
          `<span class="sess-name">${esc(a.type || 'agent')}</span>` +
          `<span class="sess-state">${STATE_LABELS[a.state] || a.state || 'processing'}</span>`;

        list.appendChild(child);
      }
    }
  }

  _updateSessionBadge();
}
```

- [ ] **Step 4: Update app.js — slot 12 focusSwitched handling**

The existing `msg.focusSwitched` check already handles this — slot 12 LAYOUT includes `focusSwitched: true` and `session.id`, so `switchLogSession` will fire. No change needed in app.js for basic sync.

- [ ] **Step 5: Add CSS for agent-switch key and child rows**

In `public/css/style.css`:

```css
/* ── AGENT SWITCH KEY (slot 12) ── */
.k.agent-switch { border-color: var(--purple); background: var(--pdim); cursor: pointer; }
.k.agent-switch:active { transform: scale(.93); }
.k.agent-switch .agent-ico { font-size: 24px; line-height: 1; color: var(--purple); }
.k.agent-switch .agent-n {
  font-size: 11px; color: var(--purple); margin-top: 3px;
  max-width: 90%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.agent-badge {
  position: absolute; top: 3px; right: 3px;
  background: var(--purple); color: var(--bg);
  font-size: 7px; font-weight: 700;
  width: 12px; height: 12px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}

/* ── SESSION CHILD ROWS ── */
.sess-child { padding-left: 30px; }
.sess-child .sess-name { color: var(--muted); font-weight: 400; }
.sess-child .sess-name::before { content: '└ '; color: var(--bd2); }
```

Remove the `.k.reserved` CSS block (replaced by `.k.agent-switch`).

- [ ] **Step 6: Run full test suite**

Run: `node --test test/*.test.js`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add public/js/d200-renderer.js public/js/dashboard.js public/js/app.js public/css/style.css
git commit -m "feat: slot 12 agent-switch key, tree-view sessions, child row styling"
```

---

### Task 6: Integration test & final verification

**Files:**
- All modified files

- [ ] **Step 1: Run full test suite**

Run: `node --test test/*.test.js`
Expected: All pass (previous 64 + ~14 new = ~78)

- [ ] **Step 2: Manual smoke test**

```bash
# Terminal 1: start bridge
./scripts/start-bridge.sh

# Terminal 2: open browser
# http://localhost:39200
# Verify:
# - Slot 12 shows "ROOT" with purple border (not RSVD)
# - Sessions tab renders normally
# - Event log tabs work
```

- [ ] **Step 3: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: integration fixes for subagent tracking"
```

- [ ] **Step 4: Push**

```bash
git push
```
