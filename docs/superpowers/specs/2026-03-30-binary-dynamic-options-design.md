# Binary Permission: Dynamic Options Refactor

**Date:** 2026-03-30
**Status:** Approved

## Problem

BINARY permission buttons are hardcoded as 3 fixed slots (Allow/AlwaysAllow/Deny). The `permission_suggestions` array can have 0~N items, but only `suggestions[0]` is used. FE labels are hardcoded, requiring manual changes when behavior changes.

## Design

Replace `hasAlwaysAllow` + `alwaysAllowSuggestion` with a dynamic `options[]` array in the BINARY prompt. The backend builds the options, FE just renders them.

### Prompt Structure

```js
{
  type: 'BINARY',
  toolName: 'Bash',
  command: 'curl ...',
  options: [
    { type: 'allow', label: 'Allow' },
    { type: 'addRule', label: 'AddRule', suggestion: {...}, preview: 'curl...' },
    // ... N addRule options from permission_suggestions
    { type: 'deny', label: 'Deny' }
  ]
}
```

### Slot Mapping

- Slot 0: always `allow`
- Slots 1..N: one per `permission_suggestion` (`addRule`)
- Slot N+1: always `deny`

### Changes Per File

| File | Change |
|------|--------|
| `sessionManager.js` | Build `options[]` from `permission_suggestions`. Remove `hasAlwaysAllow`/`alwaysAllowSuggestion`. |
| `buttonManager.js` | `resolvePress`: use `options[slot]` instead of hardcoded slot mapping. |
| `buttonManager.js` | `buildHookResponse`: dispatch on `option.type` (allow/addRule/deny). |
| `buttonManager.js` | `layoutFor`: pass `options` instead of raw `prompt`. |
| `d200-renderer.js` | Iterate `options[]` to render buttons. Remove hardcoded approve/always/deny for binary. |
| `server.js` | Log `options.length` and labels. Rule persistence unchanged. |
| Tests | Update to use new options structure. |

### Response Building by Type

- `allow` → `{ behavior: "allow" }`
- `addRule` → suggestion object as decision (has `behavior: "allow"` + `addRules`)
- `deny` → `{ behavior: "deny" }`

### FE Rendering

```js
// binary case — just iterate options like choice does
options.forEach((opt, slot) => _setKeyState(slot, opt.type, opt));
```

Type-to-visual mapping: `allow` → green ✅, `addRule` → yellow 🔒, `deny` → red ❌.
