# Auto Mode Compatibility

## Problem

When Claude Code runs with `--dangerously-skip-permissions` or `acceptEdits` mode, the `choice-format` skill creates a conflict:

1. **choice-format** instructs Claude to always use `AskUserQuestion` for choices
2. **Auto mode** auto-approves all tool permissions, including `AskUserQuestion`
3. Claude receives an empty or default answer instead of a real user selection
4. This defeats the purpose of the skill and may cause Claude to behave unexpectedly

## Affected Paths

| Path | Auto mode impact |
|---|---|
| **AskUserQuestion (permission hook)** | Broken — auto-approved with no real answer |
| **Stop hook proxy** | Unaffected — Stop hooks fire regardless of permission mode |
| **Binary permissions (Allow/Deny)** | N/A — auto mode handles these natively |

## Stop Hook Proxy as Safety Net

The stop hook proxy (v0.3.11) works independently of the permission system:
- Detects text choices via regex/fence parsing in the transcript
- Uses `decision: "block"` to inject the selection back to Claude
- This path is actually **more reliable** in auto mode since it doesn't depend on PermissionRequest

## Proposed Solution

### Option A: Conditional SKILL.md Rules
Add auto-mode detection to SKILL.md:
- If auto mode detected → skip AskUserQuestion enforcement
- Rely on stop hook proxy for all choice interception
- Detection method: check for environment variable or hook context

### Option B: Hook-Level Detection
In `permission.js`, detect if auto-approve is active:
- If AskUserQuestion is auto-approved with empty answer → log warning
- Bridge could detect the pattern and fall back to stop proxy

### Option C: Ignore
Auto mode users typically don't use the deck — they want fully unattended operation. The conflict is theoretical since these users wouldn't be watching the dashboard.

## Priority

Low — auto mode and deck usage are mutually exclusive use cases in practice.

## Related

- `choice-format` skill: `claude-plugin/skills/choice-format/SKILL.md`
- Stop hook proxy: `claude-plugin/hooks/stop.js`
- Permission hook: `claude-plugin/hooks/permission.js`
