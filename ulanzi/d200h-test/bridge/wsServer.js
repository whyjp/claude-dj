/**
 * wsServer.js
 *
 * Bridge WebSocket 서버.
 * 연결 클라이언트(브라우저 가상덱, Ulanzi 플러그인 등)에게
 * LAYOUT 메시지를 브로드캐스트하고 BUTTON_PRESS를 수신한다.
 *
 * 메시지 타입:
 *   → CLIENT_READY  { type, clientType, version }
 *   → BUTTON_PRESS  { type, slot, timestamp? }
 *   ← LAYOUT        { type, preset, slots?, ... }
 *   ← ALL_DIM       { type }
 *   ← WELCOME       { type, version }
 */

import { WebSocketServer } from 'ws';

export class WsServer {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    /** @type {((slot: number, timestamp?: number) => void) | null} */
    this.onButtonPress = null;
    /** @type {((ws: import('ws').WebSocket) => void) | null} */
    this.onClientReady = null;
  }

  /**
   * http.Server에 WebSocket 서버를 attach한다.
   * @param {import('http').Server} server
   * @param {string} [path='/ws']
   */
  attach(server, path = '/ws') {
    this.wss = new WebSocketServer({
      server,
      path,
      maxPayload: 64 * 1024,
      verifyClient: ({ origin }) => {
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

      // 신규 클라이언트에게 WELCOME 전송
      this._sendToWs(ws, { type: 'WELCOME', version: '0.1.0' });
    });
  }

  /**
   * @param {import('ws').WebSocket} ws
   * @param {object} msg
   */
  _handleMessage(ws, msg) {
    switch (msg.type) {
      case 'CLIENT_READY':
        console.log(`[ws] CLIENT_READY: type=${msg.clientType} v=${msg.version}`);
        if (this.onClientReady) this.onClientReady(ws);
        break;

      case 'BUTTON_PRESS': {
        const slot = Number(msg.slot);
        if (!Number.isInteger(slot) || slot < 0 || slot > 12) {
          console.warn(`[ws] BUTTON_PRESS dropped — invalid slot: ${msg.slot}`);
          break;
        }
        console.log(`[ws] BUTTON_PRESS slot=${slot}`);
        if (this.onButtonPress) {
          this.onButtonPress(slot, msg.timestamp);
        } else {
          console.warn('[ws] BUTTON_PRESS dropped — no handler');
        }
        break;
      }

      default:
        console.log(`[ws] unknown message type: ${msg.type}`);
    }
  }

  /**
   * 연결된 모든 클라이언트에게 메시지를 브로드캐스트한다.
   * @param {object} msg
   */
  broadcast(msg) {
    let data;
    try {
      data = JSON.stringify({ type: msg.type || 'LAYOUT', ...msg });
    } catch (e) {
      console.error('[ws] broadcast serialize error:', e.message);
      return;
    }
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

  /**
   * @param {import('ws').WebSocket} ws
   * @param {object} msg
   */
  _sendToWs(ws, msg) {
    try {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(msg));
      }
    } catch (e) {
      console.error('[ws] send error:', e.message);
    }
  }

  /**
   * 모든 연결된 클라이언트를 즉시 강제 종료한다.
   * 서버 종료 시나리오나 테스트 픽스처에서 사용한다.
   */
  terminateAll() {
    for (const client of this.clients) {
      try { client.terminate(); } catch (_) {}
    }
    this.clients.clear();
  }

  get clientCount() {
    return this.clients.size;
  }
}
