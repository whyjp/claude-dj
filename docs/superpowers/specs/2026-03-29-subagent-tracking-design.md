# Subagent Tracking & Hierarchical Session Management

**Date:** 2026-03-29
**Status:** Approved

## Goal

Track subagent lifecycle within sessions. Display root/child hierarchy in dashboard. Assign Slot 11 to root-only session cycling, Slot 12 to subagent cycling within current root.

## Constraints

- Claude Code hooks share `session_id` between root and subagents
- `agent_id` field present only on hooks fired inside a subagent
- `agent_type` field gives agent name (e.g., "Explore", "Plan")
- `SubagentStart` / `SubagentStop` dedicated hook events available
- No `parent_agent_id` — flat, but `agent_id` presence = child

## Data Model

### Session object (SessionManager)

```js
{
  id: "abc123",              // session_id
  name: "api-server",
  state: "PROCESSING",       // root agent state
  waitingSince: null,
  prompt: null,
  respondFn: null,
  lastToolResult: null,
  idleSince: null,
  agents: new Map([           // NEW — subagent tracking
    ["agent_7f2a", {
      agentId: "agent_7f2a",
      type: "Explore",
      state: "PROCESSING",
      startedAt: 1743000000,
    }],
  ]),
}
```

### Focus model

```
focusSessionId  → root session ID       (Slot 11 cycles)
focusAgentId    → subagent ID or null   (Slot 12 cycles)
```

- `focusAgentId = null` means root is focused
- Slot 12 with no agents: displays "ROOT", no-op on press

### Classification rule

| Hook input           | Classification | Action                          |
|----------------------|----------------|---------------------------------|
| No `agent_id`        | root agent     | Update `session.state`          |
| Has `agent_id`       | subagent       | Update `session.agents.get(id)` |
| `SubagentStart` event| child created  | Add to `session.agents` Map     |
| `SubagentStop` event | child ended    | Remove from `session.agents`    |

## New Hooks

### SubagentStart

- File: `hooks/subagentStart.js`
- Type: command (async, fire-and-forget)
- POSTs to `POST /api/hook/subagentStart`
- Input fields used: `session_id`, `agent_id`, `agent_type`

### SubagentStop

- File: `hooks/subagentStop.js`
- Type: command (async, fire-and-forget)
- POSTs to `POST /api/hook/subagentStop`
- Input fields used: `session_id`, `agent_id`, `agent_type`

### hooks.json update

Add two entries:
```json
"SubagentStart": [{ "hooks": [{ "type": "command", "command": "..." }] }],
"SubagentStop":  [{ "hooks": [{ "type": "command", "command": "..." }] }]
```

## Server Changes

### New endpoints

```
POST /api/hook/subagentStart  → sm.handleSubagentStart(input)
POST /api/hook/subagentStop   → sm.handleSubagentStop(input)
```

### Existing handler changes

All handlers (handleNotify, handlePermission, handlePostToolUse, handleStop) gain agent_id branching:

```js
if (input.agent_id) {
  // Update session.agents.get(input.agent_id).state
} else {
  // Existing logic — update session.state
}
```

### SessionManager new methods

```js
handleSubagentStart(input)   // Add agent to session.agents Map
handleSubagentStop(input)    // Remove agent from session.agents Map
cycleAgent()                 // Cycle focusAgentId within current root's agents
getAgentCount(sessionId)     // Return agents.size for a session
```

### Slot behavior

| Slot | Action | Details |
|------|--------|---------|
| 11   | Cycle root sessions | `cycleFocus()` — root only, resets `focusAgentId = null` |
| 12   | Cycle subagents | `cycleAgent()` — within current root. null → first agent → next → null |

Both broadcast LAYOUT with `focusSwitched: true`.

### LAYOUT message extension

```js
{
  type: "LAYOUT",
  preset: "processing",
  session: { id, name, state },
  agent: { agentId, type, state } | null,   // NEW — focused agent, null = root
  sessionCount: 3,
  agentCount: 2,                            // NEW — current root's child count
  focusSwitched: true,
}
```

## Frontend Changes

### Dashboard — Sessions tab (tree view)

```
● api-server (abc123)        PROCESSING
  ├ Explore (agent_7f2a)     PROCESSING
  └ Plan (agent_9c1b)        IDLE
● frontend (def456)          WAITING_BINARY
```

- Child rows: `.sess-child` class, indented with padding-left
- Dot color follows state rules (same as root)
- Children removed on SubagentStop

### Slot 12 key design

Replace RESERVED with agent switcher:

- Default (no agents): show "ROOT" with purple border
- Agent selected: show agent type name (e.g., "Explore")
- Agent count badge (same pattern as slot 10 count badge)
- CSS: `.k.agent-switch` replacing `.k.reserved`

### Event log tabs

Sub-tabs extended with agent granularity:

```
[All] [api-server] [api-server/Explore] [api-server/Plan] [frontend]
```

- `log()` accepts `sessionId` + `agentId`
- Root tab: all logs for that session (root + children)
- Child tab: only that agent_id's logs

### Slot 12 log sync

Same pattern as slot 11: server sends `focusSwitched: true` on cycleAgent, client calls `switchLogSession` with session + agent filter.

## Testing

### SessionManager tests (new)

- `handleSubagentStart` adds agent to session.agents
- `handleSubagentStop` removes agent from session.agents
- `handleNotify` with agent_id updates agent state, not root
- `handlePermission` with agent_id updates agent state
- `cycleAgent` rotates through agents + null (root)
- `cycleAgent` returns null when no agents
- `cycleFocus` resets focusAgentId to null

### ButtonManager tests (new)

- Slot 12 layout: agent-switch key with agent info
- Slot 12 resolvePress returns agent cycle action

### E2E tests (new)

- SubagentStart hook spawn → bridge receives → session.agents updated
- SubagentStop hook spawn → bridge receives → agent removed
- notify with agent_id → agent state updated (not root)

### Hook script tests (new)

- subagentStart.js exists and is valid JS
- subagentStop.js exists and is valid JS
- hooks.json includes SubagentStart and SubagentStop entries
