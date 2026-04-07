/**
 * translator.js — Translator 탭 UI 관리
 *
 * - Translator(ulanzi-plugin) 연결 상태 표시
 * - Bridge ↔ Translator 메시지 교환 로그 뷰어
 * - 초기 로드 시 /api/translator/status REST로 기존 로그 복원
 */

import { esc } from './util.js';

const MAX_ENTRIES = 200;

let _entries = [];
let _filter = '';

// ── Init ──────────────────────────────────────────────────────

export function initTranslator() {
  // 필터 입력
  const fil = document.getElementById('trFil');
  if (fil) {
    fil.addEventListener('input', () => {
      _filter = fil.value.trim().toLowerCase();
      _rebuildLog();
    });
  }

  // clear 버튼
  const btnClear = document.getElementById('btnTrClear');
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      _entries = [];
      _rebuildLog();
    });
  }

  // 초기 상태 REST 조회
  _fetchInitialStatus();
}

async function _fetchInitialStatus() {
  try {
    const r = await fetch('/api/translator/status');
    if (!r.ok) return;
    const data = await r.json();
    // 연결 상태 반영
    handleTranslatorStatus({
      connected: data.connected,
      connectedAt: data.connectedAt,
    });
    // 기존 로그 복원
    if (Array.isArray(data.log)) {
      for (const entry of data.log) {
        _entries.push(entry);
      }
      if (_entries.length > MAX_ENTRIES) _entries = _entries.slice(-MAX_ENTRIES);
      _rebuildLog();
    }
  } catch { /* bridge not running yet */ }
}

// ── Public API ────────────────────────────────────────────────

/**
 * TRANSLATOR_STATUS 메시지 처리
 * @param {{ connected: boolean, connectedAt?: number, version?: string }} msg
 */
export function handleTranslatorStatus(msg) {
  const dot = document.getElementById('trConnDot');
  const lbl = document.getElementById('trConnLbl');
  const time = document.getElementById('trConnTime');
  const tabDot = document.getElementById('trDot');

  if (msg.connected) {
    dot?.classList.add('on');
    lbl?.classList.add('on');
    if (lbl) lbl.textContent = `ulanzi-plugin${msg.version ? ' v' + msg.version : ''}`;
    if (time && msg.connectedAt) {
      time.textContent = 'since ' + _fmtTime(msg.connectedAt);
    }
    tabDot?.classList.add('on');
  } else {
    dot?.classList.remove('on');
    lbl?.classList.remove('on');
    if (lbl) lbl.textContent = 'disconnected';
    if (time) time.textContent = '';
    tabDot?.classList.remove('on');
  }
}

/**
 * TRANSLATOR_LOG 항목 처리
 * @param {{ t: number, dir: 'in'|'out', type: string, clientType: string, payload: object }} entry
 */
export function handleTranslatorLog(entry) {
  if (!entry) return;
  _entries.push(entry);
  if (_entries.length > MAX_ENTRIES) _entries.shift();

  // BUTTON_PRESS 수신 시 슬롯 카운트 업데이트는 별도 처리 없이 로그에서 파악
  _appendEntry(entry);
  _scrollToBottom();
}

// ── Rendering ─────────────────────────────────────────────────

function _rebuildLog() {
  const container = document.getElementById('trLog');
  if (!container) return;
  container.innerHTML = '';
  const filtered = _filter
    ? _entries.filter(e => e.type.toLowerCase().includes(_filter) || (e.payload?.preset || '').toLowerCase().includes(_filter))
    : _entries;
  for (const entry of filtered) {
    container.appendChild(_makeRow(entry));
  }
  _scrollToBottom();
}

function _appendEntry(entry) {
  if (_filter && !entry.type.toLowerCase().includes(_filter) && !(entry.payload?.preset || '').toLowerCase().includes(_filter)) return;
  const container = document.getElementById('trLog');
  if (!container) return;
  container.appendChild(_makeRow(entry));
  // 최대 DOM 노드 수 제한
  while (container.children.length > MAX_ENTRIES) {
    container.removeChild(container.firstChild);
  }
}

function _makeRow(entry) {
  const row = document.createElement('div');
  row.className = 'tr-entry';

  // 시각
  const tEl = document.createElement('span');
  tEl.className = 'tr-entry-time';
  tEl.textContent = _fmtTime(entry.t);

  // 방향
  const dEl = document.createElement('span');
  dEl.className = `tr-entry-dir ${entry.dir}`;
  dEl.textContent = entry.dir === 'in' ? '←' : '→';

  // 타입
  const typeEl = document.createElement('span');
  typeEl.className = 'tr-entry-type';
  typeEl.textContent = entry.type;

  // 요약 바디
  const bodyEl = document.createElement('span');
  bodyEl.className = 'tr-entry-body';
  bodyEl.title = JSON.stringify(entry.payload, null, 2);
  bodyEl.innerHTML = _summarize(entry);

  row.appendChild(tEl);
  row.appendChild(dEl);
  row.appendChild(typeEl);
  row.appendChild(bodyEl);
  return row;
}

function _summarize(entry) {
  const p = entry.payload || {};
  switch (entry.type) {
    case 'LAYOUT': {
      const preset = p.preset || '?';
      const badge = `<span class="tr-badge ${esc(preset)}">${esc(preset)}</span>`;
      const sess = p.session?.name ? ` sess=${esc(p.session.name)}` : '';
      const choices = p.choices?.length ? ` choices=${p.choices.length}` : '';
      return badge + sess + choices;
    }
    case 'BUTTON_PRESS':
      return `slot=${p.slot ?? '?'}`;
    case 'CLIENT_READY':
      return `clientType=${esc(p.clientType || '?')} v${esc(p.version || '?')}`;
    case 'WELCOME':
      return `v${esc(p.version || '?')} sessions=${(p.sessions || []).length}`;
    case 'SYNC_REQUEST':
      return '(re-sync)';
    case 'ALL_DIM':
      return '(dim all)';
    default:
      return esc(JSON.stringify(p).slice(0, 80));
  }
}

function _scrollToBottom() {
  const chk = document.getElementById('trAutoScroll');
  if (chk && !chk.checked) return;
  const container = document.getElementById('trLog');
  if (container) container.scrollTop = container.scrollHeight;
}

function _fmtTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}
