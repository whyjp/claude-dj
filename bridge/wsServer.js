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
      case 'BIG_WINDOW_PRESS':
        // Phase 2
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
