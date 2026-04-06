/**
 * server.js — D200H Bridge Server
 *
 * Express HTTP + WebSocket (port 39200)
 *
 * HTTP API:
 *   GET  /api/health              — 상태 확인
 *   POST /api/layout              — LAYOUT 메시지를 모든 WS 클라이언트에 브로드캐스트
 *   POST /api/button-press        — BUTTON_PRESS 이벤트를 강제 발생 (테스트용)
 *
 * WebSocket (ws://localhost:39200/ws):
 *   ← LAYOUT { type, preset, slots? }     — 브리지 → 플러그인
 *   → BUTTON_PRESS { type, slot }          — 플러그인 → 브리지
 */

import http from 'node:http';
import express from 'express';
import { WsServer } from './wsServer.js';

const PORT = Number(process.env.BRIDGE_PORT ?? 39200);

const app = express();
app.use(express.json({ limit: '100kb' }));

const server = http.createServer(app);
const ws = new WsServer();
ws.attach(server, '/ws');

// BUTTON_PRESS 수신 핸들러 — 로깅 및 향후 상위 로직 연결용
ws.onButtonPress = (slot, timestamp) => {
  console.log(`[bridge] BUTTON_PRESS received: slot=${slot} ts=${timestamp ?? 'n/a'}`);
  // TODO Stage C+: 여기서 외부 앱(claude-dj 등)으로 이벤트 전달
};

// --- REST API ---

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.1.0', port: PORT, clients: ws.clientCount });
});

/**
 * POST /api/layout
 * Body: { preset: 'idle'|'active'|..., slots?: { [slot]: stateIndex } }
 * LAYOUT 메시지를 모든 연결된 WS 클라이언트(플러그인 포함)에 브로드캐스트한다.
 */
app.post('/api/layout', (req, res) => {
  const layout = req.body;
  if (!layout || typeof layout !== 'object') {
    return res.status(400).json({ error: 'body must be a JSON object' });
  }
  if (!layout.preset) {
    return res.status(400).json({ error: 'preset is required' });
  }

  ws.broadcast({ type: 'LAYOUT', ...layout });
  console.log(`[bridge] LAYOUT broadcast: preset=${layout.preset} clients=${ws.clientCount}`);
  res.json({ ok: true, clients: ws.clientCount });
});

/**
 * POST /api/button-press
 * Body: { slot: number }
 * 테스트용: 특정 슬롯의 BUTTON_PRESS 이벤트를 수동으로 발생시킨다.
 */
app.post('/api/button-press', (req, res) => {
  const { slot } = req.body ?? {};
  const slotNum = Number(slot);
  if (!Number.isInteger(slotNum) || slotNum < 0 || slotNum > 12) {
    return res.status(400).json({ error: 'slot must be integer 0-12' });
  }
  ws.broadcast({ type: 'BUTTON_PRESS', slot: slotNum, timestamp: Date.now() });
  console.log(`[bridge] BUTTON_PRESS broadcast: slot=${slotNum}`);
  res.json({ ok: true, slot: slotNum });
});

server.listen(PORT, () => {
  console.log(`[bridge] server started at ws://localhost:${PORT}/ws`);
  console.log(`[bridge] REST API at http://localhost:${PORT}/api/`);
});

export { app, server, ws };
