/**
 * app.js — claude-dj Deck plugin main service
 *
 * UlanziStudio(D200H) ↔ claude-dj Bridge 간 양방향 번역 레이어.
 *
 * [슬롯 변환 책임]
 * - 입력 (D200H → Bridge):
 *     UlanziStudio가 "col_row" 포맷으로 보낸 키를 eventParser가
 *     D200H 열-우선 슬롯(col×4+row)으로 파싱한다.
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
import { transition, getStateIndex } from './core/stateMachine.js';
import { applyRender } from './adapters/ulanziOutputAdapter.js';
import { BridgeWsAdapter } from './adapters/bridgeWsAdapter.js';
import { mapLayout, toInternalSlot } from './core/layoutMapper.js';

const PLUGIN_UUID = 'com.claudedj.deck';

const $UD = new UlanziApi();

/**
 * 키별 상태 저장.
 * context → { state: string, context: string, slot: number }
 * slot은 D200H 열-우선 슬롯 (keyStates 조회 및 LAYOUT 매핑에 사용).
 */
const keyStates = new Map();

// Bridge 어댑터 (연결 실패해도 입력 이벤트 수신은 동작)
const bridge = new BridgeWsAdapter({ url: process.env.BRIDGE_URL ?? 'ws://localhost:39200/ws' });

bridge.onLayout((layout) => {
  // mapLayout은 D200H 열-우선 슬롯 기준 SlotCommand 배열을 반환
  const cmds = mapLayout(layout);
  const cmdBySlot = new Map(cmds.map(c => [c.slot, c]));

  for (const [context, entry] of keyStates.entries()) {
    // entry.slot은 D200H 열-우선 슬롯이므로 직접 조회
    const cmd = cmdBySlot.get(entry.slot);
    if (cmd) {
      applyRender({ context, stateIndex: cmd.stateIndex, text: cmd.text }, $UD);
      entry.state = cmd.stateIndex === 0 ? 'IDLE' : 'ACTIVE';
    }
  }
});

$UD.connect(PLUGIN_UUID);

$UD.onConnected(() => {
  console.log('[deck-plugin] connected to UlanziStudio');
});

$UD.onAdd((msg) => {
  const context = msg.context;
  if (!keyStates.has(context)) {
    // parseSlot은 "col_row" → col×GRID_COLS+row = D200H 열-우선 슬롯을 반환
    const d200hSlot = parseSlot(msg.key) ?? 0;
    keyStates.set(context, { state: 'IDLE', context, slot: d200hSlot });
    applyRender({ context, stateIndex: getStateIndex('IDLE') }, $UD);
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

  // event.slot = D200H 열-우선 슬롯
  console.log(`[deck-plugin] INPUT: d200hSlot=${event.slot} event=${event.event} context=${event.context}`);

  if (event.event === 'run') {
    const entry = keyStates.get(event.context);
    if (entry) {
      const nextState = transition(entry.state, event.event);
      entry.state = nextState;
      const stateIndex = getStateIndex(nextState);
      applyRender({ context: event.context, stateIndex }, $UD);
      console.log(`[deck-plugin] STATE: ${event.context} → ${nextState} (idx=${stateIndex})`);

      // D200H 열-우선 슬롯 → Bridge 행-우선 슬롯으로 변환 후 전송
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
  console.log('[deck-plugin] disconnected from UlanziStudio');
});

$UD.onError((err) => {
  console.error('[deck-plugin] error:', err);
});

console.log(`[deck-plugin] starting — UUID=${PLUGIN_UUID}`);
