import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { log, warn, error } from './logger.js';
import { SessionManager } from './sessionManager.js';
import { ButtonManager } from './buttonManager.js';
import { WsServer } from './wsServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const sm = new SessionManager();
const ws = new WsServer();

app.use(express.json({ limit: '100kb' }));

// Input validation middleware for hook endpoints
function validateHookInput(req, res, next) {
  const { session_id } = req.body || {};
  if (!session_id || typeof session_id !== 'string') {
    return res.status(400).json({ error: 'missing or invalid session_id' });
  }
  next();
}
app.post('/api/hook/*', validateHookInput);
app.use(express.static(path.join(__dirname, '..', 'public')));

// Landing page served at /landing for local debugging (source: repo root index.html)
app.get('/landing', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

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
  log(`[hook/notify] session=${input.session_id} tool=${input.tool_name} event=${input.hook_event_name}`);
  // Cancel pending response timer — Claude is still working
  if (_stopTimers.has(input.session_id)) {
    clearTimeout(_stopTimers.get(input.session_id));
    _stopTimers.delete(input.session_id);
  }
  const session = sm.handleNotify(input);
  // Only broadcast if this is the focused session — don't override WAITING_BINARY/CHOICE
  const focus = sm.getFocusSession();
  if (!focus || focus.id === session.id) {
    const layout = ButtonManager.layoutFor(session, sm.focusAgentId, sm.getAgentCount(session.id));
    broadcastLayout(layout);
  }
  res.json({ ok: true });
});

app.post('/api/hook/postToolUse', (req, res) => {
  const input = req.body;
  log(`[hook/postToolUse] session=${input.session_id} tool=${input.tool_name} errored=${input.tool_result?.errored}`);
  const session = sm.handlePostToolUse(input);
  // Only broadcast if this is the focused session
  const focus = sm.getFocusSession();
  if (!focus || focus.id === session.id) {
    const layout = ButtonManager.layoutFor(session, sm.focusAgentId, sm.getAgentCount(session.id));
    broadcastLayout(layout);
  }
  res.json({ ok: true });
});

app.post('/api/hook/subagentStart', (req, res) => {
  const input = req.body;
  log(`[hook/subagentStart] session=${input.session_id} agent=${input.agent_id} type=${input.agent_type}`);
  const session = sm.handleSubagentStart(input);
  const layout = ButtonManager.layoutFor(session, sm.focusAgentId, sm.getAgentCount(session.id));
  broadcastLayout(layout);
  res.json({ ok: true });
});

app.post('/api/hook/subagentStop', (req, res) => {
  const input = req.body;
  log(`[hook/subagentStop] session=${input.session_id} agent=${input.agent_id}`);
  const session = sm.handleSubagentStop(input);
  const layout = ButtonManager.layoutFor(session, sm.focusAgentId, sm.getAgentCount(session.id));
  broadcastLayout(layout);
  res.json({ ok: true });
});

app.post('/api/hook/stop', (req, res) => {
  const input = req.body;
  const choices = input._djChoices || null;
  log(`[hook/stop] session=${input.session_id} active=${input.stop_hook_active} choices=${choices?.length || 0}`);
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
    // Choices detected in transcript — show "waiting for input" on deck (display-only, no interaction)
    const session = sm.handleStopWithChoices(input, choices);
    const layout = ButtonManager.layoutFor(session, sm.focusAgentId, sm.getAgentCount(session.id));
    broadcastLayout(layout);
  } else {
    // No choices — go to IDLE (dismiss if session exists, ignore if not)
    sm.dismissSession(sessionId);
    ws.broadcast({ type: 'ALL_DIM' });
  }

  res.json({ ok: true });
});

// --- Events File API ---

fs.mkdirSync(config.eventsDir, { recursive: true });

app.get('/api/events/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  if (!sessionId || sessionId.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    return res.status(400).json({ error: 'invalid session id' });
  }
  const file = path.join(config.eventsDir, `${sessionId}.jsonl`);
  // Atomic read-then-delete: rename first to prevent concurrent reads
  const tmpFile = file + '.reading';
  try { fs.renameSync(file, tmpFile); } catch { return res.json({ events: [] }); }
  try {
    const lines = fs.readFileSync(tmpFile, 'utf8').trim().split('\n').filter(Boolean);
    const events = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    fs.unlinkSync(tmpFile);
    res.json({ events });
  } catch {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    res.json({ events: [] });
  }
});

app.post('/api/hook/permission', (req, res) => {
  const input = req.body;
  log(`[hook/permission] session=${input.session_id} tool=${input.tool_name} event=${input.hook_event_name}`);

  // Auto-deny previous pending permission to prevent orphaned HTTP responses
  const existing = sm.get(input.session_id);
  if (existing?.respondFn) {
    warn(`[hook/permission] auto-denying previous pending permission for session=${input.session_id}`);
    existing.respondFn({ type: 'binary', value: 'deny' });
  }
  if (existing?._permissionTimeout) {
    clearTimeout(existing._permissionTimeout);
    existing._permissionTimeout = null;
  }

  const session = sm.handlePermission(input);
  // Auto-focus: new permission request takes focus (including subagent)
  sm.setFocus(session.id);
  if (input.agent_id) sm.focusAgentId = input.agent_id;
  const layout = ButtonManager.layoutFor(session, sm.focusAgentId, sm.getAgentCount(session.id));
  const isChoice = session.state === 'WAITING_CHOICE';

  broadcastLayout(layout);

  const timeout = setTimeout(() => {
    warn(`[hook→claude] TIMEOUT (${config.buttonTimeout}ms) session=${session.id} tool=${input.tool_name} — auto-deny sent`);
    session.respondFn = null;
    session._permissionTimeout = null;
    sm.handleStop({ session_id: session.id, stop_hook_active: false });
    ws.broadcast({ type: 'ALL_DIM' });
    res.json(ButtonManager.buildTimeoutResponse());
  }, config.buttonTimeout);

  session._permissionTimeout = timeout;

  const question = session.prompt?.question || '';
  session.respondFn = (decision) => {
    if (session._permissionTimeout) {
      clearTimeout(session._permissionTimeout);
      session._permissionTimeout = null;
    }
    const response = ButtonManager.buildHookResponse(decision, isChoice, question);
    const newLayout = ButtonManager.layoutFor(session, sm.focusAgentId, sm.getAgentCount(session.id));
    broadcastLayout(newLayout);
    try {
      res.json(response);
      const behavior = response.hookSpecificOutput?.decision?.behavior;
      log(`[hook→claude] session=${session.id} tool=${input.tool_name} behavior=${behavior} decision=${decision.type}:${decision.value}`);
    } catch (e) {
      error(`[hook→claude] FAILED res.json for session=${session.id}: ${e.message}`);
    }
  };
});

// --- WebSocket ---

ws.attach(server, config.wsPath);

ws.onClientReady = (client) => {
  // Send full session list on connect
  ws.sendWelcome(client, sm.toJSON());
  // Then send current focused layout
  const focus = sm.getFocusSession();
  if (focus) {
    const layout = ButtonManager.layoutFor(focus, sm.focusAgentId, sm.getAgentCount(focus.id));
    const msg = JSON.stringify({ type: 'LAYOUT', sessionCount: sm.sessionCount, ...layout });
    if (client.readyState === 1) client.send(msg);
  }
};

ws.onButtonPress = (slot, timestamp) => {
  // Slot 11: cycle focus to next session
  if (slot === 11) {
    const next = sm.cycleFocus();
    if (next) {
      log(`[btn] slot=11 → cycled to session=${next.name}`);
      const layout = ButtonManager.layoutFor(next, sm.focusAgentId, sm.getAgentCount(next.id));
      broadcastLayout({ ...layout, focusSwitched: true });
    } else {
      log(`[btn] slot=11 → no sessions to cycle`);
    }
    return;
  }

  // Slot 12: cycle subagents within current root
  if (slot === 12) {
    const agent = sm.cycleAgent();
    const focus = sm.focusSessionId ? sm.get(sm.focusSessionId) : null;
    log(`[btn] slot=12 → agent=${agent?.type || 'ROOT'} session=${focus?.name || 'none'}`);
    if (focus) {
      const layout = ButtonManager.layoutFor(focus, sm.focusAgentId, sm.getAgentCount(focus.id));
      broadcastLayout({ ...layout, focusSwitched: true });
    }
    return;
  }

  const focus = sm.getFocusSession();
  if (!focus) {
    warn(`[btn] slot=${slot} dropped — no focused session`);
    return;
  }

  const decision = ButtonManager.resolvePress(slot, focus.state, focus.prompt);
  if (!decision) {
    warn(`[btn] slot=${slot} dropped — resolvePress returned null (state=${focus.state}, hasPrompt=${!!focus.prompt})`);
    return;
  }

  if (focus.state === 'WAITING_RESPONSE') {
    log(`[btn] slot=${slot} ignored — WAITING_RESPONSE is display-only`);
    return;
  }

  // multiSelect toggle — update layout without resolving
  if (decision.type === 'toggle') {
    log(`[btn] slot=${slot} → multiSelect toggle index=${decision.index}`);
    const layout = ButtonManager.layoutFor(focus, sm.focusAgentId, sm.getAgentCount(focus.id));
    broadcastLayout(layout);
    return;
  }

  log(`[btn] slot=${slot} → resolving: ${decision.type}=${decision.value} session=${focus.name} (${focus.id})`);
  sm.resolveWaiting(focus.id, decision);
};

ws.onAgentFocus = (agentId) => {
  const focus = sm.focusSessionId ? sm.get(sm.focusSessionId) : null;
  if (!focus) return;
  sm.setAgentFocus(agentId);
  const layout = ButtonManager.layoutFor(focus, sm.focusAgentId, sm.getAgentCount(focus.id));
  broadcastLayout({ ...layout, focusSwitched: true });
};

// --- Session Cleanup ---

const pruneInterval = setInterval(() => {
  const pruned = sm.pruneIdle(config.sessionIdleTimeout);
  if (pruned.length > 0) {
    for (const id of pruned) {
      if (_stopTimers.has(id)) {
        clearTimeout(_stopTimers.get(id));
        _stopTimers.delete(id);
      }
    }
    log(`[claude-dj] Pruned ${pruned.length} idle session(s): ${pruned.join(', ')}`);
    ws.broadcast({ type: 'SESSION_DISCONNECTED', sessionIds: pruned, reason: 'idle_timeout' });
  }
}, 60000); // check every minute

// --- Session Sync (poll Claude Code disk state) ---

let _emptyTicks = 0;
const AUTO_SHUTDOWN_TICKS = parseInt(process.env.CLAUDE_DJ_SHUTDOWN_TICKS, 10) || 10; // 10 × 30s = 5 min

const syncInterval = setInterval(() => {
  const { pruned, alive } = sm.syncFromDisk();
  if (pruned.length > 0) {
    for (const id of pruned) {
      if (_stopTimers.has(id)) {
        clearTimeout(_stopTimers.get(id));
        _stopTimers.delete(id);
      }
    }
    log(`[claude-dj] Synced: removed ${pruned.length} dead session(s): ${pruned.join(', ')}`);
    ws.broadcast({ type: 'SESSION_DISCONNECTED', sessionIds: pruned, reason: 'process_exit' });
  }

  // Auto-shutdown: no sessions + no WS clients for AUTO_SHUTDOWN_TICKS consecutive checks
  if (sm.sessionCount === 0 && ws.clients.size === 0) {
    _emptyTicks++;
    if (_emptyTicks >= AUTO_SHUTDOWN_TICKS) {
      log(`[claude-dj] No sessions or clients for ${_emptyTicks * 30}s — shutting down`);
      clearInterval(pruneInterval);
      clearInterval(syncInterval);
      server.close(() => process.exit(0));
    }
  } else {
    _emptyTicks = 0;
  }
}, 30000); // check every 30s

// --- Start ---

const port = config.port;
server.listen(port, () => {
  log(`[claude-dj] Bridge running at http://localhost:${port}`);
  log(`[claude-dj] Virtual DJ at http://localhost:${port}`);
  log(`[claude-dj] WebSocket at ws://localhost:${port}${config.wsPath}`);
});

export { server, app, pruneInterval, syncInterval };
