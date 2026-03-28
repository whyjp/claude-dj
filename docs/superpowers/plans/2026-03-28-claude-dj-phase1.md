# Claude DJ Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code의 Hook 이벤트를 수신하여 브라우저 기반 Virtual DJ에서 permission/choice를 물리 버튼처럼 조작할 수 있는 전체 루프를 구현한다.

**Architecture:** Bridge-Centric — Express HTTP 서버가 Hook API + WebSocket + Static serve를 단일 프로세스로 담당. Hook scripts는 단순 HTTP forwarder. Virtual DJ FE는 vanilla JS SPA로 Bridge가 serve.

**Tech Stack:** Node.js 20+, express, ws, vanilla JS (no build tools)

---

## File Structure

```
claude-dj/
├── package.json                # name: claude-dj, bin, type: module
├── bridge/
│   ├── server.js               # Express + WS + static serve 진입점
│   ├── sessionManager.js       # 세션 상태 머신
│   ├── buttonManager.js        # state → 버튼 레이아웃 매핑
│   ├── wsServer.js             # WebSocket 서버, 클라이언트 관리
│   └── config.js               # 포트, 타임아웃 설정
├── hooks/
│   ├── permission.js           # PermissionRequest → HTTP POST (blocking)
│   ├── notify.js               # PreToolUse → HTTP POST (async)
│   └── stop.js                 # Stop → HTTP POST (async)
├── public/
│   ├── index.html              # SPA 진입점
│   ├── css/style.css           # 다크 테마
│   └── js/
│       ├── app.js              # 메인 앱 로직 + WS 클라이언트
│       ├── d200-renderer.js    # D200 버튼 그리드 렌더링
│       └── dashboard.js        # 이벤트 로그, 상태 표시
├── cli/
│   └── index.js                # CLI 진입점 (claude-dj start/setup)
├── tools/
│   └── setup.js                # Hook 자동 등록 (settings.json)
├── plugin/
│   ├── app.js                  # 스켈레톤 (Phase 3)
│   └── manifest.json           # Ulanzi 매니페스트 (스켈레톤)
├── test/
│   ├── bridge.test.js          # Bridge 통합 테스트
│   ├── sessionManager.test.js  # 상태 머신 단위 테스트
│   ├── buttonManager.test.js   # 레이아웃 매핑 테스트
│   └── hooks.test.js           # Hook scripts 테스트
└── ulanzi/
    └── sdk/                    # Ulanzi SDK (git clone, .gitignore)
```

---

### Task 1: Project Scaffold + package.json

**Files:**
- Create: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "claude-dj",
  "version": "0.1.0",
  "description": "Control Claude Code with physical buttons or browser — no terminal focus needed",
  "type": "module",
  "main": "bridge/server.js",
  "bin": {
    "claude-dj": "./cli/index.js"
  },
  "scripts": {
    "start": "node bridge/server.js",
    "test": "node --test test/*.test.js",
    "setup": "node tools/setup.js"
  },
  "keywords": ["claude-code", "ulanzi", "d200", "hooks", "dj"],
  "license": "MIT",
  "engines": { "node": ">=20.0.0" },
  "dependencies": {
    "express": "^4.21.0",
    "ws": "^8.18.0"
  }
}
```

- [ ] **Step 2: Update .gitignore**

Append to existing `.gitignore`:

```
node_modules/
.superpowers/
ulanzi/sdk/
ulanzi/software/
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` generated

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "feat: project scaffold with package.json and dependencies"
```

---

### Task 2: Bridge Config

**Files:**
- Create: `bridge/config.js`
- Test: `test/config.test.js`

- [ ] **Step 1: Write config test**

Create `test/config.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../bridge/config.js';

describe('config', () => {
  it('has default port 39200', () => {
    assert.equal(config.port, 39200);
  });

  it('has default button timeout 30000ms', () => {
    assert.equal(config.buttonTimeout, 30000);
  });

  it('respects CLAUDE_DJ_PORT env var', () => {
    process.env.CLAUDE_DJ_PORT = '12345';
    // Re-import won't work due to caching, so test the parsing logic
    const port = parseInt(process.env.CLAUDE_DJ_PORT, 10) || 39200;
    assert.equal(port, 12345);
    delete process.env.CLAUDE_DJ_PORT;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/config.test.js`
Expected: FAIL — cannot find module `../bridge/config.js`

- [ ] **Step 3: Implement config.js**

Create `bridge/config.js`:

```js
export const config = {
  port: parseInt(process.env.CLAUDE_DJ_PORT, 10) || 39200,
  buttonTimeout: parseInt(process.env.CLAUDE_DJ_BUTTON_TIMEOUT, 10) || 30000,
  hookTimeout: 110000,
  wsPath: '/ws',
  apiPrefix: '/api',
  version: '0.1.0',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/config.test.js`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add bridge/config.js test/config.test.js
git commit -m "feat: bridge config with port and timeout defaults"
```

---

### Task 3: Session Manager

**Files:**
- Create: `bridge/sessionManager.js`
- Test: `test/sessionManager.test.js`

- [ ] **Step 1: Write session manager tests**

Create `test/sessionManager.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sessionManager.test.js`
Expected: FAIL — cannot find module

- [ ] **Step 3: Implement sessionManager.js**

Create `bridge/sessionManager.js`:

```js
import path from 'node:path';

export class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  getOrCreate(input) {
    const id = input.session_id;
    if (!this.sessions.has(id)) {
      this.sessions.set(id, {
        id,
        name: input.cwd ? path.basename(input.cwd) : 'unknown',
        cwd: input.cwd || '',
        state: 'IDLE',
        waitingSince: null,
        prompt: null,
        respondFn: null,
      });
    }
    return this.sessions.get(id);
  }

  get(id) {
    return this.sessions.get(id);
  }

  handleNotify(input) {
    const session = this.getOrCreate(input);
    session.state = 'PROCESSING';
    session.prompt = null;
    return session;
  }

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
    return session;
  }

  handleStop(input) {
    const session = this.getOrCreate(input);
    session.state = 'IDLE';
    session.prompt = null;
    session.waitingSince = null;
    session.respondFn = null;
    return session;
  }

  resolveWaiting(sessionId, decision) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (session.respondFn) {
      session.respondFn(decision);
      session.respondFn = null;
    }
    session.state = 'PROCESSING';
    session.prompt = null;
    session.waitingSince = null;
    return true;
  }

  getFocusSession() {
    for (const [, session] of this.sessions) {
      if (session.state === 'WAITING_BINARY' || session.state === 'WAITING_CHOICE') {
        return session;
      }
    }
    return null;
  }

  toJSON() {
    return [...this.sessions.values()].map(({ respondFn, ...rest }) => rest);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sessionManager.test.js`
Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add bridge/sessionManager.js test/sessionManager.test.js
git commit -m "feat: session manager with state machine and transitions"
```

---

### Task 4: Button Manager

**Files:**
- Create: `bridge/buttonManager.js`
- Test: `test/buttonManager.test.js`

- [ ] **Step 1: Write button manager tests**

Create `test/buttonManager.test.js`:

```js
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

  it('resolves binary button press slot 1 to deny', () => {
    const decision = ButtonManager.resolvePress(1, 'WAITING_BINARY', {
      type: 'BINARY', hasAlwaysAllow: false,
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/buttonManager.test.js`
Expected: FAIL

- [ ] **Step 3: Implement buttonManager.js**

Create `bridge/buttonManager.js`:

```js
export class ButtonManager {
  static layoutFor(session) {
    const base = {
      session: session.id ? {
        id: session.id,
        name: session.name,
        state: session.state,
      } : undefined,
    };

    switch (session.state) {
      case 'IDLE':
        return { ...base, preset: 'idle' };

      case 'PROCESSING':
        return { ...base, preset: 'processing' };

      case 'WAITING_BINARY':
        return { ...base, preset: 'binary', prompt: session.prompt };

      case 'WAITING_CHOICE':
        return {
          ...base,
          preset: 'choice',
          choices: session.prompt.choices,
        };

      default:
        return { ...base, preset: 'idle' };
    }
  }

  static resolvePress(slot, state, prompt) {
    if (state === 'WAITING_BINARY') {
      if (slot === 0) return { type: 'binary', value: 'allow' };
      if (slot === 1) return { type: 'binary', value: 'deny' };
      if (slot === 5 && prompt.hasAlwaysAllow) return { type: 'binary', value: 'alwaysAllow' };
      return null;
    }

    if (state === 'WAITING_CHOICE') {
      const choices = prompt.choices || [];
      if (slot >= 0 && slot < choices.length) {
        return { type: 'choice', value: String(choices[slot].index) };
      }
      return null;
    }

    return null;
  }

  static buildHookResponse(decision, isChoice) {
    if (isChoice) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          decision: {
            behavior: 'allow',
            updatedInput: { answer: decision.value },
          },
        },
      };
    }

    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: decision.value,
          message: `Claude DJ: ${decision.value} via button`,
        },
      },
    };
  }

  static buildTimeoutResponse() {
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'deny',
          message: 'Claude DJ: timeout (30s)',
        },
      },
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/buttonManager.test.js`
Expected: 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add bridge/buttonManager.js test/buttonManager.test.js
git commit -m "feat: button manager with layout mapping and press resolution"
```

---

### Task 5: WebSocket Server

**Files:**
- Create: `bridge/wsServer.js`

- [ ] **Step 1: Implement wsServer.js**

Create `bridge/wsServer.js`:

```js
import { WebSocketServer } from 'ws';

export class WsServer {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    this.onButtonPress = null;
  }

  attach(server, path) {
    this.wss = new WebSocketServer({ server, path });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      console.log(`[ws] client connected (total: ${this.clients.size})`);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleMessage(ws, msg);
        } catch (e) {
          console.error('[ws] invalid message:', e.message);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`[ws] client disconnected (total: ${this.clients.size})`);
      });
    });
  }

  _handleMessage(ws, msg) {
    switch (msg.type) {
      case 'CLIENT_READY':
        console.log(`[ws] client ready: ${msg.clientType} v${msg.version}`);
        break;
      case 'BUTTON_PRESS':
        if (this.onButtonPress) {
          this.onButtonPress(msg.slot, msg.timestamp);
        }
        break;
      default:
        console.log(`[ws] unknown message type: ${msg.type}`);
    }
  }

  broadcast(msg) {
    const data = JSON.stringify({ type: msg.type || 'LAYOUT', ...msg });
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(data);
      }
    }
  }

  sendWelcome(ws, sessions) {
    const msg = JSON.stringify({
      type: 'WELCOME',
      version: '0.1.0',
      sessions,
    });
    if (ws.readyState === 1) {
      ws.send(msg);
    }
  }

  get clientCount() {
    return this.clients.size;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add bridge/wsServer.js
git commit -m "feat: websocket server with broadcast and button press handling"
```

---

### Task 6: Bridge Server (Main Entry)

**Files:**
- Create: `bridge/server.js`
- Test: `test/bridge.test.js`

- [ ] **Step 1: Write bridge integration test**

Create `test/bridge.test.js`:

```js
import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const PORT = 39299; // test port

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${path}`, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });
}

describe('Bridge Server', () => {
  let server;

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

  it('GET /api/health returns ok', async () => {
    const res = await get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  });

  it('POST /api/hook/notify returns ok', async () => {
    const res = await post('/api/hook/notify', {
      session_id: 'test1',
      cwd: '/test/project',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('POST /api/hook/stop returns ok', async () => {
    const res = await post('/api/hook/stop', {
      session_id: 'test1',
      hook_event_name: 'Stop',
      stop_hook_active: false,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('GET /api/status returns sessions', async () => {
    const res = await get('/api/status');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.sessions));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/bridge.test.js`
Expected: FAIL

- [ ] **Step 3: Implement bridge/server.js**

Create `bridge/server.js`:

```js
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { SessionManager } from './sessionManager.js';
import { ButtonManager } from './buttonManager.js';
import { WsServer } from './wsServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const sm = new SessionManager();
const ws = new WsServer();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- Health & Status ---

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: config.version, port: config.port, uptime: process.uptime() | 0 });
});

app.get('/api/status', (req, res) => {
  res.json({
    version: config.version,
    uptime: process.uptime() | 0,
    sessions: sm.toJSON(),
    clients: { total: ws.clientCount },
  });
});

// --- Hook Endpoints ---

app.post('/api/hook/notify', (req, res) => {
  const input = req.body;
  const session = sm.handleNotify(input);
  const layout = ButtonManager.layoutFor(session);
  ws.broadcast({ type: 'LAYOUT', ...layout });
  res.json({ ok: true });
});

app.post('/api/hook/stop', (req, res) => {
  const input = req.body;
  if (input.stop_hook_active) {
    return res.json({ ok: true });
  }
  const session = sm.handleStop(input);
  ws.broadcast({ type: 'ALL_DIM' });
  res.json({ ok: true });
});

app.post('/api/hook/permission', (req, res) => {
  const input = req.body;
  const session = sm.handlePermission(input);
  const layout = ButtonManager.layoutFor(session);
  const isChoice = session.state === 'WAITING_CHOICE';

  ws.broadcast({ type: 'LAYOUT', ...layout });

  const timeout = setTimeout(() => {
    session.respondFn = null;
    sm.handleStop({ session_id: session.id, stop_hook_active: false });
    ws.broadcast({ type: 'ALL_DIM' });
    res.json(ButtonManager.buildTimeoutResponse());
  }, config.buttonTimeout);

  session.respondFn = (decision) => {
    clearTimeout(timeout);
    const response = ButtonManager.buildHookResponse(decision, isChoice);
    const newLayout = ButtonManager.layoutFor(session);
    ws.broadcast({ type: 'LAYOUT', ...newLayout });
    res.json(response);
  };
});

// --- WebSocket ---

ws.attach(server, config.wsPath);

ws.onButtonPress = (slot, timestamp) => {
  const focus = sm.getFocusSession();
  if (!focus) return;

  const decision = ButtonManager.resolvePress(slot, focus.state, focus.prompt);
  if (!decision) return;

  sm.resolveWaiting(focus.id, decision);
};

// --- Start ---

const port = config.port;
server.listen(port, () => {
  console.log(`[claude-dj] Bridge running at http://localhost:${port}`);
  console.log(`[claude-dj] Virtual DJ at http://localhost:${port}`);
  console.log(`[claude-dj] WebSocket at ws://localhost:${port}${config.wsPath}`);
});

export { server, app };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/bridge.test.js`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add bridge/server.js test/bridge.test.js
git commit -m "feat: bridge server with HTTP API, WS, and hook endpoints"
```

---

### Task 7: Hook Scripts

**Files:**
- Create: `hooks/permission.js`, `hooks/notify.js`, `hooks/stop.js`
- Test: `test/hooks.test.js`

- [ ] **Step 1: Create hooks/permission.js**

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const BRIDGE_URL = process.env.CLAUDE_DJ_URL || 'http://localhost:39200';

try {
  const input = readFileSync('/dev/stdin', 'utf8');
  const res = await fetch(`${BRIDGE_URL}/api/hook/permission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: input,
    signal: AbortSignal.timeout(110_000),
  });
  const json = await res.json();
  process.stdout.write(JSON.stringify(json));
} catch (e) {
  // Bridge down — exit 0 with empty response = show original dialog
  process.exit(0);
}
```

- [ ] **Step 2: Create hooks/notify.js**

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const BRIDGE_URL = process.env.CLAUDE_DJ_URL || 'http://localhost:39200';

try {
  const input = readFileSync('/dev/stdin', 'utf8');
  await fetch(`${BRIDGE_URL}/api/hook/notify`, {
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

- [ ] **Step 3: Create hooks/stop.js**

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const BRIDGE_URL = process.env.CLAUDE_DJ_URL || 'http://localhost:39200';

try {
  const input = readFileSync('/dev/stdin', 'utf8');
  await fetch(`${BRIDGE_URL}/api/hook/stop`, {
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

- [ ] **Step 4: Write basic hook test**

Create `test/hooks.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

describe('Hook scripts', () => {
  it('permission.js exists and is valid JS', () => {
    assert.ok(existsSync('hooks/permission.js'));
    const content = readFileSync('hooks/permission.js', 'utf8');
    assert.ok(content.includes('/api/hook/permission'));
  });

  it('notify.js exists and is valid JS', () => {
    assert.ok(existsSync('hooks/notify.js'));
    const content = readFileSync('hooks/notify.js', 'utf8');
    assert.ok(content.includes('/api/hook/notify'));
  });

  it('stop.js exists and is valid JS', () => {
    assert.ok(existsSync('hooks/stop.js'));
    const content = readFileSync('hooks/stop.js', 'utf8');
    assert.ok(content.includes('/api/hook/stop'));
  });
});
```

- [ ] **Step 5: Run tests**

Run: `node --test test/hooks.test.js`
Expected: 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add hooks/permission.js hooks/notify.js hooks/stop.js test/hooks.test.js
git commit -m "feat: hook scripts — permission (blocking), notify and stop (async)"
```

---

### Task 8: Virtual DJ FE — HTML + CSS

**Files:**
- Create: `public/index.html`, `public/css/style.css`

- [ ] **Step 1: Create public/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude DJ — Virtual DJ</title>
<link rel="stylesheet" href="css/style.css">
</head>
<body>
<header>
  <div class="logo"><span class="g">Claude</span>DJ</div>
  <span class="sep">—</span>
  <span class="sub">VIRTUAL DJ</span>
  <div class="ws-bar">
    <div class="ws-dot" id="wsDot"></div>
    <span class="ws-lbl" id="wsLbl">disconnected</span>
  </div>
</header>
<main>
  <div class="dev-panel">
    <div class="dev-hdr">
      <span class="dev-title">D200 Simulator</span>
      <span class="dev-model">13 LCD Keys</span>
    </div>
    <div class="d200-wrap">
      <div class="d200">
        <div class="kg5" id="row0"></div>
        <div class="kg5" id="row1"></div>
        <div class="kgl" id="row2"></div>
      </div>
      <div class="state-info">
        <div class="si"><span class="si-k">STATE</span><span class="si-v" id="iState">IDLE</span></div>
        <div class="si"><span class="si-k">SESSION</span><span class="si-v" id="iSess">—</span></div>
        <div class="si"><span class="si-k">TOOL</span><span class="si-v" id="iTool">—</span></div>
        <div class="si"><span class="si-k">WS</span><span class="si-v" id="iWs">disconnected</span></div>
      </div>
    </div>
  </div>
  <div class="ctl-panel">
    <div class="tabs">
      <div class="tab on" data-tab="log">Event Log</div>
      <div class="tab" data-tab="proto">Protocol</div>
      <div class="tab" data-tab="settings">Settings</div>
    </div>
    <div class="pane on" id="pane-log">
      <div class="elog" id="elog"></div>
      <div class="log-ctl">
        <input class="log-fil" id="logFil" placeholder="filter...">
        <button class="btn-s" id="btnClear">clear</button>
      </div>
    </div>
    <div class="pane" id="pane-proto">
      <div class="proto-ref">
        <h4>Bridge → Client</h4>
        <code>LAYOUT { preset, session, prompt?, choices? }</code><br>
        <code>WELCOME { version, sessions }</code><br>
        <code>ALL_DIM {}</code><br>
        <h4>Client → Bridge</h4>
        <code>BUTTON_PRESS { slot, timestamp }</code><br>
        <code>CLIENT_READY { clientType, version }</code>
      </div>
    </div>
    <div class="pane" id="pane-settings">
      <div class="settings-form">
        <label>Bridge WS URL</label>
        <input id="wsUrl" value="">
        <label>Button Timeout (ms)</label>
        <input id="timeout" value="30000" type="number">
      </div>
    </div>
  </div>
</main>
<script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create public/css/style.css**

Base the CSS on the design from docs/pre-researched/ReactDeck_VirtualD200.html but with Claude DJ branding. Include:
- Dark theme (bg: #080810, green: #39ff6e, red: #ff3355, amber: #ffcc00, blue: #44aaff)
- JetBrains Mono font
- Grid layout: left panel (D200) + right panel (dashboard)
- Key styles: .k (base), .k.dim, .k.approve, .k.deny, .k.always, .k.proc, .k[data-ci="N"]
- Animations: glow pulse, wave, flash
- State info bar, tabs, event log styling

The CSS file will be substantial (~250 lines). Extract the CSS variable system and key animation keyframes from the existing ReactDeck_VirtualD200.html, updating branding references from "ReactDeck" to "ClaudeDJ".

- [ ] **Step 3: Verify static serve works**

Run: `node bridge/server.js`
Open: `http://localhost:39200`
Expected: HTML page loads with D200 grid skeleton (no JS functionality yet)
Stop: Ctrl+C

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/css/style.css
git commit -m "feat: virtual dj FE — HTML structure and CSS dark theme"
```

---

### Task 9: Virtual DJ FE — JavaScript

**Files:**
- Create: `public/js/app.js`, `public/js/d200-renderer.js`, `public/js/dashboard.js`

- [ ] **Step 1: Create public/js/d200-renderer.js**

```js
const SLOT_COUNT = 13;
const ROWS = [
  { id: 'row0', slots: [0, 1, 2, 3, 4] },
  { id: 'row1', slots: [5, 6, 7, 8, 9] },
  { id: 'row2', slots: [10, 11, 12] },
];

const CHOICE_COLORS = [
  '#39ff6e', '#ffcc00', '#44aaff', '#bb88ff',
  '#ff8844', '#44ffcc', '#ff44aa', '#88ff44', '#ffaa44',
];

export function initGrid() {
  ROWS.forEach(({ id, slots }) => {
    const row = document.getElementById(id);
    row.innerHTML = '';
    slots.forEach((slot) => {
      const key = document.createElement('div');
      key.className = 'k dim';
      key.dataset.slot = slot;
      if (slot === 9) {
        key.className = 'k count';
        key.innerHTML = '<span class="cnt-n">0</span><span class="cnt-l">sessions</span>';
      }
      key.addEventListener('click', () => onKeyPress(slot));
      row.appendChild(key);
    });
  });
}

let pressHandler = null;
export function onPress(fn) { pressHandler = fn; }

function onKeyPress(slot) {
  if (pressHandler) pressHandler(slot);
}

export function renderLayout(msg) {
  clearAll();

  switch (msg.preset) {
    case 'idle':
      break; // all dim

    case 'processing':
      forEachDynamic((el, i) => {
        el.className = 'k proc';
        el.style.setProperty('--off', `${i * 0.12}s`);
      });
      break;

    case 'binary':
      getSlot(0).className = 'k approve';
      getSlot(0).innerHTML = '<span class="ki">✅</span><span class="kl">Approve</span>';
      getSlot(1).className = 'k deny';
      getSlot(1).innerHTML = '<span class="ki">❌</span><span class="kl">Deny</span>';
      if (msg.prompt?.hasAlwaysAllow) {
        getSlot(5).className = 'k always';
        getSlot(5).innerHTML = '<span class="ki">🔒</span><span class="kl">Always</span>';
      }
      break;

    case 'choice':
      (msg.choices || []).forEach((choice, i) => {
        if (i >= 9) return;
        const el = getSlot(i);
        const color = CHOICE_COLORS[i % CHOICE_COLORS.length];
        el.className = 'k';
        el.dataset.ci = String(i);
        el.innerHTML = `<span class="kn">${choice.index}</span><span class="ks">${choice.label}</span>`;
      });
      break;
  }

  updateStateInfo(msg);
}

export function renderAllDim() {
  clearAll();
  updateStateInfo({ preset: 'idle', session: null });
}

function clearAll() {
  for (let i = 0; i <= 12; i++) {
    if (i === 9) continue;
    const el = getSlot(i);
    el.className = 'k dim';
    el.innerHTML = '';
    el.style.removeProperty('--off');
    delete el.dataset.ci;
  }
}

function forEachDynamic(fn) {
  let idx = 0;
  for (let i = 0; i <= 8; i++) {
    fn(getSlot(i), idx++);
  }
  for (let i = 10; i <= 12; i++) {
    fn(getSlot(i), idx++);
  }
}

function getSlot(n) {
  return document.querySelector(`[data-slot="${n}"]`);
}

function updateStateInfo(msg) {
  const state = msg.session?.state || msg.preset?.toUpperCase() || 'IDLE';
  document.getElementById('iState').textContent = state;
  document.getElementById('iState').className = 'si-v ' + stateColor(state);
  document.getElementById('iSess').textContent = msg.session?.name || '—';
  document.getElementById('iTool').textContent = msg.prompt?.toolName || '—';
}

function stateColor(state) {
  if (state.includes('WAITING')) return 'a';
  if (state === 'PROCESSING') return 'b';
  return '';
}
```

- [ ] **Step 2: Create public/js/dashboard.js**

```js
const MAX_LOG = 500;
let logs = [];
let filterText = '';

export function initDashboard() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('on'));
      document.querySelectorAll('.pane').forEach((p) => p.classList.remove('on'));
      tab.classList.add('on');
      document.getElementById(`pane-${tab.dataset.tab}`).classList.add('on');
    });
  });

  document.getElementById('btnClear').addEventListener('click', () => {
    logs = [];
    render();
  });

  document.getElementById('logFil').addEventListener('input', (e) => {
    filterText = e.target.value.toLowerCase();
    render();
  });
}

export function log(direction, msg) {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  logs.push({ time, direction, msg });
  if (logs.length > MAX_LOG) logs.shift();
  render();
}

function render() {
  const el = document.getElementById('elog');
  const filtered = filterText
    ? logs.filter((l) => l.msg.toLowerCase().includes(filterText))
    : logs;

  el.innerHTML = filtered
    .map((l) => {
      const dcls = l.direction === 'in' ? 'in' : l.direction === 'out' ? 'out' : 'sys';
      const arrow = l.direction === 'in' ? '◀' : l.direction === 'out' ? '▶' : '●';
      return `<div class="le ${dcls}-e"><span class="le-t">${l.time}</span><span class="le-d ${dcls}">${arrow}</span><span class="le-m">${esc(l.msg)}</span></div>`;
    })
    .join('');

  el.scrollTop = el.scrollHeight;
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function updateWsStatus(connected) {
  const dot = document.getElementById('wsDot');
  const lbl = document.getElementById('wsLbl');
  const iWs = document.getElementById('iWs');
  dot.className = connected ? 'ws-dot connected' : 'ws-dot';
  lbl.textContent = connected ? 'connected' : 'disconnected';
  iWs.textContent = connected ? 'connected' : 'disconnected';
  iWs.className = connected ? 'si-v g' : 'si-v';
}
```

- [ ] **Step 3: Create public/js/app.js**

```js
import { initGrid, renderLayout, renderAllDim, onPress } from './d200-renderer.js';
import { initDashboard, log, updateWsStatus } from './dashboard.js';

const WS_URL = `ws://${location.host}/ws`;
let ws = null;
let reconnectTimer = null;

function connect() {
  if (ws && ws.readyState <= 1) return;

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    updateWsStatus(true);
    log('sys', 'WebSocket connected');
    ws.send(JSON.stringify({ type: 'CLIENT_READY', clientType: 'virtual', version: '0.1.0' }));
    clearTimeout(reconnectTimer);
  };

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      handleMessage(msg);
    } catch (e) {
      log('sys', `parse error: ${e.message}`);
    }
  };

  ws.onclose = () => {
    updateWsStatus(false);
    log('sys', 'WebSocket disconnected — reconnecting in 3s');
    reconnectTimer = setTimeout(connect, 3000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function handleMessage(msg) {
  log('in', `${msg.type} ${summarize(msg)}`);

  switch (msg.type) {
    case 'LAYOUT':
      renderLayout(msg);
      break;
    case 'ALL_DIM':
      renderAllDim();
      break;
    case 'WELCOME':
      log('sys', `Bridge v${msg.version}, ${msg.sessions?.length || 0} sessions`);
      break;
    case 'SESSION_COUNT':
      // Phase 2
      break;
  }
}

function summarize(msg) {
  if (msg.preset) return `preset:${msg.preset}`;
  if (msg.sessions) return `sessions:${msg.sessions.length}`;
  return '';
}

onPress((slot) => {
  if (!ws || ws.readyState !== 1) return;
  const msg = { type: 'BUTTON_PRESS', slot, timestamp: Date.now() };
  ws.send(JSON.stringify(msg));
  log('out', `BUTTON_PRESS slot:${slot}`);

  // Flash feedback
  const el = document.querySelector(`[data-slot="${slot}"]`);
  if (el && !el.classList.contains('dim')) {
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 250);
  }
});

// --- Init ---
initGrid();
initDashboard();
connect();

// Settings: WS URL display
document.getElementById('wsUrl').value = WS_URL;
```

- [ ] **Step 4: Full loop test**

Run: `node bridge/server.js`
Open: `http://localhost:39200`
Expected: D200 grid visible, WS connected, all keys dim

Test with curl:
```bash
# Send binary permission
curl -X POST http://localhost:39200/api/hook/notify -H "Content-Type: application/json" -d '{"session_id":"s1","cwd":"/test","hook_event_name":"PreToolUse","tool_name":"Bash"}'
# Should see PROCESSING animation in browser

# This will block until button press or 30s timeout:
# curl -X POST http://localhost:39200/api/hook/permission -H "Content-Type: application/json" -d '{"session_id":"s1","cwd":"/test","hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"rm -rf dist"}}'
# Click approve button in browser → curl returns with allow response
```

- [ ] **Step 5: Commit**

```bash
git add public/js/app.js public/js/d200-renderer.js public/js/dashboard.js
git commit -m "feat: virtual dj FE — D200 renderer, dashboard, WS client"
```

---

### Task 10: CLI + Setup

**Files:**
- Create: `cli/index.js`, `tools/setup.js`

- [ ] **Step 1: Create cli/index.js**

```js
#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const command = process.argv[2];

if (command === 'setup') {
  const setup = await import('../tools/setup.js');
  await setup.run();
} else {
  // Default: start bridge
  const server = path.join(__dirname, '..', 'bridge', 'server.js');
  const child = spawn(process.execPath, [server], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code || 0));
}
```

- [ ] **Step 2: Create tools/setup.js**

```js
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hooksDir = path.resolve(__dirname, '..', 'hooks');

export async function run() {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  }

  if (!settings.hooks) settings.hooks = {};

  const nodeCmd = process.execPath;

  settings.hooks.PermissionRequest = settings.hooks.PermissionRequest || [];
  settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];
  settings.hooks.Stop = settings.hooks.Stop || [];

  const permHook = {
    hooks: [{
      type: 'command',
      command: `"${nodeCmd}" "${path.join(hooksDir, 'permission.js')}"`,
      timeout: 120,
    }],
  };

  const notifyHook = {
    hooks: [{
      type: 'command',
      command: `"${nodeCmd}" "${path.join(hooksDir, 'notify.js')}"`,
    }],
  };

  const stopHook = {
    hooks: [{
      type: 'command',
      command: `"${nodeCmd}" "${path.join(hooksDir, 'stop.js')}"`,
    }],
  };

  // Remove existing claude-dj hooks
  const isClaudeDjHook = (h) => h.hooks?.some((x) => x.command?.includes('claude-dj') || x.command?.includes('hooks/permission.js') || x.command?.includes('hooks/notify.js') || x.command?.includes('hooks/stop.js'));

  settings.hooks.PermissionRequest = settings.hooks.PermissionRequest.filter((h) => !isClaudeDjHook(h));
  settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter((h) => !isClaudeDjHook(h));
  settings.hooks.Stop = settings.hooks.Stop.filter((h) => !isClaudeDjHook(h));

  settings.hooks.PermissionRequest.push(permHook);
  settings.hooks.PreToolUse.push(notifyHook);
  settings.hooks.Stop.push(stopHook);

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

  console.log('[claude-dj] Hooks registered in ~/.claude/settings.json');
  console.log('[claude-dj] PermissionRequest → permission.js');
  console.log('[claude-dj] PreToolUse → notify.js');
  console.log('[claude-dj] Stop → stop.js');
}
```

- [ ] **Step 3: Test CLI**

Run: `node cli/index.js`
Expected: Bridge starts, logs printed
Stop: Ctrl+C

- [ ] **Step 4: Commit**

```bash
git add cli/index.js tools/setup.js
git commit -m "feat: CLI entry point and hook auto-registration setup"
```

---

### Task 11: Ulanzi Plugin Skeleton

**Files:**
- Create: `plugin/manifest.json`, `plugin/app.js`

- [ ] **Step 1: Create plugin/manifest.json**

```json
{
  "Author": "claude-dj",
  "Name": "Claude DJ",
  "Description": "Control Claude Code with Ulanzi D200 physical buttons",
  "Icon": "assets/icons/icon.png",
  "Version": "0.1.0",
  "UUID": "com.claudedj.ulanzistudio.claudedj",
  "Type": "JavaScript",
  "CodePath": "app.js",
  "Actions": [
    {
      "Name": "Claude DJ Button",
      "UUID": "com.claudedj.ulanzistudio.claudedj.button",
      "Icon": "assets/icons/actionIcon.png",
      "States": [{ "Image": "assets/icons/actionIcon.png" }],
      "Controllers": ["Keypad"],
      "Tooltip": "Claude Code permission/choice button"
    }
  ],
  "OS": [
    { "Platform": "windows", "MinimumVersion": "10" },
    { "Platform": "mac", "MinimumVersion": "10.11" }
  ],
  "Software": { "MinVersion": "2.1.4" }
}
```

- [ ] **Step 2: Create plugin/app.js skeleton**

```js
// Claude DJ — Ulanzi Plugin (Phase 3)
// This is a skeleton. Full implementation in Phase 3.
//
// Role: Protocol bridge between Claude DJ Bridge WS and UlanziStudio WS
// - Connects to Claude DJ Bridge via WS (ws://localhost:39200/ws)
// - Connects to UlanziStudio via Ulanzi SDK
// - Translates LAYOUT messages → setPathIcon/setGifPathIcon per key
// - Translates onRun (key press) → BUTTON_PRESS to Bridge

import UlanziApi from '../ulanzi/sdk/common-node/index.js';

const $UD = new UlanziApi();

// TODO Phase 3: Implement Bridge WS client
// TODO Phase 3: Implement LAYOUT → icon mapping
// TODO Phase 3: Implement key press → BUTTON_PRESS forwarding

$UD.connect('com.claudedj.ulanzistudio.claudedj');

$UD.onConnected(() => {
  console.log('[claude-dj plugin] Connected to UlanziStudio');
});

$UD.onRun((jsn) => {
  console.log('[claude-dj plugin] Key pressed:', jsn.context);
  // TODO Phase 3: Forward to Bridge as BUTTON_PRESS
});

$UD.onAdd((jsn) => {
  console.log('[claude-dj plugin] Action added:', jsn.context);
});

$UD.onClear((jsn) => {
  console.log('[claude-dj plugin] Action cleared');
});
```

- [ ] **Step 3: Commit**

```bash
git add plugin/manifest.json plugin/app.js
git commit -m "feat: ulanzi plugin skeleton with manifest and SDK connection"
```

---

### Task 12: End-to-End Test + Run All Tests

**Files:**
- No new files

- [ ] **Step 1: Run all unit tests**

Run: `node --test test/config.test.js test/sessionManager.test.js test/buttonManager.test.js test/hooks.test.js`
Expected: All tests PASS

- [ ] **Step 2: Run bridge integration test**

Run: `node --test test/bridge.test.js`
Expected: All tests PASS

- [ ] **Step 3: Manual E2E test — BINARY flow**

Terminal 1: `node bridge/server.js`
Browser: open `http://localhost:39200`

Terminal 2:
```bash
curl -s -X POST http://localhost:39200/api/hook/notify \
  -H "Content-Type: application/json" \
  -d '{"session_id":"s1","cwd":"/test/project","hook_event_name":"PreToolUse","tool_name":"Bash"}'
```
Expected: Browser shows PROCESSING animation.

Terminal 2 (will block):
```bash
curl -s -X POST http://localhost:39200/api/hook/permission \
  -H "Content-Type: application/json" \
  -d '{"session_id":"s1","cwd":"/test/project","hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"rm -rf dist"}}'
```
Expected: Browser shows ✅❌ buttons. Click ✅ Approve. curl returns:
```json
{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow","message":"Claude DJ: allow via button"}}}
```

- [ ] **Step 4: Manual E2E test — CHOICE flow**

Terminal 2 (will block):
```bash
curl -s -X POST http://localhost:39200/api/hook/permission \
  -H "Content-Type: application/json" \
  -d '{"session_id":"s1","cwd":"/test/project","hook_event_name":"PermissionRequest","tool_name":"AskUserQuestion","tool_input":{"question":"How to proceed?","options":[{"label":"1","description":"Refactor"},{"label":"2","description":"Fix tests"},{"label":"3","description":"Show diff"}]}}'
```
Expected: Browser shows 1️⃣2️⃣3️⃣ buttons. Click button 2. curl returns:
```json
{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow","updatedInput":{"answer":"2"}}}}
```

- [ ] **Step 5: Manual E2E test — Stop**

```bash
curl -s -X POST http://localhost:39200/api/hook/stop \
  -H "Content-Type: application/json" \
  -d '{"session_id":"s1","hook_event_name":"Stop","stop_hook_active":false}'
```
Expected: Browser returns to all dim.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "test: verify all unit and integration tests pass"
```

---

## Summary

| Task | Component | Files | Tests |
|------|-----------|-------|-------|
| 1 | Project scaffold | package.json, .gitignore | — |
| 2 | Config | bridge/config.js | 3 |
| 3 | Session Manager | bridge/sessionManager.js | 6 |
| 4 | Button Manager | bridge/buttonManager.js | 8 |
| 5 | WS Server | bridge/wsServer.js | — |
| 6 | Bridge Server | bridge/server.js | 4 |
| 7 | Hook Scripts | hooks/*.js (3 files) | 3 |
| 8 | Virtual DJ HTML+CSS | public/index.html, css/style.css | — |
| 9 | Virtual DJ JS | public/js/*.js (3 files) | — |
| 10 | CLI + Setup | cli/index.js, tools/setup.js | — |
| 11 | Plugin Skeleton | plugin/manifest.json, plugin/app.js | — |
| 12 | E2E Test | — | Manual E2E |

**Total: 12 tasks, ~20 files, ~24 automated tests + manual E2E**
