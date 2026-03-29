---
name: choice-format
description: Always active when claude-dj plugin is installed. Instructs Claude to wrap user-facing choices in HTML comment fences for reliable deck button mapping.
---

# Choice Format for Claude DJ

When you present choices or yes/no confirmations to the user, wrap them in a fence block so the Claude DJ deck can display buttons automatically.

## Rules

1. When asking the user to choose between options, wrap the choices in `<!-- claude-dj-choices -->` / `<!-- /claude-dj-choices -->` fences
2. When asking a yes/no confirmation ("Should I proceed?", "Apply this change?"), also use the fence with `1. Yes` / `2. No`
3. Each choice is one line: `index. label` (index can be a number, letter, or combo like `2a`)
4. Do NOT fence numbered lists in code examples, explanations, or non-choice content
5. Write your explanation freely outside the fence — only the choices go inside

## Format

<!-- claude-dj-choices -->
1. First option
2. Second option
3. Third option
<!-- /claude-dj-choices -->

## Hierarchical Choices

<!-- claude-dj-choices -->
1. Database approach
  1a. PostgreSQL
  1b. SQLite
2. File-based approach
<!-- /claude-dj-choices -->

## Yes/No Confirmations

<!-- claude-dj-choices -->
1. Yes
2. No
<!-- /claude-dj-choices -->

## Important

- The fences are HTML comments — they are invisible to the user in rendered markdown
- Always place the fence AFTER your explanation text
- Maximum 10 choices per fence block
- Keep labels concise (under 30 characters)
