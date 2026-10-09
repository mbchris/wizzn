---
name: caveman-commit
description: >
  Ultra-compressed commit message generator.
  Conventional Commits format. Subject ≤50 chars,
  body only when "why" isn't obvious.
  Use when user says "write a commit",
  "commit message", "generate commit",
  or invokes /caveman-commit.
inference_examples:
  - "write a commit"
  - "commit message"
  - "generate commit"
  - "/caveman-commit"
---

Write commit messages terse and exact.
Conventional Commits format. No fluff.
Why over what.

## Rules

**Subject line:**
- `<type>(<scope>): <imperative summary>`
- Types: `feat`, `fix`, `refactor`, `perf`,
  `docs`, `test`, `chore`, `build`, `ci`,
  `style`, `revert`
- Imperative mood: "add", "fix", "remove"
- ≤50 chars when possible, hard cap 72
- No trailing period

**Body (only if needed):**
- Skip when subject is self-explanatory
- Add for: non-obvious *why*, breaking changes,
  migration notes, linked issues
- Wrap at 72 chars
- Bullets `-` not `*`
- Reference issues at end: `Closes #42`

**Never include:**
- "This commit does X", "I", "we", "now"
- AI attribution (unless project convention)
- Emoji (unless project convention)
- Restating file name when scope says it

## Examples

Diff: new endpoint for user profile
- Bad: "feat: add a new endpoint to get user
  profile information from the database"
- Good:
  ```
  feat(api): add GET /users/:id/profile

  Mobile client needs profile data without
  full user payload to reduce LTE bandwidth.

  Closes #128
  ```

## Auto-Clarity

Always include body for: breaking changes,
security fixes, data migrations, reverts.

## Boundaries

Only generates commit message. Does not run
`git commit`, stage files, or amend. Output as
code block ready to paste. "stop caveman-commit"
or "normal mode": revert to verbose commit style.
