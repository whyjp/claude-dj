/**
 * logger.js — Structured logger with optional file output.
 *
 * Usage:  import { log, warn, error } from './logger.js';
 *
 * Enable file logging:
 *   CLAUDE_DJ_DEBUG=1 node bridge/server.js
 *   npm run debug
 *
 * Log file: ./logs/bridge.log (auto-created, appended per run)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'bridge.log');

const DEBUG = !!(process.env.CLAUDE_DJ_DEBUG || process.env.DEBUG);

let _stream = null;

if (DEBUG) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  _stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  const ts = new Date().toISOString();
  _stream.write(`\n${'='.repeat(60)}\n[${ts}] Bridge started (debug mode)\n${'='.repeat(60)}\n`);
}

function _fmt(level, args) {
  const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  return `${ts} ${level} ${msg}`;
}

function _write(line) {
  if (_stream) _stream.write(line + '\n');
}

export function log(...args) {
  console.log(...args);
  _write(_fmt('INFO ', args));
}

export function warn(...args) {
  console.warn(...args);
  _write(_fmt('WARN ', args));
}

export function error(...args) {
  console.error(...args);
  _write(_fmt('ERROR', args));
}
