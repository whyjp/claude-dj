#!/usr/bin/env node
// Bump version across all files from claude-plugin/package.json (source of truth)
// Usage: node scripts/bump-version.js [major|minor|patch]
//   Without args: syncs current version to all files

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const pkgPath = path.join(root, 'claude-plugin', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const bump = process.argv[2]; // major, minor, patch
if (bump) {
  const [major, minor, patch] = pkg.version.split('.').map(Number);
  if (bump === 'major') pkg.version = `${major + 1}.0.0`;
  else if (bump === 'minor') pkg.version = `${major}.${minor + 1}.0`;
  else if (bump === 'patch') pkg.version = `${major}.${minor}.${patch + 1}`;
  else { console.error('Usage: bump-version.js [major|minor|patch]'); process.exit(1); }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

const version = pkg.version;
console.log(`[claude-dj] Syncing version: ${version}`);

// Files to update (JSON files with "version" field)
const jsonFiles = [
  'package.json',
  'claude-plugin/package.json',
  'claude-plugin/plugin.json',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  'ulanzi/com.claudedj.deck.ulanziPlugin/plugin/package.json',
  'ulanzi/com.claudedj.deck.ulanziPlugin/manifest.json',
];

for (const rel of jsonFiles) {
  const fp = path.join(root, rel);
  try {
    const data = JSON.parse(readFileSync(fp, 'utf8'));
    if (data.version) data.version = version;
    if (data.Version) data.Version = version; // UlanziStudio manifest.json
    // marketplace.json has nested plugin version
    if (data.plugins?.[0]?.version) data.plugins[0].version = version;
    writeFileSync(fp, JSON.stringify(data, null, 2) + '\n');
    console.log(`  ✓ ${rel}`);
  } catch { console.log(`  ✗ ${rel} (skipped)`); }
}

// Update frontend VERSION in app.js
const appJsPath = path.join(root, 'claude-plugin', 'public', 'js', 'app.js');
try {
  const appJs = readFileSync(appJsPath, 'utf8');
  const updated = appJs.replace(/^let VERSION = '[^']*';/m, `let VERSION = '${version}';`);
  if (updated !== appJs) {
    writeFileSync(appJsPath, updated);
    console.log(`  ✓ claude-plugin/public/js/app.js`);
  }
} catch { console.log(`  ✗ claude-plugin/public/js/app.js (skipped)`); }

// Also sync package.json to the installed plugin path (so bridge reports correct version)
try {
  const installedPluginsPath = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');
  const installed = JSON.parse(readFileSync(installedPluginsPath, 'utf8'));
  const entry = Object.entries(installed.plugins || {}).find(([k]) => k.startsWith('claude-dj'));
  if (entry) {
    const installPath = entry[1][0].installPath;
    const installedPkgPath = path.join(installPath, 'package.json');
    const data = JSON.parse(readFileSync(installedPkgPath, 'utf8'));
    data.version = version;
    writeFileSync(installedPkgPath, JSON.stringify(data, null, 2) + '\n');
    console.log(`  ✓ installed package.json (${installPath})`);
  }
} catch { /* installed path not found — skip */ }

console.log(`[claude-dj] Done — version ${version}`);
