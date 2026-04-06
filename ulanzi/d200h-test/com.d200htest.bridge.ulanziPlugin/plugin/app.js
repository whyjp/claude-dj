/**
 * app.js — D200H Bridge plugin main service
 *
 * Stage A: 입력 이벤트 수신 및 로깅
 * Stage B: 상태 토글 출력
 * Stage C: Bridge WS 연결 (bridgeWsAdapter)
 *
 * UlanziStudio가 이 파일을 Node.js v20으로 실행하며
 * argv: [node, app.js, address, port, language]
 */

import UlanziApi from './plugin-common-node/index.js';
import { parseInputEvent, parseSlot } from './core/eventParser.js';
import { transition, getStateIndex } from './core/stateMachine.js';
import { applyRender } from './adapters/ulanziOutputAdapter.js';
import { BridgeWsAdapter } from './adapters/bridgeWsAdapter.js';
import { mapLayout } from './core/layoutMapper.js';

const PLUGIN_UUID = 'com.d200htest.bridge';

const $UD = new UlanziApi();

// 키별 상태 저장: context → { state, context }
const keyStates = new Map();

// Stage C: Bridge 어댑터 (연결 실패해도 Stage A/B는 동작)
const bridge = new BridgeWsAdapter({ url: 'ws://localhost:39200/ws' });
bridge.onLayout((layout) => {
  // mapLayout으로 preset/custom 등 모든 포맷 처리
  const cmds = mapLayout(layout);
  const cmdBySlot = new Map(cmds.map(c => [c.slot, c]));

  for (const [context, entry] of keyStates.entries()) {
    const cmd = cmdBySlot.get(entry.slot);
    if (cmd) {
      applyRender({ context, stateIndex: cmd.stateIndex }, $UD);
      entry.state = cmd.stateIndex === 0 ? 'IDLE' : 'ACTIVE';
    }
  }
});

$UD.connect(PLUGIN_UUID);

$UD.onConnected(() => {
  console.log('[bridge-plugin] connected to UlanziStudio');
});

$UD.onAdd((msg) => {
  const context = msg.context;
  if (!keyStates.has(context)) {
    const slot = parseSlot(msg.key) ?? 0;
    keyStates.set(context, { state: 'IDLE', context, slot });
    applyRender({ context, stateIndex: getStateIndex('IDLE') }, $UD);
  }
  console.log(`[bridge-plugin] key added: slot=${parseSlot(msg.key)} context=${context}`);
});

$UD.onClear((msg) => {
  if (msg.param) {
    for (const item of msg.param) {
      keyStates.delete(item.context);
      console.log(`[bridge-plugin] key removed: context=${item.context}`);
    }
  }
});

function handleInput(msg) {
  const event = parseInputEvent(msg);
  if (!event) return;

  console.log(`[bridge-plugin] INPUT: slot=${event.slot} event=${event.event} context=${event.context}`);

  // Stage B: run 이벤트로 상태 토글
  if (event.event === 'run') {
    const entry = keyStates.get(event.context);
    if (entry) {
      const nextState = transition(entry.state, event.event);
      entry.state = nextState;
      const stateIndex = getStateIndex(nextState);
      applyRender({ context: event.context, stateIndex }, $UD);
      console.log(`[bridge-plugin] STATE: ${event.context} → ${nextState} (idx=${stateIndex})`);

      // Stage C: Bridge로 버튼 누름 전달
      bridge.sendButtonPress(event.slot);
    }
  }
}

$UD.onKeyDown(handleInput);
$UD.onKeyUp(handleInput);
$UD.onRun(handleInput);

$UD.onClose(() => {
  console.log('[bridge-plugin] disconnected from UlanziStudio');
});

$UD.onError((err) => {
  console.error('[bridge-plugin] error:', err);
});

console.log(`[bridge-plugin] starting — UUID=${PLUGIN_UUID}`);
