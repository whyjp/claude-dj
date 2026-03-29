# Claude DJ — Session 4 Final Status

> **Date:** 2026-03-29
> **Tests:** 82 passing, 8 suites
> **Commits this session:** 20+
> **Push:** Not yet pushed

---

## 1. Completed Work

### 1.1 Choice-Format Skill (AskUserQuestion)
- `skills/choice-format/SKILL.md` — instructs Claude to use AskUserQuestion for all choices
- **Live verified**: deck shows WAITING_CHOICE buttons, button press delivers response to Claude
- Replaces fence-based detection approach (HTML comments stripped from transcript)
- `hooks/choiceParser.js` retained as display-only regex fallback

### 1.2 Plugin Installation System
- `claude-dj install` / `uninstall` / `status` CLI commands
- Registers in `installed_plugins.json` + `known_marketplaces.json` + `enabledPlugins`
- `.claude-plugin/marketplace.json` — compatible with claude-hud/autoresearch pattern
- Cache directory junction → local repo for development
- `claude-dj@claude-dj` plugin key
- Legacy `@local` and old hook-based setup auto-cleaned

### 1.3 PROCESSING Flood Fix
- notify/postToolUse only broadcast when session is focused
- Prevents background session tool calls from overriding WAITING_CHOICE buttons

### 1.4 AskUserQuestion Options Parsing
- Fixed `tool_input.options` → `tool_input.questions[0].options` path
- Fixed `parseInt(label)` → sequential index (was returning NaN for text labels)

### 1.5 FE Style Improvements
- Pretendard sans-serif font (JetBrains Mono for code/logs only)
- Surface/border colors brightened (`--surf: #161628`, `--bd: #262640`)
- `--muted: #9090b0` (was `#4a4a6a`), `--white: #f4f4ff`
- Base font 14px, key numbers 32px, labels 13px
- Header bar 48px, logo 16px
- Choice label opacity 95%

### 1.6 Subagent Tracking (In Progress — other session)
- `SessionManager.handleSubagentStart/Stop` — agent lifecycle
- `cycleAgent()`, `focusAgentId`, `getAgentCount()`
- `hooks/subagentStart.js`, `hooks/subagentStop.js`
- `server.js` endpoints for SubagentStart/Stop
- Slot 12 repurposed: cycle subagents within session

### 1.7 Test Timeout Fix
- Export `pruneInterval` from server.js, clear in test teardown
- All 82 tests pass (was timing out before)

---

## 2. Architecture (Current)

```
Claude Code Session
    ├─ PreToolUse    → hooks/notify.js       → POST /api/hook/notify      (async, focus-filtered)
    ├─ PostToolUse   → hooks/postToolUse.js  → POST /api/hook/postToolUse (async, focus-filtered)
    ├─ PermissionReq → hooks/permission.js   → POST /api/hook/permission  (blocking)
    ├─ Stop          → hooks/stop.js         → POST /api/hook/stop        (async + regex fallback)
    ├─ UserPrompt    → hooks/userPrompt.js   → GET /api/events/:id       (reads deck events)
    ├─ SubagentStart → hooks/subagentStart.js→ POST /api/hook/subagentStart (async)
    └─ SubagentStop  → hooks/subagentStop.js → POST /api/hook/subagentStop  (async)
         ↓
    Bridge Server (localhost:39200)
    ├─ SessionManager (state machine, focus, prune, agent tracking)
    ├─ ButtonManager (state → layout, choice mapping)
    ├─ WsServer (broadcast, late-join sync)
    ├─ Events API (read/clear events.jsonl)
    └─ Static serve (Virtual DJ)
         ↓ WebSocket
    Virtual DJ (browser) / Ulanzi D200 (Phase 3)

    Plugin System:
    ├─ .claude-plugin/plugin.json + marketplace.json
    ├─ hooks/hooks.json (auto-discovered)
    ├─ skills/choice-format/SKILL.md (AskUserQuestion guidance)
    └─ CLI: claude-dj install|uninstall|status
```

### Key Interaction Paths

| User Action | Path | Status |
|-------------|------|--------|
| Permission approve/deny | PermissionRequest → WAITING_BINARY → button → respondFn | ✅ Working |
| AskUserQuestion choice | PermissionRequest → WAITING_CHOICE → button → respondFn | ✅ Live verified |
| Session switch | Slot 11 → cycleFocus → broadcast | ✅ Working |
| Subagent switch | Slot 12 → cycleAgent → broadcast | 🔧 In progress |

---

## 3. Current File/Test Map

```
claude-dj/
├── .claude-plugin/
│   ├── plugin.json          (no hooks field — auto-discovered)
│   └── marketplace.json     (claude-hud compatible format)
├── bridge/
│   ├── config.js            (3 tests)
│   ├── sessionManager.js    (32 tests: +agent lifecycle, cycleAgent)
│   ├── buttonManager.js     (11 tests: +natural language response)
│   ├── wsServer.js
│   └── server.js            (5 tests, focus-filtered broadcast, subagent endpoints)
├── hooks/
│   ├── hooks.json           (7 hooks: +SubagentStart, +SubagentStop)
│   ├── permission.js
│   ├── notify.js
│   ├── postToolUse.js
│   ├── stop.js              (uses choiceParser.js)
│   ├── userPrompt.js
│   ├── choiceParser.js      (fence + regex parser, 11 tests)
│   ├── subagentStart.js     (new)
│   └── subagentStop.js      (new)
├── skills/
│   └── choice-format/
│       └── SKILL.md         (AskUserQuestion guidance)
├── cli/
│   └── index.js             (install/uninstall/status/start)
├── tools/
│   └── setup.js             (plugin registration logic)
├── public/
│   ├── css/style.css        (Pretendard, improved contrast)
│   ├── js/app.js
│   ├── js/d200-renderer.js
│   ├── js/dashboard.js
│   └── js/util.js
├── test/
│   ├── sessionManager.test.js  (32 tests)
│   ├── buttonManager.test.js   (11 tests)
│   ├── stopParser.test.js      (11 tests)
│   ├── hooks.test.js           (11 tests)
│   ├── config.test.js          (3 tests)
│   ├── bridge.test.js          (5 tests)
│   └── e2e.test.js             (11 tests: +display-only choices)
└── docs/
    ├── superpowers/specs/2026-03-29-choice-fencing-design.md
    ├── superpowers/specs/2026-03-29-subagent-tracking-design.md
    └── superpowers/plans/2026-03-29-subagent-tracking.md
```

Total: **82 automated tests**, 8 suites.

---

## 4. Next Steps (Priority Order)

### 4.1 [HIGH] Subagent Tracking — Remaining Tasks
> Plan: `docs/superpowers/plans/2026-03-29-subagent-tracking.md`

- Task 4: FE dashboard agent display (agent count badge, session detail)
- Task 5: E2E tests for subagent lifecycle
- Task 6: Integration test with real subagents

### 4.2 [HIGH] Cross-Session AskUserQuestion
다른 세션의 AskUserQuestion 선택지에 대한 덱 버튼 응답 전달 확인.
현재 포커스 관리가 제대로 되는지 검증 필요.

### 4.3 [MEDIUM] Button Timeout Extension
`bridge/config.js` — `buttonTimeout: 30000` → `60000`+
30초는 선택에 충분하지 않음 (라이브 테스트에서 확인)

### 4.4 [LOW] Phase 3 — Physical D200 Plugin
> Ref: `docs/reference/ulanzideck-plugin-dev-guide.md`

### 4.5 [LOW] Phase 4 — Distribution
- `git push` to GitHub
- npm publish (`npx claude-dj`)
- `/install github:whyjp/claude-dj` 검증

---

## 5. Quick Start for Next Session

```bash
cd D:/github/claude-dj

# Verify tests pass
node --test test/*.test.js    # 82/82

# Plugin is globally installed
node cli/index.js status

# Start bridge
node bridge/server.js         # http://localhost:39200

# New Claude session auto-loads hooks + skills
claude                        # choice-format skill active
```
