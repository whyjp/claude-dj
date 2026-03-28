import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hooksDir = path.resolve(__dirname, '..', 'hooks');

/**
 * Register claude-dj hooks in Claude Code settings.
 * @param {Object} opts
 * @param {boolean} opts.global - If true, write to ~/.claude/settings.json (affects all sessions).
 *                                 If false (default), write to <cwd>/.claude/settings.json (project-only).
 */
export async function run({ global = false } = {}) {
  const settingsPath = global
    ? path.join(os.homedir(), '.claude', 'settings.json')
    : path.join(process.cwd(), '.claude', 'settings.json');

  const settingsDir = path.dirname(settingsPath);
  fs.mkdirSync(settingsDir, { recursive: true });

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  }

  if (!settings.hooks) settings.hooks = {};

  const nodeCmd = process.execPath;

  settings.hooks.PermissionRequest = settings.hooks.PermissionRequest || [];
  settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];
  settings.hooks.PostToolUse = settings.hooks.PostToolUse || [];
  settings.hooks.Stop = settings.hooks.Stop || [];

  // Remove existing claude-dj hooks
  const isClaudeDjHook = (h) => h.hooks?.some((x) =>
    x.command?.includes('claude-dj') ||
    x.command?.includes('hooks/permission.js') ||
    x.command?.includes('hooks/notify.js') ||
    x.command?.includes('hooks/postToolUse.js') ||
    x.command?.includes('hooks/stop.js'));

  settings.hooks.PermissionRequest = settings.hooks.PermissionRequest.filter((h) => !isClaudeDjHook(h));
  settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter((h) => !isClaudeDjHook(h));
  settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter((h) => !isClaudeDjHook(h));
  settings.hooks.Stop = settings.hooks.Stop.filter((h) => !isClaudeDjHook(h));

  const permHook = {
    hooks: [{
      type: 'command',
      command: `"${nodeCmd}" "${path.join(hooksDir, 'permission.js')}"`,
      timeout: 120,
    }],
  };

  const notifyHook = {
    hooks: [{
      type: 'command',
      command: `"${nodeCmd}" "${path.join(hooksDir, 'notify.js')}"`,
    }],
  };

  const postToolUseHook = {
    hooks: [{
      type: 'command',
      command: `"${nodeCmd}" "${path.join(hooksDir, 'postToolUse.js')}"`,
    }],
  };

  const stopHook = {
    hooks: [{
      type: 'command',
      command: `"${nodeCmd}" "${path.join(hooksDir, 'stop.js')}"`,
      timeout: 35,
    }],
  };

  settings.hooks.PermissionRequest.push(permHook);
  settings.hooks.PreToolUse.push(notifyHook);
  settings.hooks.PostToolUse.push(postToolUseHook);
  settings.hooks.Stop.push(stopHook);

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

  const scope = global ? 'GLOBAL (~/.claude)' : `PROJECT (${settingsDir})`;
  console.log(`[claude-dj] Hooks registered — ${scope}`);
  console.log(`[claude-dj] PermissionRequest → permission.js`);
  console.log(`[claude-dj] PreToolUse → notify.js`);
  console.log(`[claude-dj] PostToolUse → postToolUse.js`);
  console.log(`[claude-dj] Stop → stop.js`);
}
