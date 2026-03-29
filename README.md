# Claude DJ

Control Claude Code with physical buttons or browser — no terminal focus needed.

**[Landing Page](https://whyjp.github.io/claude-dj/)**

## Quick Start

### 1. Start the Bridge Server

The Bridge must be running before Claude Code can communicate with the deck.

```bash
# Linux/Mac
./scripts/start-bridge.sh          # default port 39200
./scripts/start-bridge.sh 8080     # custom port

# Windows
scripts\start-bridge.bat
scripts\start-bridge.bat 8080
```

Open **http://localhost:39200** in a browser to see the Virtual DJ.

### 2. Connect Claude Code

**Option A: Plugin mode (recommended)**
```bash
# In a separate terminal — hooks register automatically
claude --plugin-dir /path/to/claude-dj
```

**Option B: Hook scripts**
```bash
# Install globally (all Claude sessions)
./scripts/install-hooks.sh              # Linux/Mac
scripts\install-hooks.bat               # Windows

# Or project-local only
./scripts/install-hooks.sh --project    # Linux/Mac
scripts\install-hooks.bat --project     # Windows

# Then start Claude normally
claude
```

**Uninstall hooks**
```bash
./scripts/uninstall-hooks.sh            # Linux/Mac
scripts\uninstall-hooks.bat             # Windows
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

## Scripts

| Script | Description |
|--------|-------------|
| `scripts/start-bridge.sh` / `.bat` | Start bridge server (auto-installs deps) |
| `scripts/install-hooks.sh` / `.bat` | Register hooks in Claude Code settings |
| `scripts/uninstall-hooks.sh` / `.bat` | Remove hooks from Claude Code settings |

All scripts accept `--project` (hooks only) for project-local instead of global scope.

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Start bridge in dev
./scripts/start-bridge.sh
```

## License

MIT
