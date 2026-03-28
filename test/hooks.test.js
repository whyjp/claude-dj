import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

describe('Hook scripts', () => {
  it('permission.js exists and is valid JS', () => {
    assert.ok(existsSync('hooks/permission.js'));
    const content = readFileSync('hooks/permission.js', 'utf8');
    assert.ok(content.includes('/api/hook/permission'));
  });

  it('notify.js exists and is valid JS', () => {
    assert.ok(existsSync('hooks/notify.js'));
    const content = readFileSync('hooks/notify.js', 'utf8');
    assert.ok(content.includes('/api/hook/notify'));
  });

  it('stop.js exists and is valid JS', () => {
    assert.ok(existsSync('hooks/stop.js'));
    const content = readFileSync('hooks/stop.js', 'utf8');
    assert.ok(content.includes('/api/hook/stop'));
  });

  it('postToolUse.js exists and is valid JS', () => {
    assert.ok(existsSync('hooks/postToolUse.js'));
    const content = readFileSync('hooks/postToolUse.js', 'utf8');
    assert.ok(content.includes('/api/hook/postToolUse'));
  });
});
