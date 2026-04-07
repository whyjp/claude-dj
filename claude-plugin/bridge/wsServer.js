import { WebSocketServer } from 'ws';
import { log, warn, error } from './logger.js';
import { config } from './config.js';

export class WsServer {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    this.onButtonPress = null;
    this.onAgentFocus = null;
    this.onSessionFocus = null;
    this.onClientReady = null;
  }

  attach(server, path) {
    this.wss = new WebSocketServer({
      server,
      path,
      maxPayload: 64 * 1024, // 64KB
      verifyClient: ({ origin }) => {
        // Allow non-browser clients (no origin header) and localhost origins
        if (!origin) return true;
        return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      },
    });

    this.wss.on('connection', (ws) => {
      if (this.clients.size >= 50) {
        ws.close(1013, 'Too many connections');
        return;
      }
      this.clients.add(ws);
      log(`[ws] client connected (total: ${this.clients.size})`);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleMessage(ws, msg);
        } catch (e) {
          error('[ws] invalid message:', e.message);
        }
      });

      ws.on('error', (err) => {
        error('[ws] client error:', err.message);
        this.clients.delete(ws);
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        log(`[ws] client disconnected (total: ${this.clients.size})`);
      });
    });
  }

  _handleMessage(ws, msg) {
    switch (msg.type) {
      case 'CLIENT_READY':
        log(`[ws] client ready: ${msg.clientType} v${msg.version}`);
        if (this.onClientReady) this.onClientReady(ws);
        break;
      case 'BUTTON_PRESS': {
        const slot = Number(msg.slot);
        // D200H: 5×4=20키, 행-우선 슬롯 0~19. 슬롯 11=세션전환, 12=에이전트전환도 포함.
        if (!Number.isInteger(slot) || slot < 0 || slot > 19) {
          warn(`[ws] BUTTON_PRESS dropped — invalid slot: ${msg.slot}`);
          break;
        }
        log(`[ws] BUTTON_PRESS slot=${slot}`);
        if (this.onButtonPress) {
          this.onButtonPress(slot, msg.timestamp);
        } else {
          warn(`[ws] BUTTON_PRESS dropped — no handler registered`);
        }
        break;
      }
      case 'AGENT_FOCUS':
        if (this.onAgentFocus) this.onAgentFocus(msg.agentId || null);
        break;
      case 'SESSION_FOCUS':
        if (this.onSessionFocus) this.onSessionFocus(msg.sessionId || null);
        break;
      default:
        log(`[ws] unknown message type: ${msg.type}`);
    }
  }

  broadcast(msg) {
    let data;
    try { data = JSON.stringify({ type: msg.type || 'LAYOUT', ...msg }); }
    catch (e) { error('[ws] broadcast serialize error:', e.message); return; }
    const stale = [];
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(data);
      } else {
        stale.push(client);
      }
    }
    for (const c of stale) this.clients.delete(c);
  }

  sendWelcome(ws, sessions) {
    const msg = JSON.stringify({
      type: 'WELCOME',
      version: config.version,
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
