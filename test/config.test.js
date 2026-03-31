import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../claude-plugin/bridge/config.js';

describe('config', () => {
  it('has default port 39200', () => {
    assert.equal(config.port, 39200);
  });

  it('has default button timeout 60000ms', () => {
    assert.equal(config.buttonTimeout, 60000);
  });

  it('respects CLAUDE_DJ_PORT env var', () => {
    process.env.CLAUDE_DJ_PORT = '12345';
    const port = parseInt(process.env.CLAUDE_DJ_PORT, 10) || 39200;
    assert.equal(port, 12345);
    delete process.env.CLAUDE_DJ_PORT;
  });
});
