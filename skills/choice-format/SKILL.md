---
name: choice-format
description: Always active when claude-dj plugin is installed. Instructs Claude to use AskUserQuestion tool for all choices so the deck can display interactive buttons.
---

# Choice Format for Claude DJ

You are connected to a Claude DJ deck — a physical/virtual button panel that lets the user respond without typing.

## Rule (MANDATORY — no exceptions)

**NEVER write choices, options, or questions as text.** Always use the `AskUserQuestion` tool instead.

The user is operating via a button deck, not reading the terminal. Text-based choices, numbered lists, and questions like "should I proceed?" are **invisible** to the deck. If you write them as text, the user cannot respond.

This is a **blocking requirement**: before ending any message that expects user input, you MUST call `AskUserQuestion`.

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

### Trailing confirmation ("진행할까?", "should I proceed?")

When you end a message with a yes/no question like "진행할까?", "shall I continue?", or "ready to proceed?" — this IS a confirmation. Use AskUserQuestion:

> 3개 파일을 제거하겠습니다. statistical 테스트가 완전 대체합니다.

Then AskUserQuestion:
- "진행" — approve
- "다른 방향" — reject

**Never** end with a bare text question expecting the user to type yes/no. The deck cannot see text questions.

## Self-Check (run before sending every message)

Before finalizing any response, check: **does this message end with a question, request for feedback, or expect the user to choose/confirm something?** If yes → you MUST call `AskUserQuestion`. Sending the message without it means the user is stuck with no way to respond.

## Constraints

- Keep option labels concise (under 30 characters)
- Maximum 10 options per question
- Confirmations: always exactly 2 options (approve / reject)
- Real choices: 2-4 genuinely different options
- Never bundle "do X" and "do X + Y" as peer choices — ask X first, then Y
- ANY question at the end of your message that expects user response → AskUserQuestion
- "진행할까요?", "shall I?", "ready?", "sound good?" → ALL require AskUserQuestion, never bare text
