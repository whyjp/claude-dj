import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..');

const PLUGIN_NAME = 'claude-dj-plugin';
const MARKETPLACE_ID = 'claude-dj-marketplace';
const PLUGIN_KEY = `${PLUGIN_NAME}@${MARKETPLACE_ID}`;
const GITHUB_REPO = 'whyjp/claude-dj';
const MARKETPLACE_DIR_NAME = 'whyjp-claude-dj'; // github user-repo format
const VERSION = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'claude-plugin', 'package.json'), 'utf8')).version;

// Also match legacy key from previous installs
const LEGACY_KEY = 'claude-dj@local';

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
 * Registers marketplace, plugin, and enables — matching the pattern
 * used by claude-hud, autoresearch, and other git-based plugins.
 *
 * After install, users can also install from any machine via:
 *   /install github:whyjp/claude-dj
 */
export async function install({ global = true } = {}) {
  const claudeDir = getClaudeDir();
  const pluginsDir = path.join(claudeDir, 'plugins');
  const installedPath = path.join(pluginsDir, 'installed_plugins.json');
  const marketplacesPath = path.join(pluginsDir, 'known_marketplaces.json');
  const settingsPath = global
    ? path.join(claudeDir, 'settings.json')
    : path.join(process.cwd(), '.claude', 'settings.json');

  // 1. Register marketplace (git repo mapping)
  const marketplaces = readJSON(marketplacesPath) || {};
  marketplaces[MARKETPLACE_ID] = {
    source: { source: 'github', repo: GITHUB_REPO },
    installLocation: path.join(pluginsDir, 'marketplaces', MARKETPLACE_DIR_NAME),
    lastUpdated: new Date().toISOString(),
  };
  writeJSON(marketplacesPath, marketplaces);

  // 2. Symlink/copy marketplace directory (point to local repo)
  const marketplaceDir = path.join(pluginsDir, 'marketplaces', MARKETPLACE_DIR_NAME);
  if (!fs.existsSync(marketplaceDir)) {
    fs.mkdirSync(path.dirname(marketplaceDir), { recursive: true });
    try {
      fs.symlinkSync(pluginRoot, marketplaceDir, 'junction');
    } catch (e) {
      // Symlink may fail on some Windows configs — copy .claude-plugin instead
      fs.mkdirSync(marketplaceDir, { recursive: true });
      const srcPlugin = path.join(pluginRoot, '.claude-plugin');
      const dstPlugin = path.join(marketplaceDir, '.claude-plugin');
      fs.mkdirSync(dstPlugin, { recursive: true });
      for (const f of fs.readdirSync(srcPlugin)) {
        fs.copyFileSync(path.join(srcPlugin, f), path.join(dstPlugin, f));
      }
    }
  }

  // 3. Register plugin in installed_plugins.json
  const installed = readJSON(installedPath) || { version: 2, plugins: {} };
  // Remove legacy key if present
  delete installed.plugins[LEGACY_KEY];
  installed.plugins[PLUGIN_KEY] = [{
    scope: global ? 'user' : 'project',
    installPath: pluginRoot,
    version: VERSION,
    installedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  }];
  writeJSON(installedPath, installed);

  // 4. Enable in settings.json
  const settings = readJSON(settingsPath) || {};
  if (!settings.enabledPlugins) settings.enabledPlugins = {};
  delete settings.enabledPlugins[LEGACY_KEY]; // clean legacy
  settings.enabledPlugins[PLUGIN_KEY] = true;
  writeJSON(settingsPath, settings);

  const scope = global ? 'GLOBAL' : 'PROJECT';
  console.log(`[claude-dj] Plugin installed — ${scope}`);
  console.log(`  Key:     ${PLUGIN_KEY}`);
  console.log(`  Path:    ${pluginRoot}`);
  console.log(`  Repo:    github:${GITHUB_REPO}`);
  console.log(`  Hooks:   8 (sessionStart, permission, notify, postToolUse, stop, userPrompt, subagentStart, subagentStop)`);
  console.log(`  Skills:  choice-format`);
  console.log(``);
  console.log(`  New Claude sessions will auto-load claude-dj.`);
  console.log(`  Other machines: /install github:${GITHUB_REPO}`);
}

/**
 * Uninstall claude-dj plugin completely.
 */
export async function uninstall({ global = true } = {}) {
  // Stop running bridge first
  const port = process.env.CLAUDE_DJ_PORT || 39200;
  try {
    const res = await fetch(`http://localhost:${port}/api/shutdown`, { method: 'POST', signal: AbortSignal.timeout(3000) });
    if (res.ok) console.log(`[claude-dj] Bridge stopped (port ${port})`);
  } catch { /* bridge not running — fine */ }

  const claudeDir = getClaudeDir();
  const pluginsDir = path.join(claudeDir, 'plugins');
  const installedPath = path.join(pluginsDir, 'installed_plugins.json');
  const marketplacesPath = path.join(pluginsDir, 'known_marketplaces.json');
  const settingsPath = global
    ? path.join(claudeDir, 'settings.json')
    : path.join(process.cwd(), '.claude', 'settings.json');

  // 1. Remove from installed_plugins.json
  const installed = readJSON(installedPath);
  if (installed?.plugins) {
    delete installed.plugins[PLUGIN_KEY];
    delete installed.plugins[LEGACY_KEY];
    writeJSON(installedPath, installed);
  }

  // 2. Remove from known_marketplaces.json
  const marketplaces = readJSON(marketplacesPath);
  if (marketplaces?.[MARKETPLACE_ID]) {
    delete marketplaces[MARKETPLACE_ID];
    writeJSON(marketplacesPath, marketplaces);
  }

  // 3. Remove marketplace symlink/directory
  const marketplaceDir = path.join(pluginsDir, 'marketplaces', MARKETPLACE_DIR_NAME);
  if (fs.existsSync(marketplaceDir)) {
    fs.rmSync(marketplaceDir, { recursive: true, force: true });
  }

  // 4. Remove from settings.json
  const settings = readJSON(settingsPath);
  if (settings?.enabledPlugins) {
    delete settings.enabledPlugins[PLUGIN_KEY];
    delete settings.enabledPlugins[LEGACY_KEY];
  }

  // 5. Clean up legacy hooks
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
  }
  if (settings) writeJSON(settingsPath, settings);

  // 6. Remove cache (current + legacy names)
  for (const name of [MARKETPLACE_ID, 'claude-dj']) {
    const cacheDir = path.join(pluginsDir, 'cache', name);
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  }

  const scope = global ? 'GLOBAL' : 'PROJECT';
  console.log(`[claude-dj] Plugin uninstalled — ${scope}`);
  console.log(`  Removed: plugin, marketplace, hooks, cache, bridge stopped`);
}

/**
 * Show current installation status.
 */
export async function status() {
  const claudeDir = getClaudeDir();
  const pluginsDir = path.join(claudeDir, 'plugins');
  const installedPath = path.join(pluginsDir, 'installed_plugins.json');
  const marketplacesPath = path.join(pluginsDir, 'known_marketplaces.json');
  const settingsPath = path.join(claudeDir, 'settings.json');

  const installed = readJSON(installedPath);
  const settings = readJSON(settingsPath);
  const marketplaces = readJSON(marketplacesPath);

  const entry = installed?.plugins?.[PLUGIN_KEY]?.[0]
    || installed?.plugins?.[LEGACY_KEY]?.[0];
  const isEnabled = settings?.enabledPlugins?.[PLUGIN_KEY]
    || settings?.enabledPlugins?.[LEGACY_KEY];
  const hasMarketplace = !!marketplaces?.[MARKETPLACE_ID];

  console.log(`[claude-dj] Status:`);
  console.log(`  Registered:   ${entry ? 'yes' : 'no'}`);
  console.log(`  Enabled:      ${isEnabled ? 'yes' : 'no'}`);
  console.log(`  Marketplace:  ${hasMarketplace ? 'yes' : 'no'}`);
  if (entry) {
    console.log(`  Key:          ${installed?.plugins?.[PLUGIN_KEY] ? PLUGIN_KEY : LEGACY_KEY}`);
    console.log(`  Path:         ${entry.installPath}`);
    console.log(`  Version:      ${entry.version}`);
  }
}
