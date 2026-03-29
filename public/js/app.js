/**
 * app.js — ClaudeDJ Virtual DJ main entry point
 *
 * Connects to the Bridge WebSocket, routes messages to the D200 renderer,
 * and handles button press events from the virtual grid.
 */

import { initGrid, onPress, renderLayout, renderAllDim, setConnectionOverlay } from './d200-renderer.js';
import { initDashboard, log, updateWsStatus, clearLog, updateSession, dimAllSessions, disconnectSessions, setSessions, switchLogSession } from './dashboard.js';

const VERSION = '0.1.0';
const WS_PATH = '/ws';
const RECONNECT_DELAY = 3000;

let _ws = null;
let _reconnectTimer = null;
let _manualDisconnect = false;

// ── Bootstrap ────────────────────────────────────────────────

function init() {
  initGrid();
  initDashboard();

  // Populate WS URL input with default
  const wsInput = document.getElementById('wsUrlInput');
  if (wsInput) wsInput.value = `ws://${location.host}${WS_PATH}`;

  // Connect button toggles connection
  const btnConn = document.getElementById('btnConn');
  if (btnConn) {
    btnConn.addEventListener('click', () => {
      if (_ws && _ws.readyState === WebSocket.OPEN) {
        _manualDisconnect = true;
        _disconnect();
      } else {
        _manualDisconnect = false;
        _connect();
      }
    });
  }

  // Reconnect button in settings
  const btnReconnect = document.getElementById('btnReconnect');
  if (btnReconnect) {
    btnReconnect.addEventListener('click', () => {
      _manualDisconnect = false;
      _disconnect();
      _connect();
    });
  }

  // Keyboard shortcuts: 1-9 map to slots 0-8
  document.addEventListener('keydown', e => {
    const n = parseInt(e.key);
    if (!isNaN(n) && n >= 1 && n <= 9) {
      _simulatePress(n - 1);
    }
  });

  // Register key press handler from renderer
  onPress(slot => {
    _sendButtonPress(slot);
  });

  // Start connection
  _connect();

  log('sys', 'ClaudeDJ Virtual DJ v' + VERSION + ' ready');
  log('sys', 'Connecting to Bridge at ' + `ws://${location.host}${WS_PATH}`);
}

// ── WebSocket ────────────────────────────────────────────────

function _connect() {
  if (_ws && _ws.readyState !== WebSocket.CLOSED) return;

  const wsInput = document.getElementById('wsUrlInput');
  const url = (wsInput && wsInput.value.trim()) || `ws://${location.host}${WS_PATH}`;

  updateWsStatus('connecting');
  setConnectionOverlay('connecting');

  try {
    _ws = new WebSocket(url);

    _ws.onopen = () => {
      updateWsStatus('connected');
      setConnectionOverlay('connected');
      log('sys', `Connected: ${url}`);
      _clearReconnect();
      _sendJson({ type: 'CLIENT_READY', clientType: 'virtual', version: VERSION });
    };

    _ws.onmessage = e => {
      try {
        const msg = JSON.parse(e.data);
        const sid = msg.session?.id || null;
        const aid = msg.agent?.agentId || null;
        _handleMessage(msg);
        log('in', e.data, sid, aid);
      } catch {
        log('err', `Parse error: ${String(e.data).slice(0, 80)}`);
      }
    };

    _ws.onclose = () => {
      updateWsStatus('');
      setConnectionOverlay('disconnected');
      log('sys', 'Disconnected');
      _ws = null;
      if (!_manualDisconnect) _scheduleReconnect();
    };

    _ws.onerror = () => {
      updateWsStatus('error');
      setConnectionOverlay('error');
      log('err', 'WebSocket error');
    };
  } catch (err) {
    updateWsStatus('error');
    log('err', `Connection failed: ${err.message}`);
    if (!_manualDisconnect) _scheduleReconnect();
  }
}

function _disconnect() {
  _clearReconnect();
  if (_ws) {
    _ws.onclose = null; // suppress auto-reconnect on manual close
    _ws.close();
    _ws = null;
  }
  updateWsStatus('');
  log('sys', 'Disconnected manually');
}

function _scheduleReconnect() {
  const chkAuto = document.getElementById('chkAutoReconnect');
  if (chkAuto && !chkAuto.checked) return;
  _clearReconnect();
  log('sys', `Reconnecting in ${RECONNECT_DELAY / 1000}s…`);
  _reconnectTimer = setTimeout(() => _connect(), RECONNECT_DELAY);
}

function _clearReconnect() {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
}

// ── Message routing ───────────────────────────────────────────

function _handleMessage(msg) {
  const sid = msg.session?.id || null;
  switch (msg.type) {
    case 'WELCOME':
      log('sys', `Bridge v${msg.version || '?'} — ${(msg.sessions || []).length} session(s)`);
      if (msg.sessions) setSessions(msg.sessions);
      break;

    case 'LAYOUT':
      renderLayout(msg);
      updateSession(msg);
      if (msg.focusSwitched && sid) {
        switchLogSession(sid, msg.agent?.agentId || null);
      }
      break;

    case 'ALL_DIM':
      renderAllDim();
      dimAllSessions();
      break;

    case 'SESSION_DISCONNECTED':
      renderAllDim();
      disconnectSessions(msg.sessionIds || [], msg.reason || 'process_exit');
      break;

    default:
      // Unknown message — already logged by onmessage handler
      break;
  }
  return sid;
}

// ── Outbound ─────────────────────────────────────────────────

function _sendButtonPress(slot) {
  const payload = { type: 'BUTTON_PRESS', slot, timestamp: Date.now() };
  _sendJson(payload);
}

function _sendJson(obj) {
  const str = JSON.stringify(obj);
  const chkLog = document.getElementById('chkLogOutbound');
  const shouldLog = !chkLog || chkLog.checked;

  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(str);
    if (shouldLog) log('out', str);
  } else {
    log('err', `Not connected — dropped: ${str.slice(0, 60)}`);
  }
}

// ── Keyboard press simulation ─────────────────────────────────

function _simulatePress(slot) {
  const el = document.querySelector(`[data-slot="${slot}"]`);
  if (el && !el.classList.contains('dim')) {
    el.click();
  }
}

// ── Start ─────────────────────────────────────────────────────

init();
