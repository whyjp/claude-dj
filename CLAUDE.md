# Claude DJ — Development Guide

## Version Bump Rules

**Every code change must be accompanied by a version bump.** No exceptions.

### Full Deploy Workflow

```bash
# 1. Make code changes

# 2. Bump version
node scripts/bump-version.js patch   # bug fixes
node scripts/bump-version.js minor   # new features
node scripts/bump-version.js major   # breaking changes

# 3. Detect installed path (reuse in subsequent commands)
INSTALL="$(node -e "const p=require('path'),os=require('os');const d=p.join(os.homedir(),'.claude','plugins');const i=JSON.parse(require('fs').readFileSync(p.join(d,'installed_plugins.json'),'utf8'));const e=Object.entries(i.plugins).find(([k])=>k.startsWith('claude-dj'));if(e)console.log(e[1][0].installPath);else console.log('NOT_FOUND')")"

# 4. Copy EACH changed source file to the installed path
#    app.js is ALWAYS copied (bump updates the VERSION constant)
#    Copy only the files you actually changed — examples:
cp claude-plugin/public/js/app.js              "$INSTALL/public/js/app.js"
cp claude-plugin/bridge/server.js              "$INSTALL/bridge/server.js"
cp claude-plugin/bridge/sessionManager.js      "$INSTALL/bridge/sessionManager.js"
cp claude-plugin/bridge/buttonManager.js       "$INSTALL/bridge/buttonManager.js"
cp claude-plugin/bridge/wsServer.js            "$INSTALL/bridge/wsServer.js"
cp claude-plugin/hooks/stop.js                 "$INSTALL/hooks/stop.js"
cp claude-plugin/hooks/permission.js           "$INSTALL/hooks/permission.js"
cp claude-plugin/hooks/userPrompt.js           "$INSTALL/hooks/userPrompt.js"
cp claude-plugin/hooks/choiceParser.js         "$INSTALL/hooks/choiceParser.js"
cp claude-plugin/public/js/d200-renderer.js    "$INSTALL/public/js/d200-renderer.js"
cp claude-plugin/public/index.html             "$INSTALL/public/index.html"
cp claude-plugin/public/css/style.css          "$INSTALL/public/css/style.css"
cp claude-plugin/skills/choice-format/SKILL.md "$INSTALL/skills/choice-format/SKILL.md"

# 5. Restart bridge (if bridge/*.js or package.json changed)
#    /claude-dj-plugin:bridge-restart

# 6. Commit and push
git add <changed files> package.json claude-plugin/plugin.json \
  .claude-plugin/plugin.json .claude-plugin/marketplace.json \
  claude-plugin/public/js/app.js
git commit -m "fix/feat: description (vX.Y.Z)"
git push
```

### What bump-version.js syncs automatically
- `package.json` (repo root)
- `claude-plugin/package.json`
- `claude-plugin/plugin.json`
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `claude-plugin/public/js/app.js` (VERSION constant)
- Installed plugin `package.json` (detected via `installed_plugins.json`)

### What requires manual copy to installed path
Everything NOT in the list above: `bridge/*.js`, `hooks/*.js`, `skills/**/*.md`, `public/js/` (except app.js), `public/css/`, `public/index.html`

### When to restart the bridge
| Changed files | Bridge restart needed? |
|---|---|
| `bridge/*.js` | **Yes** — process must reload |
| `package.json` only | **Yes** — version read at startup |
| `public/*`, `css/*`, `hooks/*`, `skills/*` | No — served from disk / read per invocation |

### About version display
The "About → Version" in the Virtual DJ UI comes from the bridge's WELCOME message (`config.version` → `package.json`). It will NOT update until the bridge is restarted, even after browser refresh.
