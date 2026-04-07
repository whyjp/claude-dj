---
name: choice-format
description: Always active when claude-dj plugin is installed. Instructs Claude to use AskUserQuestion tool for all choices so the deck can display interactive buttons.
---

# Claude DJ — Deck Button Rule

The user controls this session via a button deck. They cannot type responses. Every user decision MUST go through `AskUserQuestion`.

## The One Rule

**If your message expects ANY response from the user → call `AskUserQuestion` before the message ends.**

No exceptions. No text-only questions. No numbered lists for the user to pick from. If you skip AskUserQuestion, the user is stuck — they literally cannot respond.

## How to Apply

1. Write your explanation, plan, or analysis as normal text
2. Before ending, ask yourself: "Am I expecting the user to react?"
3. If yes → call `AskUserQuestion` with options

## Patterns That MUST Use AskUserQuestion

### Choice (2-4 genuinely different paths)
```
AskUserQuestion: ["Refactor", "Rewrite", "Patch"]
```

### Confirmation (approve/reject a plan you just stated)
```
AskUserQuestion: ["Proceed", "Different approach"]
AskUserQuestion: ["진행", "다른 방향"]
```

### Plan/Approach Selection (multiple strategies or phases)
When presenting plans, approaches, strategies, or implementation options:
```
# BAD — user cannot respond:
P1. Incremental refactor
P2. Full rewrite
P3. Hybrid approach
어떤 방향으로?

# GOOD — user can press a button:
[explain plans as text, then:]
AskUserQuestion: ["P1: Incremental", "P2: Full rewrite", "P3: Hybrid"]
```

### Multi-Option Lists (features, tasks, priorities)
When listing items for the user to pick from:
```
# BAD:
a) Add caching
b) Fix auth
c) Update docs
d) Refactor API

# GOOD:
AskUserQuestion: ["Add caching", "Fix auth", "Update docs", "Refactor API"]
```

### Superpowers / Plan Mode Outputs
When ANY skill or workflow presents options (plan mode, superpowers, etc.),
YOU must still wrap the final selection in AskUserQuestion. The deck cannot
read text-only choices regardless of which skill generated them.

Never put plan descriptions as choice options. State the plan as text, then confirm.

## Common Mistakes to Avoid

These ALL require AskUserQuestion — never write them as bare text:

| Text pattern | → AskUserQuestion |
|---|---|
| "shall I proceed?" / "진행할까요?" | `["Proceed", "Different approach"]` |
| "should I commit?" / "커밋할까요?" | `["Commit", "Not yet"]` |
| "what's next?" / "다음은?" | `["Task A", "Task B", "Task C"]` |
| "sound good?" / "괜찮나요?" | `["Proceed", "Needs changes"]` |
| "which approach?" / "어떤 방향?" | `["Option A", "Option B"]` |
| Numbered lists (1. X / 2. Y) | `["X", "Y"]` |
| Lettered lists (A. X / B. Y) | `["X", "Y"]` |
| Plan options (P1 / P2 / P3) | `["P1: label", "P2: label"]` |
| Phase selections (Phase 1 / Phase 2) | `["Phase 1: label", "Phase 2: label"]` |
| Priority picks (High / Medium / Low) | `["High", "Medium", "Low"]` |

## Self-Check

Before sending ANY message, scan your output for these red flags:
- Numbered or lettered list at the end → needs AskUserQuestion
- Question mark at the end → needs AskUserQuestion
- "which" / "어떤" / "어느" anywhere → needs AskUserQuestion
- Multiple options described in text → needs AskUserQuestion

If you find ANY of these, add AskUserQuestion BEFORE sending.

## Fallback: Fenced Choices

When `AskUserQuestion` is unavailable (e.g., inside plan mode, third-party skills, or workflows that bypass tool calls), wrap choices in a fence block so the stop hook can detect them reliably without regex guessing:

```
[claude-dj-choices]
1. Refactor the module
2. Rewrite from scratch
3. Patch and move on
[/claude-dj-choices]
```

**Priority order:**
1. `AskUserQuestion` — always preferred (blocking, interactive)
2. `[claude-dj-choices]` fence — fallback when tool calls are not possible (detected by stop hook with 100% accuracy)
3. Bare numbered lists — last resort, detected by regex with heuristic filtering (may miss some patterns)

If you are generating choices inside a plan, skill output, or any context where AskUserQuestion might not fire, **use the fence block**.

## Exception: Direct Input Override

When another skill explicitly instructs you to **end a message without AskUserQuestion** (e.g., to trigger `WAITING_RESPONSE` / awaiting state on the deck), obey that skill for that specific step. Look for phrases like "Do NOT call AskUserQuestion" or "end your message without AskUserQuestion" — these are intentional overrides, not mistakes.

This is necessary because some deck states (like awaiting) can only be reached when Claude's response ends without a pending AskUserQuestion. If you override this with AskUserQuestion, the state becomes `WAITING_CHOICE` instead and the intended behavior is broken.

## Constraints

- Labels: max 30 chars, max 10 options
- Confirmations: always exactly 2 options
- Choices: 2-10 options (use up to 4 for simple selections)
