/**
 * bridgeWsAdapter.js
 *
 * Ulanzi 플러그인 ↔ Bridge 서버(port 39200) WebSocket 연결을 관리한다.
 *
 * 역할:
 *  - Bridge로 BUTTON_PRESS { type, slot } 송신
 *  - Bridge에서 LAYOUT 수신 → onLayout 콜백 호출
 *  - 연결 단절 시 지수 백오프로 재연결 (최대 5회, 1/2/4/8/16초)
 *  - 재연결 후 Bridge에 SYNC_REQUEST 전송 → 최신 LAYOUT 재수신
 *
 * 사용:
 *   const bridge = new BridgeWsAdapter({ url: 'ws://localhost:39200/ws' });
 *   bridge.onLayout(layout => { ... });
 *   bridge.sendButtonPress(3);
 */

import WebSocket from 'ws';

const DEFAULT_URL = 'ws://localhost:39200/ws';
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000]; // 지수 백오프

export class BridgeWsAdapter {
  /**
   * @param {{ url?: string }} [options]
   */
  constructor(options = {}) {
    this.url = options.url ?? DEFAULT_URL;
    this._ws = null;
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._layoutCallback = null;
    this._destroyed = false;
    this._connected = false;

    this._connect();
  }

  /** 현재 Bridge에 연결된 상태인지 여부 */
  get isConnected() {
    return this._connected;
  }

  /**
   * LAYOUT 메시지 수신 시 호출될 콜백을 등록한다.
   * @param {(layout: object) => void} fn
   */
  onLayout(fn) {
    this._layoutCallback = fn;
  }

  /**
   * Bridge 서버로 BUTTON_PRESS 이벤트를 송신한다.
   * @param {number} slot
   */
  sendButtonPress(slot) {
    this._send({ type: 'BUTTON_PRESS', slot, timestamp: Date.now() });
  }

  /**
   * 어댑터를 종료하고 재연결을 중단한다.
   */
  destroy() {
    this._destroyed = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }

  // --- 내부 메서드 ---

  _connect() {
    if (this._destroyed) return;

    console.log(`[bridge-ws] connecting to ${this.url} (attempt ${this._reconnectAttempts + 1})`);

    const ws = new WebSocket(this.url);
    this._ws = ws;

    ws.on('open', () => {
      console.log('[bridge-ws] connected');
      this._reconnectAttempts = 0;
      this._connected = true;

      // CLIENT_READY 전송
      this._send({ type: 'CLIENT_READY', clientType: 'ulanzi-plugin', version: '0.1.0' });

      // 재연결 후 최신 상태 요청
      this._send({ type: 'SYNC_REQUEST' });
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this._handleMessage(msg);
      } catch (e) {
        console.error('[bridge-ws] parse error:', e.message);
      }
    });

    ws.on('close', (code, reason) => {
      console.warn(`[bridge-ws] closed: code=${code} reason=${reason?.toString() || ''}`);
      this._ws = null;
      this._connected = false;
      this._scheduleReconnect();
    });

    ws.on('error', (err) => {
      console.error('[bridge-ws] error:', err.message);
      // 'close' 이벤트가 이어서 발생하므로 여기서는 close 처리만 대기
    });
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'LAYOUT':
        if (this._layoutCallback) {
          this._layoutCallback(msg);
        }
        break;

      case 'ALL_DIM':
        if (this._layoutCallback) {
          this._layoutCallback({ type: 'LAYOUT', preset: 'idle' });
        }
        break;

      case 'WELCOME':
        console.log(`[bridge-ws] WELCOME from bridge v${msg.version}`);
        break;

      default:
        console.log(`[bridge-ws] unknown message type: ${msg.type}`);
    }
  }

  _scheduleReconnect() {
    if (this._destroyed) return;
    if (this._reconnectAttempts >= RECONNECT_DELAYS.length) {
      console.warn('[bridge-ws] max reconnect attempts reached, giving up');
      return;
    }

    const delay = RECONNECT_DELAYS[this._reconnectAttempts];
    this._reconnectAttempts++;
    console.log(`[bridge-ws] reconnecting in ${delay}ms (attempt ${this._reconnectAttempts}/${RECONNECT_DELAYS.length})`);

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, delay);
  }

  _send(msg) {
    if (this._ws?.readyState === WebSocket.OPEN) {
      try {
        this._ws.send(JSON.stringify(msg));
      } catch (e) {
        console.error('[bridge-ws] send error:', e.message);
      }
    } else {
      console.warn(`[bridge-ws] send skipped — not connected (type=${msg.type})`);
    }
  }
}
