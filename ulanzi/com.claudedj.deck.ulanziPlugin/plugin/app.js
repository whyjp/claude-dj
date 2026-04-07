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
import { mapLayout, toInternalSlot } from './core/layoutMapper.js';
import { makeSessionSwitchIcon, makeAgentSwitchIcon } from './core/iconRenderer.js';

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
// processing 대상 슬롯 목록 (D200H 열-우선)
let _processingSlots = [];

function _startProcessing(slots) {
  _processingSlots = slots;
  _processingFrame = 0;
  if (_processingTimer) return; // 이미 실행 중
  _processingTimer = setInterval(() => {
    _processingFrame = (_processingFrame + 1) % 3;
    const frameKey = `processing-${_processingFrame + 1}`;
    for (const [context, entry] of keyStates.entries()) {
      if (_processingSlots.includes(entry.slot)) {
        applyRender({ context, iconKey: frameKey }, $UD);
      }
    }
  }, 400); // 400ms 간격 (0.4초 × 3프레임 = 1.2초 주기)
}

function _stopProcessing() {
  if (_processingTimer) {
    clearInterval(_processingTimer);
    _processingTimer = null;
  }
  _processingSlots = [];
}

// ── Bridge 연결 ──────────────────────────────────────────────

const bridge = new BridgeWsAdapter({ url: process.env.BRIDGE_URL ?? 'ws://localhost:39200/ws' });

bridge.onLayout((layout) => {
  const cmds = mapLayout(layout);
  const cmdBySlot = new Map(cmds.map(c => [c.slot, c]));

  // processing 애니메이션 제어
  if (layout.preset === 'processing') {
    const procSlots = cmds
      .filter(c => c.iconKey === 'processing-1' || c.iconKey === 'processing')
      .map(c => c.slot);
    _startProcessing(procSlots);
  } else {
    _stopProcessing();
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
  console.log('[deck-plugin] disconnected from UlanziStudio');
});

$UD.onError((err) => {
  console.error('[deck-plugin] error:', err);
});

console.log(`[deck-plugin] starting — UUID=${PLUGIN_UUID}`);
