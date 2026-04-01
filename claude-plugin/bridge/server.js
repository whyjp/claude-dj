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

// --- Process Error Handlers ---
process.on('unhandledRejection', (err) => {
  error('[fatal] unhandledRejection:', err);
});
process.on('uncaughtException', (err) => {
  error('[fatal] uncaughtException:', err);
  process.exit(1);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const sm = new SessionManager();
const ws = new WsServer();

app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:* ws://127.0.0.1:*");
  next();
});

// Input validation middleware for hook endpoints
function validateHookInput(req, res, next) {
  const { session_id } = req.body || {};
  if (!session_id || typeof session_id !== 'string') {
    return res.status(400).json({ error: 'missing or invalid session_id' });
  }
  next();
}
// Simple per-session rate limiter (100 req/s sliding window)
const _rateBuckets = new Map();
const RATE_LIMIT = 100;
const RATE_WINDOW = 1000;
function rateLimitHook(req, res, next) {
  const sid = req.body?.session_id;
  if (!sid) return next();
  const now = Date.now();
  let bucket = _rateBuckets.get(sid);
  if (!bucket) { bucket = { count: 0, resetAt: now + RATE_WINDOW }; _rateBuckets.set(sid, bucket); }
  if (now > bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + RATE_WINDOW; }
  if (++bucket.count > RATE_LIMIT) {
    warn(`[ratelimit] session=${sid} exceeded ${RATE_LIMIT} req/s`);
    return res.status(429).json({ error: 'rate limit exceeded' });
  }
  next();
}

app.post('/api/hook/*', validateHookInput);
app.post('/api/hook/*', rateLimitHook);
app.use(express.static(path.join(__dirname, '..', 'public')));

// Landing page served at /landing for local debugging (source: repo root index.html)
app.get('/landing', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// --- Health & Status ---

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: config.version, port: config.port, uptime: process.uptime() | 0 });
});

app.post('/api/shutdown', (req, res) => {
  log('[claude-dj] Shutdown requested via API');
  res.json({ status: 'shutting_down' });
  clearInterval(pruneInterval);
  clearInterval(syncInterval);
  // Terminate all WebSocket clients
  for (const client of ws.clients) {
    client.terminate();
  }
  // Force exit — server.close can hang with keep-alive connections
  setTimeout(() => process.exit(0), 500);
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

function broadcastSessionLayout(session, extras) {
  const layout = ButtonManager.layoutFor(session, sm.focusAgentId, sm.getAgentCount(session.id));
  broadcastLayout(extras ? { ...layout, ...extras } : layout);
}

// --- Hook Endpoints ---

app.post('/api/hook/sessionStart', (req, res, next) => {
  try {
    const input = req.body;
    log(`[hook/sessionStart] session=${input.session_id} source=${input.source || 'startup'}`);
    const session = sm.handleSessionStart(input);
    ws.broadcast({ type: 'SESSIONS_UPDATE', sessions: sm.toJSON() });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/hook/sessionEnd', (req, res, next) => {
  try {
    const input = req.body;
    log(`[hook/sessionEnd] session=${input.session_id} reason=${input.reason || 'unknown'}`);
    const session = sm.handleSessionEnd(input);
    if (session) {
      ws.broadcast({ type: 'SESSION_DISCONNECTED', sessionIds: [input.session_id], reason: input.reason || 'session_end' });
    }
    // Refresh layout for remaining sessions
    const focus = sm.getFocusSession();
    if (focus) {
      broadcastSessionLayout(focus);
    } else {
      ws.broadcast({ type: 'ALL_DIM' });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/hook/userPromptSubmit', (req, res, next) => {
  try {
    const input = req.body;
    log(`[hook/userPromptSubmit] session=${input.session_id}`);
    const session = sm.handleUserPromptSubmit(input);
    const focus = sm.getFocusSession();
    if (!focus || focus.id === session.id) {
      broadcastSessionLayout(session);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/hook/notify', (req, res, next) => {
  try {
    const input = req.body;
    log(`[hook/notify] session=${input.session_id} tool=${input.tool_name} event=${input.hook_event_name}`);
    const session = sm.handleNotify(input);
    // Only broadcast if this is the focused session — don't override WAITING_BINARY/CHOICE
    const focus = sm.getFocusSession();
    if (!focus || focus.id === session.id) {
      broadcastSessionLayout(session);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/hook/postToolUse', (req, res, next) => {
  try {
    const input = req.body;
    log(`[hook/postToolUse] session=${input.session_id} tool=${input.tool_name} errored=${input.tool_result?.errored}`);
    const session = sm.handlePostToolUse(input);
    // Only broadcast if this is the focused session
    const focus = sm.getFocusSession();
    if (!focus || focus.id === session.id) {
      broadcastSessionLayout(session);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/hook/postToolUseFailure', (req, res, next) => {
  try {
    const input = req.body;
    log(`[hook/postToolUseFailure] session=${input.session_id} tool=${input.tool_name} error=${(input.error || '').slice(0, 80)}`);
    const session = sm.handlePostToolUseFailure(input);
    const focus = sm.getFocusSession();
    if (!focus || focus.id === session.id) {
      broadcastSessionLayout(session);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/hook/subagentStart', (req, res, next) => {
  try {
    const input = req.body;
    log(`[hook/subagentStart] session=${input.session_id} agent=${input.agent_id} type=${input.agent_type}`);
    const session = sm.handleSubagentStart(input);
    broadcastSessionLayout(session);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/hook/subagentStop', (req, res, next) => {
  try {
    const input = req.body;
    log(`[hook/subagentStop] session=${input.session_id} agent=${input.agent_id}`);
    const session = sm.handleSubagentStop(input);
    broadcastSessionLayout(session);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/hook/stop', (req, res, next) => { try {
  const input = req.body;
  const choices = input._djChoices || null;
  log(`[hook/stop] session=${input.session_id} active=${input.stop_hook_active} choices=${choices?.length || 0}`);
  if (input.stop_hook_active) {
    return res.json({ ok: true });
  }

  const sessionId = input.session_id;

  if (choices && choices.length > 0) {
    // Choices detected in transcript — show "waiting for input" on deck (display-only, no interaction)
    const session = sm.handleStopWithChoices(input, choices);
    broadcastSessionLayout(session);
  } else {
    // No choices — go to IDLE (dismiss if session exists, ignore if not)
    sm.dismissSession(sessionId);
    ws.broadcast({ type: 'ALL_DIM' });
  }

  res.json({ ok: true });
} catch (e) { next(e); }
});

app.post('/api/hook/taskEvent', (req, res, next) => {
  try {
    const input = req.body;
    const event = input.hook_event_name || '?';
    log(`[hook/task] session=${input.session_id} event=${event} task="${input.task_subject || '?'}" id=${input.task_id || '?'}`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/hook/compact', (req, res, next) => {
  try {
    const input = req.body;
    const event = input.hook_event_name || '?';
    log(`[hook/compact] session=${input.session_id} event=${event} trigger=${input.trigger || '?'}`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/hook/teammateIdle', (req, res, next) => {
  try {
    const input = req.body;
    log(`[hook/teammateIdle] session=${input.session_id} teammate=${input.teammate_name || '?'} team=${input.team_name || '?'}`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/hook/notification', (req, res, next) => {
  try {
    const input = req.body;
    const title = input.title || '';
    const msg = input.message || '';
    log(`[hook/notification] session=${input.session_id} type=${input.notification_type || '?'} title="${title}" msg="${msg.slice(0, 80)}"`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post('/api/hook/stopFailure', (req, res, next) => {
  try {
    const input = req.body;
    const errMsg = input.error_details || input.error?.message || 'unknown';
    log(`[hook/stopFailure] session=${input.session_id} error=${errMsg.slice(0, 80)}`);
    const session = sm.handleStopFailure(input);
    broadcastSessionLayout(session);
    res.json({ ok: true });
  } catch (e) { next(e); }
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

/**
 * Persist always-allow rules to .claude/settings.local.json.
 * Claude Code's hook path doesn't persist addRules — we do it directly.
 */
function _persistAlwaysAllowRules(cwd, suggestion) {
  if (suggestion.destination !== 'localSettings') return;
  const settingsPath = path.join(cwd, '.claude', 'settings.local.json');
  try {
    let settings = {};
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { /* new file */ }
    if (!settings.permissions) settings.permissions = {};
    if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];

    const rules = suggestion.rules || [];
    let added = 0;
    for (const rule of rules) {
      const entry = `${rule.toolName}(${rule.ruleContent})`;
      if (!settings.permissions.allow.includes(entry)) {
        settings.permissions.allow.push(entry);
        added++;
      }
    }
    if (added > 0) {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
      log(`[rules] +${added} rule(s) → ${settingsPath}`);
    }
  } catch (e) {
    warn(`[rules] failed to persist: ${e.message}`);
  }
}

app.post('/api/hook/permission', (req, res) => {
  const input = req.body;
  log(`[hook/permission] session=${input.session_id} tool=${input.tool_name} event=${input.hook_event_name}`);

  // Auto-deny previous pending permission to prevent orphaned HTTP responses.
  // Safe: Node.js is single-threaded, so this completes before handlePermission overwrites state.
  const existing = sm.get(input.session_id);
  if (existing?.respondFn) {
    warn(`[hook/permission] auto-denying previous pending permission for session=${input.session_id}`);
    const prevRespondFn = existing.respondFn;
    existing.respondFn = null; // nullify first to prevent double-call
    prevRespondFn({ type: 'binary', value: 'deny' });
  }
  if (existing?._permissionTimeout) {
    clearTimeout(existing._permissionTimeout);
    existing._permissionTimeout = null;
  }

  const session = sm.handlePermission(input);
  // Auto-focus: new permission request takes focus (including subagent)
  sm.setFocus(session.id);
  if (input.agent_id) sm.setAgentFocus(input.agent_id);
  const isChoice = session.state === 'WAITING_CHOICE';

  // Log buttons sent to deck
  if (isChoice) {
    const labels = session.prompt.choices.map((c) => `${c.index}:${c.label}`).join(', ');
    log(`[deck←] ${session.prompt.choices.length} buttons → [${labels}]${session.prompt.multiSelect ? ' (multiSelect)' : ''}`);
  } else {
    const buttons = session.prompt.hasAlwaysAllow
      ? '[0:Allow, 1:AlwaysAllow, 2:Deny]'
      : '[0:Allow, 1:Deny]';
    log(`[deck←] tool=${input.tool_name} cmd="${session.prompt.command}" ${buttons}${session.prompt.hasAlwaysAllow ? ` rule="${session.prompt.alwaysAllowSuggestion?.rules?.[0]?.ruleContent || '?'}"` : ''}`);
  }

  broadcastSessionLayout(session);

  // Detect hook process killed by Claude Code (connection drop).
  // Use res.on('close') — req.on('close') fires on request-body-consumed in Node ≥18,
  // even when the TCP connection is still alive, causing immediate false-positive cleanup.
  res.on('close', () => {
    if (res.writableFinished) return; // response was sent successfully — not a disconnect
    if (!session.respondFn) return; // already resolved
    log(`[hook/permission] connection closed by client — session=${session.id} tool=${input.tool_name}`);
    session.respondFn = null;
    session.state = 'PROCESSING';
    session.prompt = null;
    session.waitingSince = null;
    broadcastSessionLayout(session);
  });

  const question = session.prompt?.question || '';
  session.respondFn = (decision) => {
    const response = ButtonManager.buildHookResponse(decision, isChoice, question);
    broadcastSessionLayout(session);

    // Persist always-allow rules to settings.local.json as fallback.
    // With updatedPermissions in hook response, Claude Code should persist natively.
    // TODO: remove this fallback after confirming native persistence works.
    if (decision.suggestion?.rules?.length && session.cwd) {
      log(`[rules] fallback persist (updatedPermissions should handle this natively)`);
      _persistAlwaysAllowRules(session.cwd, decision.suggestion);
    }

    try {
      res.json(response);
      const d = response.hookSpecificOutput?.decision;
      if (decision.suggestion) {
        log(`[claude←] tool=${input.tool_name} behavior=allow+addRules dest=${d.destination} rules=${JSON.stringify(d.rules)}`);
      } else if (isChoice) {
        log(`[claude←] tool=${input.tool_name} behavior=allow answer=${d.updatedInput?.answer}`);
      } else {
        log(`[claude←] tool=${input.tool_name} behavior=${d.behavior}`);
      }
    } catch (e) {
      error(`[claude←] FAILED res.json for session=${session.id}: ${e.message}`);
    }
  };
});

// --- Express Error Middleware ---
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  error(`[express] ${req.method} ${req.path}: ${err.message}`);
  if (!res.headersSent) {
    res.status(status).json({ error: status < 500 ? err.message : 'internal server error' });
  }
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
      broadcastSessionLayout(next, { focusSwitched: true });
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
      broadcastSessionLayout(focus, { focusSwitched: true });
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
    broadcastSessionLayout(focus);
    return;
  }

  // Log what the user actually pressed
  const label = decision.suggestion ? 'AlwaysAllow' : decision.type === 'choice' ? `choice:${decision.value}` : decision.value;
  log(`[deck→] slot=${slot} pressed="${label}" session=${focus.name}`);
  const result = sm.resolveWaiting(focus.id, decision);

  // Multi-question: re-broadcast layout for next question without resolving HTTP
  if (result === 'next_question') {
    broadcastSessionLayout(focus);
    return;
  }
};

ws.onAgentFocus = (agentId) => {
  const focus = sm.focusSessionId ? sm.get(sm.focusSessionId) : null;
  if (!focus) return;
  sm.setAgentFocus(agentId);
  broadcastSessionLayout(focus, { focusSwitched: true });
};

ws.onSessionFocus = (sessionId) => {
  if (!sessionId) return;
  const session = sm.get(sessionId);
  if (!session) return;
  sm.setFocus(sessionId);
  sm.setAgentFocus(null);
  log(`[ws] SESSION_FOCUS → session=${session.name}`);
  broadcastSessionLayout(session, { focusSwitched: true });
};

// --- Session Cleanup ---

const pruneInterval = setInterval(() => {
  const pruned = sm.pruneIdle(config.sessionIdleTimeout);
  if (pruned.length > 0) {
    log(`[claude-dj] Pruned ${pruned.length} idle session(s): ${pruned.join(', ')}`);
    ws.broadcast({ type: 'SESSION_DISCONNECTED', sessionIds: pruned, reason: 'idle_timeout' });
  }
}, 60000); // check every minute

// --- Session Sync (poll Claude Code disk state) ---

let _emptyTicks = 0;
const _shutdownEnv = parseInt(process.env.CLAUDE_DJ_SHUTDOWN_TICKS, 10);
const AUTO_SHUTDOWN_TICKS = Number.isNaN(_shutdownEnv) ? 10 : _shutdownEnv; // 10 × 30s = 5 min

const syncInterval = setInterval(() => {
  const { pruned, alive, renamed } = sm.syncFromDisk();
  if (pruned.length > 0) {
    log(`[claude-dj] Synced: removed ${pruned.length} dead session(s): ${pruned.join(', ')}`);
    ws.broadcast({ type: 'SESSION_DISCONNECTED', sessionIds: pruned, reason: 'process_exit' });
  }
  if (renamed.length > 0) {
    log(`[claude-dj] Synced: renamed ${renamed.length} session(s)`);
    ws.broadcast({ type: 'SESSIONS_UPDATE', sessions: sm.toJSON() });
  }

  // Auto-shutdown: no sessions + no WS clients for AUTO_SHUTDOWN_TICKS consecutive checks
  if (sm.sessionCount === 0 && ws.clients.size === 0) {
    _emptyTicks++;
    if (_emptyTicks >= AUTO_SHUTDOWN_TICKS) {
      log(`[claude-dj] No sessions or clients for ${_emptyTicks * 30}s — shutting down`);
      clearInterval(pruneInterval);
      clearInterval(syncInterval);
      for (const client of ws.clients) {
        client.close(1001, 'bridge shutting down');
      }
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000);
    }
  } else {
    _emptyTicks = 0;
  }
}, 30000); // check every 30s

// --- Start ---

const port = config.port;
server.listen(port, '127.0.0.1', () => {
  log(`[claude-dj] Bridge running at http://127.0.0.1:${port}`);
  log(`[claude-dj] Virtual DJ at http://localhost:${port}`);
  log(`[claude-dj] WebSocket at ws://localhost:${port}${config.wsPath}`);
});

export { server, app, pruneInterval, syncInterval };
