# Claude DJ — Development Guide

## Version Bump Rules

**Every code change must be accompanied by a version bump.** No exceptions.

### Full Deploy Workflow

```bash
# 1. Make code changes

# 2. Bump version (updates package.json, plugin.json, marketplace.json, app.js, AND installed package.json)
node scripts/bump-version.js patch   # bug fixes
node scripts/bump-version.js minor   # new features
node scripts/bump-version.js major   # breaking changes

# 3. Copy ALL changed files to the active installed path
#    Detect installed path:
INSTALL="$(node -e "const p=require('path'),os=require('os');const d=p.join(os.homedir(),'.claude','plugins');const i=JSON.parse(require('fs').readFileSync(p.join(d,'installed_plugins.json'),'utf8'));const e=Object.entries(i.plugins).find(([k])=>k.startsWith('claude-dj'));if(e)console.log(e[1][0].installPath);else console.log('NOT_FOUND')")"

#    Copy each changed file, e.g.:
cp claude-plugin/bridge/server.js      "$INSTALL/bridge/server.js"
cp claude-plugin/bridge/sessionManager.js "$INSTALL/bridge/sessionManager.js"
cp claude-plugin/bridge/buttonManager.js  "$INSTALL/bridge/buttonManager.js"
cp claude-plugin/bridge/wsServer.js    "$INSTALL/bridge/wsServer.js"
cp claude-plugin/public/js/app.js     "$INSTALL/public/js/app.js"      # always copy — bump updates VERSION
cp claude-plugin/public/js/d200-renderer.js "$INSTALL/public/js/d200-renderer.js"
cp claude-plugin/public/index.html    "$INSTALL/public/index.html"
cp claude-plugin/public/css/style.css "$INSTALL/public/css/style.css"
cp claude-plugin/hooks/userPrompt.js  "$INSTALL/hooks/userPrompt.js"

# 4. Restart bridge (required when bridge/*.js changed; optional for public/* changes)
#    Use skill: claude-dj-plugin:bridge-restart
#    Or command: /claude-dj-plugin:bridge-restart

# 5. Commit and push
git add <changed files> package.json claude-plugin/plugin.json .claude-plugin/plugin.json .claude-plugin/marketplace.json claude-plugin/public/js/app.js
git commit -m "fix/feat: description (vX.Y.Z)"
git push
```

### What bump-version.js syncs automatically
- `package.json` (repo root)
- `claude-plugin/plugin.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `claude-plugin/public/js/app.js` (VERSION constant)
- Installed plugin `package.json` (detected via `installed_plugins.json`)

### What requires manual copy to installed path
Everything else: `bridge/*.js`, `public/js/` (except app.js), `public/css/`, `public/index.html`, `hooks/*.js`

### When to restart the bridge
| Changed files | Bridge restart needed? |
|---|---|
| `bridge/*.js` | Yes — process must reload |
| `public/*`, `css/*`, `hooks/*` | No — static files served from disk |
| `package.json` only | Yes — version read at startup |

### About version display
The "About → Version" in the Virtual DJ UI comes from the bridge's WELCOME message (`config.version` → `package.json`). It will NOT update until the bridge is restarted, even after browser refresh.
