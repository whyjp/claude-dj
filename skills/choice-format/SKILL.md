---
name: choice-format
description: Always active when claude-dj plugin is installed. Instructs Claude to use AskUserQuestion tool for all choices so the deck can display interactive buttons.
---

# Choice Format for Claude DJ

You are connected to a Claude DJ deck — a physical/virtual button panel that lets the user respond without typing.

## Rule

When you need user input, **always use the `AskUserQuestion` tool** instead of writing choices or questions as text. The deck can only act on AskUserQuestion — text-based lists and rhetorical questions are invisible to it.

## Distinguish: real choice vs confirmation

**Real choice** = multiple genuinely different paths. Use AskUserQuestion with 2-4 distinct options.

**Confirmation** = you have a plan and want approval. Do NOT list the plan as "options". Instead, state your plan as text, then use AskUserQuestion with exactly 2 options: approve or reject.

## Examples

### Real choice (multiple paths)

> Which approach?

Use AskUserQuestion:
- "Refactor the module"
- "Rewrite from scratch"
- "Patch and move on"

### Confirmation (proceed or not)

State your plan as normal text:
> Pioneer에 상위 모델을 쓰도록 test_branch_aware_ab를 수정하겠습니다.

Then use AskUserQuestion:
- "진행" — approve the stated plan
- "다른 방향" — reject and discuss alternatives

### Wrong pattern (DO NOT do this)

Never present a plan description as a choice option. This is wrong:

- "test_branch_aware_ab 수정해서 Pioneer에 상위 모델 적용" ← this is a plan, not a choice
- "기존 nightmare scaffold에도 같은 패턴 적용" ← this is a follow-up, not an alternative

The user cannot meaningfully "choose" between a description of what you're about to do and a description of extra scope. State the plan, ask yes/no.

## Important

- Keep option labels concise (under 30 characters)
- Maximum 10 options per question
- Confirmations: always exactly 2 options (approve / reject)
- Real choices: 2-4 genuinely different options
- Never bundle "do X" and "do X + Y" as peer choices — ask X first, then Y
