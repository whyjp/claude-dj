# Ulanzi Plugin Deploy

Deploy the claude-dj Ulanzi plugin to Ulanzi Studio's installed plugin directory.

## When to Use

- After pulling updates that change ulanzi plugin source files
- When Ulanzi Studio shows an outdated plugin version
- After `npm install` changes in the ulanzi plugin
- On a new machine where the plugin hasn't been installed yet

## Steps

Run the following Bash command to detect Ulanzi Studio and deploy:

```bash
node -e "
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SRC = path.resolve(process.cwd(), 'ulanzi', 'com.claudedj.deck.ulanziPlugin');
const DST = path.join(os.homedir(), 'AppData', 'Roaming', 'Ulanzi', 'UlanziDeck', 'Plugins', 'com.claudedj.deck.ulanziPlugin');
const ULANZI_BASE = path.join(os.homedir(), 'AppData', 'Roaming', 'Ulanzi', 'UlanziDeck');

// Check Ulanzi Studio is installed
if (!fs.existsSync(ULANZI_BASE)) {
  console.log('[ulanzi-deploy] Ulanzi Studio not installed — skipping');
  process.exit(0);
}

// Recursively copy, skipping node_modules and logs
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (['node_modules', 'logs'].includes(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else { fs.copyFileSync(s, d); }
  }
}

console.log('[ulanzi-deploy] Copying plugin files...');
copyDir(SRC, DST);
console.log('[ulanzi-deploy] Copy complete → ' + DST);

// Run npm install if node_modules is missing
const nodeModules = path.join(DST, 'plugin', 'node_modules');
if (!fs.existsSync(nodeModules)) {
  console.log('[ulanzi-deploy] Running npm install...');
  execSync('npm install --omit=dev --silent', { cwd: path.join(DST, 'plugin'), stdio: 'inherit' });
  console.log('[ulanzi-deploy] npm install done');
}

// Report installed version
const manifest = JSON.parse(fs.readFileSync(path.join(DST, 'manifest.json'), 'utf8'));
console.log('[ulanzi-deploy] Installed version: ' + manifest.Version);
console.log('[ulanzi-deploy] Restart Ulanzi Studio to apply changes');
"
```

## Detection Logic

Ulanzi Studio is considered installed if `%APPDATA%\Ulanzi\UlanziDeck` exists.
If not found, the skill exits silently — no error.

## What Gets Copied

All files in `ulanzi/com.claudedj.deck.ulanziPlugin/` **except**:
- `node_modules/` — installed via `npm install` after copy
- `logs/` — runtime logs, not source

## After Deploy

Restart Ulanzi Studio for the updated plugin to take effect.
The bridge server does **not** need to be restarted (it's separate).
