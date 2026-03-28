/**
 * dashboard.js
 * Manages tab switching, event log, session list, and WebSocket status indicator.
 */
import { esc } from './util.js';

let _logEntries = [];
let _logFilter = '';

/** @type {Map<string, {id:string, name:string, state:string, waitingSince:number|null}>} */
let _sessions = new Map();
let _sessionDurTimer = null;

const DIR_SYMBOL = { in: '←', out: '→', sys: '·', err: '!' };
const DIR_CLASS  = { in: 'in-e', out: 'out-e', err: 'err-e', sys: '' };

/** Initialize tab switcher and log controls */
export function initDashboard() {
  // Tab switching
  const tabBar = document.getElementById('tabBar');
  if (tabBar) {
    tabBar.addEventListener('click', e => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      const name = tab.dataset.tab;
      if (name) _switchTab(name);
    });
  }

  // Log filter input
  const logFil = document.getElementById('logFil');
  if (logFil) {
    logFil.addEventListener('input', () => {
      _logFilter = logFil.value;
      _reRenderLog();
    });
  }

  // Clear log buttons
  const clearBtn1 = document.getElementById('btnClearLog');
  const clearBtn2 = document.getElementById('btnClearLog2');
  const clearFn = () => clearLog();
  if (clearBtn1) clearBtn1.addEventListener('click', clearFn);
  if (clearBtn2) clearBtn2.addEventListener('click', clearFn);
}

/** Switch to a named tab */
function _switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('on', t.dataset.tab === name);
  });
  document.querySelectorAll('.pane').forEach(p => {
    p.classList.toggle('on', p.id === `pane-${name}`);
  });
}

/**
 * Append an entry to the event log.
 * @param {'in'|'out'|'sys'|'err'} direction
 * @param {string} msg
 */
export function log(direction, msg) {
  const now = new Date();
  const t = [
    now.getHours().toString().padStart(2, '0'),
    now.getMinutes().toString().padStart(2, '0'),
    now.getSeconds().toString().padStart(2, '0'),
  ].join(':');

  const entry = { dir: direction, msg, t };
  _logEntries.push(entry);
  if (_logEntries.length > 500) _logEntries.shift();

  _appendEntry(entry);
  _updateBadge();
}

/** Update the WebSocket connection status dot + label */
export function updateWsStatus(state) {
  // state: 'connected' | 'connecting' | 'error' | '' (disconnected)
  const dot = document.getElementById('wsDot');
  const lbl = document.getElementById('wsLbl');
  const iWs = document.getElementById('iWs');
  const btn = document.getElementById('btnConn');

  const labels = {
    connected:  'connected',
    connecting: 'connecting…',
    error:      'error',
    '':         'disconnected',
  };
  const label = labels[state] ?? 'disconnected';

  if (dot) dot.className = 'ws-dot ' + state;
  if (lbl) lbl.textContent = label;
  if (iWs) iWs.textContent = label;

  if (btn) {
    if (state === 'connected') {
      btn.textContent = 'disconnect';
      btn.className = 'btn-s warn';
    } else {
      btn.textContent = 'connect';
      btn.className = 'btn-s';
    }
  }
}

// ── Sessions ──────────────────────────────────────────────

/**
 * Update session list from a LAYOUT message.
 * @param {{session?: {id:string, name:string, state:string}, sessionCount?: number}} msg
 */
export function updateSession(msg) {
  const s = msg.session;
  if (!s || !s.id) return;

  const existing = _sessions.get(s.id);
  const isWaiting = s.state === 'WAITING_BINARY' || s.state === 'WAITING_CHOICE';
  const wasWaiting = existing && (existing.state === 'WAITING_BINARY' || existing.state === 'WAITING_CHOICE');

  _sessions.set(s.id, {
    id: s.id,
    name: s.name || s.id.slice(0, 8),
    state: s.state,
    waitingSince: isWaiting ? (wasWaiting ? existing.waitingSince : Date.now()) : null,
  });

  _renderSessions();
  _ensureDurTimer();
}

/**
 * Mark all sessions as IDLE (from ALL_DIM message).
 */
export function dimAllSessions() {
  for (const [id, s] of _sessions) {
    _sessions.set(id, { ...s, state: 'IDLE', waitingSince: null });
  }
  _renderSessions();
}

/**
 * Bulk-set sessions from WELCOME message.
 * @param {{id:string, name:string, state:string}[]} list
 */
export function setSessions(list) {
  _sessions.clear();
  for (const s of list) {
    if (!s.id) continue;
    const isWaiting = s.state === 'WAITING_BINARY' || s.state === 'WAITING_CHOICE';
    _sessions.set(s.id, {
      id: s.id,
      name: s.name || s.id.slice(0, 8),
      state: s.state || 'IDLE',
      waitingSince: isWaiting ? Date.now() : null,
    });
  }
  _renderSessions();
  _ensureDurTimer();
}

/** Get sessions map (for testing) */
export function getSessions() {
  return _sessions;
}

/** Clear all log entries */
export function clearLog() {
  _logEntries = [];
  const el = document.getElementById('elog');
  if (el) el.innerHTML = '';
  _updateBadge();
}

// ── Internals ──────────────────────────────────────────────

function _appendEntry(entry) {
  const { dir, msg, t } = entry;
  if (_logFilter && !msg.toLowerCase().includes(_logFilter.toLowerCase())) return;

  const el = document.createElement('div');
  el.className = `le ${DIR_CLASS[dir] || ''}`;
  const truncated = msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
  el.innerHTML =
    `<span class="le-t">${t}</span>` +
    `<span class="le-d ${dir}">${DIR_SYMBOL[dir] || '·'}</span>` +
    `<span class="le-m">${esc(truncated)}</span>`;

  const elog = document.getElementById('elog');
  if (!elog) return;
  elog.appendChild(el);

  const autoScroll = document.getElementById('aScroll');
  if (!autoScroll || autoScroll.checked) {
    elog.scrollTop = elog.scrollHeight;
  }
}

function _reRenderLog() {
  const elog = document.getElementById('elog');
  if (!elog) return;
  elog.innerHTML = '';
  _logEntries.forEach(e => _appendEntry(e));
}

function _updateBadge() {
  const badge = document.getElementById('lbadge');
  if (!badge) return;
  const count = _logEntries.length;
  badge.textContent = count > 99 ? '99+' : count > 0 ? count : '';
}

// _esc imported from util.js as esc

// ── Session internals ─────────────────────────────────────

const STATE_LABELS = {
  IDLE: 'idle',
  PROCESSING: 'processing',
  WAITING_BINARY: 'waiting',
  WAITING_CHOICE: 'choosing',
};

function _renderSessions() {
  const list = document.getElementById('sessList');
  const empty = document.getElementById('sessEmpty');
  if (!list) return;

  list.innerHTML = '';
  const entries = Array.from(_sessions.values());

  if (empty) empty.classList.toggle('hide', entries.length > 0);

  for (const s of entries) {
    const row = document.createElement('div');
    row.className = 'sess-row';
    row.dataset.sid = s.id;

    const dur = s.waitingSince ? _fmtDur(Date.now() - s.waitingSince) : '';

    row.innerHTML =
      `<span class="sess-dot ${esc(s.state)}"></span>` +
      `<span class="sess-name">${esc(s.name)}</span>` +
      `<span class="sess-state">${STATE_LABELS[s.state] || s.state}</span>` +
      `<span class="sess-dur">${dur}</span>`;

    list.appendChild(row);
  }

  _updateSessionBadge();
}

function _updateSessionBadge() {
  const badge = document.getElementById('sbadge');
  if (!badge) return;
  const count = _sessions.size;
  badge.textContent = count > 0 ? count : '';
}

function _fmtDur(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m${rem.toString().padStart(2, '0')}s`;
}

/** Start a 1s timer to keep waiting durations up to date */
function _ensureDurTimer() {
  if (_sessionDurTimer) return;
  _sessionDurTimer = setInterval(() => {
    const hasWaiting = Array.from(_sessions.values()).some(s => s.waitingSince);
    if (hasWaiting) {
      _renderSessions();
    } else {
      clearInterval(_sessionDurTimer);
      _sessionDurTimer = null;
    }
  }, 1000);
}
