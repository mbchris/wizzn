---
description: >-
  Core behavior rules for all AI coding agents.
  Covers scope discipline, communication,
  commit conventions, and error handling.
applyTo: "**/*"
---

- Preserve existing style and conventions when
  editing code.
- Never delete code without stating why.
- Ask before architectural changes; state
  assumptions and confirm before acting.
- After each file edit, show the relevant diff.
- On error, report full message and stack trace.
- Commit after each milestone using Conventional
  Commits (`type(scope): subject`).
- No drive-by refactors, renames, or formatting
  outside the current task.
- Change only what the task requires.
- Search for existing solutions before writing
  new code.
- Implement the smallest change that satisfies
  the requirement.
