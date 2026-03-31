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

## Two Patterns

**Choice** (2-4 genuinely different paths):
```
AskUserQuestion: ["Refactor", "Rewrite", "Patch"]
```

**Confirmation** (approve/reject a plan you just stated):
```
AskUserQuestion: ["Proceed", "Different approach"]
AskUserQuestion: ["진행", "다른 방향"]          # Korean session
```

Never put plan descriptions as choice options. State the plan as text, then confirm.

## Common Mistakes to Avoid

These ALL require AskUserQuestion — never write them as bare text:

| Text question | → AskUserQuestion |
|---|---|
| "shall I proceed?" / "진행할까요?" | `["Proceed", "Different approach"]` |
| "should I commit?" / "커밋할까요?" | `["Commit", "Not yet"]` |
| "what's next?" / "다음은?" | `["Task A", "Task B", "Task C"]` |
| "sound good?" / "괜찮나요?" | `["Proceed", "Needs changes"]` |
| "ready?" / "준비됐나요?" | `["Proceed", "Wait"]` |
| "which approach?" / "어떤 방향?" | `["Option A", "Option B"]` |
| Numbered lists (1. X / 2. Y) | `["X", "Y"]` |

## Constraints

- Labels: max 30 chars, max 10 options
- Confirmations: always exactly 2 options
- Choices: 2-4 options
