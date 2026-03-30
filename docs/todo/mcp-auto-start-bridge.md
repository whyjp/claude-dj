# MCP Wrapper for Bridge Auto-Start

> **Status:** POC target (next phase)
> **Difficulty:** MEDIUM
> **Date:** 2026-03-30

---

## Problem

The bridge server (`bridge/server.js`) must be started manually before using Claude DJ. This is a UX friction point — users must remember to run `npm start` or `./scripts/start-bridge.sh` before starting Claude Code.

## Insight

Claude Code plugins can declare MCP servers in `plugin.json`. MCP servers are **auto-started** when the plugin is loaded. If the bridge is wrapped as an MCP server, Claude Code will start it automatically on session launch — no manual step needed.

## Why It's Not MCP Today

MCP provides tools **to** Claude (Claude → MCP Server → result). The bridge receives events **from** Claude (Claude → Hook → HTTP → Bridge). The data flow is reversed:

```
MCP:    Claude ──tool call──→ MCP Server ──result──→ Claude
Bridge: Claude ──hook event──→ Hook Script ──HTTP──→ Bridge ──WS──→ Deck
```

The bridge doesn't need to expose any MCP tools. Hooks remain the event delivery mechanism.

## Proposed Approach

Wrap the bridge as a **stdio MCP server** that:
1. Starts the Express + WebSocket server as a side effect of MCP init
2. Exposes a minimal MCP tool (e.g., `bridge_status`) for health checks
3. Stays alive as long as the Claude Code session is active (MCP lifecycle)

```
plugin.json:
{
  "mcpServers": {
    "claude-dj-bridge": {
      "command": "node",
      "args": ["bridge/mcp-wrapper.js"],
      "env": {}
    }
  }
}
```

```
bridge/mcp-wrapper.js (conceptual):
  - Start Express server on configured port
  - Start WebSocket server
  - Listen on stdio for MCP protocol (JSON-RPC)
  - Expose tool: bridge_status → { port, sessions, clients }
  - Server stays alive = bridge stays alive
```

## Benefits

- **Zero manual setup** — plugin install = bridge auto-starts
- **Lifecycle management** — bridge dies when Claude Code exits
- **Health visibility** — Claude can call `bridge_status` tool to check bridge
- **No port conflicts** — could dynamically allocate port and pass via env

## Open Questions

- Can one MCP server instance serve multiple concurrent Claude Code sessions? (Bridge already supports multi-session, but MCP lifecycle is per-session)
- Should the MCP wrapper detect if a bridge is already running (from another session) and connect instead of starting a second instance?
- Port allocation strategy for concurrent sessions
- Does MCP stdio transport work reliably on Windows with long-lived processes?

## POC Scope

1. Create `bridge/mcp-wrapper.js` with minimal MCP stdio server
2. Add `mcpServers` to `plugin.json`
3. Verify bridge auto-starts when Claude Code loads the plugin
4. Verify bridge survives full session duration
5. Verify multi-session behavior (second session detects existing bridge)
