/**
 * integration.test.js
 *
 * Bridge WsServer + BridgeWsAdapter 통합 검증.
 * 실제 WebSocket 서버를 in-process로 실행해 메시지 왕복을 확인한다.
 *
 * 테스트 범위:
 *  - LAYOUT 브로드캐스트 수신 확인
 *  - BUTTON_PRESS 송신 후 서버 수신 확인
 *  - 서버 연결 강제 종료 후 재연결 확인 (Stage D)
 *
 * 테스트 원칙:
 *  - 테스트 실패 시: 이 파일의 로직이 잘못됐는지(타임아웃, 이벤트 순서),
 *    WsServer/BridgeWsAdapter 내부 오류인지를 주석으로 분리한다.
 *  - green을 위한 억지 수정 금지.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WsServer } from '../bridge/wsServer.js';
import { BridgeWsAdapter } from '../com.d200htest.bridge.ulanziPlugin/plugin/adapters/bridgeWsAdapter.js';
import { mapLayout } from '../com.d200htest.bridge.ulanziPlugin/plugin/core/layoutMapper.js';

const TEST_PORT = 39295;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(fn, timeoutMs = 3000, intervalMs = 30) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await wait(intervalMs);
  }
  throw new Error(`waitUntil timeout after ${timeoutMs}ms — condition: ${fn.toString().slice(0, 80)}`);
}

// ─────────────────────────────────────────────
// 공유 서버 + 테스트 그룹
// ─────────────────────────────────────────────

describe('Integration: Bridge WsServer + BridgeWsAdapter', () => {
  let server;
  let wsServer;

  before(async () => {
    server = http.createServer();
    wsServer = new WsServer();
    wsServer.attach(server, '/ws');
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(TEST_PORT, resolve);
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  // ── LAYOUT 브로드캐스트 ──────────────────────

  it('LAYOUT(idle) 브로드캐스트 수신', async () => {
    const received = [];
    const adapter = new BridgeWsAdapter({ url: `ws://localhost:${TEST_PORT}/ws` });
    adapter.onLayout((l) => received.push(l));

    await waitUntil(() => adapter.isConnected);
    wsServer.broadcast({ type: 'LAYOUT', preset: 'idle' });
    await waitUntil(() => received.length > 0);

    assert.equal(received[0].preset, 'idle');
    adapter.destroy();
  });

  it('LAYOUT(idle) → mapLayout: 전체 슬롯 stateIndex=0', async () => {
    const received = [];
    const adapter = new BridgeWsAdapter({ url: `ws://localhost:${TEST_PORT}/ws` });
    adapter.onLayout((l) => received.push(l));

    await waitUntil(() => adapter.isConnected);
    wsServer.broadcast({ type: 'LAYOUT', preset: 'idle' });
    await waitUntil(() => received.length > 0);

    const cmds = mapLayout(received[0]);
    assert.ok(cmds.every((c) => c.stateIndex === 0));
    adapter.destroy();
  });

  it('ALL_DIM → layoutCallback에서 preset:idle 수신', async () => {
    const received = [];
    const adapter = new BridgeWsAdapter({ url: `ws://localhost:${TEST_PORT}/ws` });
    adapter.onLayout((l) => received.push(l));

    await waitUntil(() => adapter.isConnected);
    wsServer.broadcast({ type: 'ALL_DIM' });
    await waitUntil(() => received.length > 0);

    assert.equal(received[0].preset, 'idle');
    adapter.destroy();
  });

  it('LAYOUT(custom) slots 수신 후 mapLayout 변환 확인', async () => {
    const received = [];
    const adapter = new BridgeWsAdapter({ url: `ws://localhost:${TEST_PORT}/ws` });
    adapter.onLayout((l) => received.push(l));

    await waitUntil(() => adapter.isConnected);
    wsServer.broadcast({ type: 'LAYOUT', preset: 'custom', slots: { '3': 1, '7': 1 } });
    await waitUntil(() => received.length > 0);

    const cmds = mapLayout(received[0]);
    assert.equal(cmds.find((c) => c.slot === 3)?.stateIndex, 1);
    assert.equal(cmds.find((c) => c.slot === 7)?.stateIndex, 1);
    assert.equal(cmds.find((c) => c.slot === 0)?.stateIndex, 0);
    adapter.destroy();
  });

  // ── BUTTON_PRESS ─────────────────────────────

  it('sendButtonPress(5) → 서버 onButtonPress(5) 호출', async () => {
    const presses = [];
    wsServer.onButtonPress = (slot) => presses.push(slot);

    const adapter = new BridgeWsAdapter({ url: `ws://localhost:${TEST_PORT}/ws` });
    await waitUntil(() => adapter.isConnected);

    adapter.sendButtonPress(5);
    await waitUntil(() => presses.length > 0);

    assert.equal(presses[presses.length - 1], 5);
    adapter.destroy();
  });

  it('연속 BUTTON_PRESS(0,3,12) → 서버 수신 순서 보장', async () => {
    const presses = [];
    wsServer.onButtonPress = (slot) => presses.push(slot);
    const startLen = presses.length;

    const adapter = new BridgeWsAdapter({ url: `ws://localhost:${TEST_PORT}/ws` });
    await waitUntil(() => adapter.isConnected);

    adapter.sendButtonPress(0);
    adapter.sendButtonPress(3);
    adapter.sendButtonPress(12);

    await waitUntil(() => presses.length - startLen >= 3, 3000);
    const newPresses = presses.slice(startLen);
    assert.deepEqual(newPresses, [0, 3, 12]);
    adapter.destroy();
  });
});

// ─────────────────────────────────────────────
// 재연결 시나리오 (각자 별도 포트 사용)
// ─────────────────────────────────────────────

describe('BridgeWsAdapter — 재연결 (Stage D)', () => {
  it('서버 종료 후 재연결 성공', async () => {
    const port = 39292;
    const s1 = http.createServer();
    const ws1 = new WsServer();
    ws1.attach(s1, '/ws');
    await new Promise((resolve, reject) => {
      s1.once('error', reject);
      s1.listen(port, resolve);
    });

    const received = [];
    const adapter = new BridgeWsAdapter({ url: `ws://localhost:${port}/ws` });
    adapter.onLayout((l) => received.push(l));

    // 첫 연결
    await waitUntil(() => adapter.isConnected, 3000);

    // 서버 종료 — WS 연결 강제 종료 후 HTTP 서버 닫기
    ws1.terminateAll();
    await new Promise((resolve) => s1.close(resolve));
    await waitUntil(() => !adapter.isConnected, 2000);

    // 서버 재기동 (1초 백오프 이내에 준비)
    const s2 = http.createServer();
    const ws2 = new WsServer();
    ws2.attach(s2, '/ws');
    await new Promise((resolve, reject) => {
      s2.once('error', reject);
      s2.listen(port, resolve);
    });

    // 재연결 대기 (1초 백오프 + 여유)
    await waitUntil(() => adapter.isConnected, 5000);

    // 재연결 후 LAYOUT 수신 확인
    ws2.broadcast({ type: 'LAYOUT', preset: 'active', slot: 2 });
    await waitUntil(() => received.length > 0, 2000);

    assert.equal(received[0].preset, 'active');
    assert.equal(received[0].slot, 2);

    adapter.destroy();
    await new Promise((resolve) => s2.close(resolve));
  });

  it('연결 불가 서버에서 백오프 후 재시도 발생', async () => {
    // 존재하지 않는 포트 — 오류 없이 백오프해야 함
    const adapter = new BridgeWsAdapter({ url: 'ws://localhost:39291/ws' });

    // 2초 대기: 첫 시도(즉시) + 1초 후 2차 시도
    await wait(2000);

    assert.ok(adapter._reconnectAttempts >= 1, '재연결 시도가 발생했어야 함');
    adapter.destroy();
  });
});
