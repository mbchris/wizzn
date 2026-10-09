---
name: pr-review-api
description: >-
  Reviews Pull Requests for Hono API, Drizzle ORM,
  and backend services, posting structured feedback.
---

# `pr-review-api`

Automates Pull Request reviews for backend changes in
`packages/api/`.

## Workflow
1. Fetch PR diff for `packages/api/`.
2. Analyze Hono route schema changes and Drizzle migrations.
3. Check for security flaws, unhandled rejections, or
   missing authorization guards.
4. Output structured review comments with suggested diffs.
