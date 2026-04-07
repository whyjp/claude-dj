/**
 * hookLogger.js — Lightweight file logger for hooks.
 *
 * Each hook process is short-lived, so we appendFileSync per call.
 * Auto-rotates at 1MB, keeps 1 old file.
 */
import { appendFileSync, statSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'hooks.log');
const MAX_SIZE = 1 * 1024 * 1024; // 1MB

let _initialized = false;

function _init() {
  if (_initialized) return;
  _initialized = true;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const stat = statSync(LOG_FILE);
    if (stat.size >= MAX_SIZE) {
      try { unlinkSync(LOG_FILE + '.old'); } catch {}
      renameSync(LOG_FILE, LOG_FILE + '.old');
    }
  } catch {}
}

export function hookLog(hookName, ...args) {
  try {
    _init();
    const ts = new Date().toISOString().slice(0, 23);
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    appendFileSync(LOG_FILE, `${ts} [${hookName}] ${msg}\n`);
  } catch {}
}
