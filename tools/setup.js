import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hooksDir = path.resolve(__dirname, '..', 'hooks');

export async function run() {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  }

  if (!settings.hooks) settings.hooks = {};

  const nodeCmd = process.execPath;

  settings.hooks.PermissionRequest = settings.hooks.PermissionRequest || [];
  settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];
  settings.hooks.Stop = settings.hooks.Stop || [];

  // Remove existing claude-dj hooks
  const isClaudeDjHook = (h) => h.hooks?.some((x) => x.command?.includes('claude-dj') || x.command?.includes('hooks/permission.js') || x.command?.includes('hooks/notify.js') || x.command?.includes('hooks/stop.js'));

  settings.hooks.PermissionRequest = settings.hooks.PermissionRequest.filter((h) => !isClaudeDjHook(h));
  settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter((h) => !isClaudeDjHook(h));
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

  const stopHook = {
    hooks: [{
      type: 'command',
      command: `"${nodeCmd}" "${path.join(hooksDir, 'stop.js')}"`,
    }],
  };

  settings.hooks.PermissionRequest.push(permHook);
  settings.hooks.PreToolUse.push(notifyHook);
  settings.hooks.Stop.push(stopHook);

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

  console.log('[claude-dj] Hooks registered in ~/.claude/settings.json');
  console.log('[claude-dj] PermissionRequest → permission.js');
  console.log('[claude-dj] PreToolUse → notify.js');
  console.log('[claude-dj] Stop → stop.js');
}
