/**
 * dashboard.js
 * Manages tab switching, event log, session list, and WebSocket status indicator.
 */
import { esc } from './util.js';

let _logEntries = [];
let _logFilter = '';
let _logSessionFilter = '__all__'; // '__all__' or session id
let _logAgentFilter = null; // null = all agents in session, or agent id

/** @type {Map<string, {id:string, name:string, state:string, waitingSince:number|null, agents:Array}>} */
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

  // Log session sub-tabs (root row)
  const logTabs = document.getElementById('logTabs');
  if (logTabs) {
    logTabs.addEventListener('click', e => {
      const tab = e.target.closest('.log-tab');
      if (!tab) return;
      const sid = tab.dataset.sid;
      if (sid === '__all__') {
        _logSessionFilter = '__all__';
        _logAgentFilter = null;
      } else {
        _logSessionFilter = sid;
        _logAgentFilter = null;
      }
      _rebuildLogTabs();
      _reRenderLog();
    });
  }

  // Log agent sub-tabs (child row)
  const logTabsChild = document.getElementById('logTabsChild');
  if (logTabsChild) {
    logTabsChild.addEventListener('click', e => {
      const tab = e.target.closest('.log-tab');
      if (!tab) return;
      const aid = tab.dataset.aid || null;
      _logAgentFilter = aid;
      _rebuildLogTabs();
      _reRenderLog();
    });
  }
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
 * @param {string} [sessionId] - optional session ID for per-session filtering
 * @param {string} [agentId] - optional agent ID for per-agent filtering
 */
export function log(direction, msg, sessionId, agentId) {
  const now = new Date();
  const t = [
    now.getHours().toString().padStart(2, '0'),
    now.getMinutes().toString().padStart(2, '0'),
    now.getSeconds().toString().padStart(2, '0'),
  ].join(':');

  const entry = { dir: direction, msg, t, sid: sessionId || null, aid: agentId || null };
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
    agents: msg.agents || existing?.agents || [],
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
 * Mark specific sessions as DISCONNECTED and log the event.
 * @param {string[]} sessionIds
 * @param {'process_exit'|'idle_timeout'} reason
 */
export function disconnectSessions(sessionIds, reason) {
  const reasonLabel = reason === 'process_exit' ? 'process exited' : 'idle timeout';
  for (const id of sessionIds) {
    const s = _sessions.get(id);
    if (s) {
      _sessions.set(id, { ...s, state: 'DISCONNECTED', waitingSince: null });
      log('sys', `Session disconnected: ${s.name} (${reasonLabel})`, id);
    } else {
      log('sys', `Session disconnected: ${id.slice(0, 8)} (${reasonLabel})`, id);
    }
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
      agents: s.agents || [],
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

/** Rebuild log tabs: Row 1 = All + root sessions. Row 2 = child agents (visible when root selected). */
function _rebuildLogTabs() {
  const container = document.getElementById('logTabs');
  const childContainer = document.getElementById('logTabsChild');
  if (!container) return;

  container.innerHTML = '';

  // All tab
  const allTab = document.createElement('div');
  allTab.className = `log-tab ${_logSessionFilter === '__all__' ? 'on' : ''}`;
  allTab.dataset.sid = '__all__';
  allTab.textContent = 'All';
  container.appendChild(allTab);

  // Root session tabs
  for (const s of _sessions.values()) {
    const tab = document.createElement('div');
    const isActive = _logSessionFilter === s.id;
    const agentCount = s.agents ? s.agents.length : 0;
    tab.className = `log-tab ${isActive ? 'on' : ''}`;
    tab.dataset.sid = s.id;
    tab.textContent = s.name.split(' ')[0] + (agentCount > 0 ? ` (${agentCount})` : '');
    container.appendChild(tab);
  }

  // Child row: only visible when a root with agents is selected
  if (childContainer) {
    childContainer.innerHTML = '';
    if (_logSessionFilter !== '__all__') {
      const sess = _sessions.get(_logSessionFilter);
      if (sess && sess.agents && sess.agents.length > 0) {
        // "Root" tab = show all logs for this session (no agent filter)
        const rootTab = document.createElement('div');
        rootTab.className = `log-tab ${_logAgentFilter === null ? 'on' : ''}`;
        rootTab.dataset.sid = _logSessionFilter;
        rootTab.textContent = 'root';
        childContainer.appendChild(rootTab);

        for (const a of sess.agents) {
          const tab = document.createElement('div');
          const isActive = _logAgentFilter === a.agentId;
          tab.className = `log-tab ${isActive ? 'on' : ''}`;
          tab.dataset.sid = _logSessionFilter;
          tab.dataset.aid = a.agentId;
          tab.textContent = a.type || a.agentId.slice(0, 6);
          childContainer.appendChild(tab);
        }
        childContainer.style.display = '';
      } else {
        childContainer.style.display = 'none';
      }
    } else {
      childContainer.style.display = 'none';
    }
  }
}

/** Switch event log to a specific session/agent tab */
export function switchLogSession(sessionId, agentId) {
  if (!sessionId) return;
  _logSessionFilter = sessionId;
  _logAgentFilter = agentId || null;
  _rebuildLogTabs();
  _reRenderLog();
}

// ── Internals ──────────────────────────────────────────────

function _matchesFilter(entry) {
  if (_logFilter && !entry.msg.toLowerCase().includes(_logFilter.toLowerCase())) return false;
  if (_logSessionFilter !== '__all__') {
    if (entry.sid && entry.sid !== _logSessionFilter) return false;
    // Agent filter: if set, only show entries from that agent (+ root entries with no aid)
    if (_logAgentFilter && entry.aid && entry.aid !== _logAgentFilter) return false;
  }
  return true;
}

function _appendEntry(entry) {
  if (!_matchesFilter(entry)) return;

  const { dir, msg, t, sid } = entry;
  const el = document.createElement('div');
  el.className = `le ${DIR_CLASS[dir] || ''}`;
  const truncated = msg.length > 200 ? msg.slice(0, 200) + '…' : msg;

  const sidTag = sid && _logSessionFilter === '__all__'
    ? `<span class="le-sid">${esc(sid.slice(0, 6))}</span>`
    : '';

  el.innerHTML =
    `<span class="le-t">${t}</span>` +
    `<span class="le-d ${dir}">${DIR_SYMBOL[dir] || '·'}</span>` +
    sidTag +
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
  WAITING_RESPONSE: 'awaiting input',
  DISCONNECTED: 'disconnected',
};

function _renderSessions() {
  const list = document.getElementById('sessList');
  const empty = document.getElementById('sessEmpty');
  if (!list) return;

  list.innerHTML = '';
  const entries = Array.from(_sessions.values());

  if (empty) empty.classList.toggle('hide', entries.length > 0);
  _rebuildLogTabs();

  for (const s of entries) {
    const row = document.createElement('div');
    row.className = 'sess-row';
    row.dataset.sid = s.id;

    const dur = s.waitingSince ? _fmtDur(Date.now() - s.waitingSince) : '';
    const agentCount = s.agents ? s.agents.length : 0;
    const agentBadge = agentCount > 0
      ? `<span class="sess-agents">${agentCount} agent${agentCount > 1 ? 's' : ''}</span>`
      : '';

    row.innerHTML =
      `<span class="sess-dot ${esc(s.state)}"></span>` +
      `<span class="sess-name">${esc(s.name)}</span>` +
      agentBadge +
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
