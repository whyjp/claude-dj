#!/usr/bin/env node
/**
 * local-deploy.js — Copy changed source files to ALL cached plugin versions.
 *
 * Usage:  node scripts/local-deploy.js [file1] [file2] ...
 *         node scripts/local-deploy.js              (copies all hookable files)
 *
 * Why: CLAUDE_PLUGIN_ROOT may point to any cached version (not necessarily the
 *      latest in installed_plugins.json). This script deploys to every cached
 *      copy so the fix takes effect regardless of which version is active.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PLUGIN_CACHE = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'claude-dj-marketplace', 'claude-dj-plugin');
const MARKETPLACE_SRC = path.join(os.homedir(), '.claude', 'plugins', 'marketplaces', 'claude-dj-marketplace', 'claude-plugin');
const REPO_PLUGIN = path.resolve(import.meta.dirname, '..', 'claude-plugin');

// Files that can be hot-deployed (no bridge restart needed)
const DEPLOYABLE = [
  'hooks/stop.js',
  'hooks/choiceParser.js',
  'hooks/permission.js',
  'hooks/userPrompt.js',
  'hooks/sessionStart.js',
  'hooks/sessionEnd.js',
  'hooks/notify.js',
  'hooks/postToolUse.js',
  'hooks/postToolUseFailure.js',
  'hooks/stopFailure.js',
  'hooks/taskCreated.js',
  'hooks/compact.js',
  'hooks/notification.js',
  'hooks/teammateIdle.js',
  'hooks/subagentStart.js',
  'hooks/subagentStop.js',
  'skills/choice-format/SKILL.md',
  'skills/dj-test/SKILL.md',
  'skills/dj-choice-test/SKILL.md',
];

// Determine which files to deploy
let files = process.argv.slice(2);
if (files.length === 0) {
  files = DEPLOYABLE;
  console.log('Deploying ALL hookable files...');
} else {
  // Normalize: allow both "hooks/stop.js" and "claude-plugin/hooks/stop.js"
  files = files.map(f => f.replace(/^claude-plugin\//, ''));
}

// Find all cached versions
let versions = [];
try {
  versions = fs.readdirSync(PLUGIN_CACHE).filter(d => {
    return fs.statSync(path.join(PLUGIN_CACHE, d)).isDirectory();
  });
} catch {
  console.error(`Cache directory not found: ${PLUGIN_CACHE}`);
  process.exit(1);
}

// Deploy targets: all cached versions + marketplace source
const targets = [
  ...versions.map(v => ({ label: `cache/${v}`, base: path.join(PLUGIN_CACHE, v) })),
  { label: 'marketplace', base: MARKETPLACE_SRC },
];

let copied = 0;
let skipped = 0;

for (const file of files) {
  const src = path.join(REPO_PLUGIN, file);
  if (!fs.existsSync(src)) {
    console.log(`  SKIP ${file} (not in repo)`);
    skipped++;
    continue;
  }

  for (const target of targets) {
    const dest = path.join(target.base, file);
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    try {
      fs.copyFileSync(src, dest);
      copied++;
    } catch (e) {
      console.error(`  FAIL ${file} → ${target.label}: ${e.message}`);
    }
  }
}

console.log(`\nDeployed ${copied} file(s) across ${targets.length} targets (${skipped} skipped)`);
console.log(`Targets: ${targets.map(t => t.label).join(', ')}`);
console.log('\nNote: hooks take effect immediately (no restart needed).');
console.log('      bridge/*.js changes require /claude-dj-plugin:bridge-restart');

// --- Ulanzi Studio plugin deploy ---
// Copies ulanzi/com.claudedj.deck.ulanziPlugin → Ulanzi installed path
const ULANZI_SRC = path.resolve(import.meta.dirname, '..', 'ulanzi', 'com.claudedj.deck.ulanziPlugin');
const ULANZI_DST = path.join(os.homedir(), 'AppData', 'Roaming', 'Ulanzi', 'UlanziDeck', 'Plugins', 'com.claudedj.deck.ulanziPlugin');

if (fs.existsSync(ULANZI_DST)) {
  const ulanziFiles = ['manifest.json', 'plugin/package.json'];
  let ulanziCopied = 0;
  for (const f of ulanziFiles) {
    const src = path.join(ULANZI_SRC, f);
    const dst = path.join(ULANZI_DST, f);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    try { fs.copyFileSync(src, dst); ulanziCopied++; } catch (e) {
      console.error(`  FAIL ulanzi/${f}: ${e.message}`);
    }
  }
  console.log(`\nUlanzi plugin: ${ulanziCopied} file(s) → ${ULANZI_DST}`);
} else {
  console.log('\nUlanzi plugin: install path not found (skip)');
}
