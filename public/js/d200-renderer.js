/**
 * d200-renderer.js
 * Manages the D200 hardware simulator DOM — grid init, state rendering, press callbacks.
 */

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

  // Row 1: slots 5-8 + slot 9 (session count)
  const r1 = _makeRow('kg5');
  for (let i = 5; i <= 8; i++) r1.appendChild(_makeKey(i));
  r1.appendChild(_makeCountKey());
  grid.appendChild(r1);

  // Row 2: slots 10-12 + Info Display area (system-only, non-interactive)
  const r2 = _makeRow('kgl');
  for (let i = 10; i <= 12; i++) r2.appendChild(_makeKey(i));
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
  k.dataset.slot = '9';
  k.innerHTML = `<span class="cnt-n" id="cntN">0</span><span class="cnt-l">sessions</span>`;
  return k;
}

function _makeInfoDisplay() {
  const el = document.createElement('div');
  el.className = 'k-info idle';
  el.id = 'infoDisplay';
  el.innerHTML = `
    <span class="info-ico">💤</span>
    <span class="info-nam" id="infoNam">—</span>
    <span class="info-sts" id="infoSts">IDLE</span>
    <span class="info-ses" id="infoSes"></span>
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
  return document.querySelector(`[data-slot="${slot}"]`);
}

/** Dim all dynamic keys (slots 0-8, 10-12) and reset info display to idle */
export function renderAllDim() {
  const dynamic = [0,1,2,3,4,5,6,7,8,10,11,12];
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
    _updateInfoDisplay({ name: sess.name, state: sess.state });
  }

  switch (msg.preset) {
    case 'idle':
      _setInfoState('IDLE');
      break;

    case 'processing':
      // All dynamic keys pulse (staggered)
      [0,1,2,3,4,5,6,7,8,10,11,12].forEach((s, idx) => {
        const k = _getK(s);
        if (!k) return;
        k.className = 'k proc';
        k.style.setProperty('--off', (idx * 0.1) + 's');
        k.innerHTML = '';
      });
      _setInfoState('PROCESSING');
      break;

    case 'binary':
      _setKeyState(0, 'approve');
      _setKeyState(1, 'deny');
      if (msg.prompt?.hasAlwaysAllow) _setKeyState(5, 'always');
      _setInfoState('WAITING_BINARY');
      if (msg.prompt) {
        const actEl = document.getElementById('iAct');
        if (actEl) actEl.textContent = (msg.prompt.command || msg.prompt.toolName || '').slice(0, 28);
      }
      break;

    case 'choice':
      if (msg.choices) {
        msg.choices.forEach((c, i) => {
          if (i < 9) _setKeyChoice(i, i, c.index, c.label);
        });
      }
      _setInfoState('WAITING_CHOICE');
      break;
  }

  // Update session count key if session info available
  if (msg.session) {
    const total = msg.sessionCount ?? 1;
    const waiting = msg.preset === 'binary' || msg.preset === 'choice' ? 1 : 0;
    _updateCount(total, waiting);
  }
}

function _setKeyState(slot, state) {
  const k = _getK(slot);
  if (!k) return;
  k.removeAttribute('data-ci');
  k.style.removeProperty('--off');
  switch (state) {
    case 'approve':
      k.className = 'k approve';
      k.innerHTML = `<span class="ki">✅</span><span class="kl">Approve</span>`;
      break;
    case 'deny':
      k.className = 'k deny';
      k.innerHTML = `<span class="ki">❌</span><span class="kl">Deny</span>`;
      break;
    case 'always':
      k.className = 'k always';
      k.innerHTML = `<span class="ki">🔒</span><span class="kl">Always</span>`;
      break;
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

function _setKeyChoice(slot, ci, num, label) {
  const k = _getK(slot);
  if (!k) return;
  k.className = 'k';
  k.dataset.ci = ci;
  k.innerHTML = `<span class="kn">${num}</span><span class="ks">${label || ''}</span>`;
}

/** Update the session count key (slot 9) */
function _updateCount(total, waiting) {
  const nEl = document.getElementById('cntN');
  if (nEl) nEl.textContent = total;
  const k = _getK(9);
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

/** Update the Session Info display area (non-interactive, system-only) */
function _updateInfoDisplay({ icon, name, state } = {}) {
  const el = document.getElementById('infoDisplay');
  const namEl = document.getElementById('infoNam');
  const stsEl = document.getElementById('infoSts');
  if (!el) return;

  if (namEl && name !== undefined) namEl.textContent = name || '—';
  if (stsEl && state !== undefined) stsEl.textContent = state || 'IDLE';

  const st = (state || 'IDLE').toLowerCase();
  const ico = el.querySelector('.info-ico');

  el.className = 'k-info';
  if (st.includes('waiting')) {
    el.classList.add('wait');
    if (ico) ico.textContent = '❓';
  } else if (st === 'processing') {
    el.classList.add('proc');
    if (ico) ico.textContent = '⚙️';
  } else if (st === 'done') {
    el.classList.add('done');
    if (ico) ico.textContent = '✅';
  } else {
    el.classList.add('idle');
    if (ico) ico.textContent = icon || '💤';
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
