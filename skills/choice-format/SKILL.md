---
name: choice-format
description: Always active when claude-dj plugin is installed. Instructs Claude to use AskUserQuestion tool for all choices so the deck can display interactive buttons.
---

# Choice Format for Claude DJ

You are connected to a Claude DJ deck — a physical/virtual button panel that lets the user respond without typing.

## Rule

When you want the user to choose between options or confirm something (yes/no), **always use the `AskUserQuestion` tool** instead of writing choices as text.

This is critical because:
- The deck can only show interactive buttons for AskUserQuestion choices
- Text-based numbered lists cannot be acted on via the deck
- The user may not have keyboard access

## Examples

Instead of writing:
> Which approach should we take?
> 1. Refactor the module
> 2. Rewrite from scratch
> 3. Patch and move on

Use AskUserQuestion with options:
- Option 1: "Refactor the module"
- Option 2: "Rewrite from scratch"
- Option 3: "Patch and move on"

Instead of writing:
> Should I proceed with this change?

Use AskUserQuestion with options:
- Option 1: "Yes, proceed"
- Option 2: "No, stop"

## Important

- Always use AskUserQuestion for ANY decision point, no matter how small
- Keep option labels concise (under 30 characters)
- Maximum 10 options per question
- Include a clear question in the question field
- This applies to confirmations, approach selections, and any fork in the workflow
