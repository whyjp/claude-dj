# Claude DJ

Control Claude Code with physical buttons or browser — no terminal focus needed.

**[Landing Page](https://whyjp.github.io/claude-dj/)**

## Quick Start

### Option A: Claude Code Plugin (recommended)

```bash
# Load as plugin — hooks register automatically
claude --plugin-dir /path/to/claude-dj

# Start the Bridge server (separate terminal)
node bridge/server.js

# Open Virtual DJ at http://localhost:39200
```

### Option B: Manual Setup (legacy)

```bash
# Start the Bridge server
npx claude-dj

# Register hooks into .claude/settings.json
npx claude-dj setup          # project-local (default)
npx claude-dj setup --global # all sessions

# Open Virtual DJ at http://localhost:39200
```

## What is this?

Claude DJ connects Claude Code's Hook API to a browser-based Virtual DJ (or physical Ulanzi D200 deck in Phase 3). When Claude asks for permission or presents choices, press a button instead of switching to the terminal.

## Architecture

```
Claude Code --hooks--> Bridge :39200 --ws--> Virtual DJ (browser)
                                     --ws--> Ulanzi D200 (Phase 3)

Hooks: PreToolUse, PostToolUse, PermissionRequest, Stop
```

## Features

- **Permission buttons** — Approve / Always Allow / Deny mapped to deck slots
- **Choice selection** — AskUserQuestion options as numbered buttons
- **Multi-session** — Focus tracking with slot 11 session cycling
- **Late-join sync** — New clients receive current state immediately
- **Plugin packaging** — `.claude-plugin/plugin.json` with `${CLAUDE_PLUGIN_ROOT}` portable paths

## Development

```bash
# Run tests (47 passing)
npm test

# Start bridge in dev
node bridge/server.js
```

## License

MIT
