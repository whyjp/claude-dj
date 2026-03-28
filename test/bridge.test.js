import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const PORT = 39299; // test port

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${path}`, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });
}

describe('Bridge Server', () => {
  let server;

  before(async () => {
    process.env.CLAUDE_DJ_PORT = String(PORT);
    const mod = await import('../bridge/server.js');
    server = mod.server;
    await new Promise((r) => setTimeout(r, 500));
  });

  after(() => {
    server?.close();
    delete process.env.CLAUDE_DJ_PORT;
  });

  it('GET /api/health returns ok', async () => {
    const res = await get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  });

  it('POST /api/hook/notify returns ok', async () => {
    const res = await post('/api/hook/notify', {
      session_id: 'test1',
      cwd: '/test/project',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('POST /api/hook/stop returns ok', async () => {
    const res = await post('/api/hook/stop', {
      session_id: 'test1',
      hook_event_name: 'Stop',
      stop_hook_active: false,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('GET /api/status returns sessions', async () => {
    const res = await get('/api/status');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.sessions));
  });
});
