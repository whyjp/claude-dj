/**
 * app.js — ClaudeDJ Virtual DJ main entry point
 *
 * Connects to the Bridge WebSocket, routes messages to the D200 renderer,
 * and handles button press events from the virtual grid.
 */

import { initGrid, onPress, renderLayout, renderAllDim, setConnectionOverlay, updateMiniAgentTabs } from './d200-renderer.js';
import { initDashboard, log, updateWsStatus, clearLog, updateSession, dimAllSessions, disconnectSessions, setSessions, switchLogSession } from './dashboard.js';
import { initTranslator, handleTranslatorStatus, handleTranslatorLog } from './translator.js';

let VERSION = '0.6.7';
const WS_PATH = '/ws';
const RECONNECT_DELAY = 3000;

let _ws = null;
let _reconnectTimer = null;
let _manualDisconnect = false;

// ── Bootstrap ────────────────────────────────────────────────

function _updateAboutVersion() {
  const el = document.getElementById('about-version');
  if (el) el.textContent = VERSION;
}

function init() {
  initGrid();
  initDashboard();
  initTranslator();
  _initMiniview();
  _updateAboutVersion();

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
      if (msg.version) { VERSION = msg.version; _updateAboutVersion(); }
      log('sys', `Bridge v${msg.version || '?'} — ${(msg.sessions || []).length} session(s)`);
      if (msg.sessions) setSessions(msg.sessions);
      if (msg.sessions && msg.sessions.length > 0) {
        const first = msg.sessions[0];
        updateMiniAgentTabs(first.agents || [], null, _sendAgentFocus);
      }
      break;

    case 'LAYOUT':
      renderLayout(msg);
      updateSession(msg);
      updateMiniAgentTabs(msg.agents || [], msg.agent?.agentId || null, _sendAgentFocus);
      if (msg.focusSwitched && sid) {
        switchLogSession(sid, msg.agent?.agentId || null);
      }
      break;

    case 'TRANSLATOR_STATUS':
      handleTranslatorStatus(msg);
      return sid;

    case 'TRANSLATOR_LOG':
      handleTranslatorLog(msg.entry);
      return sid;

    case 'ALL_DIM':
      renderAllDim();
      dimAllSessions();
      updateMiniAgentTabs([], null, _sendAgentFocus);
      break;

    case 'SESSION_DISCONNECTED':
      renderAllDim();
      disconnectSessions(msg.sessionIds || [], msg.reason || 'process_exit');
      break;

    case 'SESSIONS_UPDATE':
      if (msg.sessions) setSessions(msg.sessions);
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

// ── Miniview ─────────────────────────────────────────────────

const MINI_WIDTH = 840;
const MINI_HEIGHT = 580;

function _initMiniview() {
  const params = new URLSearchParams(location.search);
  const isMini = params.get('view') === 'mini';

  if (isMini) {
    document.body.classList.add('mini');
  }

  // Header button → open miniview as always-on-top PiP (fallback: popup)
  const btnToggle = document.getElementById('btnMiniToggle');
  if (btnToggle) {
    btnToggle.addEventListener('click', () => _openMiniPopup());
  }

  // Expand button → close popup/PiP OR switch to full view inline
  const agentBar = document.getElementById('miniAgentBar');
  if (agentBar) {
    agentBar.addEventListener('click', (e) => {
      if (!e.target.closest('.ma-expand')) return;
      if (window.opener || documentPictureInPicture?.window === window) {
        window.close();
      } else {
        document.body.classList.remove('mini');
        const p = new URLSearchParams(location.search);
        p.delete('view');
        const qs = p.toString();
        history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
      }
    });
  }
}

async function _openMiniPopup() {
  const miniUrl = `${location.origin}${location.pathname}?view=mini`;

  // Try Document Picture-in-Picture (always-on-top)
  if ('documentPictureInPicture' in window) {
    try {
      const pip = await documentPictureInPicture.requestWindow({
        width: MINI_WIDTH,
        height: MINI_HEIGHT,
      });
      pip.document.head.innerHTML = '<style>body{margin:0;overflow:hidden;}</style>';
      const iframe = pip.document.createElement('iframe');
      iframe.src = miniUrl;
      iframe.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:none;';
      pip.document.body.appendChild(iframe);
      return;
    } catch { /* user dismissed or API error — fall through */ }
  }

  // Fallback: regular popup (no always-on-top)
  const left = (screen.width - MINI_WIDTH) / 2;
  const top = (screen.height - MINI_HEIGHT) / 2;
  window.open(miniUrl, 'claude-dj-mini',
    `popup,width=${MINI_WIDTH},height=${MINI_HEIGHT},left=${left},top=${top}`);
}

function _sendAgentFocus(agentId) {
  _sendJson({ type: 'AGENT_FOCUS', agentId: agentId || null });
}

// ── Start ─────────────────────────────────────────────────────

init();
