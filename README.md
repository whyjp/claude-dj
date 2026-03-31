# Claude DJ

Control Claude Code with physical buttons or browser — no terminal focus needed.

**[Landing Page](https://whyjp.github.io/claude-dj/)**

## Quick Start

### 1. Install Plugin

In Claude Code, run:

```
/install-plugin https://github.com/whyjp/claude-dj
```

This registers hooks + skills automatically.

### 2. Start the Bridge

```bash
node bridge/server.js                  # http://localhost:39200
./scripts/start-bridge.sh              # same, with auto-install
./scripts/start-bridge.sh --debug      # + file logging to logs/bridge.log
```

Open **http://localhost:39200** to see the Virtual DJ dashboard.

**Miniview:** Click `▣` in the header to pop out the deck as an always-on-top mini window. Or open `http://localhost:39200?view=mini` directly.

### 3. Use Claude Code

```bash
claude                     # hooks + skills auto-loaded
```

Claude now uses the deck for all permission dialogs and choice selections. No terminal focus needed.

## Manual Installation

```bash
git clone https://github.com/whyjp/claude-dj.git
cd claude-dj
npm install
npx claude-dj install      # registers hooks + skills globally
npx claude-dj status       # verify installation
```

## How Choice Processing Works

Claude DJ transforms Claude Code from a terminal-only workflow into a button-driven interaction model. The core innovation is a **skill-injected choice pipeline** that changes how Claude presents decisions and how users respond.

### The Problem

By default, Claude Code presents choices as text in the terminal:

```
Which approach should we take?
1. Refactor the module
2. Rewrite from scratch
3. Patch and move on
```

The user must find the terminal, type a number, and press Enter. With multiple sessions running, this creates constant context-switching overhead.

### The Solution: Skill Injection

Claude DJ installs a **`choice-format` skill** (`skills/choice-format/SKILL.md`) that is automatically loaded into every Claude Code session. This skill modifies Claude's behavior at the model level:

**Before (default Claude):** Claude writes numbered lists as plain text in the conversation transcript.

**After (with skill):** Claude uses the `AskUserQuestion` tool for every decision point — confirmations, approach selections, parameter choices, and any fork in the workflow.

This is not a cosmetic change. `AskUserQuestion` is a Claude Code built-in tool that triggers the `PermissionRequest` hook — the same hook system used for file write and shell command approvals. By instructing Claude to route all choices through this tool, every decision becomes a **structured, interceptable event** that the deck can render as physical buttons.

### Choice Pipeline

```
  Claude Code (model)
       │
       │  Skill injection: "use AskUserQuestion for all choices"
       │
       ▼
  AskUserQuestion tool call
       │  tool_name: "AskUserQuestion"
       │  tool_input: { questions: [{ question, options: [{label, description}] }] }
       │
       ▼
  PermissionRequest hook ──→ hooks/permission.js ──→ POST /api/hook/permission
       │                                                      │
       │  (HTTP request blocks until                          │
       │   deck button is pressed                             ▼
       │   or 60s timeout)                             Bridge Server
       │                                               SessionManager
       │                                                      │
       │                                               state: WAITING_CHOICE
       │                                               prompt: { type: CHOICE, choices }
       │                                                      │
       │                                                      ▼ WebSocket broadcast
       │                                               ┌─────────────┐
       │                                               │  Virtual DJ  │
       │                                               │  (browser)   │
       │                                               │             │
       │                                               │ [Refactor]  │
       │                                               │ [Rewrite ]  │
       │                                               │ [Patch   ]  │
       │                                               └──────┬──────┘
       │                                                      │
       │                                               User presses button
       │                                                      │
       │                                                      ▼
       │                                               BUTTON_PRESS { slot: 0 }
       │                                                      │
       │                                               resolvePress → { answer: "1" }
       │                                                      │
       ◀──────────────────────────────────────────────────────┘
       │  HTTP response:
       │  { decision: { behavior: "allow", updatedInput: { answer: "1" } } }
       │
       ▼
  Claude receives answer "1" → continues with "Refactor the module"
```

### What Changes at the Claude Level

The `choice-format` skill causes three behavioral shifts in Claude:

1. **Structured output** — Instead of free-form numbered lists, Claude emits `AskUserQuestion` tool calls with typed `options` arrays. Each option has a `label` (button text) and `description` (context).

2. **Blocking interaction** — `AskUserQuestion` triggers a `PermissionRequest` hook, which is the only hook type that **blocks Claude's execution** until a response arrives. This creates a true pause-and-wait interaction, unlike text choices which Claude writes and immediately continues.

3. **Choice vs Confirmation** — The skill distinguishes two interaction patterns:

   - **Real choice** (multiple genuinely different paths): 2-4 distinct options, e.g. "Refactor" / "Rewrite" / "Patch"
   - **Confirmation** (plan approval): Claude states its plan as text, then asks with exactly 2 options: "진행" / "다른 방향"

   This prevents a common anti-pattern where Claude presents a plan description *as* a choice option (e.g. "modify X and apply Y" as option 1, "also apply to Z" as option 2). Plan descriptions are not choices — they should be stated as text followed by a yes/no confirmation.

### Two Choice Paths

Claude DJ supports two distinct choice mechanisms:

| Path | Trigger | State | Response Method |
|------|---------|-------|-----------------|
| **AskUserQuestion** (primary) | `PermissionRequest` hook with `tool_name: "AskUserQuestion"` | `WAITING_CHOICE` | Blocking HTTP response with `updatedInput.answer` |
| **Transcript parsing** (notification) | `Stop` hook parses last assistant message for numbered lists | `WAITING_RESPONSE` | Display-only — deck shows "awaiting input" indicator |

The **AskUserQuestion path** is the primary mechanism — it's real-time, blocking, and guaranteed to deliver the response. The **transcript parsing path** is a display-only notification for when Claude writes choices as text despite the skill. The deck shows an "awaiting input" indicator so the user knows Claude is waiting, but interaction happens in the terminal. Stop hooks cannot inject user turns back to Claude, so this path is intentionally non-interactive.

### Cross-Session Focus Management

When multiple Claude Code sessions are running simultaneously:

- **WAITING_CHOICE/BINARY always wins** — `getFocusSession()` prioritizes sessions needing button input over sessions that are just processing.
- **Focus-filtered broadcasts** — When session A is processing and session B is waiting for a choice, A's `PreToolUse`/`PostToolUse` events do NOT broadcast layout updates. B's choice buttons remain stable on the deck.
- **Auto-focus on permission** — When any session fires a `PermissionRequest`, it immediately takes deck focus.
- **Manual cycling** — Slot 11 cycles between root sessions. Slot 12 cycles between subagents within the focused session.

### Subagent Tracking

Claude Code spawns subagents (Explore, Plan, etc.) that share the parent's `session_id`. Claude DJ tracks these via `SubagentStart`/`SubagentStop` hooks:

```
● api-server (abc123)        PROCESSING
  ├ Explore (agent_7f2a)     PROCESSING
  └ Plan (agent_9c1b)        IDLE
● frontend (def456)          WAITING_CHOICE
```

Each subagent has independent state tracking. Permission requests from subagents still use the session-level `respondFn`, so deck buttons work regardless of whether the request came from root or a child agent.

## Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Claude Code Process                          │
│                                                                     │
│  Model ──→ Tool Call ──→ Hook System ──→ hooks/*.js (child process) │
│    ▲                                         │                      │
│    │                                         │ stdin: JSON event     │
│    │                                         │ stdout: JSON response │
│    │                                         ▼                      │
│    │  ◀── stdout (blocking) ───────── permission.js ────────┐       │
│    │  ◀── exit 0 (fire-and-forget) ── notify.js ────────┐   │       │
│    │                                   stop.js ─────┐   │   │       │
│    │                                   postToolUse ──┤   │   │       │
│    │                                   subagent*.js ─┤   │   │       │
│    │                                   userPrompt.js ┤   │   │       │
│    │                                                 │   │   │       │
└────│─────────────────────────────────────────────────│───│───│───────┘
     │                                                 │   │   │
     │    ┌────────── HTTP (localhost:39200) ───────────┘   │   │
     │    │    POST /api/hook/notify (async) ◀─────────────┘   │
     │    │    POST /api/hook/permission (BLOCKING) ◀──────────┘
     │    │    POST /api/hook/stop (async)
     │    │    POST /api/hook/subagent* (async)
     │    │    GET  /api/events/:sid (poll)
     │    ▼
     │  ┌─────────────────────────────────────────────────────┐
     │  │              Bridge Server (Express + WS)            │
     │  │                                                      │
     │  │  SessionManager ──→ state machine, focus, prune      │
     │  │  ButtonManager  ──→ state → layout, resolvePress     │
     │  │  WsServer       ──→ broadcast LAYOUT/ALL_DIM         │
     │  │  Logger         ──→ stdout + logs/bridge.log         │
     │  │                                                      │
     │  │  HTTP response = hookSpecificOutput                  │
     │  │  (permission.js blocks until response or 60s timeout)│
     │  └──────────────────────┬───────────────────────────────┘
     │                         │
     │              WebSocket (ws://localhost:39200/ws)
     │              ┌──────────┴──────────┐
     │              ▼                     ▼
     │  ┌───────────────────┐  ┌─────────────────────────┐
     │  │  Virtual DJ        │  │  Ulanzi Translator      │
     │  │  (Browser)         │  │  Plugin (Phase 3)       │
     │  │                    │  │                         │
     │  │  ← LAYOUT (JSON)  │  │  ← LAYOUT → render PNG  │
     │  │  ← ALL_DIM        │  │  ← ALL_DIM              │
     │  │  ← WELCOME        │  │  → BUTTON_PRESS         │
     │  │  → BUTTON_PRESS   │  │                         │
     │  │  → AGENT_FOCUS    │  │  Bridge WS ↔ Ulanzi WS  │
     │  │  → CLIENT_READY   │  └────────────┬────────────┘
     │  │                    │               │
     │  │  Miniview (PiP)    │    WebSocket (ws://127.0.0.1:3906)
     │  └───────────────────┘    Ulanzi SDK JSON protocol
     │                                       │
     │                           ┌───────────▼───────────┐
     │                           │  UlanziStudio App      │
     │                           │  (host, manages D200)  │
     │                           └───────────┬───────────┘
     │                                       │ USB HID
     │                           ┌───────────▼───────────┐
     │                           │  Ulanzi D200 Hardware  │
     │                           │  13 LCD keys + encoder │
     │                           └───────────────────────┘
     │
     └── HTTP response flows back through permission.js stdout to Claude
```

### Protocol by Segment

| Segment | Protocol | Transport | Direction | Blocking? |
|---------|----------|-----------|-----------|-----------|
| Claude → Hook | stdin JSON | child process spawn | Claude → Hook script | depends on hook type |
| Hook → Bridge | HTTP REST | `fetch()` to localhost | Hook script → Bridge | **PermissionRequest: YES** (blocks until button/timeout) |
| Bridge → Virtual DJ | WebSocket JSON | `ws://localhost:39200/ws` | Bridge → Browser | no (broadcast) |
| Virtual DJ → Bridge | WebSocket JSON | same connection | Browser → Bridge | no (fire-and-forget) |
| Bridge → Ulanzi Plugin | WebSocket JSON | `ws://localhost:39200/ws` | Bridge → Plugin | no (broadcast) |
| Ulanzi Plugin → Bridge | WebSocket JSON | same connection | Plugin → Bridge | no (fire-and-forget) |
| Plugin ↔ UlanziStudio | WebSocket JSON | `ws://127.0.0.1:3906` (Ulanzi SDK) | bidirectional | no |
| UlanziStudio ↔ D200 | USB HID | proprietary | bidirectional | — |
| Bridge → Claude | HTTP response | same connection as Hook→Bridge | Bridge → Hook script → stdout → Claude | resolves the blocking request |

**The critical path:** `PermissionRequest` hook is the only **synchronous** segment. The hook script (`permission.js`) makes an HTTP POST and **blocks** until the bridge responds (button pressed) or 60s timeout. All other hooks are fire-and-forget.

**D200 hardware note:** The D200 connects via USB to the UlanziStudio desktop app, not directly to the bridge. A translator plugin (Phase 3) bridges the two WebSocket protocols. See `docs/todo/d200-integration-architecture.md` for details.

### Why a Separate Bridge Process?

Claude Code hooks are **short-lived child processes** — each hook invocation spawns `node hooks/permission.js`, which runs, writes stdout, and exits. There is no persistent process to hold WebSocket connections or session state. The bridge fills this gap:

| Need | Hook alone | Bridge |
|------|-----------|--------|
| Persistent WebSocket to deck | cannot (exits after each event) | holds connections |
| Session state across events | cannot (no shared memory) | SessionManager |
| Multi-session focus management | cannot (isolated processes) | getFocusSession() |
| Button press → HTTP response mapping | cannot (no listener) | respondFn callback |

**Could this be an MCP server?** MCP provides tools FROM a server TO Claude. The bridge receives events FROM Claude via hooks — the data flow is reversed. However, wrapping the bridge as an MCP server (with a no-op tool) could enable **auto-start** via Claude plugin system. This is a potential Phase 2 improvement.

### Plugin System

```
.claude-plugin/
├─ plugin.json              Plugin metadata
├─ marketplace.json         Distribution metadata
hooks/
├─ hooks.json               7 hook definitions (auto-discovered by Claude Code)
├─ permission.js            PermissionRequest → HTTP POST (blocking)
├─ notify.js                PreToolUse → HTTP POST (async)
├─ postToolUse.js           PostToolUse → HTTP POST (async)
├─ stop.js                  Stop → HTTP POST (async, choice parsing)
├─ subagentStart.js         SubagentStart → HTTP POST (async)
├─ subagentStop.js          SubagentStop → HTTP POST (async)
└─ userPrompt.js            UserPromptSubmit → GET events (poll)
skills/
└─ choice-format/SKILL.md   Injected into Claude: "use AskUserQuestion for all choices"
```

## Deck Layout

```
Row 0: [0] [1] [2] [3] [4]       ← Dynamic: choices or approve/deny
Row 1: [5] [6] [7] [8] [9]       ← Dynamic: choices (up to 10 total)
Row 2: [10:count] [11:session] [12:agent] [Info Display]
```

| State | Slots 0-9 | Slot 11 | Slot 12 |
|-------|-----------|---------|---------|
| IDLE | Dim | Session name | ROOT |
| PROCESSING | Wave pulse | Session name | Agent type or ROOT |
| WAITING_BINARY | 0=Approve, 1=Always/Deny, 2=Deny | Session name | Agent type or ROOT |
| WAITING_CHOICE | 0..N = choice buttons | Session name | Agent type or ROOT |
| WAITING_CHOICE (multiSelect) | ☐/☑ toggle (0-8) + ✔ Done (9) | Session name | Agent type or ROOT |
| WAITING_RESPONSE | ⏳ Awaiting input (display-only) | Session name | Agent type or ROOT |

## Features

- **Skill-injected choice pipeline** — Claude uses `AskUserQuestion` for all decisions, enabling button-driven interaction
- **Permission buttons** — Approve / Always Allow / Deny mapped to deck slots
- **Multi-select toggle+submit** — `multiSelect` questions show ☐/☑ toggle buttons (slots 0-8) + ✔ Done (slot 9), live verified
- **Cross-session focus** — WAITING_CHOICE/BINARY sessions auto-prioritized, processing events filtered
- **Subagent tracking** — Tree-view display, independent state per agent, slot 12 cycling
- **Awaiting input notification** — When Claude stops with text choices, deck shows ⏳ indicator
- **Multi-session management** — Slot 11 cycles root sessions, focus auto-switches on permission
- **Late-join sync** — New clients receive current deck state immediately
- **Miniview mode** — Pop-out deck as always-on-top PiP window (`▣` button or `?view=mini`), with agent tab bar for root/subagent switching
- **Plugin packaging** — `.claude-plugin/plugin.json` with portable `${CLAUDE_PLUGIN_ROOT}` paths
- **Session auto-cleanup** — Idle sessions pruned after 5 minutes
- **Debug logging** — `--debug` flag enables file logging to `logs/bridge.log` with structured levels (INFO/WARN/ERROR)

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `CLAUDE_DJ_PORT` | `39200` | Bridge server port |
| `CLAUDE_DJ_URL` | `http://localhost:39200` | Hook → Bridge URL |
| `CLAUDE_DJ_BUTTON_TIMEOUT` | `60000` (60s) | Permission button timeout (ms) |
| `CLAUDE_DJ_IDLE_TIMEOUT` | `300000` (5min) | Session prune timeout (ms) |
| `CLAUDE_DJ_DEBUG` | off | Set `1` to enable file logging |

## Debugging

```bash
# Start with file logging
./scripts/start-bridge.sh --debug       # Linux/macOS
scripts\start-bridge.bat --debug        # Windows
npm run debug                           # via npm

# Log file location printed on startup:
#   [claude-dj] Log file: D:\github\claude-dj\logs\bridge.log

# Filter problems only (WARN = dropped/ignored, ERROR = failures)
grep -E "WARN|ERROR" logs/bridge.log

# Trace a button press end-to-end
grep "slot=0" logs/bridge.log
```

Log levels:
| Level | Meaning | Example |
|-------|---------|---------|
| `INFO` | Normal flow | `[ws] BUTTON_PRESS slot=0`, `[hook→claude] behavior=allow` |
| `WARN` | Button dropped/ignored | `[btn] dropped — no focused session`, `TIMEOUT` |
| `ERROR` | Something broke | `[hook→claude] FAILED res.json`, `respondFn threw` |

## Development

```bash
npm install              # install dependencies
npm test                 # run all tests
node bridge/server.js    # start bridge
npm run debug            # start bridge with file logging
```

## License

MIT
