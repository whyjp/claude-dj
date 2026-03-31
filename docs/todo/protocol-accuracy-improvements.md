# Protocol Accuracy Improvements — Claude Code Hook Research

> Generated from Claude Code source analysis (2026-03-31, claude-code2/src)
> Compared 27 available hooks vs 6 currently used by claude-dj.

## Status Legend
- [ ] TODO
- [x] DONE
- [-] WONTFIX

---

## Research Summary

### Current Hook Coverage (6 / 27)

| Hook | Usage | Type |
|------|-------|------|
| PreToolUse | notify (async) | fire-and-forget |
| PostToolUse | tool result capture | fire-and-forget |
| PermissionRequest | approve/deny + AskUserQuestion | blocking |
| Stop | turn end, transcript choice parse | async |
| SubagentStart | agent tracking | fire-and-forget |
| SubagentStop | agent removal | fire-and-forget |

### Key Findings from Source

1. **27 hooks total** — SessionStart, SessionEnd, PostToolUseFailure, PermissionDenied, UserPromptSubmit, PreCompact, PostCompact, TeammateIdle, TaskCreated, TaskCompleted, StopFailure, Notification, Setup, Elicitation, ElicitationResult, ConfigChange, InstructionsLoaded, CwdChanged, FileChanged, WorktreeCreate, WorktreeRemove are all unused.

2. **AskUserQuestion supports 1-4 questions** with `questions[]` array, each having `header`, `options[]`, `multiSelect`, `preview`. Current bridge only reads `questions[0]`.

3. **PreToolUse can return permission decisions** (`permissionDecision: 'allow'|'deny'|'ask'`) — currently unused, only used as async notify.

4. **Hook responses support `additionalContext`** — injected as system message to model. Currently unused.

5. **SessionState is `'idle'|'running'|'requires_action'`** — Claude Code emits `session_state_changed` events. Bridge currently guesses session end via 5-min idle timeout.

6. **`updatedPermissions: PermissionUpdate[]`** can be returned in PermissionRequest response — Claude Code handles persistence natively. Bridge currently writes `settings.local.json` directly.

7. **Exit code 2 = blocking error** in hooks — stderr shown to model. Other exit codes are non-blocking. Currently not leveraged.

8. **`asyncRewake` mode** — hook runs in background but can wake model on exit code 2 via task-notification.

---

## HIGH Priority — Immediate Improvements

### 1. Add SessionStart hook
- **Impact:** Session detected at creation, not at first tool call
- **Current gap:** Bridge misses ~1-5s between session start and first PreToolUse
- **Payload fields:** `{session_id, cwd, hook_event_name: 'SessionStart', source: 'startup'|'resume'|'clear'|'compact', agent_type?, model?}`
- **Response fields:** `{additionalContext?, initialUserMessage?, watchPaths?}`
- **Implementation:**
  - [x] Create `hooks/sessionStart.js` — POST to `/api/hook/sessionStart`
  - [x] Add `POST /api/hook/sessionStart` endpoint in `server.js`
  - [x] `sm.handleSessionStart(input)` — create session immediately with name from `cwd`
  - [x] Register in plugin `hooks.json` under `SessionStart`
  - [x] Broadcast LAYOUT with state=IDLE on session creation

### 2. Add SessionEnd hook
- **Impact:** Exact session termination — no more 5-min idle guessing
- **Current gap:** Dead sessions linger until idle timeout or PID check (30s interval)
- **Payload fields:** `{session_id, hook_event_name: 'SessionEnd', reason: 'clear'|'resume'|'logout'|'prompt_input_exit'|'other'}`
- **Implementation:**
  - [x] Create `hooks/sessionEnd.js` — POST to `/api/hook/sessionEnd`
  - [x] Add `POST /api/hook/sessionEnd` endpoint in `server.js`
  - [x] `sm.handleSessionEnd(input)` — auto-deny pending permission, remove session, broadcast SESSION_DISCONNECTED
  - [x] Register in plugin `hooks.json` under `SessionEnd`
  - [x] Keep disk-sync as fallback for crashes (no SessionEnd fired)

### 3. Add PostToolUseFailure hook — DONE
- **Impact:** Show tool errors on D200 display immediately
- **Current gap:** Failed tools show no visual feedback — bridge stays in PROCESSING
- **Payload fields:** `{session_id, tool_name, tool_input, tool_use_id, error, is_interrupt?}`
- **Implementation:**
  - [x] Create `hooks/postToolUseFailure.js` — POST to `/api/hook/postToolUseFailure`
  - [x] Add endpoint in `server.js`
  - [x] Show error state on info display: red border + error icon + tool name
  - [x] Add `.k-info.error` CSS class (red theme, similar to `.k-info.wait`)
  - [x] Auto-clear after 5s back to PROCESSING
  - [x] Register in plugin `hooks.json` under `PostToolUseFailure`

### 4. Support multi-question AskUserQuestion — DONE
- **Impact:** Handle all 1-4 questions instead of only the first
- **Current gap:** `questions[1..3]` silently dropped, answers incomplete
- **Payload:** `tool_input.questions[]` — each has `{question, header, options[], multiSelect, preview}`
- **Implementation:**
  - [x] Update `sessionManager.js handlePermission()` — detect `questions.length > 1`
  - [x] Store full `questions[]` array in `session.prompt`
  - [x] Add `questionIndex` to prompt state
  - [x] On button press: record answer for current question, advance index
  - [x] On last question submit: build complete `answers` object, respond
  - [x] Update LAYOUT protocol: add `questionIndex`, `questionCount` fields
  - [x] Update `d200-renderer.js` — show question progress (e.g., "Q1/3")
  - [x] Update response format: `updatedInput.answers = {q1: ans1, q2: ans2, ...}`

### 5. Add UserPromptSubmit hook — DONE
- **Impact:** Instant PROCESSING transition when user types, not when first tool fires
- **Current gap:** ~0.5-2s delay between user input and visual PROCESSING state
- **Payload fields:** `{session_id, hook_event_name: 'UserPromptSubmit', prompt}`
- **Response fields:** `{additionalContext?}` — can inject context before model runs
- **Implementation:**
  - [x] Update `hooks/userPrompt.js` — POST to `/api/hook/userPromptSubmit`
  - [x] Add endpoint in `server.js`
  - [x] Transition session from IDLE → PROCESSING immediately
  - [x] Clear any stale WAITING_RESPONSE state
  - [x] Already registered in plugin `hooks.json` under `UserPromptSubmit`

### 6. Add StopFailure hook — DONE
- **Impact:** Show API errors (rate limit, auth, network) on D200 immediately
- **Current gap:** API failures invisible — session stays in PROCESSING until timeout
- **Payload fields:** `{session_id, hook_event_name: 'StopFailure', error, error_details?, last_assistant_message?}`
- **Implementation:**
  - [x] Create `hooks/stopFailure.js` — POST to `/api/hook/stopFailure`
  - [x] Add endpoint in `server.js`
  - [x] Show error on D200: red info display with error type
  - [x] Transition to IDLE after display (session turn ended with error)
  - [x] Register in plugin `hooks.json` under `StopFailure`

---

## MEDIUM Priority — Protocol Enhancements

### 7. Use `updatedPermissions` instead of direct settings.local.json write — IN PROGRESS
- **Current:** Hook response now includes `updatedPermissions` in correct format
- **Status:** `_persistAlwaysAllowRules()` kept as fallback with log marker
- **Implementation:**
  - [x] Update `buildHookResponse()` — return `{behavior: 'allow', updatedPermissions: [suggestion]}`
  - [x] Add fallback log marker to identify when direct write triggers
  - [ ] Live test: verify Claude Code applies rules from hook response natively
  - [ ] Remove `_persistAlwaysAllowRules()` after confirming native persistence

### 8. ~~Leverage PreToolUse permission decisions~~ — REMOVED
- **Reason:** Claude Code's internal auto-mode classifier (LLM-based) and permission rules already handle auto-approval. Auto-approved tools never fire PermissionRequest, so they never reach the deck. A bridge-side rule engine would be redundant.

### 9. Inject `additionalContext` from D200 actions — FUTURE FEATURE
- **Current:** Button presses only resolve permission — no context to model
- **Limitation:** Physical deck buttons cannot carry text input
- **Future:** Virtual DJ dashboard can add a text input box alongside approve/deny buttons
  - Text input → button press flow: user types note → presses approve → note sent as `additionalContext`
  - Model receives as system-reminder in conversation
  - Very useful for "approved with caution" or conditional approval notes
- **Implementation (deferred):**
  - [ ] Add text input field to virtual DJ permission view (not physical deck)
  - [ ] Include text as `additionalContext` in hook response
  - [ ] Model receives as system-reminder in conversation

### 10. Add Notification hook — bridge log only (no D200 display)
- **Limitation:** D200 info display is non-interactive and already used for state — notifications cannot be shown as toast without conflicting with current state display
- **Scope:** Receive notifications at bridge, log them, but do not display on deck
- **Payload:** `{session_id, message, title?, notification_type}`
- **Implementation:**
  - [x] Create `hooks/notification.js` — POST to `/api/hook/notification`
  - [x] Add endpoint in `server.js` — log notification, no display
  - [x] Register in plugin `hooks.json` under `Notification`

---

## LOW Priority — Future Considerations

### 11. Task progress monitoring (TaskCreated/TaskCompleted) — DONE (log only)
- [x] Hook scripts + bridge endpoint — log task events
- [ ] Future: dashboard panel with task list and completion tracking

### 12. PreCompact/PostCompact awareness — DONE (log only)
- [x] Hook scripts + bridge endpoint — log compaction events
- [ ] Future: show "compacting..." animation on D200

### 13. TeammateIdle tracking — DONE (log only)
- [x] Hook script + bridge endpoint — log teammate idle events
- [ ] Future: team workflow visualization on dashboard

### 14. Bridge control_request protocol (SDK-level)
- Direct WebSocket integration with Claude Code SDK
- Bypass hook HTTP overhead
- Requires Claude Code SDK to expose control protocol publicly

---

## Reference: Full Hook Payload Schemas

<details>
<summary>SessionStart input</summary>

```json
{
  "session_id": "string",
  "transcript_path": "string",
  "cwd": "string",
  "hook_event_name": "SessionStart",
  "source": "startup | resume | clear | compact",
  "agent_type": "string?",
  "model": "string?"
}
```
</details>

<details>
<summary>SessionEnd input</summary>

```json
{
  "session_id": "string",
  "hook_event_name": "SessionEnd",
  "reason": "clear | resume | logout | prompt_input_exit | other"
}
```
</details>

<details>
<summary>PostToolUseFailure input</summary>

```json
{
  "session_id": "string",
  "tool_name": "string",
  "tool_input": {},
  "tool_use_id": "string",
  "error": "string",
  "is_interrupt": "boolean?"
}
```
</details>

<details>
<summary>UserPromptSubmit input</summary>

```json
{
  "session_id": "string",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "string"
}
```
</details>

<details>
<summary>StopFailure input</summary>

```json
{
  "session_id": "string",
  "hook_event_name": "StopFailure",
  "error": {},
  "error_details": "string?",
  "last_assistant_message": "string?"
}
```
</details>

<details>
<summary>Notification input</summary>

```json
{
  "session_id": "string",
  "hook_event_name": "Notification",
  "message": "string",
  "title": "string?",
  "notification_type": "string"
}
```
</details>

<details>
<summary>PreToolUse permission response</summary>

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow | deny | ask",
    "permissionDecisionReason": "string?",
    "updatedInput": {},
    "additionalContext": "string?"
  }
}
```
</details>

<details>
<summary>PermissionRequest response (full)</summary>

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow | deny",
      "updatedInput": {},
      "updatedPermissions": [
        {
          "rule": "Bash(npm test)",
          "type": "tool_regex",
          "scope": "session | project"
        }
      ],
      "message": "string?"
    }
  }
}
```
</details>
