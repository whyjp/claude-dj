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
const JSON_FORMAT = process.env.CLAUDE_DJ_LOG_FORMAT === 'json';

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

let _stream = null;

// Ring buffer for /api/logs endpoint
const LOG_RING_SIZE = 200;
const _ring = [];

export function getRecentLogs(n = 50) {
  return _ring.slice(-Math.min(n, LOG_RING_SIZE));
}

function _rotateIfNeeded() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size >= MAX_LOG_SIZE) {
      const old = LOG_FILE + '.old';
      try { fs.unlinkSync(old); } catch { /* no previous .old */ }
      fs.renameSync(LOG_FILE, old);
      return true;
    }
  } catch { /* file doesn't exist yet */ }
  return false;
}

if (DEBUG) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  _rotateIfNeeded();
  _stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  const ts = new Date().toISOString();
  _stream.write(`\n${'='.repeat(60)}\n[${ts}] Bridge started (debug mode)\n${'='.repeat(60)}\n`);
  console.log(`[claude-dj] Log file: ${LOG_FILE}`);
}

function _fmt(level, args) {
  const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  if (JSON_FORMAT) {
    return JSON.stringify({ ts: new Date().toISOString(), level: level.trim(), msg });
  }
  return `${ts} ${level} ${msg}`;
}

function _write(line) {
  _ring.push(line);
  if (_ring.length > LOG_RING_SIZE) _ring.shift();
  if (_stream) _stream.write(line + '\n');
}

export function log(...args) {
  const line = _fmt('INFO ', args);
  JSON_FORMAT ? console.log(line) : console.log(...args);
  _write(line);
}

export function warn(...args) {
  const line = _fmt('WARN ', args);
  JSON_FORMAT ? console.warn(line) : console.warn(...args);
  _write(line);
}

export function error(...args) {
  const line = _fmt('ERROR', args);
  JSON_FORMAT ? console.error(line) : console.error(...args);
  _write(line);
}
