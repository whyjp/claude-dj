/**
 * dashboard.js
 * Manages tab switching, event log, and WebSocket status indicator.
 */

let _logEntries = [];
let _logFilter = '';

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
    `<span class="le-m">${_esc(truncated)}</span>`;

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

function _esc(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
