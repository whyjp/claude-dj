import { WebSocketServer } from 'ws';

export class WsServer {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    this.onButtonPress = null;
    this.onAgentFocus = null;
    this.onClientReady = null;
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

      ws.on('error', (err) => {
        console.error('[ws] client error:', err.message);
        this.clients.delete(ws);
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
        if (this.onClientReady) this.onClientReady(ws);
        break;
      case 'BUTTON_PRESS':
        if (this.onButtonPress) {
          this.onButtonPress(msg.slot, msg.timestamp);
        }
        break;
      case 'AGENT_FOCUS':
        if (this.onAgentFocus) this.onAgentFocus(msg.agentId || null);
        break;
      default:
        console.log(`[ws] unknown message type: ${msg.type}`);
    }
  }

  broadcast(msg) {
    let data;
    try { data = JSON.stringify({ type: msg.type || 'LAYOUT', ...msg }); }
    catch (e) { console.error('[ws] broadcast serialize error:', e.message); return; }
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
