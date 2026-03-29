/**
 * d200-renderer.js
 * Manages the D200 hardware simulator DOM — grid init, state rendering, press callbacks.
 */
import { esc } from './util.js';

const CHOICE_COLORS = [
  'var(--cc0)', 'var(--cc1)', 'var(--cc2)', 'var(--cc3)',
  'var(--cc4)', 'var(--cc5)', 'var(--cc6)', 'var(--cc7)', 'var(--cc8)',
];

let _pressHandler = null;

/** Register a click callback: fn(slot) */
export function onPress(fn) {
  _pressHandler = fn;
}

/** Build all DOM elements for the D200 grid into #d200grid */
export function initGrid() {
  const grid = document.getElementById('d200grid');
  if (!grid) return;

  // Row 0: slots 0-4
  const r0 = _makeRow('kg5');
  for (let i = 0; i <= 4; i++) r0.appendChild(_makeKey(i));
  grid.appendChild(r0);

  // Row 1: slots 5-9 (all dynamic)
  const r1 = _makeRow('kg5');
  for (let i = 5; i <= 9; i++) r1.appendChild(_makeKey(i));
  grid.appendChild(r1);

  // Row 2: slot 10 (session count) + slot 11 (session name/switch) + slot 12 (agent switch) + Info Display area (system-only, non-interactive)
  const r2 = _makeRow('kgl');
  r2.appendChild(_makeCountKey());
  r2.appendChild(_makeSessKey());
  r2.appendChild(_makeAgentKey());
  r2.appendChild(_makeInfoDisplay());
  grid.appendChild(r2);
}

function _makeRow(cls) {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

function _makeKey(slot) {
  const k = document.createElement('div');
  k.className = 'k dim';
  k.dataset.slot = slot;
  k.addEventListener('click', () => {
    if (k.classList.contains('dim')) return;
    _firePress(slot, k);
  });
  return k;
}

function _makeCountKey() {
  const k = document.createElement('div');
  k.className = 'k count';
  k.dataset.slot = '10';
  k.innerHTML = `<span class="cnt-n" id="cntN">0</span><span class="cnt-l">sessions</span>`;
  return k;
}

function _makeAgentKey() {
  const k = document.createElement('div');
  k.className = 'k agent-switch';
  k.dataset.slot = '12';
  k.innerHTML = `<span class="agent-ico">◈</span><span class="agent-n" id="agentN">ROOT</span>`;
  k.addEventListener('click', () => {
    _firePress(12, k);
  });
  return k;
}

function _updateAgentKey(agent, agentCount) {
  const nameEl = document.getElementById('agentN');
  if (nameEl) nameEl.textContent = agent ? agent.type : 'ROOT';
  const k = _getK(12);
  if (!k) return;
  k.querySelector('.agent-badge')?.remove();
  if (agentCount > 0) {
    const b = document.createElement('div');
    b.className = 'agent-badge';
    b.textContent = agentCount;
    k.appendChild(b);
  }
}

function _makeSessKey() {
  const k = document.createElement('div');
  k.className = 'k sess-switch';
  k.dataset.slot = '11';
  k.innerHTML = `<span class="sess-ico">⬡</span><span class="sess-n" id="sessN">—</span>`;
  k.addEventListener('click', () => {
    _firePress(11, k);
  });
  return k;
}

function _makeInfoDisplay() {
  const el = document.createElement('div');
  el.className = 'k-info';
  el.id = 'infoDisplay';
  el.innerHTML = `
    <span class="info-ico">🖥</span>
    <span class="info-nam">SYSTEM</span>
    <span class="info-sts">D200 Info Display</span>
  `;
  return el;
}

function _firePress(slot, el) {
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 280);
  if (_pressHandler) _pressHandler(slot);
}

/** Get a key element by slot number */
function _getK(slot) {
  return document.querySelector(`[data-slot="${Number(slot)}"]`);
}

/** Dim all dynamic keys (slots 0-9) and reset info display to idle.
 *  Slot 12 is the agent-switch key (not dimmed by this function). */
export function renderAllDim() {
  const dynamic = [0,1,2,3,4,5,6,7,8,9];
  for (const s of dynamic) {
    const k = _getK(s);
    if (!k) continue;
    k.className = 'k dim';
    k.innerHTML = '';
    k.removeAttribute('data-ci');
    k.style.removeProperty('--off');
  }
  _setInfoState('IDLE');
  _updateInfoDisplay({ icon: '💤', name: '—', state: 'IDLE' });
}

/** Apply a LAYOUT message from the bridge */
export function renderLayout(msg) {
  renderAllDim();

  if (msg.session) {
    const sess = msg.session;
    const nameEl = document.getElementById('iSess');
    if (nameEl) nameEl.textContent = sess.name || '—';
    _updateInfoDisplay();
  }

  switch (msg.preset) {
    case 'idle':
      _setInfoState('IDLE');
      break;

    case 'processing':
      // Dynamic keys 0-9 pulse (staggered). Slot 12 stays reserved.
      [0,1,2,3,4,5,6,7,8,9].forEach((s, idx) => {
        const k = _getK(s);
        if (!k) return;
        k.className = 'k proc';
        k.style.setProperty('--off', (idx * 0.1) + 's');
        k.innerHTML = '';
      });
      _setInfoState('PROCESSING');
      break;

    // Match Claude Code dialog: 1=Allow, 2=Always Allow, 3=Deny
    case 'binary': {
      const toolName = msg.prompt?.toolName || '';
      const command = msg.prompt?.command || '';
      const cmdPreview = _truncCmd(command, 18);

      _setKeyState(0, 'approve', { toolName, cmdPreview });
      if (msg.prompt?.hasAlwaysAllow) {
        _setKeyState(1, 'always', { toolName });
        _setKeyState(2, 'deny');
      } else {
        _setKeyState(1, 'deny');
      }
      _setInfoState('WAITING_BINARY');
      if (msg.prompt) {
        const actEl = document.getElementById('iAct');
        if (actEl) actEl.textContent = (command || toolName).slice(0, 28);
      }
      break;
    }

    case 'choice':
      if (msg.choices) {
        // Slots 0-9 only (max 10 choices). Slot 12 is agent-switch, never used for choices.
        msg.choices.forEach((c, i) => {
          if (i < 10) _setKeyChoice(i, i, c.index, c.label);
        });
      }
      _setInfoState('WAITING_CHOICE');
      break;

    case 'multiSelect':
      if (msg.choices) {
        msg.choices.forEach((c, i) => {
          if (i < 9) _setKeyMultiChoice(i, i, c.index, c.label, c.selected);
        });
        // Slot 9 = Submit button
        _setKeySubmit(9);
      }
      _setInfoState('WAITING_CHOICE');
      break;

    case 'awaiting_input':
      _setKeyAwaitingInput();
      _setInfoState('WAITING_RESPONSE');
      break;
  }

  // Update session count key (slot 10) and session name key (slot 11)
  if (msg.session) {
    const total = msg.sessionCount ?? 1;
    const waiting = msg.preset === 'binary' || msg.preset === 'choice' ? 1 : 0;
    _updateCount(total, waiting);
    _updateSessName(msg.session.name);
  }

  // Update agent switch key (slot 12)
  if (msg.agent !== undefined) {
    _updateAgentKey(msg.agent, msg.agentCount || 0);
  }
}

function _setKeyState(slot, state, meta) {
  const k = _getK(slot);
  if (!k) return;
  k.removeAttribute('data-ci');
  k.style.removeProperty('--off');
  switch (state) {
    case 'approve': {
      k.className = 'k approve';
      const tool = meta?.toolName ? ` ${meta.toolName}` : '';
      const cmd = meta?.cmdPreview ? `<span class="kc">${esc(meta.cmdPreview)}</span>` : '';
      k.innerHTML = `<span class="ki">✅</span><span class="kl">OK${esc(tool)}</span>${cmd}`;
      break;
    }
    case 'deny':
      k.className = 'k deny';
      k.innerHTML = `<span class="ki">❌</span><span class="kl">Deny</span>`;
      break;
    case 'always': {
      k.className = 'k always';
      const tool = meta?.toolName ? ` ${meta.toolName}` : '';
      k.innerHTML = `<span class="ki">🔒</span><span class="kl">Always${esc(tool)}</span>`;
      break;
    }
    case 'processing':
      k.className = 'k proc';
      k.style.setProperty('--off', (slot * 0.08) + 's');
      k.innerHTML = '';
      break;
    default:
      k.className = 'k dim';
      k.innerHTML = '';
  }
}

/** Truncate a command string for button preview */
function _truncCmd(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '\u2026' : str;
}

// esc imported from util.js

function _setKeyChoice(slot, ci, num, label) {
  const k = _getK(slot);
  if (!k) return;
  k.className = 'k';
  k.dataset.ci = ci;
  k.innerHTML = `<span class="kn">${esc(String(num))}</span><span class="ks">${esc(label || '')}</span>`;
}

function _setKeyMultiChoice(slot, ci, num, label, selected) {
  const k = _getK(slot);
  if (!k) return;
  k.className = selected ? 'k multi-on' : 'k multi-off';
  k.dataset.ci = ci;
  const check = selected ? '☑' : '☐';
  k.innerHTML = `<span class="kn">${check} ${esc(String(num))}</span><span class="ks">${esc(label || '')}</span>`;
}

function _setKeySubmit(slot) {
  const k = _getK(slot);
  if (!k) return;
  k.className = 'k submit';
  k.innerHTML = `<span class="ki">✔</span><span class="kl">Done</span>`;
}

function _setKeyAwaitingInput() {
  const k = _getK(4);
  if (!k) return;
  k.className = 'k awaiting';
  k.innerHTML = `<span class="ki">⏳</span><span class="kl">Awaiting input</span>`;
}

/** Update the session count key (slot 10) */
function _updateCount(total, waiting) {
  const nEl = document.getElementById('cntN');
  if (nEl) nEl.textContent = total;
  const k = _getK(10);
  if (!k) return;
  k.querySelector('.cnt-badge')?.remove();
  if (waiting > 0) {
    k.classList.add('alert');
    const b = document.createElement('div');
    b.className = 'cnt-badge';
    b.textContent = waiting;
    k.appendChild(b);
  } else {
    k.classList.remove('alert');
  }
}

/** Update the session name key (slot 11) */
function _updateSessName(name) {
  const el = document.getElementById('sessN');
  if (el) el.textContent = name || '—';
}

/** System info display — reserved by D200 hardware, non-interactive */
function _updateInfoDisplay() {
  // No-op: system key is reserved by D200 hardware ("SYSTEM / D200 Info Display")
}

/** Show/hide connection status overlay on the D200 grid */
export function setConnectionOverlay(state) {
  const grid = document.getElementById('d200grid');
  if (!grid) return;
  let ov = document.getElementById('connOverlay');

  if (state === 'connected') {
    if (ov) ov.remove();
    return;
  }

  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'connOverlay';
    ov.className = 'conn-overlay';
    grid.appendChild(ov);
  }

  if (state === 'connecting') {
    ov.className = 'conn-overlay connecting';
    ov.innerHTML = '<span class="conn-ico">&#x21bb;</span><span class="conn-msg">reconnecting\u2026</span>';
  } else if (state === 'error') {
    ov.className = 'conn-overlay error';
    ov.innerHTML = '<span class="conn-ico">&#x26a0;</span><span class="conn-msg">connection lost</span>';
  } else {
    ov.className = 'conn-overlay';
    ov.innerHTML = '<span class="conn-ico">&#x25cb;</span><span class="conn-msg">disconnected</span>';
  }
}

/** Update the state info bar */
function _setInfoState(st) {
  const el = document.getElementById('iState');
  if (!el) return;
  el.textContent = st;
  if (st === 'IDLE')                el.className = 'si-v';
  else if (st === 'PROCESSING')     el.className = 'si-v b';
  else if (st.startsWith('WAITING')) el.className = 'si-v a';
  else if (st === 'DONE')           el.className = 'si-v g';
  else                              el.className = 'si-v';
}
