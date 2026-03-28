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
