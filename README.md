# Claude DJ

Control Claude Code with physical buttons or browser — no terminal focus needed.

**[Landing Page](https://whyjp.github.io/claude-dj/)**

## Quick Start

### 1. Start the Bridge Server

The Bridge must be running before Claude Code can communicate with the deck.

```bash
cd /path/to/claude-dj
node bridge/server.js
# [claude-dj] Bridge running at http://localhost:39200
# [claude-dj] Virtual DJ at http://localhost:39200
```

Open **http://localhost:39200** in a browser to see the Virtual DJ.

### 2. Connect Claude Code

**Option A: Plugin mode (recommended)**
```bash
# In a separate terminal — hooks register automatically
claude --plugin-dir /path/to/claude-dj
```

**Option B: Manual hook registration**
```bash
# Project-local (only this directory)
node tools/setup.js

# Or global (all Claude sessions)
node tools/setup.js --global

# Then start Claude normally
claude
```

### 3. Use the Deck

- Claude asks permission → deck shows **Approve / Deny / Always** buttons
- Claude presents choices → deck shows **numbered choice buttons**
- Press **slot 11** to cycle through active sessions
- No terminal focus needed — press buttons from the deck

## What is this?

Claude DJ connects Claude Code's Hook API to a browser-based Virtual DJ (or physical Ulanzi D200 deck in Phase 3). When Claude asks for permission or presents choices, press a button instead of switching to the terminal.

## Architecture

```
Claude Code Session
    ├─ PreToolUse      → Bridge → deck pulses (PROCESSING)
    ├─ PermissionReq   → Bridge → deck shows approve/deny (BLOCKING)
    ├─ PostToolUse     → Bridge → track tool result
    ├─ Stop            → Bridge → parse transcript for choices
    └─ UserPromptSubmit → Bridge → read deck button events
                           ↕ WebSocket
                   Virtual DJ (browser) / Ulanzi D200 (Phase 3)
```

## Features

- **Permission buttons** — Approve / Always Allow / Deny mapped to deck slots
- **Choice selection** — AskUserQuestion options as numbered buttons
- **Text choice detection** — Parses Claude's transcript for numbered/lettered choices
- **File-based events** — Non-blocking, zero Claude delay (visual-companion pattern)
- **Multi-session** — Focus tracking with slot 11 session cycling
- **Late-join sync** — New clients receive current state immediately
- **Plugin packaging** — `.claude-plugin/plugin.json` with `${CLAUDE_PLUGIN_ROOT}` portable paths
- **Session auto-cleanup** — Idle sessions pruned after 5 minutes

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `CLAUDE_DJ_PORT` | `39200` | Bridge server port |
| `CLAUDE_DJ_URL` | `http://localhost:39200` | Hook → Bridge URL |
| `CLAUDE_DJ_IDLE_TIMEOUT` | `300000` (5min) | Session prune timeout (ms) |

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Start bridge in dev
node bridge/server.js
```

## License

MIT
