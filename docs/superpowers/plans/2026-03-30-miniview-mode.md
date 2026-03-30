# Miniview Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a miniview mode to VirtualDJ that shows only the D200 deck with an agent tab bar for switching between root/subagents.

**Architecture:** CSS class toggle on `<body>` (`body.mini`) hides header and control panel. A new agent tab bar sits above the deck grid, visible only in miniview. A new `AGENT_FOCUS` WebSocket message enables direct agent selection (instead of cycling with slot 12). URL parameter `?view=mini` persists the mode across reloads.

**Tech Stack:** Vanilla JS, CSS, Express/WebSocket (bridge)

---

### Task 1: Add AGENT_FOCUS message to bridge

**Files:**
- Modify: `bridge/sessionManager.js:259-278`
- Modify: `bridge/wsServer.js:39-49`
- Modify: `bridge/server.js:209-267`
- Test: `test/sessionManager.test.js`

- [ ] **Step 1: Write failing test for setAgentFocus**

Add to `test/sessionManager.test.js`:

```js
it('setAgentFocus sets focusAgentId to a specific agent', () => {
  const sm = new SessionManager();
  sm.getOrCreate({ session_id: 'sa1', cwd: '/test' });
  sm.setFocus('sa1');
  sm.handleSubagentStart({ session_id: 'sa1', agent_id: 'ag1', agent_type: 'Explore' });
  sm.handleSubagentStart({ session_id: 'sa1', agent_id: 'ag2', agent_type: 'Plan' });
  sm.setAgentFocus('ag2');
  assert.equal(sm.focusAgentId, 'ag2');
});

it('setAgentFocus with null resets to root', () => {
  const sm = new SessionManager();
  sm.getOrCreate({ session_id: 'sa2', cwd: '/test' });
  sm.setFocus('sa2');
  sm.handleSubagentStart({ session_id: 'sa2', agent_id: 'ag1', agent_type: 'Explore' });
  sm.setAgentFocus('ag1');
  assert.equal(sm.focusAgentId, 'ag1');
  sm.setAgentFocus(null);
  assert.equal(sm.focusAgentId, null);
});
```

- [ ] **Step 2: Run test — expected FAIL** (`sm.setAgentFocus is not a function`)

- [ ] **Step 3: Implement setAgentFocus**

Add after `cycleAgent()` in `bridge/sessionManager.js`:

```js
setAgentFocus(agentId) {
  this.focusAgentId = agentId || null;
}
```

- [ ] **Step 4: Run test — expected PASS**

- [ ] **Step 5: Add AGENT_FOCUS to WsServer**

In constructor: `this.onAgentFocus = null;`

In `_handleMessage`, new case:

```js
case 'AGENT_FOCUS':
  if (this.onAgentFocus) this.onAgentFocus(msg.agentId || null);
  break;
```

- [ ] **Step 6: Wire in server.js** (after `ws.onButtonPress` block):

```js
ws.onAgentFocus = (agentId) => {
  const focus = sm.focusSessionId ? sm.get(sm.focusSessionId) : null;
  if (!focus) return;
  sm.setAgentFocus(agentId);
  const layout = ButtonManager.layoutFor(focus, sm.focusAgentId, sm.getAgentCount(focus.id));
  broadcastLayout({ ...layout, focusSwitched: true });
};
```

- [ ] **Step 7: Run all tests — expected PASS**
- [ ] **Step 8: Commit** `feat: add AGENT_FOCUS WebSocket message for direct agent selection`

---

### Task 2: Add miniview CSS

**Files:**
- Modify: `public/css/style.css`

- [ ] **Step 1: Append miniview styles**

```css
/* -- MINIVIEW -- */
body.mini { grid-template-rows: 1fr; }
body.mini header { display: none; }
body.mini .ctl-panel { display: none; }
body.mini main { grid-template-columns: 1fr; }
body.mini .dev-panel { border-right: none; }
body.mini .dev-hdr { display: none; }
body.mini .state-info { display: none; }

/* -- MINI AGENT TAB BAR -- */
.mini-agent-bar { display: none; }
body.mini .mini-agent-bar {
  display: flex; align-items: center;
  border-bottom: 1px solid var(--bd);
  background: var(--bg2); padding: 0 8px; gap: 0; flex-shrink: 0;
}
.mini-agent-bar .ma-tab {
  padding: 5px 10px; font-size: 9px; color: var(--muted);
  letter-spacing: .04em; cursor: pointer; white-space: nowrap;
  border-bottom: 2px solid transparent; transition: all .15s; flex-shrink: 0;
}
.mini-agent-bar .ma-tab:hover { color: var(--white); }
.mini-agent-bar .ma-tab.on { color: var(--purple); border-bottom-color: var(--purple); }
.mini-agent-bar .ma-tab.root.on { color: var(--blue); border-bottom-color: var(--blue); }
.mini-agent-bar .ma-expand {
  margin-left: auto; padding: 4px 8px; font-size: 14px; color: var(--muted);
  cursor: pointer; transition: color .15s; flex-shrink: 0;
}
.mini-agent-bar .ma-expand:hover { color: var(--white); }

/* -- HEADER MINI TOGGLE -- */
.btn-mini {
  font-family: var(--sans); font-size: 14px;
  padding: 2px 8px; border: 1px solid var(--bd2);
  background: var(--surf); color: var(--muted);
  cursor: pointer; transition: all .15s;
}
.btn-mini:hover { color: var(--white); border-color: var(--white); }
```

- [ ] **Step 2: Verify no visual change in full view**
- [ ] **Step 3: Commit** `feat: add miniview CSS`

---

### Task 3: Add miniview DOM elements

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add agent tab bar** (inside `.dev-panel`, before `.dev-hdr`):

```html
<div class="mini-agent-bar" id="miniAgentBar">
  <div class="ma-tab root on" data-agent-id="">root</div>
  <div class="ma-expand" id="btnMiniExpand" title="Exit miniview">&#x26F6;</div>
</div>
```

- [ ] **Step 2: Add toggle button** (in `.ws-bar`, after clear log button):

```html
<button class="btn-mini" id="btnMiniToggle" title="Miniview">&#x25A3;</button>
```

- [ ] **Step 3: Verify** — toggle button visible in header, agent bar hidden
- [ ] **Step 4: Commit** `feat: add miniview DOM elements`

---

### Task 4: Implement miniview toggle logic

**Files:**
- Modify: `public/js/app.js`

- [ ] **Step 1: Add toggle functions** (after `_simulatePress`):

```js
function _initMiniview() {
  const params = new URLSearchParams(location.search);
  if (params.get('view') === 'mini') document.body.classList.add('mini');

  const btnToggle = document.getElementById('btnMiniToggle');
  if (btnToggle) btnToggle.addEventListener('click', () => _setMiniview(true));

  const agentBar = document.getElementById('miniAgentBar');
  if (agentBar) {
    agentBar.addEventListener('click', (e) => {
      if (e.target.closest('.ma-expand')) _setMiniview(false);
    });
  }
}

function _setMiniview(on) {
  document.body.classList.toggle('mini', on);
  const params = new URLSearchParams(location.search);
  if (on) params.set('view', 'mini'); else params.delete('view');
  const qs = params.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}
```

- [ ] **Step 2: Call from init()** — add `_initMiniview();` after `initDashboard();`

- [ ] **Step 3: Verify toggle** (header button, expand button, URL param)
- [ ] **Step 4: Commit** `feat: implement miniview toggle with URL persistence`

---

### Task 5: Wire agent tab bar to LAYOUT messages

**Files:**
- Modify: `public/js/d200-renderer.js`
- Modify: `public/js/app.js`

- [ ] **Step 1: Add updateMiniAgentTabs** (in d200-renderer.js, after `setConnectionOverlay`):

```js
export function updateMiniAgentTabs(agents, focusAgentId, onTabClick) {
  const bar = document.getElementById('miniAgentBar');
  if (!bar) return;
  const expand = document.getElementById('btnMiniExpand');
  bar.innerHTML = '';

  const rootTab = document.createElement('div');
  rootTab.className = `ma-tab root${focusAgentId === null ? ' on' : ''}`;
  rootTab.dataset.agentId = '';
  rootTab.textContent = 'root';
  rootTab.addEventListener('click', () => onTabClick(null));
  bar.appendChild(rootTab);

  for (const a of agents) {
    const tab = document.createElement('div');
    tab.className = `ma-tab${a.agentId === focusAgentId ? ' on' : ''}`;
    tab.dataset.agentId = a.agentId;
    tab.textContent = a.type || a.agentId.slice(0, 6);
    tab.addEventListener('click', () => onTabClick(a.agentId));
    bar.appendChild(tab);
  }

  if (expand) bar.appendChild(expand);
}
```

- [ ] **Step 2: Update app.js imports** — add `updateMiniAgentTabs`

- [ ] **Step 3: Add AGENT_FOCUS sender and wire LAYOUT/WELCOME/ALL_DIM**

```js
function _sendAgentFocus(agentId) {
  _sendJson({ type: 'AGENT_FOCUS', agentId: agentId || null });
}
```

In `case 'LAYOUT':` add after `updateSession(msg)`:
```js
updateMiniAgentTabs(msg.agents || [], msg.agent?.agentId || null, _sendAgentFocus);
```

In `case 'WELCOME':` add after `setSessions`:
```js
if (msg.sessions?.length > 0) {
  updateMiniAgentTabs(msg.sessions[0].agents || [], null, _sendAgentFocus);
}
```

In `case 'ALL_DIM':` add after `dimAllSessions()`:
```js
updateMiniAgentTabs([], null, _sendAgentFocus);
```

- [ ] **Step 4: Verify end-to-end** — tabs appear, clicking switches agent, active tab highlighted
- [ ] **Step 5: Commit** `feat: wire agent tab bar to LAYOUT with AGENT_FOCUS switching`
