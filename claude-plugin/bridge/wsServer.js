import { WebSocketServer } from 'ws';
import { log, warn, error } from './logger.js';
import { config } from './config.js';

/** 최대 보관 로그 항목 수 */
const MAX_TRANSLATOR_LOG = 200;

export class WsServer {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    // clientType별 ws 소켓 추적: 'ulanzi-plugin' | 'virtual' | 'unknown'
    this._clientMeta = new Map(); // ws → { clientType, connectedAt }
    this.onButtonPress = null;
    this.onAgentFocus = null;
    this.onSessionFocus = null;
    this.onClientReady = null;
    // Translator 교환 로그 (최근 MAX_TRANSLATOR_LOG개)
    this._translatorLog = [];
  }

  /** translator(ulanzi-plugin) 연결 여부 */
  get translatorConnected() {
    for (const meta of this._clientMeta.values()) {
      if (meta.clientType === 'ulanzi-plugin') return true;
    }
    return false;
  }

  /** translator 연결 시각 (없으면 null) */
  get translatorConnectedAt() {
    for (const meta of this._clientMeta.values()) {
      if (meta.clientType === 'ulanzi-plugin') return meta.connectedAt;
    }
    return null;
  }

  /** 최근 translator 교환 로그 배열 반환 */
  getTranslatorLog() {
    return [...this._translatorLog];
  }

  /** translator 로그 항목 추가 + 브로드캐스트 */
  _logTranslator(direction, msg, clientType) {
    const entry = {
      t: Date.now(),
      dir: direction,   // 'in' | 'out'
      type: msg.type || '?',
      clientType: clientType || 'unknown',
      payload: msg,
    };
    this._translatorLog.push(entry);
    if (this._translatorLog.length > MAX_TRANSLATOR_LOG) {
      this._translatorLog.shift();
    }
    // virtual 클라이언트에만 TRANSLATOR_LOG 브로드캐스트
    this._broadcastToVirtual({ type: 'TRANSLATOR_LOG', entry });
  }

  /** virtual 클라이언트(브라우저)에만 메시지 전송 */
  _broadcastToVirtual(msg) {
    let data;
    try { data = JSON.stringify(msg); } catch { return; }
    for (const [client, meta] of this._clientMeta.entries()) {
      if (meta.clientType !== 'ulanzi-plugin' && client.readyState === 1) {
        client.send(data);
      }
    }
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
      this._clientMeta.set(ws, { clientType: 'unknown', connectedAt: Date.now() });
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
        this._clientMeta.delete(ws);
      });

      ws.on('close', () => {
        const meta = this._clientMeta.get(ws);
        this.clients.delete(ws);
        this._clientMeta.delete(ws);
        log(`[ws] client disconnected (total: ${this.clients.size})`);
        // translator 연결 해제 시 virtual에 알림
        if (meta?.clientType === 'ulanzi-plugin') {
          this._broadcastToVirtual({ type: 'TRANSLATOR_STATUS', connected: false });
        }
      });
    });
  }

  _handleMessage(ws, msg) {
    const meta = this._clientMeta.get(ws);
    switch (msg.type) {
      case 'CLIENT_READY': {
        const clientType = msg.clientType || 'unknown';
        log(`[ws] client ready: ${clientType} v${msg.version}`);
        if (meta) {
          meta.clientType = clientType;
          meta.version = msg.version || '?';
        }
        // translator 연결 확인 시 virtual에 상태 알림
        if (clientType === 'ulanzi-plugin') {
          this._broadcastToVirtual({
            type: 'TRANSLATOR_STATUS',
            connected: true,
            connectedAt: meta?.connectedAt,
            version: msg.version || '?',
          });
          this._logTranslator('in', msg, clientType);
        }
        if (this.onClientReady) this.onClientReady(ws);
        break;
      }
      case 'BUTTON_PRESS': {
        const slot = Number(msg.slot);
        // D200H: 5×4=20키, 행-우선 슬롯 0~19. 슬롯 11=세션전환, 12=에이전트전환도 포함.
        if (!Number.isInteger(slot) || slot < 0 || slot > 19) {
          warn(`[ws] BUTTON_PRESS dropped — invalid slot: ${msg.slot}`);
          break;
        }
        log(`[ws] BUTTON_PRESS slot=${slot}`);
        // translator에서 온 버튼 누름은 로그
        if (meta?.clientType === 'ulanzi-plugin') {
          this._logTranslator('in', msg, meta.clientType);
        }
        if (this.onButtonPress) {
          this.onButtonPress(slot, msg.timestamp);
        } else {
          warn(`[ws] BUTTON_PRESS dropped — no handler registered`);
        }
        break;
      }
      case 'SYNC_REQUEST':
        // translator 재연결 후 최신 상태 요청 — 로그만 기록, 처리는 server.js onClientReady에서
        if (meta?.clientType === 'ulanzi-plugin') {
          this._logTranslator('in', msg, meta.clientType);
        }
        break;
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
    const fullMsg = { type: msg.type || 'LAYOUT', ...msg };
    let data;
    try { data = JSON.stringify(fullMsg); }
    catch (e) { error('[ws] broadcast serialize error:', e.message); return; }
    const stale = [];
    let sentToTranslator = false;
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(data);
        const meta = this._clientMeta.get(client);
        if (meta?.clientType === 'ulanzi-plugin') sentToTranslator = true;
      } else {
        stale.push(client);
      }
    }
    for (const c of stale) {
      this.clients.delete(c);
      this._clientMeta.delete(c);
    }
    // translator가 연결된 경우 브로드캐스트 메시지를 로그에 기록
    if (sentToTranslator) {
      this._logTranslator('out', fullMsg, 'bridge');
    }
  }

  sendWelcome(ws, sessions) {
    const fullMsg = {
      type: 'WELCOME',
      version: config.version,
      sessions,
    };
    const data = JSON.stringify(fullMsg);
    if (ws.readyState === 1) {
      ws.send(data);
      const meta = this._clientMeta.get(ws);
      if (meta?.clientType === 'ulanzi-plugin') {
        this._logTranslator('out', fullMsg, 'bridge');
      }
    }
  }

  get clientCount() {
    return this.clients.size;
  }
}
