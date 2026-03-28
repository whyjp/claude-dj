# UlanziDeck Plugin Development Reference

> Source: https://cloud.tencent.com/developer/article/2461403
> Extracted: 2026-03-29 for claude-dj Phase 3 (D200 hardware plugin)

---

## 1. Plugin File Structure

```
com.ulanzi.{name}.ulanziPlugin/
├── assets/icons/              # Icon resources
├── libs/                       # Shared libraries
├── plugin/
│   ├── actions/               # Action logic
│   ├── app.html               # Main service entry (HTML mode)
│   └── app.js                 # Main service JS
├── property-inspector/
│   └── {action}/
│       ├── inspector.html     # Settings UI
│       └── inspector.js       # Form/socket handling
├── manifest.json              # Plugin manifest
├── zh_CN.json                 # i18n Chinese
└── en.json                    # i18n English
```

## 2. manifest.json Schema

```json
{
  "Version": "1.0.4",
  "Author": "Ulanzi",
  "Name": "Analog Clock",
  "Description": "Always be on time.",
  "Icon": "assets/icons/icon.png",
  "Category": "Analog Clock",
  "CategoryIcon": "assets/icons/categoryIcon.png",
  "CodePath": "plugin/app.html",
  "Type": "JavaScript",
  "SupportedInMultiActions": false,
  "PrivateAPI": true,
  "UUID": "com.ulanzi.ulanzideck.analogclock",
  "Actions": [
    {
      "Name": "clock",
      "Icon": "assets/icons/actionIcon.png",
      "PropertyInspectorPath": "property-inspector/clock/inspector.html",
      "state": 0,
      "States": [
        { "Name": "clock", "Image": "assets/icons/icon.png" }
      ],
      "Tooltip": "Show a nice analog clock",
      "UUID": "com.ulanzi.ulanzideck.analogclock.clock",
      "SupportedInMultiActions": false
    }
  ],
  "OS": [
    { "Platform": "mac", "MinimumVersion": "10.11" },
    { "Platform": "windows", "MinimumVersion": "10" }
  ],
  "Software": { "MinimumVersion": "6.1" }
}
```

### Key Fields

| Field | Description |
|-------|-------------|
| `CodePath` | Main plugin entry point (.html or .js) |
| `UUID` | Plugin main identifier (length = 4 segments) |
| `Actions[].UUID` | Action identifier (length > 4 segments) |
| `Actions[].PropertyInspectorPath` | Settings UI HTML path |
| `Actions[].state` | Default icon index in States array |
| `Actions[].States` | Array of icon states |

## 3. WebSocket Communication Protocol

### 3.1 Plugin Initialization

**Node.js mode:**
```bash
node.exe "app.js" "127.0.0.1" "3906" "en-US"
```

**HTML mode (query params):**
```
app.html?address=127.0.0.1&port=3906&language=en-US&uuid=com.xxx.xxx
```

### 3.2 PropertyInspector Loading (query params)

```
inspector.html?address=127.0.0.1
              &port=3906
              &language=en-US
              &uuid=com.xxx.xxx          # Action UUID
              &actionId=                 # Unique instance ID
              &key=0_0                   # Grid coordinate (row_col)
```

### 3.3 Server → Plugin Events

```javascript
// Connection established
$UD.onConnected(conn => { /* init */ })

// Action params changed (from PropertyInspector)
$UD.onParamFromPlugin(jsn => { /* jsn.param, jsn.context */ })

// Action active/inactive state (page switch)
$UD.onSetActive(jsn => { /* jsn.active, jsn.context */ })

// Action removed by user
$UD.onClear(jsn => { /* jsn.context */ })
```

### 3.4 Plugin → Server Requests

```javascript
// Send params to server
$UD.sendParamFromPlugin(paramObject);

// Send generic message
$UD.send(type, parameters);
```

## 4. Action Lifecycle

```
Register (manifest load)
    → Activate (user places Action on deck) → onConnected()
    → Configure (PropertyInspector loads) → sendParamFromPlugin()
    → Page Switch → onSetActive(false) → pause resources
    → Page Return → onSetActive(true) → resume
    → Remove → onClear() → cleanup memory
```

## 5. Communication Flow

```
User UI (UlanziDeck App)
    ↕ WebSocket
PropertyInspector.html ←→ Server ←→ plugin/app.html (or app.js)
    sendParamFromPlugin()       onParamFromPlugin()
```

## 6. Image/Icon Specs

- **Format**: PNG
- **Background**: `#282828` (match device background)
- **Font**: "Source Han Sans" (defined in udpi.css)
- **Location**: `assets/icons/`

## 7. Naming Conventions

| Item | Pattern | Example |
|------|---------|---------|
| Package name | `com.ulanzi.{name}.ulanziPlugin` | `com.ulanzi.analogclock.ulanziPlugin` |
| Plugin UUID | 4 segments | `com.ulanzi.ulanzideck.analogclock` |
| Action UUID | >4 segments | `com.ulanzi.ulanzideck.analogclock.clock` |

## 8. Requirements

- Node.js 20.12.2+
- UlanziDeck Software 6.1+
- SDK: `UlanziTechnology/UlanziDeckPlugin-SDK` (GitHub)

## 9. Implications for claude-dj Phase 3

The claude-dj D200 plugin will need:

1. **manifest.json** with claude-dj Actions (approve/deny/always/session-switch)
2. **WebSocket bridge**: plugin/app.js connects to both UlanziDeck server AND claude-dj Bridge
3. **Action states**: Multiple States per action for idle/processing/waiting/approve/deny icons
4. **PropertyInspector**: Minimal — just bridge URL config
5. **onSetActive handling**: Pause/resume bridge connection on page switch
6. **onClear**: Disconnect from bridge when action removed
7. **Image assets**: PNG icons at device resolution, `#282828` background
