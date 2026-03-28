// Claude DJ — Ulanzi Plugin (Phase 3)
// This is a skeleton. Full implementation in Phase 3.
//
// Role: Protocol bridge between Claude DJ Bridge WS and UlanziStudio WS
// - Connects to Claude DJ Bridge via WS (ws://localhost:39200/ws)
// - Connects to UlanziStudio via Ulanzi SDK
// - Translates LAYOUT messages → setPathIcon/setGifPathIcon per key
// - Translates onRun (key press) → BUTTON_PRESS to Bridge

import UlanziApi from '../ulanzi/sdk/common-node/index.js';

const $UD = new UlanziApi();

// TODO Phase 3: Implement Bridge WS client
// TODO Phase 3: Implement LAYOUT → icon mapping
// TODO Phase 3: Implement key press → BUTTON_PRESS forwarding

$UD.connect('com.claudedj.ulanzistudio.claudedj');

$UD.onConnected(() => {
  console.log('[claude-dj plugin] Connected to UlanziStudio');
});

$UD.onRun((jsn) => {
  console.log('[claude-dj plugin] Key pressed:', jsn.context);
  // TODO Phase 3: Forward to Bridge as BUTTON_PRESS
});

$UD.onAdd((jsn) => {
  console.log('[claude-dj plugin] Action added:', jsn.context);
});

$UD.onClear((jsn) => {
  console.log('[claude-dj plugin] Action cleared');
});
