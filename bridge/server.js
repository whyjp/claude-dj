import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
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

// --- Helpers ---

function broadcastLayout(layout) {
  ws.broadcast({ type: 'LAYOUT', sessionCount: sm.sessionCount, ...layout });
}

// --- Hook Endpoints ---

const _stopTimers = new Map();

app.post('/api/hook/notify', (req, res) => {
  const input = req.body;
  console.log(`[hook/notify] session=${input.session_id} tool=${input.tool_name} event=${input.hook_event_name}`);
  // Cancel pending response timer — Claude is still working
  if (_stopTimers.has(input.session_id)) {
    clearTimeout(_stopTimers.get(input.session_id));
    _stopTimers.delete(input.session_id);
  }
  const session = sm.handleNotify(input);
  // Only broadcast if this is the focused session — don't override WAITING_BINARY/CHOICE
  const focus = sm.getFocusSession();
  if (!focus || focus.id === session.id) {
    const layout = ButtonManager.layoutFor(session);
    broadcastLayout(layout);
  }
  res.json({ ok: true });
});

app.post('/api/hook/postToolUse', (req, res) => {
  const input = req.body;
  console.log(`[hook/postToolUse] session=${input.session_id} tool=${input.tool_name} errored=${input.tool_result?.errored}`);
  const session = sm.handlePostToolUse(input);
  // Only broadcast if this is the focused session
  const focus = sm.getFocusSession();
  if (!focus || focus.id === session.id) {
    const layout = ButtonManager.layoutFor(session);
    broadcastLayout(layout);
  }
  res.json({ ok: true });
});

app.post('/api/hook/stop', (req, res) => {
  const input = req.body;
  const choices = input._djChoices || null;
  console.log(`[hook/stop] session=${input.session_id} active=${input.stop_hook_active} choices=${choices?.length || 0}`);
  if (input.stop_hook_active) {
    return res.json({ ok: true });
  }

  const sessionId = input.session_id;

  // Clear any pending response timer
  if (_stopTimers.has(sessionId)) {
    clearTimeout(_stopTimers.get(sessionId));
    _stopTimers.delete(sessionId);
  }

  if (choices && choices.length > 0) {
    // Choices detected in transcript — show on deck (display-only)
    const session = sm.handleStopWithChoices(input, choices);
    const currentFocus = sm.getFocusSession();
    if (!currentFocus || currentFocus.state === 'WAITING_RESPONSE') {
      sm.setFocus(session.id);
    }
    const layout = ButtonManager.layoutFor(session);
    broadcastLayout(layout);
  } else {
    // No choices — go to IDLE
    sm.dismissSession(sessionId) || sm.getOrCreate(input);
    ws.broadcast({ type: 'ALL_DIM' });
  }

  res.json({ ok: true });
});

// --- Events File API ---

fs.mkdirSync(config.eventsDir, { recursive: true });

app.get('/api/events/:sessionId', (req, res) => {
  const file = path.join(config.eventsDir, `${req.params.sessionId}.jsonl`);
  if (!fs.existsSync(file)) return res.json({ events: [] });
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  const events = lines.map((l) => JSON.parse(l));
  fs.unlinkSync(file); // clear after read
  res.json({ events });
});

app.post('/api/hook/permission', (req, res) => {
  const input = req.body;
  console.log(`[hook/permission] session=${input.session_id} tool=${input.tool_name} event=${input.hook_event_name}`);
  const session = sm.handlePermission(input);
  // Auto-focus: new permission request takes focus
  sm.setFocus(session.id);
  const layout = ButtonManager.layoutFor(session);
  const isChoice = session.state === 'WAITING_CHOICE';

  broadcastLayout(layout);

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
    broadcastLayout(newLayout);
    res.json(response);
  };
});

// --- WebSocket ---

ws.attach(server, config.wsPath);

ws.onClientReady = (client) => {
  const focus = sm.getFocusSession();
  if (focus) {
    const layout = ButtonManager.layoutFor(focus);
    const msg = JSON.stringify({ type: 'LAYOUT', sessionCount: sm.sessionCount, ...layout });
    if (client.readyState === 1) client.send(msg);
  }
};

ws.onButtonPress = (slot, timestamp) => {
  // Slot 11: cycle focus to next session
  if (slot === 11) {
    const next = sm.cycleFocus();
    if (next) {
      const layout = ButtonManager.layoutFor(next);
      broadcastLayout({ ...layout, focusSwitched: true });
    }
    return;
  }

  const focus = sm.getFocusSession();
  if (!focus) return;

  const decision = ButtonManager.resolvePress(slot, focus.state, focus.prompt);
  if (!decision) return;

  if (focus.state === 'WAITING_RESPONSE') {
    // Display-only: write to events file for reference, dismiss session
    const file = path.join(config.eventsDir, `${focus.id}.jsonl`);
    const event = JSON.stringify({ type: 'button', value: decision.value, timestamp: Date.now() });
    fs.appendFileSync(file, event + '\n');
    console.log(`[events] wrote ${decision.value} for session ${focus.id}`);
    sm.dismissSession(focus.id);
    ws.broadcast({ type: 'ALL_DIM' });
    return;
  }

  sm.resolveWaiting(focus.id, decision);
};

// --- Session Cleanup ---

const pruneInterval = setInterval(() => {
  const pruned = sm.pruneIdle(config.sessionIdleTimeout);
  if (pruned.length > 0) {
    console.log(`[claude-dj] Pruned ${pruned.length} idle session(s): ${pruned.join(', ')}`);
  }
}, 60000); // check every minute

// --- Start ---

const port = config.port;
server.listen(port, () => {
  console.log(`[claude-dj] Bridge running at http://localhost:${port}`);
  console.log(`[claude-dj] Virtual DJ at http://localhost:${port}`);
  console.log(`[claude-dj] WebSocket at ws://localhost:${port}${config.wsPath}`);
});

export { server, app, pruneInterval };
