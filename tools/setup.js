import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..');
const pluginName = 'claude-dj@local';

function getClaudeDir() {
  return path.join(os.homedir(), '.claude');
}

function readJSON(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Install claude-dj as a Claude Code plugin.
 * Registers in installed_plugins.json and enables in settings.json.
 * This makes hooks + skills available to all new sessions.
 */
export async function install({ global = true } = {}) {
  const claudeDir = getClaudeDir();
  const installedPath = path.join(claudeDir, 'plugins', 'installed_plugins.json');
  const settingsPath = global
    ? path.join(claudeDir, 'settings.json')
    : path.join(process.cwd(), '.claude', 'settings.json');

  // 1. Register in installed_plugins.json
  const installed = readJSON(installedPath) || { version: 2, plugins: {} };
  installed.plugins[pluginName] = [{
    scope: global ? 'user' : 'project',
    installPath: pluginRoot,
    version: '0.1.0',
    installedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  }];
  writeJSON(installedPath, installed);

  // 2. Enable in settings.json
  const settings = readJSON(settingsPath) || {};
  if (!settings.enabledPlugins) settings.enabledPlugins = {};
  settings.enabledPlugins[pluginName] = true;
  writeJSON(settingsPath, settings);

  const scope = global ? 'GLOBAL' : 'PROJECT';
  console.log(`[claude-dj] Plugin installed — ${scope}`);
  console.log(`[claude-dj] Path: ${pluginRoot}`);
  console.log(`[claude-dj] Hooks: 5 (permission, notify, postToolUse, stop, userPrompt)`);
  console.log(`[claude-dj] Skills: choice-format`);
  console.log(`[claude-dj] New Claude sessions will auto-load claude-dj.`);
}

/**
 * Uninstall claude-dj plugin.
 * Removes from installed_plugins.json and settings.json.
 */
export async function uninstall({ global = true } = {}) {
  const claudeDir = getClaudeDir();
  const installedPath = path.join(claudeDir, 'plugins', 'installed_plugins.json');
  const settingsPath = global
    ? path.join(claudeDir, 'settings.json')
    : path.join(process.cwd(), '.claude', 'settings.json');

  // 1. Remove from installed_plugins.json
  const installed = readJSON(installedPath);
  if (installed?.plugins?.[pluginName]) {
    delete installed.plugins[pluginName];
    writeJSON(installedPath, installed);
  }

  // 2. Remove from settings.json enabledPlugins
  const settings = readJSON(settingsPath);
  if (settings?.enabledPlugins?.[pluginName]) {
    delete settings.enabledPlugins[pluginName];
    writeJSON(settingsPath, settings);
  }

  // 3. Also clean up legacy hooks from settings.json (from old setup.js)
  if (settings?.hooks) {
    const isClaudeDjHook = (h) => h.hooks?.some((x) =>
      x.command?.includes('claude-dj') ||
      x.command?.includes('hooks/permission.js') ||
      x.command?.includes('hooks/notify.js') ||
      x.command?.includes('hooks/postToolUse.js') ||
      x.command?.includes('hooks/userPrompt.js') ||
      x.command?.includes('hooks/stop.js'));

    for (const type of ['UserPromptSubmit', 'PermissionRequest', 'PreToolUse', 'PostToolUse', 'Stop']) {
      if (Array.isArray(settings.hooks[type])) {
        settings.hooks[type] = settings.hooks[type].filter((h) => !isClaudeDjHook(h));
      }
    }
    writeJSON(settingsPath, settings);
  }

  const scope = global ? 'GLOBAL' : 'PROJECT';
  console.log(`[claude-dj] Plugin uninstalled — ${scope}`);
  console.log(`[claude-dj] Hooks and skills removed.`);
}

/**
 * Show current installation status.
 */
export async function status() {
  const claudeDir = getClaudeDir();
  const installedPath = path.join(claudeDir, 'plugins', 'installed_plugins.json');
  const settingsPath = path.join(claudeDir, 'settings.json');

  const installed = readJSON(installedPath);
  const settings = readJSON(settingsPath);

  const isInstalled = !!installed?.plugins?.[pluginName];
  const isEnabled = !!settings?.enabledPlugins?.[pluginName];

  console.log(`[claude-dj] Status:`);
  console.log(`  Registered: ${isInstalled ? 'yes' : 'no'}`);
  console.log(`  Enabled:    ${isEnabled ? 'yes' : 'no'}`);
  if (isInstalled) {
    console.log(`  Path:       ${installed.plugins[pluginName][0].installPath}`);
    console.log(`  Version:    ${installed.plugins[pluginName][0].version}`);
  }
}
