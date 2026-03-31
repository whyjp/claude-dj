import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

function intEnv(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isNaN(v) ? fallback : v;
}

export const config = {
  port: intEnv('CLAUDE_DJ_PORT', 39200),
  buttonTimeout: intEnv('CLAUDE_DJ_BUTTON_TIMEOUT', 60000),
  hookTimeout: 110000,
  eventsDir: process.env.CLAUDE_DJ_EVENTS_DIR || path.join(os.tmpdir(), 'claude-dj-events'),
  wsPath: '/ws',
  apiPrefix: '/api',
  sessionIdleTimeout: intEnv('CLAUDE_DJ_IDLE_TIMEOUT', 300000), // 5 min
  version: pkg.version,
};
