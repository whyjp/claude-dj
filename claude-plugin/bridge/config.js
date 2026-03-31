import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

export const config = {
  port: parseInt(process.env.CLAUDE_DJ_PORT, 10) || 39200,
  buttonTimeout: parseInt(process.env.CLAUDE_DJ_BUTTON_TIMEOUT, 10) || 60000,
  hookTimeout: 110000,
  eventsDir: process.env.CLAUDE_DJ_EVENTS_DIR || path.join(os.tmpdir(), 'claude-dj-events'),
  wsPath: '/ws',
  apiPrefix: '/api',
  sessionIdleTimeout: parseInt(process.env.CLAUDE_DJ_IDLE_TIMEOUT, 10) || 300000, // 5 min
  version: pkg.version,
};
