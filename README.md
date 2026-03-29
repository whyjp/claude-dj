# Claude DJ

Control Claude Code with physical buttons or browser — no terminal focus needed.

**[Landing Page](https://whyjp.github.io/claude-dj/)**

## Quick Start

### 1. Install as Plugin

```bash
claude-dj install          # registers hooks + skills globally
claude-dj status           # verify installation
```

### 2. Start the Bridge

```bash
node bridge/server.js      # http://localhost:39200
```

Open **http://localhost:39200** to see the Virtual DJ dashboard.

### 3. Use Claude Code

```bash
claude                     # hooks + skills auto-loaded
```

Claude now uses the deck for all permission dialogs and choice selections. No terminal focus needed.

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

```
Claude Code Session
    ├─ PreToolUse      → hooks/notify.js       → POST /api/hook/notify      (async)
    ├─ PostToolUse     → hooks/postToolUse.js  → POST /api/hook/postToolUse (async)
    ├─ PermissionReq   → hooks/permission.js   → POST /api/hook/permission  (blocking, 60s)
    ├─ Stop            → hooks/stop.js         → POST /api/hook/stop        (async, display-only notification)
    ├─ UserPromptSubmit→ hooks/userPrompt.js   → GET  /api/events/:id       (reads deck events)
    ├─ SubagentStart   → hooks/subagentStart.js→ POST /api/hook/subagentStart (async)
    └─ SubagentStop    → hooks/subagentStop.js → POST /api/hook/subagentStop  (async)
         ↓
    Bridge Server (localhost:39200)
    ├─ SessionManager (state machine, focus, prune, agent tracking)
    ├─ ButtonManager (state → layout mapping, choice resolution)
    ├─ WsServer (broadcast, late-join sync)
    └─ Static serve → Virtual DJ dashboard
         ↓ WebSocket
    Virtual DJ (browser) / Ulanzi D200 (Phase 3)

    Plugin System:
    ├─ .claude-plugin/plugin.json + marketplace.json
    ├─ hooks/hooks.json (7 hooks, auto-discovered)
    └─ skills/choice-format/SKILL.md (AskUserQuestion behavior injection)
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
| WAITING_RESPONSE | Awaiting input indicator (display-only) | Session name | Agent type or ROOT |

## Features

- **Skill-injected choice pipeline** — Claude uses `AskUserQuestion` for all decisions, enabling button-driven interaction
- **Permission buttons** — Approve / Always Allow / Deny mapped to deck slots
- **Cross-session focus** — WAITING_CHOICE/BINARY sessions auto-prioritized, processing events filtered
- **Subagent tracking** — Tree-view display, independent state per agent, slot 12 cycling
- **Awaiting input notification** — When Claude stops with text choices, deck shows "awaiting input" indicator
- **Multi-session management** — Slot 11 cycles root sessions, focus auto-switches on permission
- **Late-join sync** — New clients receive current deck state immediately
- **Plugin packaging** — `.claude-plugin/plugin.json` with portable `${CLAUDE_PLUGIN_ROOT}` paths
- **Session auto-cleanup** — Idle sessions pruned after 5 minutes

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `CLAUDE_DJ_PORT` | `39200` | Bridge server port |
| `CLAUDE_DJ_URL` | `http://localhost:39200` | Hook → Bridge URL |
| `CLAUDE_DJ_BUTTON_TIMEOUT` | `60000` (60s) | Permission button timeout (ms) |
| `CLAUDE_DJ_IDLE_TIMEOUT` | `300000` (5min) | Session prune timeout (ms) |

## Development

```bash
npm install              # install dependencies
npm test                 # 96 tests across 9 suites
node bridge/server.js    # start bridge
```

## License

MIT
