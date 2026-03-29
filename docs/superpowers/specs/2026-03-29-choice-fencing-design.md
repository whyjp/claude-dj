# Choice Fencing — Skill-Based Structured Choice Detection

> **Date:** 2026-03-29
> **Status:** Approved
> **Replaces:** Regex-only detection (kept as fallback)

---

## Problem

Current regex-based choice detection in `hooks/stop.js` scans the entire assistant message for numbered/lettered patterns. This causes:

1. **False positives** — example code blocks, explanations, and non-choice numbered lists trigger detection
2. **Index collisions** — separate lists merge into one (e.g., two `1. / 2.` lists become `1,2,1,2`)
3. **No implicit choice support** — "Should I proceed?" yes/no questions go undetected

## Solution

Add a **claude-dj plugin skill** that instructs Claude to wrap choices in HTML comment fences. The stop hook parser prioritizes fences over regex, eliminating false positives.

## Architecture

```
Claude (with choice-format skill active)
  → Wraps choices in <!-- claude-dj-choices --> fence
  → Stop hook parses fence from transcript
  → Bridge receives structured choices
  → Deck shows buttons with correct indices
  → User presses button
  → events.jsonl → UserPromptSubmit → Claude
```

### Fallback Chain

```
1. Fence marker found     → parse fence contents only (100% accurate)
2. No fence found         → existing regex patterns (backward compatible)
3. No regex match either  → no choices, deck dims
```

## Skill: `skills/choice-format/SKILL.md`

### Location

```
claude-dj/
├── skills/
│   └── choice-format/
│       └── SKILL.md
```

### Behavior

The skill is **always active** when the claude-dj plugin is installed. It instructs Claude to:

- Wrap user-facing choices in `<!-- claude-dj-choices -->` / `<!-- /claude-dj-choices -->` fences
- Wrap yes/no confirmation questions the same way
- Use `index. label` format inside fences (index = number, letter, or number-letter combo)
- Never fence numbered lists in code examples, explanations, or non-choice content

### Fence Format

```markdown
Which approach should we take?

<!-- claude-dj-choices -->
1. Refactor the module
2. Rewrite from scratch
  2a. With new schema
  2b. Keep existing schema
3. Patch and move on
<!-- /claude-dj-choices -->
```

Confirmation question:
```markdown
Apply this change?

<!-- claude-dj-choices -->
1. Yes
2. No
<!-- /claude-dj-choices -->
```

### Index Formats Supported

| Format | Example | Use case |
|--------|---------|----------|
| Number | `1.` `2.` `3.` | Flat numeric list |
| Letter | `A.` `B.` `C.` | Letter-based options |
| Number-letter | `1a.` `1b.` `2a.` | Hierarchical choices |

Delimiters: `.` `)` `:` `]` are all accepted after the index.

## Parser Changes: `hooks/stop.js`

### Fence Parser (new, priority)

1. Search last assistant message for `<!-- claude-dj-choices -->` opening marker
2. Extract content between opening and closing `<!-- /claude-dj-choices -->` markers
3. Parse each non-empty line with: `/^\s*([A-Za-z0-9]+(?:[a-z])?)[.):\]]\s*(.+)/`
4. Return `[{index: "1", label: "Refactor the module"}, ...]`

If multiple fence blocks exist in one message, use the **last** one (most recent choice).

### Regex Fallback (existing, unchanged)

When no fence is found, existing 4-pattern regex runs as before. This ensures backward compatibility for sessions where the skill is not loaded.

## Data Flow

### Choice Detection

```
Stop hook fires
  → Read transcript_path (last assistant message)
  → parseFencedChoices(text)
     → Found? Return choices array
     → Not found? parseRegexChoices(text) (existing logic)
  → POST /api/hook/stop with _djChoices
```

### Deck Display

Choices are flattened into slots 0-9:

| Slot | Index Display | Label |
|------|--------------|-------|
| 0 | `1` | Refactor the module |
| 1 | `2` | Rewrite from scratch |
| 2 | `2a` | With new schema |
| 3 | `2b` | Keep existing schema |
| 4 | `3` | Patch and move on |

Hierarchical choices are displayed flat — the index string (`2a`, `2b`) distinguishes depth.

### Button Press → Claude

```
User presses slot 2
  → events.jsonl: {"type":"button","value":"2a. With new schema","timestamp":...}
  → UserPromptSubmit hook reads events
  → additionalContext: "User selected via deck: 2a. With new schema"
```

## Frontend Changes

### Button Index Display

Current: `_setKeyChoice(slot, ci, num, label)` — `num` is always a number.
Change: `num` becomes a string (`"1"`, `"2a"`, `"A"`) to support all index formats.

No other FE changes needed — the renderer already handles string display.

## Testing

### Unit Tests (stop.js parser)

- Fence with numeric choices → correct extraction
- Fence with letter choices → correct extraction
- Fence with hierarchical choices (1a, 1b) → correct extraction
- Multiple fences → last fence used
- No fence → regex fallback triggers
- Fence in code block (``` fenced) → not matched (only HTML comment fences)
- Empty fence → no choices (returns null)

### E2E Tests

- Stop hook with fenced transcript → deck shows correct buttons
- Stop hook without fence → regex fallback works
- Button press on hierarchical choice → correct value in events.jsonl

## Scope Exclusions

- LLM-based choice detection — deferred to future phase
- Free-text input detection (`<!-- claude-dj-freetext -->`) — not needed now
- Nested/collapsible choice UI — flat display only
