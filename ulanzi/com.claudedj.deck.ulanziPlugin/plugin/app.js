/**
 * app.js — claude-dj Deck plugin main service
 *
 * UlanziStudio(D200H) ↔ claude-dj Bridge 간 양방향 번역 레이어.
 *
 * [슬롯 변환 책임]
 * - 입력 (D200H → Bridge):
 *     UlanziStudio가 "col_row" 포맷으로 보낸 키를 eventParser가
 *     D200H 열-우선 슬롯(col×5+row)으로 파싱한다.
 *     이를 Bridge가 이해하는 행-우선 슬롯(row×5+col)으로 변환 후 전송.
 *
 * - 출력 (Bridge → D200H):
 *     Bridge가 행-우선 슬롯으로 내려보낸 LAYOUT 메시지를
 *     layoutMapper가 D200H 열-우선 슬롯으로 역변환하여 LCD에 반영.
 *
 * UlanziStudio가 이 파일을 Node.js v20으로 실행하며
 * argv: [node, app.js, address, port, language]
 */

import UlanziApi from './plugin-common-node/index.js';
import { parseInputEvent, parseSlot } from './core/eventParser.js';
import { applyRender, applyRenderRaw } from './adapters/ulanziOutputAdapter.js';
import { BridgeWsAdapter } from './adapters/bridgeWsAdapter.js';
import { mapLayout, toInternalSlot, toD200hSlot } from './core/layoutMapper.js';
import { makeSessionSwitchIcon, makeAgentSwitchIcon, makeMultiIcon } from './core/iconRenderer.js';

const PLUGIN_UUID = 'com.claudedj.deck';

const $UD = new UlanziApi();

/**
 * 키별 상태 저장.
 * context → { context: string, slot: number }
 * slot은 D200H 열-우선 슬롯.
 */
const keyStates = new Map();

// ── Processing 애니메이션 ────────────────────────────────────

let _processingTimer = null;
let _processingFrame = 0;
let _processingSlots = []; // D200H 열-우선 슬롯 목록

function _startProcessing(slots) {
  _processingSlots = slots;
  _processingFrame = 0;
  if (_processingTimer) return;
  _processingTimer = setInterval(() => {
    _processingFrame = (_processingFrame + 1) % 3;
    const frameKey = `processing-${_processingFrame + 1}`;
    for (const [context, entry] of keyStates.entries()) {
      if (_processingSlots.includes(entry.slot)) {
        applyRender({ context, iconKey: frameKey }, $UD);
      }
    }
  }, 400);
}

function _stopProcessing() {
  if (_processingTimer) { clearInterval(_processingTimer); _processingTimer = null; }
  _processingSlots = [];
}

// ── Idle 캐릭터 애니메이션 ───────────────────────────────────
//
// 순환 경로 (Bridge 행-우선 슬롯):
//   0→1→2→3→4 (row0 좌→우)
//   9→8→7→6→5 (row1 우→좌)
//   → 반복
// 각 위치에서 idle-char-N 아이콘 표시, 나머지는 idle(dim)

const IDLE_PATH = [0, 1, 2, 3, 4, 9, 8, 7, 6, 5]; // Bridge 행-우선 슬롯

let _idleTimer = null;
let _idleStep  = 0;  // IDLE_PATH 인덱스
let _idleSlots = []; // 현재 idle 상태인 D200H 열-우선 슬롯 목록

const IDLE_SLEEP_MS = 10 * 60 * 1000; // 10분 후 sleep 모드
let _idleSleepTimer = null;
let _isSleeping = false;

function _startIdle(slots) {
  _idleSlots = slots;
  _idleStep  = 0;
  _isSleeping = false;
  if (_idleSleepTimer) clearTimeout(_idleSleepTimer);
  _idleSleepTimer = setTimeout(() => _enterSleep(), IDLE_SLEEP_MS);
  if (_idleTimer) return;
  _idleTimer = setInterval(() => {
    if (_isSleeping) return;
    _idleStep = (_idleStep + 1) % IDLE_PATH.length;
    _renderIdleFrame();
  }, 600); // 0.6초 간격 (10프레임 = 6초 1주기)
  _renderIdleFrame(); // 즉시 첫 프레임
}

function _stopIdle() {
  if (_idleTimer) { clearInterval(_idleTimer); _idleTimer = null; }
  if (_idleSleepTimer) { clearTimeout(_idleSleepTimer); _idleSleepTimer = null; }
  _isSleeping = false;
  _idleSlots = [];
}

function _enterSleep() {
  if (_idleTimer) { clearInterval(_idleTimer); _idleTimer = null; }
  _isSleeping = true;
  // slot 0 (Bridge) → D200H slot에 sleep 아이콘, 나머지 idle(dim)
  const sleepD200h = toD200hSlot(0);
  for (const [context, entry] of keyStates.entries()) {
    if (!_idleSlots.includes(entry.slot)) continue;
    if (entry.slot === sleepD200h) {
      applyRender({ context, iconKey: 'sleep' }, $UD);
    } else {
      applyRender({ context, iconKey: 'idle' }, $UD);
    }
  }
}

function _renderIdleFrame() {
  // toD200hSlot은 import로 직접 사용
  const charDjSlot  = IDLE_PATH[_idleStep];
  const charD200h   = toD200hSlot(charDjSlot);
  const charIconKey = `idle-char-${_idleStep}`;

  for (const [context, entry] of keyStates.entries()) {
    if (!_idleSlots.includes(entry.slot)) continue;
    if (entry.slot === charD200h) {
      applyRender({ context, iconKey: charIconKey }, $UD);
    } else {
      applyRender({ context, iconKey: 'idle' }, $UD);
    }
  }
}

// ── Bridge 연결 ──────────────────────────────────────────────

const bridge = new BridgeWsAdapter({ url: process.env.BRIDGE_URL ?? 'ws://localhost:39200/ws' });

bridge.onLayout((layout) => {
  const cmds = mapLayout(layout);
  const cmdBySlot = new Map(cmds.map(c => [c.slot, c]));

  // 애니메이션 제어 — preset에 따라 시작/정지
  if (layout.preset === 'processing') {
    _stopIdle();
    const procSlots = cmds
      .filter(c => c.iconKey === 'processing-1' || c.iconKey === 'processing')
      .map(c => c.slot);
    _startProcessing(procSlots);
  } else if (layout.preset === 'idle') {
    _stopProcessing();
    const idleSlots = cmds
      .filter(c => c.iconKey === 'idle')
      .map(c => c.slot);
    _startIdle(idleSlots);
    return; // idle 렌더링은 _renderIdleFrame이 담당
  } else {
    _stopProcessing();
    _stopIdle();
  }

  for (const [context, entry] of keyStates.entries()) {
    const cmd = cmdBySlot.get(entry.slot);
    if (!cmd) continue;

    // session-switch: 세션명 동적 PNG 생성
    if (cmd.iconKey === 'session-switch' && cmd.sessName) {
      const b64 = makeSessionSwitchIcon(cmd.sessName);
      applyRenderRaw({ context, b64 }, $UD);
      continue;
    }

    // agent-switch: 에이전트 타입 동적 PNG 생성
    if (cmd.iconKey === 'agent-switch' && cmd.agentLabel) {
      const b64 = makeAgentSwitchIcon(cmd.agentLabel);
      applyRenderRaw({ context, b64 }, $UD);
      continue;
    }

    // multi-dynamic: 번호 + 레이블 + 선택 상태 동적 PNG 생성
    if (cmd.iconKey === 'multi-dynamic') {
      const b64 = makeMultiIcon(cmd.multiN, cmd.multiLabel, cmd.multiSelected);
      applyRenderRaw({ context, b64 }, $UD);
      continue;
    }

    applyRender({ context, iconKey: cmd.iconKey }, $UD);
  }
});

// ── UlanziStudio 연결 ────────────────────────────────────────

$UD.connect(PLUGIN_UUID);

$UD.onConnected(() => {
  console.log('[deck-plugin] connected to UlanziStudio');
});

$UD.onAdd((msg) => {
  const context = msg.context;
  if (!keyStates.has(context)) {
    const d200hSlot = parseSlot(msg.key) ?? 0;
    keyStates.set(context, { context, slot: d200hSlot });
    applyRender({ context, iconKey: 'idle' }, $UD);
  }
  console.log(`[deck-plugin] key added: d200hSlot=${parseSlot(msg.key)} context=${context}`);
});

$UD.onClear((msg) => {
  if (msg.param) {
    for (const item of msg.param) {
      keyStates.delete(item.context);
      console.log(`[deck-plugin] key removed: context=${item.context}`);
    }
  }
});

function handleInput(msg) {
  const event = parseInputEvent(msg);
  if (!event) return;

  console.log(`[deck-plugin] INPUT: d200hSlot=${event.slot} event=${event.event} context=${event.context}`);

  if (event.event === 'run') {
    const entry = keyStates.get(event.context);
    if (entry) {
      const djSlot = toInternalSlot(event.slot);
      console.log(`[deck-plugin] PRESS: d200hSlot=${event.slot} → djSlot=${djSlot}`);
      bridge.sendButtonPress(djSlot);
    }
  }
}

$UD.onKeyDown(handleInput);
$UD.onKeyUp(handleInput);
$UD.onRun(handleInput);

$UD.onClose(() => {
  _stopProcessing();
  _stopIdle();
  console.log('[deck-plugin] disconnected from UlanziStudio');
});

$UD.onError((err) => {
  console.error('[deck-plugin] error:', err);
});

console.log(`[deck-plugin] starting — UUID=${PLUGIN_UUID}`);
