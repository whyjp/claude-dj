# D200 Hardware Integration — Architecture Analysis

> **Status:** POC target (next phase)
> **Difficulty:** MEDIUM-HIGH
> **Date:** 2026-03-30

---

## Key Finding

The D200 does NOT connect directly via WebSocket. The actual communication stack is:

```
Ulanzi Plugin ──WebSocket (port 3906)──→ UlanziStudio App ──USB HID──→ D200 Hardware
```

UlanziStudio is the mandatory intermediary. Plugins cannot bypass it to talk to D200 directly.

## SDK Protocol Summary

| Layer | Protocol | Format | Direction |
|-------|----------|--------|-----------|
| Plugin ↔ UlanziStudio | WebSocket `ws://127.0.0.1:3906` | JSON `{cmd, uuid, key, actionid, param}` | bidirectional |
| UlanziStudio ↔ D200 | USB HID | proprietary | bidirectional |

### Button press flow (D200 → Plugin)
```
D200 button pressed → USB → UlanziStudio → WS {cmd:"run", key:"0"} → Plugin
```

### Key display update (Plugin → D200)
```
Plugin → WS {cmd:"state", param:{statelist:[{type:1, data:"base64..."}]}} → UlanziStudio → USB → D200 LCD
```

## Integration Approaches

### Approach A: claude-dj as Ulanzi Plugin (recommended)

Create a standard Ulanzi plugin package (`com.claudedj.deck.ulanziPlugin/`) that:
- Connects to UlanziStudio on port 3906 via their SDK
- Connects to claude-dj Bridge on port 39200 via our existing WebSocket
- Acts as a **translator** between the two WebSocket protocols

```
Claude Code → Hooks → Bridge (39200)
                        ↓ WebSocket (39200)
                  ┌─────┴─────┐
                  │ Virtual DJ │  (browser, existing)
                  └────────────┘
                        ↓ WebSocket (39200)
              ┌─────────┴──────────┐
              │ Ulanzi Plugin      │  (NEW: translator)
              │ (Node.js, in       │
              │  UlanziStudio)     │
              └─────────┬──────────┘
                        ↓ WebSocket (3906, Ulanzi SDK)
              ┌─────────┴──────────┐
              │ UlanziStudio App   │
              └─────────┬──────────┘
                        ↓ USB HID
              ┌─────────┴──────────┐
              │ D200 Hardware      │
              └────────────────────┘
```

**Pros:**
- Uses official SDK, no reverse engineering
- Plugin is a standard Ulanzi package, installable via UlanziStudio
- Bridge protocol already exists (LAYOUT, BUTTON_PRESS, etc.)
- Virtual DJ and D200 share the same bridge → same state

**Cons:**
- Requires UlanziStudio running
- Two WebSocket connections from the plugin (one to bridge, one to UlanziStudio)
- Must render key images as PNG/base64 (not CSS)

### Approach B: Bridge replaces UlanziStudio

Communicate directly with D200 via USB HID from the bridge.

**Pros:**
- No UlanziStudio dependency
- Full control over D200

**Cons:**
- Requires USB HID reverse engineering
- D200 protocol is proprietary and undocumented
- Platform-specific USB drivers
- Loses access to UlanziStudio's profile/page management

### Recommendation: Approach A

Approach A is clearly superior — it uses the official SDK, is well-documented, and the translator plugin is a small Node.js script.

## Ulanzi Plugin Requirements

### manifest.json
```json
{
  "UUID": "com.claudedj.deck",
  "Name": "Claude DJ",
  "Author": "whyjp",
  "Description": "Control Claude Code with D200 deck",
  "Version": "0.1.0",
  "Icon": "resources/icon.png",
  "Type": "JavaScript",
  "CodePath": "plugin/app.js",
  "Actions": [
    {
      "UUID": "com.claudedj.deck.slot",
      "Name": "DJ Slot",
      "States": [
        { "Name": "Dim", "Image": "resources/dim.png" },
        { "Name": "Active", "Image": "resources/active.png" }
      ],
      "Controllers": ["Keypad"]
    }
  ]
}
```

### Translator Plugin Logic
```
1. Connect to UlanziStudio (port 3906) via Ulanzi SDK
2. Connect to claude-dj Bridge (port 39200) via WebSocket
3. On LAYOUT from Bridge:
   - For each slot, render key image (PNG base64)
   - Send {cmd:"state"} to UlanziStudio for each key
4. On {cmd:"run"} from UlanziStudio:
   - Map key index to slot number
   - Send {type:"BUTTON_PRESS", slot} to Bridge
```

### Key Rendering Challenge

D200 LCD keys display images (PNG/base64), not HTML/CSS. The plugin must:
- Render each key state as a PNG image
- Use canvas or SVG → PNG conversion
- Handle approve (green), deny (red), choice (colored), processing (animation) states
- GIF supported for animations (processing pulse)

## POC Scope

1. Create minimal Ulanzi plugin folder structure
2. Implement translator: Bridge WS ↔ Ulanzi WS
3. Render IDLE and BINARY states as PNG key images
4. Verify button press → BUTTON_PRESS → Bridge → Claude flow
5. Test with real D200 hardware
